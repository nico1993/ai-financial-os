// redis.ts — the one place apps/api constructs ioredis clients.
//
// Named import, not `import Redis from "ioredis"` -- ioredis's real .d.ts
// merges a class declaration with a namespace of the same name, and under
// NodeNext/verbatimModuleSyntax a default import resolves to the
// namespace half only ("Cannot use namespace 'Redis' as a type").
import { Redis } from "ioredis";
import { env } from "./env.js";

let sessionClient: Redis | undefined;
let queueClient: Redis | undefined;

/** Session storage (auth/session.ts). */
export function getRedisClient(): Redis {
  sessionClient ??= new Redis(env.REDIS_URL);
  return sessionClient;
}

/** BullMQ producer connection (queues.ts), kept separate from the session
 * client on purpose: BullMQ wants `maxRetriesPerRequest: null` on the
 * connections it owns, and a stuck queue command should not be able to
 * interfere with session reads on a shared socket. */
export function getQueueConnection(): Redis {
  queueClient ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return queueClient;
}
