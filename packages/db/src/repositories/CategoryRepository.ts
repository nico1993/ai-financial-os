// CategoryRepository — every persistence operation on Category goes
// through here (ADR-0005, ADR-0028). Deliberately has no opinion on what a
// "default category" is: seedDefaults() takes the seed list as an
// argument rather than importing apps/worker's DEFAULT_CATEGORY_SEEDS --
// packages/db doesn't depend on apps/worker (wrong direction), and keeping
// taxonomy content out of this package mirrors how MerchantRuleRepository
// carries zero domain content either.
import { CategoryModel, type CategoryDocument } from "../models/Category.js";

export interface CategorySeed {
  name: string;
  color: string;
}

export class CategoryRepository {
  /** Tier 3's category-name source and a future "manage categories" list's
   * data (CAT-9). Archived categories are excluded -- a hidden category
   * shouldn't be offered to the model or shown as an active option, even
   * though transactions already tagged with its name keep displaying it
   * (Transaction.category.value is free text, not a reference). Sorted by
   * creation order so the seeded defaults keep a stable, predictable order
   * ahead of anything a user adds later. */
  async findActiveByUser(userId: string): Promise<CategoryDocument[]> {
    return CategoryModel.find({ userId, archived: false })
      .sort({ createdAt: 1 })
      .lean<CategoryDocument[]>();
  }

  /** Idempotent per (userId, name) -- the unique index on Category is this
   * method's upsert key. Only ever inserts: $setOnInsert means a name that
   * already exists for this user (seeded before, or a custom category that
   * happens to share a default's name) is left completely untouched, so a
   * category the user already renamed/recolored/archived can never be
   * silently reset by calling this again. Safe to call on every
   * categorize-llm run's cache miss (apps/worker's
   * resolveUserCategoryNames()) rather than needing a one-time signup
   * hook -- this is also what lets the one real user who existed before
   * CAT-9 shipped get seeded with no migration script. */
  async seedDefaults(userId: string, seeds: readonly CategorySeed[]): Promise<void> {
    // Sequential, not Promise.all -- findActiveByUser() sorts by
    // createdAt, and concurrent upserts racing for the same millisecond
    // would make that order nondeterministic. This runs once per user, for
    // a short list, so the small serialization cost buys a predictable
    // "defaults appear in the order they're defined" list instead.
    for (const seed of seeds) {
      await CategoryModel.updateOne(
        { userId, name: seed.name },
        {
          $setOnInsert: {
            userId,
            name: seed.name,
            color: seed.color,
            isDefault: true,
            archived: false,
          },
        },
        // setDefaultsOnInsert is redundant with the explicit $setOnInsert
        // above, but TransactionRepository.upsertFromSync() sets it
        // explicitly rather than trusting the implicit default, and this
        // follows that same precedent instead of two upsert call sites
        // disagreeing on whether to rely on it.
        { upsert: true, setDefaultsOnInsert: true },
      );
    }
  }

  /** A user-added custom category (CAT-9). No route/UI calls this yet
   * (CAT-7's review queue is where one is expected to land -- deferred);
   * this is the data-layer half, ready for that wiring. */
  async create(userId: string, name: string, color: string): Promise<CategoryDocument> {
    const doc = await CategoryModel.create({
      userId,
      name,
      color,
      isDefault: false,
      archived: false,
    });
    return doc.toObject() as CategoryDocument;
  }

  /** CAT-10: recolor a category the user already has, default or custom --
   * scoped to (categoryId, userId) together so one user can never touch
   * another's row via a guessed id. Returns null on no match (wrong id,
   * wrong owner, or already archived-and-deleted -- there's no
   * hard-delete path today, but this keeps the return type honest for
   * whichever check the caller wants) rather than throwing, matching this
   * package's general "advisory data" tolerance elsewhere (MerchantRule,
   * Tier 1's buildTier1Index()). */
  async updateColor(
    userId: string,
    categoryId: string,
    color: string,
  ): Promise<CategoryDocument | null> {
    return CategoryModel.findOneAndUpdate(
      { _id: categoryId, userId },
      { $set: { color } },
      { new: true },
    ).lean<CategoryDocument | null>();
  }
}
