// Connection — a linked bank login (was "Item" — provider-neutral, per
// ADR-0004). ARCHITECTURE.md §3.2.
import mongoose, { Schema, model, type Model } from "mongoose";

export type ConnectionStatus = "active" | "login_required" | "error";

export interface ConnectionDocument {
  _id: mongoose.Types.ObjectId;
  userId: string;
  /** 'plaid' is the only value today; future-proofs for a second provider (ADR-0004). */
  provider: "plaid";
  /** Plaid's item_id — opaque to the rest of the app. */
  providerItemId: string;
  /** Plaid's access_token for this Item — required to call
   * /transactions/sync and every other per-Item Plaid endpoint. Added by
   * ADR-0016 (not in the original §3.2 sketch): a bearer credential, not
   * account data, but sensitive for the same reason — a candidate for
   * SEC-1's field-level encryption before this ever holds real tokens. */
  accessToken: string;
  institutionName: string;
  status: ConnectionStatus;
  /** Provider sync cursor. Lives here, not on a separate table (ARCHITECTURE.md §3.2). */
  cursor?: string;
  lastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const connectionSchema = new Schema<ConnectionDocument>(
  {
    userId: { type: String, required: true },
    provider: { type: String, required: true, enum: ["plaid"], default: "plaid" },
    providerItemId: { type: String, required: true },
    accessToken: { type: String, required: true, select: false },
    institutionName: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ["active", "login_required", "error"],
      default: "active",
    },
    cursor: { type: String },
    lastSyncedAt: { type: Date },
  },
  { timestamps: true },
);

// One connection per (user, provider, provider item) — also the natural
// upsert key for ConnectionRepository.upsertFromSync().
connectionSchema.index({ userId: 1, provider: 1, providerItemId: 1 }, { unique: true });
connectionSchema.index({ userId: 1 });
// Webhook lookups arrive with only the provider's item id (ING-7), which
// the compound index above can't serve — its leading field is userId, and
// an inbound webhook doesn't tell us who the user is.
connectionSchema.index({ provider: 1, providerItemId: 1 });

export const ConnectionModel: Model<ConnectionDocument> =
  mongoose.models.Connection ?? model<ConnectionDocument>("Connection", connectionSchema);
