import { describe, it, expect } from "vitest";
import {
  PROVIDER_SYNC_ATTEMPTS,
  QUEUE_NAMES,
  enqueueProviderSync,
  providerSyncJobId,
  providerSyncJobOptions,
  type ProviderSyncJobData,
  type ProviderSyncJobOptions,
  type ProviderSyncQueueLike,
} from "./queues.js";

interface RecordedAdd {
  name: string;
  data: ProviderSyncJobData;
  opts: ProviderSyncJobOptions;
}

/** Mimics the part of BullMQ's contract ING-5 depends on: an `add` whose
 * jobId matches a job the queue still holds is ignored. */
function fakeQueue(): { queue: ProviderSyncQueueLike; adds: RecordedAdd[]; held: Set<string> } {
  const adds: RecordedAdd[] = [];
  const held = new Set<string>();
  const queue: ProviderSyncQueueLike = {
    async add(name, data, opts) {
      if (held.has(opts.jobId)) return { id: opts.jobId };
      held.add(opts.jobId);
      adds.push({ name, data, opts });
      return { id: opts.jobId };
    },
  };
  return { queue, adds, held };
}

describe("providerSyncJobId", () => {
  it("is derived from the connection id, so all triggers agree on it", () => {
    expect(providerSyncJobId("conn-1")).toBe("sync:conn-1");
  });

  it("differs between connections", () => {
    expect(providerSyncJobId("conn-1")).not.toBe(providerSyncJobId("conn-2"));
  });
});

describe("providerSyncJobOptions", () => {
  it("carries the dedup jobId", () => {
    expect(providerSyncJobOptions("conn-1").jobId).toBe("sync:conn-1");
  });

  it("removes finished jobs so the dedup key frees up again", () => {
    // If either of these were false, BullMQ would resolve the next
    // enqueue for this connection against the retained finished job and
    // silently drop it — the connection would never sync again.
    const opts = providerSyncJobOptions("conn-1");
    expect(opts.removeOnComplete).toBe(true);
    expect(opts.removeOnFail).toBe(true);
  });

  it("retries with exponential backoff", () => {
    const opts = providerSyncJobOptions("conn-1");
    expect(opts.attempts).toBe(PROVIDER_SYNC_ATTEMPTS);
    expect(opts.backoff.type).toBe("exponential");
    expect(opts.backoff.delay).toBeGreaterThan(0);
  });
});

describe("enqueueProviderSync", () => {
  it("enqueues onto the provider-sync queue with the connection id as payload", async () => {
    const { queue, adds } = fakeQueue();

    await enqueueProviderSync(queue, "conn-1");

    expect(adds).toHaveLength(1);
    expect(adds[0]?.name).toBe(QUEUE_NAMES.providerSync);
    expect(adds[0]?.data).toEqual({ connectionId: "conn-1" });
  });

  it("collapses repeat triggers for the same connection into one job", async () => {
    const { queue, adds } = fakeQueue();

    // A webhook retry and the scheduled poll, landing together.
    await enqueueProviderSync(queue, "conn-1");
    await enqueueProviderSync(queue, "conn-1");
    await enqueueProviderSync(queue, "conn-1");

    expect(adds).toHaveLength(1);
  });

  it("does not collapse triggers for different connections", async () => {
    const { queue, adds } = fakeQueue();

    await enqueueProviderSync(queue, "conn-1");
    await enqueueProviderSync(queue, "conn-2");

    expect(adds.map((add) => add.data.connectionId)).toEqual(["conn-1", "conn-2"]);
  });

  it("enqueues again once the previous job has been removed", async () => {
    const { queue, adds, held } = fakeQueue();

    await enqueueProviderSync(queue, "conn-1");
    held.delete(providerSyncJobId("conn-1")); // job completed, removeOnComplete fired
    await enqueueProviderSync(queue, "conn-1");

    expect(adds).toHaveLength(2);
  });
});
