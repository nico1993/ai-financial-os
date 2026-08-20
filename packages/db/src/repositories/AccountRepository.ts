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
}
