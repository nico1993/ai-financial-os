// redis.ts — Redis connections for apps/worker.
//
// Named import, not default: ioredis merges a class and a namespace under
// the same name, and a default import under NodeNext resolves to the
// namespace half only.
import { Redis } from "ioredis";
import { env } from "./env.js";

const connections: Redis[] = [];

/**
 * Creates a NEW connection each call. This is not wastefulness — it is
 * required.
 *
 * A BullMQ Worker consumes jobs with blocking commands (BRPOPLPUSH),
 * which monopolize the connection for the duration of the block. Two
 * Workers handed the same client therefore cannot both consume: one wins
 * the socket and the other simply never receives a job. There is no error
 * and no warning — jobs just sit in `wait` forever, which is exactly how
 * the provider-sync worker looked healthy while never picking anything up.
 *
 * Queues (producers) could safely share a connection, but they get their
 * own too: the cost is a handful of sockets, and a single factory removes
 * any chance of accidentally passing a Worker's connection to a Queue.
 *
 * `maxRetriesPerRequest: null` is separately required by BullMQ — its
 * blocking commands sit open far longer than ioredis's default retry
 * budget allows, and BullMQ refuses to start rather than misbehave later.
 */
export function createRedisConnection(): Redis {
  const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connections.push(client);
  return client;
}

/** Closes every connection handed out by createRedisConnection(). */
export async function closeRedisConnections(): Promise<void> {
  await Promise.all(connections.map((client) => client.quit().catch(() => undefined)));
  connections.length = 0;
}
