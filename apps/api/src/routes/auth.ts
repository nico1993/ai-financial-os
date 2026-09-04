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

// AUTH-7: partial by design -- an omitted field means "leave it alone,"
// not "clear it" (PATCH semantics); an empty string clears firstName/
// lastName, the same clear-via-empty-string contract
// routes/accounts.ts's own rename route already established for
// Account.nickname (the route below converts that to `null` before it
// reaches UserRepository.updateProfile()).
const updateProfileSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "password must be at least 8 characters"),
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
    return reply.code(201).send({
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
    });
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
    return reply.send({
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
    });
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
    return reply.send({
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
    });
  });

  // AUTH-7: the Settings page's Profile card. Partial -- only the
  // fields present in the body are touched (updateProfileSchema's own
  // comment). A changing `email` is checked for a collision with a
  // *different* user here, not inside UserRepository.updateProfile()
  // (that method just writes what it's given) -- same 409 shape
  // register already uses for the same underlying unique-index
  // conflict, so a client sees one consistent error for "that email is
  // taken" everywhere in this app, not two.
  app.patch("/api/auth/me", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid input" });
    }

    if (parsed.data.email !== undefined) {
      const existing = await userRepo.findByEmail(parsed.data.email);
      if (existing && existing._id.toString() !== userId) {
        return reply.code(409).send({ error: "email already registered" });
      }
    }

    const updated = await userRepo.updateProfile(userId, {
      email: parsed.data.email,
      firstName:
        parsed.data.firstName !== undefined
          ? parsed.data.firstName.length > 0
            ? parsed.data.firstName
            : null
          : undefined,
      lastName:
        parsed.data.lastName !== undefined
          ? parsed.data.lastName.length > 0
            ? parsed.data.lastName
            : null
          : undefined,
    });
    if (!updated) {
      // Session outlived the user record -- same edge case GET /me
      // already handles, reached here instead if it happens between
      // requests.
      return reply.code(404).send({ error: "user not found" });
    }
    return reply.send({
      id: updated._id.toString(),
      email: updated.email,
      firstName: updated.firstName ?? null,
      lastName: updated.lastName ?? null,
    });
  });

  // AUTH-7: the Settings page's Password card. Requires the *current*
  // password (routes/auth.ts's job to verify, per UserRepository.
  // updatePassword()'s own doc comment) -- a session cookie alone
  // authenticates plenty of other actions in this app, but changing the
  // credential that would otherwise let someone back in is exactly the
  // one place worth asking again, the same reasoning AUTH-8's delete
  // route re-asks for a password rather than trusting the session
  // alone.
  app.post("/api/auth/me/password", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid input" });
    }

    const user = await userRepo.findByIdWithPassword(userId);
    const valid = user
      ? await verifyPassword(parsed.data.currentPassword, user.passwordHash)
      : false;
    if (!user || !valid) {
      // Same "don't reveal more than necessary" posture login's own
      // generic 401 already takes -- but unlike login (where the
      // ambiguity is "wrong email vs wrong password"), the account is
      // already known here (an authenticated session), so this can be
      // specific about *what* was wrong without leaking anything new.
      return reply.code(401).send({ error: "current password is incorrect" });
    }

    const newPasswordHash = await hashPassword(parsed.data.newPassword);
    await userRepo.updatePassword(userId, newPasswordHash);
    return reply.code(204).send();
  });
}
