// Category — the per-user taxonomy Tier 3 (LLM) picks from and the model
// CAT-10's colors live on (ARCHITECTURE.md §2.3/§3.2, ADR-0028). Replaces a
// single hardcoded DEFAULT_CATEGORIES array (apps/worker/src/categorize/
// categories.ts) that every user shared: this collection is seeded per user
// from that same list on first use (CategoryRepository.seedDefaults(),
// called by apps/worker's resolveUserCategoryNames()) and is then fully
// editable -- rename, recolor, archive -- independent of every other user's
// copy. Tier 1/2 do NOT read this collection: their categories come from
// whatever a person or a Tier 3 write-back (CAT-6) already put into
// MerchantRules/Transaction.category.value, which stays plain free text --
// this collection is Tier 3's input list and (eventually) a "manage
// categories" UI's data, not a foreign key Transaction.category.value
// points at.
import mongoose, { Schema, model, type Model } from "mongoose";

export type CategoryKind = "income" | "expense";

export interface CategoryDocument {
  _id: mongoose.Types.ObjectId;
  userId: string;
  name: string;
  /** Hex color, e.g. "#2a78d6". Every category has one -- seeded from a
   * validated categorical palette for the defaults (ADR-0028), assigned by
   * the caller for a custom category -- and it's changeable either way
   * (CAT-10): this is a user-visible identity color, not a fixed taxonomy
   * property. */
  color: string;
  /** CAT-11: an icon key from apps/web's curated, fixed lucide-react set
   * (e.g. "shopping-cart") -- same shape as `color`: a string identifier
   * this layer stores and doesn't interpret, resolved to an actual icon
   * component at render time by the frontend. Optional rather than
   * required like `color` is: a category created before this field
   * existed (or a custom one a user creates without picking one) simply
   * has no icon, and the frontend falls back to a generic default rather
   * than this needing a migration for every pre-existing row. */
  icon?: string;
  /** CAT-16: "income" or "expense", for the /categories management
   * page's Income/Expense grouping of the seeded defaults (isDefault:
   * true -- a user's own custom category always shows under "Custom"
   * regardless of its kind; see CategoriesPage.tsx's own comment for the
   * full grouping rule). Required with a schema-level default
   * ("expense") rather than optional like `icon` -- but that default
   * only actually applies to a row's stored value at *write* time
   * (CategoryModel.create() hydrates a real Document, which does apply
   * schema defaults for an omitted path); a row written before this
   * field existed has no `kind` physically stored, and Mongoose does
   * NOT backfill schema defaults for `.lean()` reads (every read in this
   * repository is `.lean()`) -- so `kind` really is optional at the type
   * level here (`kind?: CategoryKind`) despite being `required` in the
   * schema below, the same honesty gap `icon`'s own optional typing
   * documents. A pre-CAT-16 row (including an already-seeded "Income"
   * category from before this shipped -- seedDefaults()'s
   * $setOnInsert never touches an existing row) reads back as
   * `kind: undefined` until it's re-saved through `update()`; callers
   * that need a concrete "income" | "expense" (routes/categories.ts's
   * GET response, CategoriesPage's grouping) normalize with
   * `?? "expense"` rather than trusting the schema default to have
   * already done it. No migration script for the same reason `icon`
   * needed none: every *new* write (seedDefaults, create) stores a real
   * value going forward. */
  kind?: CategoryKind;
  /** True for a row CategoryRepository.seedDefaults() created, false for
   * one a user added themselves. Provenance only -- both are equally
   * rename/recolor/archive-able; nothing branches on this to restrict what
   * a "default" category can do. */
  isDefault: boolean;
  /** Soft-hide instead of delete. A transaction already written with this
   * category's name (Transaction.category.value is free text, not a
   * reference) keeps displaying correctly; an archived category just stops
   * being offered to Tier 3 or any future "add/edit category" UI. */
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<CategoryDocument>(
  {
    userId: { type: String, required: true },
    name: { type: String, required: true },
    color: { type: String, required: true },
    icon: { type: String },
    kind: { type: String, enum: ["income", "expense"], required: true, default: "expense" },
    isDefault: { type: Boolean, required: true, default: false },
    archived: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

// One category name per user -- also CategoryRepository.seedDefaults()'s
// idempotency key, so re-seeding never duplicates a row the user already
// has (whether from a prior seed or a custom category with the same name).
categorySchema.index({ userId: 1, name: 1 }, { unique: true });
// Tier 3's category-name lookup and any future "manage categories" list.
categorySchema.index({ userId: 1, archived: 1 });

export const CategoryModel: Model<CategoryDocument> =
  mongoose.models.Category ?? model<CategoryDocument>("Category", categorySchema);
