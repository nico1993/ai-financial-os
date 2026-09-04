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

  /** Returns `null` for a malformed id (mongoose's CastError) the same as
   * a genuine no-match, rather than letting the CastError escape --
   * ING-13's manual-sync route (`routes/accounts.ts`) is the first caller
   * to feed this a raw, client-supplied route param; every other caller
   * (job handlers, webhook lookups) already only ever passes a value read
   * back out of this database, so this is strictly safer for them too,
   * never a behavior they depended on. Same reasoning as
   * TransactionRepository.updateCategoryForUser() (ADR-0041). */
  async findById(connectionId: string): Promise<ConnectionDocument | null> {
    try {
      return await ConnectionModel.findById(connectionId).lean<ConnectionDocument | null>();
    } catch (err) {
      if (err instanceof Error && err.name === "CastError") {
        return null;
      }
      throw err;
    }
  }

  /** The one place `accessToken` is ever read back out — for the
   * provider-sync job (ING-4) to authenticate its Plaid calls. Every other
   * read path should use findById()/findByUserId() and never see it. */
  async findByIdWithAccessToken(connectionId: string): Promise<ConnectionDocument | null> {
    return ConnectionModel.findById(connectionId)
      .select("+accessToken")
      .lean<ConnectionDocument | null>();
  }

  /** Resolves a provider's own item id back to our Connection — the only
   * handle a webhook gives us (ING-7). Scoped by provider because
   * `providerItemId` is only unique within one provider's namespace
   * (ADR-0004 anticipates a second adapter). */
  async findByProviderItemId(
    provider: ConnectionDocument["provider"],
    providerItemId: string,
  ): Promise<ConnectionDocument | null> {
    return ConnectionModel.findOne({ provider, providerItemId }).lean<ConnectionDocument | null>();
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

  /** Drops the stored cursor so the next run starts from scratch — the
   * "reset and full resync" path §6 calls for when a cursor goes stale
   * (ING-11). `$unset` rather than setting an empty string: the provider
   * adapter treats a missing cursor as "first sync", and an empty string
   * is not the same thing to Plaid. */
  async resetCursor(connectionId: string): Promise<void> {
    await ConnectionModel.updateOne({ _id: connectionId }, { $unset: { cursor: "" } });
  }

  async updateStatus(connectionId: string, status: ConnectionStatus): Promise<void> {
    await ConnectionModel.updateOne({ _id: connectionId }, { $set: { status } });
  }

  /** Connections the scheduled fallback poll should actually sync
   * (ING-8). Deliberately excludes `login_required` and `error`: §6 is
   * explicit that a broken Item should stop being retried until the user
   * acts, and a 4-hourly poll is exactly the "burning retry budget
   * indefinitely" it warns about. */
  async findSyncable(): Promise<ConnectionDocument[]> {
    return ConnectionModel.find({ status: "active" }).lean<ConnectionDocument[]>();
  }

  /** AUTH-8: every Connection this user has, *with* its access token --
   * account deletion needs to revoke each one at Plaid
   * (FinancialProvider.removeItem()) before erasing our own record of
   * it, the one other caller besides the provider-sync job (ING-4) that
   * legitimately needs this field. */
  async findByUserIdWithAccessToken(userId: string): Promise<ConnectionDocument[]> {
    return ConnectionModel.find({ userId }).select("+accessToken").lean<ConnectionDocument[]>();
  }

  /** AUTH-8/ADR-0047: erases every Connection this user owns. Plaid-side
   * revocation (FinancialProvider.removeItem(), via
   * findByUserIdWithAccessToken() above) happens first, in the caller
   * (routes/auth.ts) -- this method only ever touches this app's own
   * records, the same division every other deleteAllForUser() added
   * alongside this one keeps. */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await ConnectionModel.deleteMany({ userId });
    return result.deletedCount;
  }
}
