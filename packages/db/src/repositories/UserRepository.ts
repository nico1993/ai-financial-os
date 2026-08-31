// UserRepository — every persistence operation on User goes through here
// (ADR-0005). Password hashing/verification is not this package's job
// (ADR-0018 puts it in apps/api, alongside session handling) — this
// repository only ever stores/reads whatever hash it's given.
import { UserModel, type UserDocument } from "../models/User.js";

export type CreateUserInput = Pick<UserDocument, "email" | "passwordHash">;

/** A user as every path except login sees it: no credential attached.
 *
 * This is a type, not just a convention, because `select: false` alone
 * doesn't get you there. It excludes the field from *queries*, so
 * `findByEmail`/`findById` genuinely come back without it — but
 * `Model.create()` isn't a query, and returns the document just built
 * from the caller's input, hash included. Typing the safe paths as
 * `SafeUserDocument` makes the compiler enforce what `select: false` only
 * half-delivers: `findByEmailWithPassword()` is the one function whose
 * return type admits a `passwordHash`, so any code touching a credential
 * has to go through the function named for it. */
export type SafeUserDocument = Omit<UserDocument, "passwordHash">;

export class UserRepository {
  async create(input: CreateUserInput): Promise<SafeUserDocument> {
    const doc = await UserModel.create(input);
    const { _id, email, createdAt, updatedAt } = doc.toObject() as UserDocument;
    // Named allow-list rather than stripping passwordHash off the created
    // document: `select: false` doesn't help here (it applies to queries,
    // and Model.create() hands back what the caller passed in), and a
    // deny-list would silently start leaking the next sensitive field
    // added to this schema. Listing what may leave means a new field is
    // withheld by default until someone deliberately adds it here.
    return { _id, email, createdAt, updatedAt };
  }

  async findByEmail(email: string): Promise<SafeUserDocument | null> {
    return UserModel.findOne({ email: email.toLowerCase() }).lean<SafeUserDocument | null>();
  }

  /** The one place `passwordHash` is ever read back out — login is the
   * only caller, and the only function whose return type carries it. */
  async findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return UserModel.findOne({ email: email.toLowerCase() })
      .select("+passwordHash")
      .lean<UserDocument | null>();
  }

  async findById(userId: string): Promise<SafeUserDocument | null> {
    return UserModel.findById(userId).lean<SafeUserDocument | null>();
  }

  /** Used by the register route to decide whether this is the bootstrap
   * (zero-users) case (ADR-0018). */
  async count(): Promise<number> {
    return UserModel.countDocuments();
  }

  /** Every user id in the system -- ANLY-7's subscription-detection
   * scheduler (mirroring ConnectionRepository.findSyncable()'s role for
   * providerSyncScheduler.ts) enumerates all of them rather than assuming
   * a single hardcoded user, even though this app is built for one. */
  async findAllIds(): Promise<string[]> {
    const docs = await UserModel.find().select("_id").lean<{ _id: unknown }[]>();
    return docs.map((doc) => String(doc._id));
  }
}
