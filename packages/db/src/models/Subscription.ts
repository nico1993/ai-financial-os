// Subscription — recurring-merchant detections, written by a nightly batch
// job (ARCHITECTURE.md §4.2, ANLY-7), not a live query. Phase 1 heuristic:
// group by merchantNameNormalized, flag as recurring any merchant with ≥3
// transactions whose amount falls within a tolerance band and whose
// interval clusters around ~30 or ~365 days.
import mongoose, { Schema, model, type Model } from "mongoose";

export type SubscriptionFrequency = "monthly" | "annual" | "other";

export interface SubscriptionDocument {
  _id: mongoose.Types.ObjectId;
  userId: string;
  merchantNameNormalized: string;
  merchantName: string;
  /** Integer cents — typical/most-recent detected amount. */
  amount: number;
  /** Detected interval in days (the raw measurement the heuristic clustered on). */
  intervalDays: number;
  /** Derived label from intervalDays — ~30 days -> monthly, ~365 -> annual. */
  frequency: SubscriptionFrequency;
  lastTransactionDate: Date;
  /** Projected next occurrence, for display. */
  nextExpectedDate: Date;
  /** The transactions that contributed to this detection. */
  transactionIds: mongoose.Types.ObjectId[];
  /** False once the merchant stops recurring — a lapsed subscription
   * rather than a deleted record, so history isn't lost. */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<SubscriptionDocument>(
  {
    userId: { type: String, required: true },
    merchantNameNormalized: { type: String, required: true },
    merchantName: { type: String, required: true },
    amount: { type: Number, required: true },
    intervalDays: { type: Number, required: true },
    frequency: { type: String, required: true, enum: ["monthly", "annual", "other"] },
    lastTransactionDate: { type: Date, required: true },
    nextExpectedDate: { type: Date, required: true },
    transactionIds: {
      type: [Schema.Types.ObjectId],
      ref: "Transaction",
      required: true,
      default: [],
    },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

// One subscription record per merchant per user — the nightly job's upsert key.
subscriptionSchema.index({ userId: 1, merchantNameNormalized: 1 }, { unique: true });
subscriptionSchema.index({ userId: 1, active: 1 });

export const SubscriptionModel: Model<SubscriptionDocument> =
  mongoose.models.Subscription ?? model<SubscriptionDocument>("Subscription", subscriptionSchema);
