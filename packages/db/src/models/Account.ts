// Account — a single bank/credit/investment account under a Connection.
// ARCHITECTURE.md §3.2.
import mongoose, { Schema, model, type Model } from "mongoose";

export type AccountType = "depository" | "credit" | "loan" | "investment";

export interface AccountDocument {
  _id: mongoose.Types.ObjectId;
  userId: string;
  connectionId: mongoose.Types.ObjectId;
  provider: "plaid";
  /** Plaid's account_id. */
  providerAccountId: string;
  institutionName: string;
  type: AccountType;
  subtype: string;
  officialName?: string;
  /** ACCT-1: a user-chosen display name, set only via
   * AccountRepository.updateNickname() -- never written by
   * upsertFromSync() (see UpsertAccountInput's own comment), so a
   * provider resync can never silently overwrite a name the user picked.
   * Display precedence is `nickname ?? officialName ?? institutionName`. */
  nickname?: string;
  /** ACCT-2: "delete this account," soft -- same convention as
   * Category.archived/Transaction.isRemoved elsewhere in this codebase,
   * chosen over fully unlinking the parent Connection (Plaid's
   * `/item/remove`) so a Connection with several Accounts can lose just
   * one without dragging its siblings down, and so historical
   * DailyBalanceSnapshot/MonthlyRollup rows that reference this account
   * (apps/worker/src/queues/rollups.ts) don't silently break -- they
   * read AccountRepository.findByUserId(), not findActiveByUser(), so
   * an archived account's balance history keeps computing correctly.
   * Set only via AccountRepository.archive(); never written by
   * upsertFromSync() for the same reason `nickname` isn't (a resync
   * should never silently un-delete an account the user removed).
   *
   * Optional here despite the schema below declaring it `required` with
   * `default: false` -- the same `Category.kind?` (CAT-16) situation:
   * `required`+`default` only governs new writes, and every Account
   * created before this field existed has no `archived` key in its
   * stored document at all, so a `.lean()` read of one of those genuinely
   * produces `undefined` at runtime no matter what this type claims.
   * Every reader (findActiveByUser() below) treats that as "not
   * archived" explicitly rather than assuming the field is always
   * present. */
  archived?: boolean;
  /** Integer cents, never float (ARCHITECTURE.md §3.2). */
  currentBalance: number;
  availableBalance?: number;
  isoCurrencyCode: string;
  createdAt: Date;
  updatedAt: Date;
}

const accountSchema = new Schema<AccountDocument>(
  {
    userId: { type: String, required: true },
    connectionId: { type: Schema.Types.ObjectId, ref: "Connection", required: true },
    provider: { type: String, required: true, enum: ["plaid"], default: "plaid" },
    providerAccountId: { type: String, required: true },
    institutionName: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: ["depository", "credit", "loan", "investment"],
    },
    subtype: { type: String, required: true },
    officialName: { type: String },
    nickname: { type: String, trim: true },
    archived: { type: Boolean, required: true, default: false },
    currentBalance: { type: Number, required: true },
    availableBalance: { type: Number },
    isoCurrencyCode: { type: String, required: true },
  },
  { timestamps: true },
);

// Natural upsert key for AccountRepository.upsertFromSync().
accountSchema.index({ userId: 1, provider: 1, providerAccountId: 1 }, { unique: true });
accountSchema.index({ connectionId: 1 });
accountSchema.index({ userId: 1 });
// ACCT-2: same shape as Category's { userId: 1, archived: 1 } index --
// findActiveByUser()'s query below.
accountSchema.index({ userId: 1, archived: 1 });

export const AccountModel: Model<AccountDocument> =
  mongoose.models.Account ?? model<AccountDocument>("Account", accountSchema);
