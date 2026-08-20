// password.ts — the only file allowed to touch bcryptjs directly
// (ADR-0018). Pure-ish wrapper functions, tested in password.test.ts per
// AGENTS.md's TDD convention.
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
