// session.ts — registers cookie parsing + Redis-backed sessions
// (ADR-0018). Import order matters: @fastify/cookie must be registered
// before @fastify/session.
//
// The Redis store is hand-written (RedisSessionStore below) rather than
// pulling in `connect-redis`: @fastify/session's Store interface is the
// same tiny get/set/destroy(callback) shape express-session uses, ioredis
// is already a dependency here, and a ~30-line store avoids betting on
// connect-redis's exact version/typings for something this small.
import cookie from "@fastify/cookie";
import fastifySession, { type SessionStore } from "@fastify/session";
import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { getRedisClient } from "../redis.js";

const SESSION_COOKIE_NAME = "financial_os_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Derived from getRedisClient()'s own return type rather than importing
// ioredis's exported type directly -- ioredis has changed how it exports
// its class across major versions (default vs. `export =`), and this way
// the store just matches whatever getRedisClient() actually returns.
type RedisClient = ReturnType<typeof getRedisClient>;

// `Session` isn't a named export of @fastify/session -- it only shows up
// inside the package's own type declarations (which is why it appeared in
// the earlier typecheck error). Pulled structurally off SessionStore's own
// `set` method instead of guessing an export name, so this stays correct
// even if that internal type gets renamed.
type StoreSession = Parameters<SessionStore["set"]>[1];

class RedisSessionStore implements SessionStore {
  constructor(
    private readonly redis: RedisClient,
    private readonly prefix: string = "sess:",
    private readonly ttlSeconds: number = SESSION_TTL_SECONDS,
  ) {}

  private key(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }

  get(sessionId: string, callback: (err: unknown, session?: StoreSession | null) => void): void {
    this.redis
      .get(this.key(sessionId))
      .then((raw: string | null) =>
        callback(null, raw ? (JSON.parse(raw) as unknown as StoreSession) : null),
      )
      .catch((err: unknown) => callback(err));
  }

  set(sessionId: string, session: StoreSession, callback: (err?: unknown) => void): void {
    this.redis
      .set(this.key(sessionId), JSON.stringify(session), "EX", this.ttlSeconds)
      .then(() => callback())
      .catch((err: unknown) => callback(err));
  }

  destroy(sessionId: string, callback: (err?: unknown) => void): void {
    this.redis
      .del(this.key(sessionId))
      .then(() => callback())
      .catch((err: unknown) => callback(err));
  }
}

export async function registerSession(app: FastifyInstance): Promise<void> {
  await app.register(cookie);
  await app.register(fastifySession, {
    secret: env.SESSION_SECRET,
    cookieName: SESSION_COOKIE_NAME,
    store: new RedisSessionStore(getRedisClient()),
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: SESSION_TTL_SECONDS * 1000,
    },
  });
}

declare module "@fastify/session" {
  interface FastifySessionObject {
    userId?: string;
  }
}
