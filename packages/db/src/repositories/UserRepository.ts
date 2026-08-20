// UserRepository — every persistence operation on User goes through here
// (ADR-0005). Password hashing/verification is not this package's job
// (ADR-0018 puts it in apps/api, alongside session handling) — this
// repository only ever stores/reads whatever hash it's given.
import { UserModel, type UserDocument } from "../models/User.js";

export type CreateUserInput = Pick<UserDocument, "email" | "passwordHash">;

export class UserRepository {
  async create(input: CreateUserInput): Promise<UserDocument> {
    const doc = await UserModel.create(input);
    return doc.toObject() as UserDocument;
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return UserModel.findOne({ email: email.toLowerCase() }).lean<UserDocument | null>();
  }

  /** The one place `passwordHash` is ever read back out — login is the
   * only caller. Every other read path should use findByEmail()/findById()
   * and never see it. */
  async findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return UserModel.findOne({ email: email.toLowerCase() })
      .select("+passwordHash")
      .lean<UserDocument | null>();
  }

  async findById(userId: string): Promise<UserDocument | null> {
    return UserModel.findById(userId).lean<UserDocument | null>();
  }

  /** Used by the register route to decide whether this is the bootstrap
   * (zero-users) case (ADR-0018). */
  async count(): Promise<number> {
    return UserModel.countDocuments();
  }
}
