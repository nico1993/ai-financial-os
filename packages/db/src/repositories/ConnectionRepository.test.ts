import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../test/mongo-memory.js";
import { ConnectionRepository, type UpsertConnectionInput } from "./ConnectionRepository.js";

const db = setupTestDb();
const repo = new ConnectionRepository();

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

function baseInput(overrides: Partial<UpsertConnectionInput> = {}): UpsertConnectionInput {
  return {
    userId: "user-1",
    provider: "plaid",
    providerItemId: "item-1",
    institutionName: "Chase",
    accessToken: "access-sandbox-abc123",
    ...overrides,
  };
}

describe("ConnectionRepository", () => {
  it("upsertFromSync creates a new connection", async () => {
    const created = await repo.upsertFromSync(baseInput());

    expect(created.institutionName).toBe("Chase");
    expect(created.status).toBe("active");
  });

  it("upsertFromSync never returns accessToken (select: false)", async () => {
    const created = await repo.upsertFromSync(baseInput());
    expect((created as { accessToken?: string }).accessToken).toBeUndefined();
  });

  it("upsertFromSync updates the same connection instead of duplicating it", async () => {
    await repo.upsertFromSync(baseInput());
    await repo.upsertFromSync(baseInput({ institutionName: "Chase Bank" }));

    const all = await repo.findByUserId("user-1");
    expect(all).toHaveLength(1);
    expect(all[0]?.institutionName).toBe("Chase Bank");
  });

  it("findById returns the connection without accessToken", async () => {
    const created = await repo.upsertFromSync(baseInput());

    const found = await repo.findById(created._id.toString());
    expect(found?.providerItemId).toBe("item-1");
    expect((found as { accessToken?: string } | null)?.accessToken).toBeUndefined();
  });

  it("findByIdWithAccessToken returns the connection with accessToken", async () => {
    const created = await repo.upsertFromSync(baseInput());

    const found = await repo.findByIdWithAccessToken(created._id.toString());
    expect(found?.accessToken).toBe("access-sandbox-abc123");
  });

  it("findByProviderItemId resolves a webhook's item id back to the connection", async () => {
    await repo.upsertFromSync(baseInput());

    const found = await repo.findByProviderItemId("plaid", "item-1");
    expect(found?.institutionName).toBe("Chase");
    // Still no credential on this read path.
    expect((found as { accessToken?: string } | null)?.accessToken).toBeUndefined();
  });

  it("findByProviderItemId returns null for an item we don't have", async () => {
    await repo.upsertFromSync(baseInput());

    expect(await repo.findByProviderItemId("plaid", "item-unknown")).toBeNull();
  });

  it("findByUserId scopes to the given user", async () => {
    await repo.upsertFromSync(baseInput());
    await repo.upsertFromSync(
      baseInput({ userId: "user-2", providerItemId: "item-2", institutionName: "Ally" }),
    );

    const results = await repo.findByUserId("user-1");
    expect(results).toHaveLength(1);
    expect(results[0]?.userId).toBe("user-1");
  });

  it("updateCursor persists the cursor and bumps lastSyncedAt", async () => {
    const created = await repo.upsertFromSync(baseInput());
    expect(created.lastSyncedAt).toBeUndefined();

    await repo.updateCursor(created._id.toString(), "cursor-abc");

    const found = await repo.findById(created._id.toString());
    expect(found?.cursor).toBe("cursor-abc");
    expect(found?.lastSyncedAt).toBeInstanceOf(Date);
  });

  it("resetCursor clears the cursor so the next sync starts from scratch", async () => {
    const created = await repo.upsertFromSync(baseInput());
    await repo.updateCursor(created._id.toString(), "cursor-stale");

    await repo.resetCursor(created._id.toString());

    const found = await repo.findById(created._id.toString());
    // Unset, not empty-string: the adapter treats absent as "first sync",
    // and an empty cursor is not the same thing to the provider.
    expect(found?.cursor).toBeUndefined();
  });

  it("findSyncable returns only active connections", async () => {
    const active = await repo.upsertFromSync(baseInput());
    const broken = await repo.upsertFromSync(baseInput({ providerItemId: "item-broken" }));
    const errored = await repo.upsertFromSync(baseInput({ providerItemId: "item-errored" }));
    await repo.updateStatus(broken._id.toString(), "login_required");
    await repo.updateStatus(errored._id.toString(), "error");

    const syncable = await repo.findSyncable();

    // A connection needing re-auth must not be re-polled every few hours
    // -- that is the retry-budget burn §6 warns about.
    expect(syncable.map((c) => c._id.toString())).toEqual([active._id.toString()]);
  });

  it("updateStatus updates the status", async () => {
    const created = await repo.upsertFromSync(baseInput());

    await repo.updateStatus(created._id.toString(), "login_required");

    const found = await repo.findById(created._id.toString());
    expect(found?.status).toBe("login_required");
  });
});
