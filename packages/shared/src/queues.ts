// Queue names, job payload shapes, and enqueue options — the contract
// between the process that enqueues and the process that consumes.
//
// This lives in packages/shared rather than apps/worker because both sides
// need it and apps must not import each other (§7.1): the Plaid webhook
// receiver and the scheduled fallback poll (both apps/api, ING-7/ING-8)
// enqueue provider-sync jobs that apps/worker processes. Names, payload
// shapes, and job options are shared; the BullMQ Queue and Worker
// instances stay in their respective apps. Nothing here imports bullmq —
// the option shapes below are structurally compatible with its
// `JobsOptions`, which keeps this package dependency-free.

export const QUEUE_NAMES = {
  providerSync: "provider-sync",
  /** ING-8's webhook-miss safety net. A separate queue from provider-sync
   * on purpose (ADR-0025): provider-sync jobs are per-connection and
   * carry a `sync-{connectionId}` dedup id, whereas this one is a single
   * repeating fan-out with no connection of its own. */
  providerSyncScheduler: "provider-sync-scheduler",
  /** Tier 3 LLM categorization (CAT-4, ARCHITECTURE.md §2.3, ADR-0026).
   * Its own queue, separate from provider-sync, for the same reason
   * ADR-0025 gives provider-sync-scheduler one: LLM latency and
   * concurrency have nothing to do with a Plaid drain's, so mixing them
   * onto one queue would mean one's backlog blocks the other. */
  categorizeLlm: "categorize-llm",
  transferMatching: "transfer-matching",
  rollups: "rollups",
  /** ANLY-7's nightly batch job. Its own queue for the same reason
   * providerSyncScheduler gets one (ADR-0025): a repeating, payload-less
   * scheduled job, not a per-event trigger the way provider-sync/
   * categorize-llm/transfer-matching/rollups all are. */
  subscriptionDetection: "subscription-detection",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Intentionally just an id (§2.2): the handler loads the connection's
 * current cursor at execution time, so two jobs queued back to back for
 * the same connection can't race on a cursor captured at enqueue time. */
export interface ProviderSyncJobData {
  connectionId: string;
}

/** Deduplication key for the provider-sync queue (ING-5). BullMQ ignores
 * an `add` whose `jobId` matches a job it is already tracking, so a
 * webhook retry and the scheduled poll landing on the same connection
 * collapse into one drain instead of two racing on the cursor.
 *
 * The separator is a hyphen, NOT a colon. BullMQ rejects a custom job id
 * containing ":" outright (`Custom Id cannot contain :`) because it uses
 * colons as its own Redis key separator. ARCHITECTURE.md §2.2 sketches
 * this id as `sync:${connectionId}`, which throws on every enqueue —
 * see ADR-0022. */
export function providerSyncJobId(connectionId: string): string {
  return `sync-${connectionId}`;
}

/** The scheduled poll takes no payload — it derives its work list from
 * the database at run time, so a connection linked since the schedule was
 * registered is picked up without re-registering anything. */
export type ProviderSyncScheduleJobData = Record<string, never>;

/** Stable id for the repeating schedule (ING-8). BullMQ upserts a job
 * scheduler by this id, so re-registering on every worker boot updates
 * the existing schedule instead of stacking up duplicates. */
export const PROVIDER_SYNC_SCHEDULER_ID = "provider-sync-fallback-poll";

/** Stable id for ANLY-7's repeating nightly schedule -- same
 * upsert-by-id idempotency as PROVIDER_SYNC_SCHEDULER_ID above. */
export const SUBSCRIPTION_DETECTION_SCHEDULER_ID = "subscription-detection-nightly";

/** The nightly job takes no payload -- like ProviderSyncScheduleJobData,
 * it derives its own work list (every user) from the database at run
 * time, so a user created after the schedule was registered is picked up
 * without re-registering anything. */
export type SubscriptionDetectionJobData = Record<string, never>;

/** Structurally compatible with BullMQ's `JobsOptions` — declared here so
 * packages/shared doesn't need bullmq as a dependency. */
export interface ProviderSyncJobOptions {
  jobId: string;
  attempts: number;
  backoff: { type: "exponential"; delay: number };
  removeOnComplete: boolean;
  removeOnFail: boolean;
}

/** Attempts before a sync is abandoned until the next trigger. Paired with
 * exponential backoff, five attempts spans roughly 5s → 80s of retries,
 * which covers a transient Plaid blip without hammering a genuinely
 * broken Item. A provider rate-limit response is handled separately and
 * does NOT consume an attempt (ING-6). */
export const PROVIDER_SYNC_ATTEMPTS = 5;
export const PROVIDER_SYNC_BACKOFF_MS = 5_000;

/**
 * Job options for every provider-sync enqueue.
 *
 * `removeOnComplete` and `removeOnFail` are both `true`, and that is
 * load-bearing rather than housekeeping: BullMQ resolves `jobId`
 * collisions against jobs it still retains, *including finished ones*.
 * Retaining completed or failed jobs under a per-connection id would mean
 * the first sync for a connection permanently blocks every later one —
 * the dedup key would never free up. History therefore comes from logs
 * and `Connection.status` (ING-10), not from BullMQ's retained sets.
 */
export function providerSyncJobOptions(connectionId: string): ProviderSyncJobOptions {
  return {
    jobId: providerSyncJobId(connectionId),
    attempts: PROVIDER_SYNC_ATTEMPTS,
    backoff: { type: "exponential", delay: PROVIDER_SYNC_BACKOFF_MS },
    removeOnComplete: true,
    removeOnFail: true,
  };
}

/** The slice of BullMQ's `Queue` this package needs — keeps the enqueue
 * helper testable and bullmq out of packages/shared's dependencies. */
export interface ProviderSyncQueueLike {
  add(
    name: string,
    data: ProviderSyncJobData,
    opts: ProviderSyncJobOptions,
  ): Promise<{ id?: string | null } | null>;
}

/**
 * The single supported way to request a sync (ING-5). Every trigger —
 * webhook (ING-7), scheduled poll (ING-8), a manual re-sync from the UI —
 * goes through here so none of them can accidentally skip the dedup key.
 *
 * Known limitation, accepted deliberately (ADR-0022): if a trigger arrives
 * while a drain for the same connection is already *running*, the add is
 * swallowed rather than queued behind it. Plaid's cursor is drained to
 * `hasMore: false`, so the in-flight run already picks up anything Plaid
 * had when it started; only data landing after its final page waits, and
 * ING-8's scheduled poll bounds that wait.
 */
export async function enqueueProviderSync(
  queue: ProviderSyncQueueLike,
  connectionId: string,
): Promise<void> {
  await queue.add(QUEUE_NAMES.providerSync, { connectionId }, providerSyncJobOptions(connectionId));
}

/** Dedup key for the categorize-llm queue (CAT-4), mirroring ING-5's
 * providerSyncJobId: several sync runs finishing back-to-back before the
 * LLM catches up collapse onto one queued job, instead of stacking up
 * duplicates that would all query the same needs_review set. Same hyphen
 * separator as providerSyncJobId, for the same reason (ADR-0022) --
 * BullMQ rejects a custom job id containing ":". */
export function categorizeLlmJobId(userId: string): string {
  return `categorize-${userId}`;
}

/** Just the user id (ADR-0026): the job queries findNeedsReview() itself
 * at run time rather than being handed a specific transaction list at
 * enqueue time -- the same "work list comes from the database, not the
 * schedule" choice ADR-0025 makes for the fallback poll. A transaction
 * that was already needs_review before this queue existed, or one a
 * previous LLM attempt left low-confidence, is picked up by the next run
 * without any extra bookkeeping. */
export interface CategorizeLlmJobData {
  userId: string;
}

export interface CategorizeLlmJobOptions {
  jobId: string;
  attempts: number;
  backoff: { type: "exponential"; delay: number };
  removeOnComplete: boolean;
  removeOnFail: boolean;
}

/** Fewer attempts than provider-sync's, and no rate-limit handling to
 * speak of: an LLM call that still fails after its own internal retry
 * (ADR-0026 -- OllamaCategorizationProvider already retries once on a
 * totally-unparseable response) is unlikely to succeed just because
 * BullMQ tries again a few seconds later, and a local Ollama instance has
 * no external quota to wait out the way Plaid does. */
export const CATEGORIZE_LLM_ATTEMPTS = 3;
export const CATEGORIZE_LLM_BACKOFF_MS = 10_000;

/**
 * Job options for every categorize-llm enqueue. `removeOnComplete` /
 * `removeOnFail` are both `true` for the same load-bearing reason as
 * provider-sync's (ADR-0022): BullMQ resolves a `jobId` collision against
 * jobs it still retains, including finished ones, so retaining them here
 * would permanently block this user's dedup key from ever enqueueing
 * again after the first run.
 */
export function categorizeLlmJobOptions(userId: string): CategorizeLlmJobOptions {
  return {
    jobId: categorizeLlmJobId(userId),
    attempts: CATEGORIZE_LLM_ATTEMPTS,
    backoff: { type: "exponential", delay: CATEGORIZE_LLM_BACKOFF_MS },
    removeOnComplete: true,
    removeOnFail: true,
  };
}

/** The slice of BullMQ's `Queue` this package needs -- keeps the enqueue
 * helper testable and bullmq out of packages/shared's dependencies. */
export interface CategorizeLlmQueueLike {
  add(
    name: string,
    data: CategorizeLlmJobData,
    opts: CategorizeLlmJobOptions,
  ): Promise<{ id?: string | null } | null>;
}

/**
 * The single supported way to request an LLM categorization pass for a
 * user (CAT-4). Every sync run that touched transactions goes through
 * here, the same discipline enqueueProviderSync() enforces for syncs, so
 * nothing can accidentally skip the dedup key.
 */
export async function enqueueCategorizeLlm(
  queue: CategorizeLlmQueueLike,
  userId: string,
): Promise<void> {
  await queue.add(QUEUE_NAMES.categorizeLlm, { userId }, categorizeLlmJobOptions(userId));
}

/** Dedup key for the transfer-matching queue (XFER-2), mirroring
 * categorizeLlmJobId/providerSyncJobId: several categorize-llm runs
 * finishing back-to-back for the same user collapse onto one queued
 * transfer-matching job instead of stacking duplicates that would all
 * scan the same unmatched pool. Same hyphen separator, same reason
 * (ADR-0022) -- BullMQ rejects a custom job id containing ":". */
export function transferMatchingJobId(userId: string): string {
  return `transfer-match-${userId}`;
}

/** Just the user id (mirrors CategorizeLlmJobData, ADR-0025's "work list
 * from the database" principle): the job loads its own unmatched pool via
 * TransactionRepository.findUnmatchedTransferCandidates() at run time
 * rather than being handed a transaction list at enqueue time. */
export interface TransferMatchingJobData {
  userId: string;
}

export interface TransferMatchingJobOptions {
  jobId: string;
  attempts: number;
  backoff: { type: "exponential"; delay: number };
  removeOnComplete: boolean;
  removeOnFail: boolean;
}

/** Same attempts/backoff as categorize-llm's: both are pure-DB jobs with
 * no external provider quota to wait out, so there's no reason for this
 * one to retry differently. */
export const TRANSFER_MATCHING_ATTEMPTS = CATEGORIZE_LLM_ATTEMPTS;
export const TRANSFER_MATCHING_BACKOFF_MS = CATEGORIZE_LLM_BACKOFF_MS;

/**
 * Job options for every transfer-matching enqueue. `removeOnComplete` /
 * `removeOnFail` are both `true` for the same load-bearing reason as
 * categorize-llm's and provider-sync's (ADR-0022): retaining a finished
 * job under this user's dedup key would permanently block their next
 * transfer-matching enqueue.
 */
export function transferMatchingJobOptions(userId: string): TransferMatchingJobOptions {
  return {
    jobId: transferMatchingJobId(userId),
    attempts: TRANSFER_MATCHING_ATTEMPTS,
    backoff: { type: "exponential", delay: TRANSFER_MATCHING_BACKOFF_MS },
    removeOnComplete: true,
    removeOnFail: true,
  };
}

/** The slice of BullMQ's `Queue` this package needs -- keeps the enqueue
 * helper testable and bullmq out of packages/shared's dependencies. */
export interface TransferMatchingQueueLike {
  add(
    name: string,
    data: TransferMatchingJobData,
    opts: TransferMatchingJobOptions,
  ): Promise<{ id?: string | null } | null>;
}

/**
 * The single supported way to request a transfer-matching pass for a user
 * (XFER-2). categorize-llm's job calls this once its own run completes,
 * the same discipline enqueueCategorizeLlm() enforces for categorize-llm,
 * so nothing can accidentally skip the dedup key.
 */
export async function enqueueTransferMatching(
  queue: TransferMatchingQueueLike,
  userId: string,
): Promise<void> {
  await queue.add(QUEUE_NAMES.transferMatching, { userId }, transferMatchingJobOptions(userId));
}

/** Dedup key for the rollups queue -- NOT used the way
 * providerSyncJobId/categorizeLlmJobId/transferMatchingJobId are (ADR-0034).
 * Those three queues derive their whole work list from the database at run
 * time, so collapsing a duplicate enqueue onto an existing jobId is safe --
 * the surviving job still does everything the dropped one would have. A
 * rollups job instead carries a SPECIFIC bucket list as its payload (the
 * caller's own touchedDayBuckets/touchedMonthBuckets); collapsing two
 * enqueues via a shared jobId would silently drop whichever one lost the
 * dedup race, along with the bucket list it carried, and nothing would ever
 * recompute those buckets. Recompute itself is idempotent -- each bucket's
 * snapshot is derived fresh from the current Account/Transaction state,
 * never applied as an incremental delta (ADR-0034) -- so redundant,
 * overlapping rollups jobs are harmless. There is no correctness reason to
 * dedup here, only cost, and that cost is negligible at single-user scale.
 * `rollupJobOptions()` below therefore carries no `jobId` at all. */

/** ANLY-2's targeted recompute signal (ADR-0008): the day/month buckets a
 * completed provider-sync or transfer-matching run touched. ISO date
 * strings, not Date objects -- BullMQ serializes job data as JSON, so a
 * Date would round-trip as a string regardless; declaring the field as a
 * string here is honest about what the queue actually carries rather than
 * relying on an implicit coercion the type system wouldn't catch. */
export interface RollupJobData {
  userId: string;
  dayBuckets: string[];
  monthBuckets: string[];
}

export interface RollupJobOptions {
  attempts: number;
  backoff: { type: "exponential"; delay: number };
  removeOnComplete: boolean;
  removeOnFail: boolean;
}

/** Same attempts/backoff as categorize-llm's and transfer-matching's: a
 * pure-DB job with no external provider quota to wait out. */
export const ROLLUP_ATTEMPTS = CATEGORIZE_LLM_ATTEMPTS;
export const ROLLUP_BACKOFF_MS = CATEGORIZE_LLM_BACKOFF_MS;

/** Job options for every rollups enqueue. `removeOnComplete`/`removeOnFail`
 * stay `true` for consistency with the other queues (nothing here retains
 * job history as its source of truth), even though -- unlike the other
 * three -- there is no dedup jobId for retention to block. */
export function rollupJobOptions(): RollupJobOptions {
  return {
    attempts: ROLLUP_ATTEMPTS,
    backoff: { type: "exponential", delay: ROLLUP_BACKOFF_MS },
    removeOnComplete: true,
    removeOnFail: true,
  };
}

/** The slice of BullMQ's `Queue` this package needs -- keeps the enqueue
 * helper testable and bullmq out of packages/shared's dependencies. */
export interface RollupQueueLike {
  add(
    name: string,
    data: RollupJobData,
    opts: RollupJobOptions,
  ): Promise<{ id?: string | null } | null>;
}

/**
 * Requests a targeted rollup recompute (ANLY-2, ADR-0008, ADR-0034).
 * Called independently by both provider-sync's and transfer-matching's own
 * job handlers once their own writes are done, each passing its OWN
 * touchedDayBuckets/touchedMonthBuckets -- not chained through one another.
 * Transfer-matching's touched buckets only cover buckets its own matching
 * pass touched, a small subset of what provider-sync ingests, so a single
 * trigger fired only from the last pipeline stage would miss most ordinary
 * (non-transfer) transactions.
 *
 * A no-op (nothing enqueued) when both bucket lists are empty, so a
 * sync/match run that touched nothing doesn't create a job with nothing to
 * do.
 */
export async function enqueueRollup(
  queue: RollupQueueLike,
  userId: string,
  dayBuckets: readonly Date[],
  monthBuckets: readonly Date[],
): Promise<void> {
  if (dayBuckets.length === 0 && monthBuckets.length === 0) return;
  await queue.add(
    QUEUE_NAMES.rollups,
    {
      userId,
      dayBuckets: dayBuckets.map((d) => d.toISOString()),
      monthBuckets: monthBuckets.map((d) => d.toISOString()),
    },
    rollupJobOptions(),
  );
}
