import { describe, it, expect } from "vitest";
import {
  CATEGORIZE_LLM_ATTEMPTS,
  PROVIDER_SYNC_ATTEMPTS,
  QUEUE_NAMES,
  ROLLUP_ATTEMPTS,
  TRANSFER_MATCHING_ATTEMPTS,
  categorizeLlmJobId,
  categorizeLlmJobOptions,
  enqueueCategorizeLlm,
  enqueueProviderSync,
  enqueueRollup,
  enqueueTransferMatching,
  providerSyncJobId,
  providerSyncJobOptions,
  rollupJobOptions,
  transferMatchingJobId,
  transferMatchingJobOptions,
  type CategorizeLlmJobData,
  type CategorizeLlmJobOptions,
  type CategorizeLlmQueueLike,
  type ProviderSyncJobData,
  type ProviderSyncJobOptions,
  type ProviderSyncQueueLike,
  type RollupJobData,
  type RollupJobOptions,
  type RollupQueueLike,
  type TransferMatchingJobData,
  type TransferMatchingJobOptions,
  type TransferMatchingQueueLike,
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

interface RecordedCategorizeAdd {
  name: string;
  data: CategorizeLlmJobData;
  opts: CategorizeLlmJobOptions;
}

/** Same dedup mimicry as fakeQueue(), for the categorize-llm queue. */
function fakeCategorizeQueue(): {
  queue: CategorizeLlmQueueLike;
  adds: RecordedCategorizeAdd[];
  held: Set<string>;
} {
  const adds: RecordedCategorizeAdd[] = [];
  const held = new Set<string>();
  const queue: CategorizeLlmQueueLike = {
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
    expect(providerSyncJobId("conn-1")).toBe("sync-conn-1");
  });

  it("differs between connections", () => {
    expect(providerSyncJobId("conn-1")).not.toBe(providerSyncJobId("conn-2"));
  });

  it("contains no colon, which BullMQ rejects outright", () => {
    // Not a style preference: BullMQ throws `Custom Id cannot contain :`
    // because colons are its Redis key separator. The id sketched in
    // ARCHITECTURE.md §2.2 used one, so every enqueue threw and ING-5's
    // dedup never ran once -- caught only by an end-to-end run, because
    // the original version of this very test asserted the broken value.
    expect(providerSyncJobId("507f1f77bcf86cd799439011")).not.toContain(":");
  });
});

