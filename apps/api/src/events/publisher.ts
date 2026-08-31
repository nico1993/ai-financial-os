// events/publisher.ts — ANLY-8's SSE fan-out (ARCHITECTURE.md §4.3,
// ADR-0007, ADR-0037). Three BullMQ `QueueEvents` listeners (one per
// queue whose completion the dashboard cares about) translate a raw
// job-completed signal into a typed, per-user `DashboardEvent` and hand
// it to every subscriber -- ../routes/events.ts's SSE route is the only
// subscriber today, kept separate so the pub/sub plumbing here has no
// Fastify dependency of its own.
import { Job, Queue, QueueEvents } from "bullmq";
import { ConnectionRepository } from "@financial-os/db";
import { QUEUE_NAMES } from "@financial-os/shared";
import { getEventsConnection, getQueueConnection } from "../redis.js";

const connections = new ConnectionRepository();

export type DashboardEvent =
  | { type: "sync.completed"; userId: string; connectionId: string }
  | { type: "transfer.matched"; userId: string }
  | { type: "rollup.completed"; userId: string };

type Listener = (event: DashboardEvent) => void;

const listeners = new Set<Listener>();

/** ../routes/events.ts calls this once per connected SSE client. Returns
 * an unsubscribe function -- called when that client disconnects. */
export function subscribeToDashboardEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(event: DashboardEvent): void {
  for (const listener of listeners) listener(event);
}

let providerSyncEvents: QueueEvents | undefined;
let transferMatchingEvents: QueueEvents | undefined;
let rollupsEvents: QueueEvents | undefined;
let providerSyncLookupQueue: Queue | undefined;
let transferMatchingLookupQueue: Queue | undefined;
let rollupsLookupQueue: Queue | undefined;

/** Starts the three listeners. Idempotent -- safe to call more than once
 * (a second call is a no-op), since apps/api/src/index.ts calls this
 * unconditionally at boot alongside buildServer(). */
export function startDashboardEventPublisher(): void {
  if (providerSyncEvents) return;

  // QueueEvents' own `completed` payload only carries {jobId,
  // returnvalue} -- not the job's DATA, which is what actually identifies
  // *whose* dashboard this event belongs to (a connectionId or userId).
  // Job.fromId() looks that up; a plain (non-blocking) lookup Queue per
  // queue is enough for that, sharing the same connection
  // getQueueConnection() already uses for producing jobs elsewhere in
  // this app.
  providerSyncLookupQueue = new Queue(QUEUE_NAMES.providerSync, {
    connection: getQueueConnection(),
  });
  transferMatchingLookupQueue = new Queue(QUEUE_NAMES.transferMatching, {
    connection: getQueueConnection(),
  });
  rollupsLookupQueue = new Queue(QUEUE_NAMES.rollups, { connection: getQueueConnection() });

  providerSyncEvents = new QueueEvents(QUEUE_NAMES.providerSync, {
    connection: getEventsConnection(),
  });
  providerSyncEvents.on("completed", ({ jobId }) => {
    void (async () => {
      const job = await Job.fromId(providerSyncLookupQueue!, jobId);
      const connectionId = (job?.data as { connectionId?: string } | undefined)?.connectionId;
      if (!connectionId) return;
      const connection = await connections.findById(connectionId);
      if (!connection) return;
      publish({ type: "sync.completed", userId: connection.userId, connectionId });
    })();
  });

  transferMatchingEvents = new QueueEvents(QUEUE_NAMES.transferMatching, {
    connection: getEventsConnection(),
  });
  transferMatchingEvents.on("completed", ({ jobId }) => {
    void (async () => {
      const job = await Job.fromId(transferMatchingLookupQueue!, jobId);
      const userId = (job?.data as { userId?: string } | undefined)?.userId;
      if (!userId) return;
      publish({ type: "transfer.matched", userId });
    })();
  });

  rollupsEvents = new QueueEvents(QUEUE_NAMES.rollups, { connection: getEventsConnection() });
  rollupsEvents.on("completed", ({ jobId }) => {
    void (async () => {
      const job = await Job.fromId(rollupsLookupQueue!, jobId);
      const userId = (job?.data as { userId?: string } | undefined)?.userId;
      if (!userId) return;
      publish({ type: "rollup.completed", userId });
    })();
  });

  for (const events of [providerSyncEvents, transferMatchingEvents, rollupsEvents]) {
    events.on("error", (err) => {
      console.error("[events] QueueEvents connection error:", err);
    });
  }
}

export async function stopDashboardEventPublisher(): Promise<void> {
  await Promise.all([
    providerSyncEvents?.close(),
    transferMatchingEvents?.close(),
    rollupsEvents?.close(),
    providerSyncLookupQueue?.close(),
    transferMatchingLookupQueue?.close(),
    rollupsLookupQueue?.close(),
  ]);
  providerSyncEvents = undefined;
  transferMatchingEvents = undefined;
  rollupsEvents = undefined;
  providerSyncLookupQueue = undefined;
  transferMatchingLookupQueue = undefined;
  rollupsLookupQueue = undefined;
}
