// userCategories.ts — CAT-9's category-source resolution (ARCHITECTURE.md
// §2.3, ADR-0028). Thin by design (AGENTS.md's TDD convention): the actual
// decision -- confirmed vs. needs_review -- lives in tier3.ts; this just
// gets Tier 3 its input list, seeding a user's first-ever Category rows
// from DEFAULT_CATEGORY_SEEDS on a cache miss.
import { CategoryRepository } from "@financial-os/db";
import { DEFAULT_CATEGORY_SEEDS } from "./categories.js";

/**
 * Returns userId's active category names for a categorize-llm run,
 * transparently seeding DEFAULT_CATEGORY_SEEDS the first time this user has
 * no Category rows at all. Lazy rather than a signup hook so this needs no
 * migration for the one real user who already existed before CAT-9 shipped
 * -- their first post-CAT-9 categorize-llm run seeds them exactly as if
 * they'd just signed up.
 *
 * Returns the seed names directly after seeding, rather than re-querying,
 * since CategoryRepository.seedDefaults() is written to guarantee exactly
 * those rows now exist (it never skips a seed that isn't already there).
 */
export async function resolveUserCategoryNames(
  categories: CategoryRepository,
  userId: string,
): Promise<string[]> {
  const existing = await categories.findActiveByUser(userId);
  if (existing.length > 0) return existing.map((c) => c.name);

  await categories.seedDefaults(userId, DEFAULT_CATEGORY_SEEDS);
  return DEFAULT_CATEGORY_SEEDS.map((c) => c.name);
}
