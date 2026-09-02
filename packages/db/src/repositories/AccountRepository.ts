// AccountRepository — every persistence operation on Account goes through
// here (ADR-0005).
import { AccountModel, type AccountDocument } from "../models/Account.js";

export type UpsertAccountInput = Pick<
  AccountDocument,
  | "userId"
  | "connectionId"
  | "provider"
  | "providerAccountId"
  | "institutionName"
  | "type"
  | "subtype"
  | "currentBalance"
  | "isoCurrencyCode"
> &
  Partial<Pick<AccountDocument, "officialName" | "availableBalance">>;
// ACCT-1: `nickname` is deliberately NOT part of this type. Every field
// here is provider-owned and gets `$set` on every resync
// (upsertFromSync() below) -- a nickname is the one thing on this
// document the *user* owns, the same reasoning
// TransactionRepository.upsertFromSync() already documents for
// `category`. It's written only through updateNickname().

export class AccountRepository {
  /** Upserts by (userId, provider, providerAccountId). */
  async upsertFromSync(input: UpsertAccountInput): Promise<AccountDocument> {
    const doc = await AccountModel.findOneAndUpdate(
      {
        userId: input.userId,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      },
      { $set: input },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return doc as AccountDocument;
  }

  async findById(accountId: string): Promise<AccountDocument | null> {
    return AccountModel.findById(accountId).lean<AccountDocument | null>();
  }

  async findByUserId(userId: string): Promise<AccountDocument[]> {
    return AccountModel.find({ userId }).lean<AccountDocument[]>();
  }

  async findByConnectionId(connectionId: string): Promise<AccountDocument[]> {
    return AccountModel.find({ connectionId }).lean<AccountDocument[]>();
  }

  /** ACCT-1: renames a linked account -- scoped to (accountId, userId)
   * together so one user can never rename another's account via a
   * guessed id, the same ownership check
   * `CategoryRepository.update()`/`TransactionRepository.updateCategoryForUser()`
   * already established elsewhere in this codebase. `nickname: null`
   * clears it (`$unset`) rather than setting an empty string, so display
   * code's `nickname ?? officialName ?? institutionName` fallback
   * correctly falls through instead of showing a blank name. Catches
   * mongoose's `CastError` on a malformed id and returns `null` rather
   * than 500ing, matching `updateCategoryForUser()`'s precedent. */
  async updateNickname(
    userId: string,
    accountId: string,
    nickname: string | null,
  ): Promise<AccountDocument | null> {
    try {
      return await AccountModel.findOneAndUpdate(
        { _id: accountId, userId },
        nickname === null ? { $unset: { nickname: "" } } : { $set: { nickname } },
        { new: true },
      ).lean<AccountDocument | null>();
    } catch (err) {
      if (err instanceof Error && err.name === "CastError") {
        return null;
      }
      throw err;
    }
  }
}
