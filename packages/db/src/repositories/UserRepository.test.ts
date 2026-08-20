import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../test/mongo-memory.js";
import { UserRepository, type CreateUserInput } from "./UserRepository.js";

const db = setupTestDb();
const repo = new UserRepository();

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

function baseInput(overrides: Partial<CreateUserInput> = {}): CreateUserInput {
  return {
    email: "nico@example.com",
    passwordHash: "$2a$10$fakehashfakehashfakehashfakehashfakehashfakehashfake",
    ...overrides,
  };
}

describe("UserRepository", () => {
  it("create makes a new user", async () => {
    const created = await repo.create(baseInput());
    expect(created.email).toBe("nico@example.com");
  });

  it("create never returns passwordHash (select: false)", async () => {
    const created = await repo.create(baseInput());
    expect((created as { passwordHash?: string }).passwordHash).toBeUndefined();
  });

  it("create lowercases email", async () => {
    const created = await repo.create(baseInput({ email: "Nico@Example.com" }));
    expect(created.email).toBe("nico@example.com");
  });

  it("create rejects a duplicate email", async () => {
    await repo.create(baseInput());
    await expect(repo.create(baseInput())).rejects.toThrow();
  });

  it("findByEmail returns the user without passwordHash", async () => {
    await repo.create(baseInput());

    const found = await repo.findByEmail("nico@example.com");
    expect(found?.email).toBe("nico@example.com");
    expect((found as { passwordHash?: string } | null)?.passwordHash).toBeUndefined();
  });

  it("findByEmail is case-insensitive", async () => {
    await repo.create(baseInput());

    const found = await repo.findByEmail("NICO@EXAMPLE.COM");
    expect(found?.email).toBe("nico@example.com");
  });

  it("findByEmail returns null for an unknown email", async () => {
    const found = await repo.findByEmail("nobody@example.com");
    expect(found).toBeNull();
  });

  it("findByEmailWithPassword returns the user with passwordHash", async () => {
    const created = await repo.create(baseInput());

    const found = await repo.findByEmailWithPassword("nico@example.com");
    expect(found?.passwordHash).toBe(created ? baseInput().passwordHash : undefined);
  });

  it("findById returns the user without passwordHash", async () => {
    const created = await repo.create(baseInput());

    const found = await repo.findById(created._id.toString());
    expect(found?.email).toBe("nico@example.com");
    expect((found as { passwordHash?: string } | null)?.passwordHash).toBeUndefined();
  });

  it("count reflects the number of users", async () => {
    expect(await repo.count()).toBe(0);
    await repo.create(baseInput());
    expect(await repo.count()).toBe(1);
    await repo.create(baseInput({ email: "second@example.com" }));
    expect(await repo.count()).toBe(2);
  });
});
