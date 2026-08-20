// ConnectionRepository — every persistence operation on Connection goes
// through here; no raw driver/model calls from routes or job handlers
// (ADR-0005).
import {
  ConnectionModel,
  type ConnectionDocument,
  type ConnectionStatus,
} from "../models/Connection.js";

export type UpsertConnectionInput = Pick<
  ConnectionDocument,
  "userId" | "provider" | "providerItemId" | "institutionName" | "accessToken"
> &
  Partial<Pick<ConnectionDocument, "status" | "cursor" | "lastSyncedAt">>;

export class ConnectionRepository {
  /** Upserts by (userId, provider, providerItemId) — safe to call on every
   * Link flow / sync run without creating duplicates. The returned
   * document never carries `accessToken` (it's `select: false` on the
   * schema) — callers already have the plaintext value they just passed
   * in; fetch it back only via findByIdWithAccessToken(). */
  async upsertFromSync(input: UpsertConnectionInput): Promise<ConnectionDocument> {
    const doc = await ConnectionModel.findOneAndUpdate(
      { userId: input.userId, provider: input.provider, providerItemId: input.providerItemId },
      { $set: input },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return doc as ConnectionDocument;
  }

  async findById(connectionId: string): Promise<ConnectionDocument | null> {
    return ConnectionModel.findById(connectionId).lean<ConnectionDocument | null>();
  }

  /** The one place `accessToken` is ever read back out — for the
   * provider-sync job (ING-4) to authenticate its Plaid calls. Every other
   * read path should use findById()/findByUserId() and never see it. */
  async findByIdWithAccessToken(connectionId: string): Promise<ConnectionDocument | null> {
    return ConnectionModel.findById(connectionId)
      .select("+accessToken")
      .lean<ConnectionDocument | null>();
  }

  async findByUserId(userId: string): Promise<ConnectionDocument[]> {
    return ConnectionModel.find({ userId }).lean<ConnectionDocument[]>();
  }

  /** Persists the provider sync cursor after each page (ARCHITECTURE.md
   * §2.2) — call this inside the pagination loop, not just at the end. */
  async updateCursor(connectionId: string, cursor: string): Promise<void> {
    await ConnectionModel.updateOne(
      { _id: connectionId },
      { $set: { cursor, lastSyncedAt: new Date() } },
    );
  }

  async updateStatus(connectionId: string, status: ConnectionStatus): Promise<void> {
    await ConnectionModel.updateOne({ _id: connectionId }, { $set: { status } });
  }
}