describe("providerSyncJobOptions", () => {
  it("carries the dedup jobId", () => {
    // Hyphen, not colon -- see providerSyncJobId's "contains no colon"
    // test above. This assertion itself used to read "sync:conn-1", a
    // leftover from before the ADR-0022 fix that never got updated here;
    // it was passing only because it was asserting the same wrong value
    // the (also since-fixed) implementation used to return.
    expect(providerSyncJobOptions("conn-1").jobId).toBe("sync-conn-1");
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

describe("categorizeLlmJobId", () => {
  it("is derived from the user id, so all triggers agree on it", () => {
    expect(categorizeLlmJobId("user-1")).toBe("categorize-user-1");
  });

  it("differs between users", () => {
    expect(categorizeLlmJobId("user-1")).not.toBe(categorizeLlmJobId("user-2"));
  });

  it("contains no colon, which BullMQ rejects outright", () => {
    // Same BullMQ constraint providerSyncJobId guards against (ADR-0022):
    // a custom job id containing ":" throws at enqueue time.
    expect(categorizeLlmJobId("507f1f77bcf86cd799439011")).not.toContain(":");
  });
});

describe("categorizeLlmJobOptions", () => {
  it("carries the dedup jobId", () => {
    expect(categorizeLlmJobOptions("user-1").jobId).toBe("categorize-user-1");
  });

  it("removes finished jobs so the dedup key frees up again", () => {
    // Same load-bearing reason as providerSyncJobOptions': retaining a
    // finished job under this user's id would block every later
    // categorize-llm enqueue for them (ADR-0022).
    const opts = categorizeLlmJobOptions("user-1");
    expect(opts.removeOnComplete).toBe(true);
    expect(opts.removeOnFail).toBe(true);
  });

  it("retries with exponential backoff, fewer attempts than provider-sync", () => {
    const opts = categorizeLlmJobOptions("user-1");
    expect(opts.attempts).toBe(CATEGORIZE_LLM_ATTEMPTS);
    expect(opts.attempts).toBeLessThan(PROVIDER_SYNC_ATTEMPTS);
    expect(opts.backoff.type).toBe("exponential");
    expect(opts.backoff.delay).toBeGreaterThan(0);
  });
});

describe("enqueueCategorizeLlm", () => {
  it("enqueues onto the categorize-llm queue with the user id as payload", async () => {
    const { queue, adds } = fakeCategorizeQueue();

    await enqueueCategorizeLlm(queue, "user-1");

    expect(adds).toHaveLength(1);
    expect(adds[0]?.name).toBe(QUEUE_NAMES.categorizeLlm);
    expect(adds[0]?.data).toEqual({ userId: "user-1" });
  });

  it("collapses repeat triggers for the same user into one job", async () => {
    const { queue, adds } = fakeCategorizeQueue();

    // Several sync runs finishing back-to-back before the LLM catches up.
    await enqueueCategorizeLlm(queue, "user-1");
    await enqueueCategorizeLlm(queue, "user-1");
    await enqueueCategorizeLlm(queue, "user-1");

    expect(adds).toHaveLength(1);
  });

  it("does not collapse triggers for different users", async () => {
    const { queue, adds } = fakeCategorizeQueue();

    await enqueueCategorizeLlm(queue, "user-1");
    await enqueueCategorizeLlm(queue, "user-2");

    expect(adds.map((add) => add.data.userId)).toEqual(["user-1", "user-2"]);
  });

  it("enqueues again once the previous job has been removed", async () => {
    const { queue, adds, held } = fakeCategorizeQueue();

    await enqueueCategorizeLlm(queue, "user-1");
    held.delete(categorizeLlmJobId("user-1")); // job completed, removeOnComplete fired
    await enqueueCategorizeLlm(queue, "user-1");

    expect(adds).toHaveLength(2);
  });
});

interface RecordedTransferMatchingAdd {
  name: string;
  data: TransferMatchingJobData;
  opts: TransferMatchingJobOptions;
}

/** Same dedup mimicry as fakeQueue()/fakeCategorizeQueue(), for the
 * transfer-matching queue. */
function fakeTransferMatchingQueue(): {
  queue: TransferMatchingQueueLike;
  adds: RecordedTransferMatchingAdd[];
  held: Set<string>;
} {
  const adds: RecordedTransferMatchingAdd[] = [];
  const held = new Set<string>();
  const queue: TransferMatchingQueueLike = {
    async add(name, data, opts) {
      if (held.has(opts.jobId)) return { id: opts.jobId };
      held.add(opts.jobId);
      adds.push({ name, data, opts });
      return { id: opts.jobId };
    },
  };
  return { queue, adds, held };
}

describe("transferMatchingJobId", () => {
  it("is derived from the user id, so all triggers agree on it", () => {
    expect(transferMatchingJobId("user-1")).toBe("transfer-match-user-1");
  });

  it("differs between users", () => {
    expect(transferMatchingJobId("user-1")).not.toBe(transferMatchingJobId("user-2"));
  });

  it("contains no colon, which BullMQ rejects outright", () => {
    // Same BullMQ constraint providerSyncJobId/categorizeLlmJobId guard
    // against (ADR-0022): a custom job id containing ":" throws at
    // enqueue time.
    expect(transferMatchingJobId("507f1f77bcf86cd799439011")).not.toContain(":");
  });
});

describe("transferMatchingJobOptions", () => {
  it("carries the dedup jobId", () => {
    expect(transferMatchingJobOptions("user-1").jobId).toBe("transfer-match-user-1");
  });

  it("removes finished jobs so the dedup key frees up again", () => {
    // Same load-bearing reason as categorizeLlmJobOptions'/
    // providerSyncJobOptions' (ADR-0022): retaining a finished job under
    // this user's id would block every later transfer-matching enqueue.
    const opts = transferMatchingJobOptions("user-1");
    expect(opts.removeOnComplete).toBe(true);
    expect(opts.removeOnFail).toBe(true);
  });

  it("retries with exponential backoff, same attempts as categorize-llm", () => {
    const opts = transferMatchingJobOptions("user-1");
    expect(opts.attempts).toBe(TRANSFER_MATCHING_ATTEMPTS);
    expect(opts.attempts).toBe(CATEGORIZE_LLM_ATTEMPTS);
    expect(opts.backoff.type).toBe("exponential");
    expect(opts.backoff.delay).toBeGreaterThan(0);
  });
});

describe("enqueueTransferMatching", () => {
  it("enqueues onto the transfer-matching queue with the user id as payload", async () => {
    const { queue, adds } = fakeTransferMatchingQueue();

    await enqueueTransferMatching(queue, "user-1");

    expect(adds).toHaveLength(1);
    expect(adds[0]?.name).toBe(QUEUE_NAMES.transferMatching);
    expect(adds[0]?.data).toEqual({ userId: "user-1" });
  });

  it("collapses repeat triggers for the same user into one job", async () => {
    const { queue, adds } = fakeTransferMatchingQueue();

    // Several categorize-llm runs finishing back-to-back for the same
    // user before this queue catches up.
    await enqueueTransferMatching(queue, "user-1");
    await enqueueTransferMatching(queue, "user-1");
    await enqueueTransferMatching(queue, "user-1");

    expect(adds).toHaveLength(1);
  });

  it("does not collapse triggers for different users", async () => {
    const { queue, adds } = fakeTransferMatchingQueue();

    await enqueueTransferMatching(queue, "user-1");
    await enqueueTransferMatching(queue, "user-2");

    expect(adds.map((add) => add.data.userId)).toEqual(["user-1", "user-2"]);
  });

  it("enqueues again once the previous job has been removed", async () => {
    const { queue, adds, held } = fakeTransferMatchingQueue();

    await enqueueTransferMatching(queue, "user-1");
    held.delete(transferMatchingJobId("user-1")); // job completed, removeOnComplete fired
    await enqueueTransferMatching(queue, "user-1");

    expect(adds).toHaveLength(2);
  });
});

interface RecordedRollupAdd {
  name: string;
  data: RollupJobData;
  opts: RollupJobOptions;
}

/** No dedup to mimic here (ADR-0034) -- every add() is recorded, unlike
 * fakeQueue()/fakeCategorizeQueue()/fakeTransferMatchingQueue() above. */
function fakeRollupQueue(): { queue: RollupQueueLike; adds: RecordedRollupAdd[] } {
  const adds: RecordedRollupAdd[] = [];
  const queue: RollupQueueLike = {
    async add(name, data, opts) {
      adds.push({ name, data, opts });
      return { id: `${adds.length}` };
    },
  };
  return { queue, adds };
}

describe("rollupJobOptions", () => {
  it("carries no dedup jobId, unlike the other three queues' options", () => {
    expect(rollupJobOptions()).not.toHaveProperty("jobId");
  });

  it("removes finished jobs, for consistency with the other queues", () => {
    const opts = rollupJobOptions();
    expect(opts.removeOnComplete).toBe(true);
    expect(opts.removeOnFail).toBe(true);
  });

  it("retries with exponential backoff, same attempts as categorize-llm", () => {
    const opts = rollupJobOptions();
    expect(opts.attempts).toBe(ROLLUP_ATTEMPTS);
    expect(opts.attempts).toBe(CATEGORIZE_LLM_ATTEMPTS);
    expect(opts.backoff.type).toBe("exponential");
    expect(opts.backoff.delay).toBeGreaterThan(0);
  });
});

describe("enqueueRollup", () => {
  it("enqueues onto the rollups queue with userId + ISO bucket strings as payload", async () => {
    const { queue, adds } = fakeRollupQueue();
    const day = new Date("2026-01-15T00:00:00.000Z");
    const month = new Date("2026-01-01T00:00:00.000Z");

    await enqueueRollup(queue, "user-1", [day], [month]);

    expect(adds).toHaveLength(1);
    expect(adds[0]?.name).toBe(QUEUE_NAMES.rollups);
    expect(adds[0]?.data).toEqual({
      userId: "user-1",
      dayBuckets: [day.toISOString()],
      monthBuckets: [month.toISOString()],
    });
  });

  it("does not collapse repeat triggers -- every call enqueues its own job", async () => {
    const { queue, adds } = fakeRollupQueue();
    const day = new Date("2026-01-15T00:00:00.000Z");

    // Unlike the other three queues' dedup, two triggers for the same user
    // must both survive: each could carry a different bucket list.
    await enqueueRollup(queue, "user-1", [day], []);
    await enqueueRollup(queue, "user-1", [day], []);

    expect(adds).toHaveLength(2);
  });

  it("is a no-op when both bucket lists are empty", async () => {
    const { queue, adds } = fakeRollupQueue();

    await enqueueRollup(queue, "user-1", [], []);

    expect(adds).toHaveLength(0);
  });

  it("still enqueues when only one of the two bucket lists is non-empty", async () => {
    const { queue, adds } = fakeRollupQueue();
    const month = new Date("2026-02-01T00:00:00.000Z");

    await enqueueRollup(queue, "user-1", [], [month]);

    expect(adds).toHaveLength(1);
    expect(adds[0]?.data.dayBuckets).toEqual([]);
    expect(adds[0]?.data.monthBuckets).toEqual([month.toISOString()]);
  });
});
