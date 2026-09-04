// CategoryRepository — every persistence operation on Category goes
// through here (ADR-0005, ADR-0028). Deliberately has no opinion on what a
// "default category" is: seedDefaults() takes the seed list as an
// argument rather than importing apps/worker's DEFAULT_CATEGORY_SEEDS --
// packages/db doesn't depend on apps/worker (wrong direction), and keeping
// taxonomy content out of this package mirrors how MerchantRuleRepository
// carries zero domain content either.
import { CategoryModel, type CategoryDocument, type CategoryKind } from "../models/Category.js";

export interface CategorySeed {
  name: string;
  color: string;
  /** CAT-11: optional so a pre-CAT-11 seed list literal (or a caller
   * that hasn't been updated) still type-checks -- see Category.icon's
   * own doc comment for why this whole field is optional end-to-end. */
  icon?: string;
  /** CAT-16: optional -- only the "Income" seed sets this; every other
   * seed omits it and picks up the schema's own "expense" default at
   * insert time (Category.kind's own doc comment explains why the
   * default can't be relied on for *pre-existing* rows, but a fresh
   * insert through seedDefaults() below is a real write, not a lean
   * read, so it works exactly as a schema default should here). */
  kind?: CategoryKind;
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
            ...(seed.icon !== undefined ? { icon: seed.icon } : {}),
            ...(seed.kind !== undefined ? { kind: seed.kind } : {}),
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

  /** A user-added custom category (CAT-9). CAT-14 gave this its first
   * real caller (`POST /api/categories`, routes/categories.ts), which
   * picks `color` via that route's own default-palette-cycling logic
   * (mirroring how DEFAULT_CATEGORY_SEEDS cycles CATEGORICAL_PALETTE) and
   * passes `icon` through from the request body (CAT-11), defaulting it
   * itself rather than this method inventing a fallback a caller might
   * not want. */
  async create(
    userId: string,
    name: string,
    color: string,
    icon?: string,
    kind?: CategoryKind,
  ): Promise<CategoryDocument> {
    const doc = await CategoryModel.create({
      userId,
      name,
      color,
      icon,
      kind,
      isDefault: false,
      archived: false,
    });
    return doc.toObject() as CategoryDocument;
  }

  /** CAT-10/CAT-11/CAT-16: recolor, re-icon, and/or re-kind a category the
   * user already has, default or custom -- scoped to (categoryId, userId) together so
   * one user can never touch another's row via a guessed id. Generalized
   * from CAT-10's original `updateColor(userId, categoryId, color)` into
   * one `update()` taking either or both fields (CAT-11's own ticket
   * text named this the "probably the better call" option over a
   * parallel `updateIcon()`) -- safe to do as a rename-in-place rather
   * than adding alongside, since `updateColor()` had exactly zero
   * callers outside its own test (grep-confirmed: CAT-10 shipped the
   * repository method with no route/UI wired up yet, same as `create()`
   * before CAT-14). Returns null on no match (wrong id, wrong owner, or
   * already archived-and-deleted -- there's no hard-delete path today,
   * but this keeps the return type honest for whichever check the caller
   * wants) rather than throwing, matching this package's general
   * "advisory data" tolerance elsewhere (MerchantRule, Tier 1's
   * buildTier1Index()). */
  async update(
    userId: string,
    categoryId: string,
    input: { color?: string; icon?: string; kind?: CategoryKind },
  ): Promise<CategoryDocument | null> {
    const $set: Record<string, string> = {};
    if (input.color !== undefined) $set.color = input.color;
    if (input.icon !== undefined) $set.icon = input.icon;
    if (input.kind !== undefined) $set.kind = input.kind;

    try {
      return await CategoryModel.findOneAndUpdate(
        { _id: categoryId, userId },
        { $set },
        { new: true },
      ).lean<CategoryDocument | null>();
    } catch (err) {
      // CAT-16: this method's first real HTTP caller (PATCH
      // /api/categories/:id) feeds it a raw client-supplied id -- same
      // CastError-to-null tolerance TransactionRepository.
      // updateCategoryForUser() established for the same reason (a
      // malformed id and a genuine no-match both mean 404 to the
      // caller, not a 500 with a stack trace).
      if (err instanceof Error && err.name === "CastError") {
        return null;
      }
      throw err;
    }
  }

  /** AUTH-8/ADR-0047: erases every Category this user owns (both
   * seeded defaults and custom ones -- provenance doesn't matter here,
   * everything belonging to this user goes). */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await CategoryModel.deleteMany({ userId });
    return result.deletedCount;
  }
}
