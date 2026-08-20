// MerchantRule — Tier 1 (exact-match) and Tier 2 (user regex) rules for the
// categorization pipeline. ARCHITECTURE.md §2.3. Tier 1 rows are seeded by
// the CAT-6 write-back loop (confirmed LLM/manual decisions cached here so
// the same merchant never needs LLM inference twice); Tier 2 rows are
// user-authored. Tier 2's fuzzy matching against previously-corrected
// merchants queries Transaction directly — it isn't stored here.
import mongoose, { Schema, model, type Model } from "mongoose";

export type MerchantRuleTier = 1 | 2;
export type MerchantRuleMatchType = "exact" | "regex";
export type MerchantRuleSource = "llm" | "manual";

export interface MerchantRuleDocument {
  _id: mongoose.Types.ObjectId;
  userId: string;
  tier: MerchantRuleTier;
  /** 'exact' for Tier 1 (normalized merchant string), 'regex' for Tier 2. */
  matchType: MerchantRuleMatchType;
  /** Normalized merchant string (Tier 1) or a regex source string, matched
   * against Transaction.description (Tier 2). */
  pattern: string;
  category: string;
  /** Orders overlapping Tier 2 rules deterministically (§2.3). Lower
   * evaluates first; ties broken by insertion order. */
  priority: number;
  /** How the rule came to exist — 'llm'/'manual' both come out of the
   * Tier 4 write-back loop (CAT-6); Tier 2 rules are always 'manual'. */
  source: MerchantRuleSource;
  createdAt: Date;
  updatedAt: Date;
}

const merchantRuleSchema = new Schema<MerchantRuleDocument>(
  {
    userId: { type: String, required: true },
    tier: { type: Number, required: true, enum: [1, 2] },
    matchType: { type: String, required: true, enum: ["exact", "regex"] },
    pattern: { type: String, required: true },
    category: { type: String, required: true },
    priority: { type: Number, required: true, default: 0 },
    source: { type: String, required: true, enum: ["llm", "manual"] },
  },
  { timestamps: true },
);

// Tier 1 exact-match lookup — one rule per normalized merchant string per
// user; also the write-back loop's upsert key.
merchantRuleSchema.index(
  { userId: 1, pattern: 1 },
  { unique: true, partialFilterExpression: { matchType: "exact" } },
);
// Tier 2 regex evaluation, priority-ordered.
merchantRuleSchema.index({ userId: 1, tier: 1, priority: 1 });

export const MerchantRuleModel: Model<MerchantRuleDocument> =
  mongoose.models.MerchantRule ?? model<MerchantRuleDocument>("MerchantRule", merchantRuleSchema);
