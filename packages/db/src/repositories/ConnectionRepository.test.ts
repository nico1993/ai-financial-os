import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../test/mongo-memory.js";
import { ConnectionRepository } from "./ConnectionRepository.js";

const db = setupTestDb();
const repo = new ConnectionRepository();

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

describe("ConnectionRepository", () => {
  it("upsertFromSync creates a new connection", async () => {
    const created = await repo.upsertFromSync({
      userId: "user-1",
      provider: "plaid",
      providerItemId: "item-1",
      institutionName: "Chase",
    });

    expect(created.institutionName).toBe("Chase");
    expect(created.status).toBe("active");
  });

  it("upsertFromSync updates the same connection instead of duplicating it", async () => {
    await repo.upsertFromSync({
      userId: "user-1",
      provider: "plaid",
      providerItemId: "item-1",
      institutionName: "Chase",
    });
    await repo.upsertFromSync({
      userId: "user-1",
      provider: "plaid",
      providerItemId: "item-1",
      institutionName: "Chase Bank",
    });

    const all = await repo.findByUserId("user-1");
    expect(all).toHaveLength(1);
    expect(all[0]?.institutionName).toBe("Chase Bank");
  });

  it("findById returns the connection", async () => {
    const created = await repo.upsertFromSync({
      userId: "user-1",
      provider: "plaid",
      providerItemId: "item-1",
      institutionName: "Chase",
    });

    const found = await repo.findById(created._id.toString());
    expect(found?.providerItemId).toBe("item-1");
  });

  it("findByUserId scopes to the given user", async () => {
    await repo.upsertFromSync({
      userId: "user-1",
      provider: "plaid",
      providerItemId: "item-1",
      institutionName: "Chase",
    });
    await repo.upsertFromSync({
      userId: "user-2",
      provider: "plaid",
      providerItemId: "item-2",
      institutionName: "Ally",
    });

    const results = await repo.findByUserId("user-1");
    expect(results).toHaveLength(1);
    expect(results[0]?.userId).toBe("user-1");
  });

  it("updateCursor persists the cursor and bumps lastSyncedAt", async () => {
    const created = await repo.upsertFromSync({
      userId: "user-1",
      provider: "plaid",
      providerItemId: "item-1",
      institutionName: "Chase",
    });
    expect(created.lastSyncedAt).toBeUndefined();

    await repo.updateCursor(created._id.toString(), "cursor-abc");

    const found = await repo.findById(created._id.toString());
    expect(found?.cursor).toBe("cursor-abc");
    expect(found?.lastSyncedAt).toBeInstanceOf(Date);
  });

  it("updateStatus updates the status", async () => {
    const created = await repo.upsertFromSync({
      userId: "user-1",
      provider: "plaid",
      providerItemId: "item-1",
      institutionName: "Chase",
    });

    await repo.updateStatus(created._id.toString(), "login_required");

    const found = await repo.findById(created._id.toString());
    expect(found?.status).toBe("login_required");
  });
});
