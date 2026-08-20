// routes/auth.ts — register/login/logout/me (ADR-0018, AUTH-3).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UserRepository } from "@financial-os/db";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { requireAuth } from "../auth/requireAuth.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
});

const userRepo = new UserRepository();

/** Resolves req.session.destroy() to a Promise regardless of whether the
 * installed @fastify/session version also returns one -- it always
 * accepts a callback, so wrapping is safe either way. */
function destroySession(req: {
  session: { destroy: (cb: (err?: unknown) => void) => void };
}): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/register", async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid input" });
    }

    // Bootstrap-only (ADR-0018): open registration only while no user
    // exists yet, or when an already-authenticated user is adding another
    // account. Never a public signup endpoint.
    const isBootstrap = (await userRepo.count()) === 0;
    if (!isBootstrap && !req.session.userId) {
      return reply.code(403).send({ error: "registration is closed" });
    }

    const existing = await userRepo.findByEmail(parsed.data.email);
    if (existing) {
      return reply.code(409).send({ error: "email already registered" });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await userRepo.create({ email: parsed.data.email, passwordHash });

    req.session.userId = user._id.toString();
    return reply.code(201).send({ id: user._id.toString(), email: user.email });
  });

  app.post("/api/auth/login", async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid input" });
    }

    const user = await userRepo.findByEmailWithPassword(parsed.data.email);
    const valid = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
    if (!user || !valid) {
      // Same response whether the email doesn't exist or the password is
      // wrong -- don't let this endpoint reveal which emails are registered.
      return reply.code(401).send({ error: "invalid email or password" });
    }

    req.session.userId = user._id.toString();
    return reply.send({ id: user._id.toString(), email: user.email });
  });

  app.post("/api/auth/logout", async (req, reply) => {
    await destroySession(req);
    return reply.code(204).send();
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (req, reply) => {
    const user = await userRepo.findById(req.session.userId as string);
    if (!user) {
      // Session outlived the user record (e.g. deleted directly in Mongo).
      await destroySession(req);
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send({ id: user._id.toString(), email: user.email });
  });
}
