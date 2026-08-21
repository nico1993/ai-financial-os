// Queue names and job payload shapes, shared between the process that
// enqueues and the process that consumes.
//
// This lives in packages/shared rather than apps/worker because both sides
// need it and apps must not import each other (§7.1): the Plaid webhook
// receiver and the scheduled fallback poll (both apps/api, ING-7/ING-8)
// enqueue provider-sync jobs that apps/worker processes. Names and payload
// shapes are the contract between them; the BullMQ Queue and Worker
// instances stay in their respective apps.

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

/** Deduplication key for the provider-sync queue. A webhook retry and the
 * scheduled poll landing on the same connection collapse into one job
 * rather than two racing drains — ING-5 builds on this. */
export function providerSyncJobId(connectionId: string): string {
  return `sync:${connectionId}`;
}
