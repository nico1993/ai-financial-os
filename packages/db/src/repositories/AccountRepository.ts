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

  /** ACCT-2: the Accounts page's data source -- excludes an account the
   * user has deleted (archive() below). Deliberately `{ archived: { $ne:
   * true } }`, not `{ archived: false }` (the query CategoryRepository.
   * findActiveByUser() uses for the same purpose) -- every Account
   * created before this field existed has no `archived` key at all in
   * its stored document, and `{ archived: false }` would NOT match a
   * missing field, silently hiding every pre-existing account the
   * instant this shipped. `$ne: true` matches both `false` and missing,
   * needs no backfill migration, and is the safer form for a boolean
   * added to a schema with real existing rows. Worth a look at whether
   * CategoryRepository.findActiveByUser() has the same latent gap for
   * any Category row that predates *that* field -- not investigated or
   * touched here, flagged in BACKLOG.md instead since it's a different
   * story's code. */
  async findActiveByUser(userId: string): Promise<AccountDocument[]> {
    return AccountModel.find({ userId, archived: { $ne: true } }).lean<AccountDocument[]>();
  }

  /** ACCT-2: soft-deletes one account -- scoped to (accountId, userId)
   * together, same ownership check `updateNickname()` above already
   * established. Returns the updated document (mainly so a caller can
   * echo back `{ id, archived: true }`) or `null` on no match (wrong id,
   * wrong owner, already archived, or a malformed id -- CastError
   * caught and treated as "not found," matching `updateNickname()`'s
   * precedent) rather than throwing. Nothing here touches the parent
   * Connection or sibling Accounts -- deleting one account never
   * revokes Plaid access or affects any other account under the same
   * login, by design (see this field's own doc comment on
   * AccountDocument for the full reasoning). */
  async archive(userId: string, accountId: string): Promise<AccountDocument | null> {
    try {
      return await AccountModel.findOneAndUpdate(
        { _id: accountId, userId },
        { $set: { archived: true } },
        { new: true },
      ).lean<AccountDocument | null>();
    } catch (err) {
      if (err instanceof Error && err.name === "CastError") {
        return null;
      }
      throw err;
    }
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
