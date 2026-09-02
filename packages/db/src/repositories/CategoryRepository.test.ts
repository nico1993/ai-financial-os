import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../test/mongo-memory.js";
import { CategoryModel } from "../models/Category.js";
import { CategoryRepository, type CategorySeed } from "./CategoryRepository.js";

const db = setupTestDb();
const repo = new CategoryRepository();

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

const SEEDS: CategorySeed[] = [
  { name: "Groceries", color: "#2a78d6" },
  { name: "Dining", color: "#eb6834" },
];

describe("CategoryRepository", () => {
  describe("findActiveByUser", () => {
    it("returns only that user's non-archived categories", async () => {
      await CategoryModel.create({ userId: "user-1", name: "Groceries", color: "#2a78d6" });
      await CategoryModel.create({
        userId: "user-1",
        name: "Dining",
        color: "#eb6834",
        archived: true,
      });
      await CategoryModel.create({ userId: "user-2", name: "Travel", color: "#4a3aa7" });

      const results = await repo.findActiveByUser("user-1");
      expect(results.map((c) => c.name)).toEqual(["Groceries"]);
    });
  });

  describe("seedDefaults", () => {
    it("inserts every seed for a user with no categories yet", async () => {
      await repo.seedDefaults("user-1", SEEDS);

      const results = await repo.findActiveByUser("user-1");
      expect(
        results.map((c) => ({ name: c.name, color: c.color, isDefault: c.isDefault })),
      ).toEqual([
        { name: "Groceries", color: "#2a78d6", isDefault: true },
        { name: "Dining", color: "#eb6834", isDefault: true },
      ]);
    });

    it("never overwrites a category the user already changed", async () => {
      await repo.seedDefaults("user-1", SEEDS);
      const [groceries] = await repo.findActiveByUser("user-1");
      await repo.update("user-1", groceries!._id.toString(), { color: "#ff00ff" });

      // Re-seeding (e.g. the next categorize-llm run's cache-miss path)
      // must not reset the color the user just picked.
      await repo.seedDefaults("user-1", SEEDS);

      const results = await repo.findActiveByUser("user-1");
      const recolored = results.find((c) => c.name === "Groceries");
      expect(recolored?.color).toBe("#ff00ff");
    });

    it("seeds an icon when the seed list provides one (CAT-11)", async () => {
      await repo.seedDefaults("user-1", [
        { name: "Groceries", color: "#2a78d6", icon: "shopping-cart" },
      ]);

      const [groceries] = await repo.findActiveByUser("user-1");
      expect(groceries?.icon).toBe("shopping-cart");
    });

    it("leaves icon unset when the seed doesn't provide one", async () => {
      await repo.seedDefaults("user-1", SEEDS);

      const [groceries] = await repo.findActiveByUser("user-1");
      expect(groceries?.icon).toBeUndefined();
    });

    it("seeds a kind when the seed list provides one (CAT-16, the Income seed)", async () => {
      await repo.seedDefaults("user-1", [{ name: "Income", color: "#e34948", kind: "income" }]);

      const [income] = await repo.findActiveByUser("user-1");
      expect(income?.kind).toBe("income");
    });

    it("leaves kind unset (not defaulted) when the seed doesn't provide one -- CAT-16's own doc comment: seedDefaults() is a real insert, so this documents what actually lands via $setOnInsert's conditional spread, not what the schema *could* default", async () => {
      await repo.seedDefaults("user-1", SEEDS);

      const [groceries] = await repo.findActiveByUser("user-1");
      expect(groceries?.kind).toBeUndefined();
    });

    it("does not duplicate a custom category that shares a default's name", async () => {
      await repo.create("user-1", "Groceries", "#123456");

      await repo.seedDefaults("user-1", SEEDS);

      const results = await repo.findActiveByUser("user-1");
      const groceriesRows = results.filter((c) => c.name === "Groceries");
      expect(groceriesRows).toHaveLength(1);
      expect(groceriesRows[0]?.color).toBe("#123456");
      expect(groceriesRows[0]?.isDefault).toBe(false);
    });

    it("is scoped per user -- seeding one user leaves another untouched", async () => {
      await repo.seedDefaults("user-1", SEEDS);
      expect(await repo.findActiveByUser("user-2")).toHaveLength(0);
    });
  });

  describe("create", () => {
    it("creates a custom, non-default category", async () => {
      const created = await repo.create("user-1", "Side Hustle", "#008300");
      expect(created.isDefault).toBe(false);
      expect(created.archived).toBe(false);
      expect(created.color).toBe("#008300");
    });

    it("rejects a duplicate name for the same user", async () => {
      await repo.create("user-1", "Side Hustle", "#008300");
      await expect(repo.create("user-1", "Side Hustle", "#e34948")).rejects.toThrow(
        /duplicate key|E11000/,
      );
    });

    it("allows the same name for two different users", async () => {
      await repo.create("user-1", "Side Hustle", "#008300");
      await expect(repo.create("user-2", "Side Hustle", "#e34948")).resolves.toBeDefined();
    });
  });

  describe("create", () => {
    it("stores an icon when given one (CAT-11)", async () => {
      const created = await repo.create("user-1", "Side Hustle", "#008300", "briefcase");
      expect(created.icon).toBe("briefcase");
    });

    it("leaves icon unset when not given one", async () => {
      const created = await repo.create("user-1", "Side Hustle", "#008300");
      expect(created.icon).toBeUndefined();
    });

    it("stores a kind when given one (CAT-16)", async () => {
      const created = await repo.create("user-1", "Freelance", "#008300", "briefcase", "income");
      expect(created.kind).toBe("income");
    });

    it("applies the schema's 'expense' default when kind isn't given -- unlike a .lean() read of a pre-existing row, this IS a real Document creation (CategoryModel.create()), so the schema default genuinely lands in the DB, not just undefined", async () => {
      const created = await repo.create("user-1", "Side Hustle", "#008300");
      expect(created.kind).toBe("expense");
    });
  });

  describe("update", () => {
    it("updates just the color of a category the user owns", async () => {
      const created = await repo.create("user-1", "Groceries", "#2a78d6");
      const updated = await repo.update("user-1", created._id.toString(), { color: "#ff00ff" });
      expect(updated?.color).toBe("#ff00ff");
      expect(updated?.icon).toBeUndefined();
    });

    it("updates just the icon, leaving color untouched (CAT-11)", async () => {
      const created = await repo.create("user-1", "Groceries", "#2a78d6");
      const updated = await repo.update("user-1", created._id.toString(), {
        icon: "shopping-cart",
      });
      expect(updated?.icon).toBe("shopping-cart");
      expect(updated?.color).toBe("#2a78d6");
    });

    it("updates both color and icon together", async () => {
      const created = await repo.create("user-1", "Groceries", "#2a78d6");
      const updated = await repo.update("user-1", created._id.toString(), {
        color: "#ff00ff",
        icon: "shopping-cart",
      });
      expect(updated?.color).toBe("#ff00ff");
      expect(updated?.icon).toBe("shopping-cart");
    });

    it("returns null for a category owned by a different user", async () => {
      const created = await repo.create("user-1", "Groceries", "#2a78d6");
      const result = await repo.update("user-2", created._id.toString(), { color: "#ff00ff" });
      expect(result).toBeNull();

      // Confirm it genuinely wasn't touched, not just that the return
      // value looked right.
      const [unchanged] = await repo.findActiveByUser("user-1");
      expect(unchanged?.color).toBe("#2a78d6");
    });

    it("updates just the kind, leaving color/icon untouched (CAT-16)", async () => {
      const created = await repo.create("user-1", "Groceries", "#2a78d6", "shopping-cart");
      const updated = await repo.update("user-1", created._id.toString(), { kind: "income" });
      expect(updated?.kind).toBe("income");
      expect(updated?.color).toBe("#2a78d6");
      expect(updated?.icon).toBe("shopping-cart");
    });

    it("returns null (not a thrown CastError) for a malformed id -- CAT-16's own doc comment on why update() now guards this, since PATCH /api/categories/:id is its first caller to feed it a raw client string", async () => {
      const result = await repo.update("user-1", "not-a-valid-object-id", { color: "#ff00ff" });
      expect(result).toBeNull();
    });

    it("re-kinds an already-seeded default whose row predates CAT-16 -- the exact 'stuck as undefined until re-saved' gap Category.kind's doc comment flags, fixed by this same update() path", async () => {
      // Simulate a pre-CAT-16 row: created before `kind` existed, so it
      // genuinely has no `kind` field stored (not even the schema
      // default -- CategoryModel.create() would apply that, so this
      // bypasses the repository and inserts directly, the way a real
      // row from before this migration actually looks in the DB).
      const { CategoryModel } = await import("../models/Category.js");
      const preExisting = await CategoryModel.create({
        userId: "user-1",
        name: "Income",
        color: "#e34948",
        isDefault: true,
        archived: false,
      });
      // Confirm the premise: a lean read genuinely sees kind: undefined,
      // not the schema's "expense" default -- Mongoose does not backfill
      // schema defaults on .lean() reads of a pre-existing document.
      const [before] = await repo.findActiveByUser("user-1");
      expect(before?.kind).toBeUndefined();

      const updated = await repo.update("user-1", preExisting._id.toString(), { kind: "income" });
      expect(updated?.kind).toBe("income");
    });
  });
});
