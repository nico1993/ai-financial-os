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
      await repo.updateColor("user-1", groceries!._id.toString(), "#ff00ff");

      // Re-seeding (e.g. the next categorize-llm run's cache-miss path)
      // must not reset the color the user just picked.
      await repo.seedDefaults("user-1", SEEDS);

      const results = await repo.findActiveByUser("user-1");
      const recolored = results.find((c) => c.name === "Groceries");
      expect(recolored?.color).toBe("#ff00ff");
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

  describe("updateColor", () => {
    it("updates the color of a category the user owns", async () => {
      const created = await repo.create("user-1", "Groceries", "#2a78d6");
      const updated = await repo.updateColor("user-1", created._id.toString(), "#ff00ff");
      expect(updated?.color).toBe("#ff00ff");
    });

    it("returns null for a category owned by a different user", async () => {
      const created = await repo.create("user-1", "Groceries", "#2a78d6");
      const result = await repo.updateColor("user-2", created._id.toString(), "#ff00ff");
      expect(result).toBeNull();

      // Confirm it genuinely wasn't touched, not just that the return
      // value looked right.
      const [unchanged] = await repo.findActiveByUser("user-1");
      expect(unchanged?.color).toBe("#2a78d6");
    });
  });
});
