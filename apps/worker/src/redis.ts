// redis.ts — the one place apps/worker constructs an ioredis client.
//
// Named import, not default: ioredis merges a class and a namespace under
// the same name, and a default import under NodeNext resolves to the
// namespace half only.
import { Redis } from "ioredis";
import { env } from "./env.js";

let client: Redis | undefined;

/** BullMQ requires `maxRetriesPerRequest: null` on the connection it is
 * handed — its blocking commands (BRPOPLPUSH and friends) sit open far
 * longer than ioredis's default retry budget allows, and BullMQ throws at
 * startup rather than misbehaving later if the option is left at its
 * default. */
export function getRedisConnection(): Redis {
  client ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return client;
}
