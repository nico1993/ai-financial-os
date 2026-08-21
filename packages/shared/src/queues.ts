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
  categorizeLlm: "categorize-llm",
  transferMatching: "transfer-matching",
  rollups: "rollups",
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
 * collapse into one drain instead of two racing on the cursor. */
export function providerSyncJobId(connectionId: string): string {
  return `sync:${connectionId}`;
}

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
