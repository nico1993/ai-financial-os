// Transaction — the normalized, app-facing transaction record.
// ARCHITECTURE.md §3.2. Raw provider payloads live separately in
// RawPayload (§3.1), linked via providerTransactionId, not _id.
import mongoose, { Schema, model, type Model } from "mongoose";

export type CategoryTier = 1 | 2 | 3 | 4;
export type CategoryStatus = "confirmed" | "needs_review";

export interface TransactionCategory {
  tier: CategoryTier;
  value: string;
  /** Only meaningful for tier 3 (LLM). */
  confidence?: number;
  status: CategoryStatus;
}

export interface TransactionDocument {
  _id: mongoose.Types.ObjectId;
  userId: string;
  accountId: mongoose.Types.ObjectId;
  /** Plaid transaction_id. Unique — this is what makes sync upserts idempotent. */
  providerTransactionId: string;
  /** For pending→posted reconciliation (ARCHITECTURE.md §6). */
  pendingTransactionId?: string;
  /** Posted date, UTC Date — never a string (ARCHITECTURE.md §3.2, §6). */
  date: Date;
  authorizedDate?: Date;
  /** Integer cents, never float. */
  amount: number;
  isoCurrencyCode: string;
  /** Plaid's cleaned name. */
  merchantName?: string;
  /** Normalized/lowercased key for Tier 1 lookups. */
  merchantNameNormalized: string;
  /** Raw description, for fuzzy/regex matching (Tier 2). */
  description: string;
  /** Provider's own raw category signal (e.g. Plaid's
   * personal_finance_category.detailed), unparsed by this layer on
   * purpose -- packages/providers/src/FinancialProvider.ts's
   * NormalizedTransaction.providerCategory already documented this intent
   * before anything consumed it; ADR-0029 wires it through. Distinct from
   * `category` below, which is the app's own CAT-9 taxonomy value decided
   * by Tier 1-4 -- this is the provider's signal, set once at sync time
   * and refreshed on every resync like any other provider-owned field
   * (never $setOnInsert like `category` is). */
  providerCategory?: string;
  category: TransactionCategory;
  /** Set by the transfer-matching pass (§2.4); links both sides. */
  transferGroupId?: string;
  /** True once matched as an internal transfer; filtered out of cash-flow rollups. */
  excludeFromCashFlow: boolean;
  pending: boolean;
  /** Soft-delete flag for Plaid "removed" events. */
  isRemoved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<TransactionCategory>(
  {
    tier: { type: Number, required: true, enum: [1, 2, 3, 4] },
    value: { type: String, required: true },
    confidence: { type: Number },
    status: { type: String, required: true, enum: ["confirmed", "needs_review"] },
  },
  { _id: false },
);

const transactionSchema = new Schema<TransactionDocument>(
  {
    userId: { type: String, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    providerTransactionId: { type: String, required: true },
    pendingTransactionId: { type: String },
    date: { type: Date, required: true },
    authorizedDate: { type: Date },
    amount: { type: Number, required: true },
    isoCurrencyCode: { type: String, required: true },
    merchantName: { type: String },
    merchantNameNormalized: { type: String, required: true },
    description: { type: String, required: true },
    providerCategory: { type: String },
    category: { type: categorySchema, required: true },
    transferGroupId: { type: String },
    excludeFromCashFlow: { type: Boolean, required: true, default: false },
    pending: { type: Boolean, required: true, default: false },
    isRemoved: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

// The six indexes from ARCHITECTURE.md §3.2 / BACKLOG.md DATA-8.
// The workhorse index — almost every dashboard query filters by user and
// sorts/ranges by date.
transactionSchema.index({ userId: 1, date: -1 });
// Categorical spending distribution and category drill-downs.
transactionSchema.index({ userId: 1, "category.value": 1, date: -1 });
// Upsert-on-sync idempotency — makes Plaid's added/modified/removed events
// safe to apply as upserts.
transactionSchema.index({ providerTransactionId: 1 }, { unique: true });
// Per-account views and net worth reconciliation.
transactionSchema.index({ accountId: 1, date: -1 });
// Tier 4 review queue.
transactionSchema.index({ userId: 1, "category.status": 1 });
// Looking up both sides of a matched transfer. Sparse since most
// transactions never get a transferGroupId.
transactionSchema.index({ transferGroupId: 1 }, { sparse: true });

export const TransactionModel: Model<TransactionDocument> =
  mongoose.models.Transaction ?? model<TransactionDocument>("Transaction", transactionSchema);
