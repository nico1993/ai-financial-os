// redis.ts — the one place apps/api constructs an ioredis client. Session
// storage (auth/session.ts) is the only consumer today; if apps/api ever
// needs a BullMQ producer too (e.g. enqueueing a provider-sync job from a
// route), give it its own client rather than reusing this one.
// Named import, not `import Redis from "ioredis"` -- ioredis's real .d.ts
// merges a class declaration with a namespace of the same name, and under
// NodeNext/verbatimModuleSyntax a default import resolves to the
// namespace half only ("Cannot use namespace 'Redis' as a type").
import { Redis } from "ioredis";
import { env } from "./env.js";

let client: Redis | undefined;

export function getRedisClient(): Redis {
  client ??= new Redis(env.REDIS_URL);
  return client;
}
