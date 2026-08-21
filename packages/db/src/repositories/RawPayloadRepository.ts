// RawPayloadRepository — every persistence operation on RawPayload goes
// through here (ADR-0005).
//
// DATA-9 named only four repositories (Connection/Account/Transaction/
// Rollup), but ARCHITECTURE.md §3.1 requires the untouched provider
// response to be stored alongside the cleaned Transaction, and the sync
// job (ING-4) is the only thing positioned to write it. Insert-only by
// design: no update or delete method exists here, and none should be added
// — §3.1's auditability and replay-ability guarantees depend on this
// collection being append-only.
import { RawPayloadModel, type RawPayloadDocument } from "../models/RawPayload.js";

export type InsertRawPayloadInput = Pick<
  RawPayloadDocument,
  "userId" | "source" | "type" | "providerId" | "payload"
> &
  Partial<Pick<RawPayloadDocument, "receivedAt">>;

export class RawPayloadRepository {
  /** Appends one raw provider payload. Deliberately not an upsert: a
   * transaction Plaid sends twice (an `added` later corrected by a
   * `modified`, or a page replayed after a crash mid-drain) should leave
   * two rows, because the point is to preserve what arrived and when. */
  async insert(input: InsertRawPayloadInput): Promise<void> {
    await RawPayloadModel.create({ receivedAt: new Date(), ...input });
  }

  /** Replay/audit path (§3.1): every raw payload recorded for one provider
   * entity, oldest first, so a reprocess can walk the corrections in the
   * order the provider actually sent them. */
  async findByProviderId(
    userId: string,
    type: RawPayloadDocument["type"],
    providerId: string,
  ): Promise<RawPayloadDocument[]> {
    return RawPayloadModel.find({ userId, type, providerId })
      .sort({ receivedAt: 1 })
      .lean<RawPayloadDocument[]>();
  }
}
