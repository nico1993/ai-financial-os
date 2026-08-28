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
