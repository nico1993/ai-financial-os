// RawPayload — untouched provider responses, insert-only. ARCHITECTURE.md
// §3.1: auditability, replay-ability (reprocess without re-hitting the
// provider's API), and clean reconciliation of Plaid's pending→posted
// corrections. Linked to the cleaned collection (e.g. Transaction) via
// providerId, not _id.
import mongoose, { Schema, model, type Model } from "mongoose";

/** What kind of entity this raw payload represents. Transaction is the
 * only type Phase 1 actually writes, but the discriminator exists so
 * account/item payloads can be added later without a schema migration. */
export type RawPayloadType = "transaction" | "account" | "item";

export interface RawPayloadDocument {
  _id: mongoose.Types.ObjectId;
  userId: string;
  /** 'plaid' today — matches Connection.provider (ADR-0004). */
  source: "plaid";
  type: RawPayloadType;
  /** The provider's own id for this entity — for type: 'transaction' this
   * is the same value as Transaction.providerTransactionId, which is how
   * the raw and cleaned records link (§3.1). Not a Mongo _id. */
  providerId: string;
  /** The untouched provider response, stored as-is. */
  payload: unknown;
  receivedAt: Date;
}

const rawPayloadSchema = new Schema<RawPayloadDocument>({
  userId: { type: String, required: true },
  source: { type: String, required: true, enum: ["plaid"], default: "plaid" },
  type: { type: String, required: true, enum: ["transaction", "account", "item"] },
  providerId: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true },
  receivedAt: { type: Date, required: true, default: () => new Date() },
});
// No `timestamps: true` — insert-only collection, an updatedAt field would
// be misleading (ARCHITECTURE.md §3.1 explicitly calls out "no updates").

rawPayloadSchema.index({ userId: 1, type: 1, providerId: 1 });
rawPayloadSchema.index({ userId: 1, source: 1, type: 1, receivedAt: -1 });

export const RawPayloadModel: Model<RawPayloadDocument> =
  mongoose.models.RawPayload ?? model<RawPayloadDocument>("RawPayload", rawPayloadSchema);
