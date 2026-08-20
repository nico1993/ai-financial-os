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

export const AccountModel: Model<AccountDocument> =
  mongoose.models.Account ?? model<AccountDocument>("Account", accountSchema);
