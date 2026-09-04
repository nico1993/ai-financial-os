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
    const { _id, email, firstName, lastName, createdAt, updatedAt } =
      doc.toObject() as UserDocument;
    // Named allow-list rather than stripping passwordHash off the created
    // document: `select: false` doesn't help here (it applies to queries,
    // and Model.create() hands back what the caller passed in), and a
    // deny-list would silently start leaking the next sensitive field
    // added to this schema. Listing what may leave means a new field is
    // withheld by default until someone deliberately adds it here.
    return { _id, email, firstName, lastName, createdAt, updatedAt };
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

  /** AUTH-7's password-change flow: starts from the authenticated
   * session's userId, not a re-entered email the way login's
   * findByEmailWithPassword() does -- same "the one place passwordHash
   * is ever read back out" precedent, a second entry point for it since
   * this caller genuinely has no email handy without an extra round
   * trip. Tolerates a malformed id (CastError) the same way every other
   * repository method fed a raw client-supplied id already does in this
   * codebase, rather than letting it escape as a 500. */
  async findByIdWithPassword(userId: string): Promise<UserDocument | null> {
    try {
      return await UserModel.findById(userId).select("+passwordHash").lean<UserDocument | null>();
    } catch (err) {
      if (err instanceof Error && err.name === "CastError") {
        return null;
      }
      throw err;
    }
  }

  /** AUTH-7: edits the fields the Settings page's Profile card owns.
   * Checking a new `email` for a collision with another user is the
   * caller's job (routes/auth.ts does, via findByEmail()) -- this
   * method just writes what it's given and lets the schema's own
   * unique index catch a race as a last resort, the same layering
   * ADR-0018 already draws between this package and apps/api.
   * `firstName`/`lastName: null` clears the field (`$unset`), matching
   * this codebase's established empty-clears-via-unset convention
   * (AccountRepository.updateNickname()) rather than storing an empty
   * string; `undefined` (the field simply omitted from `updates`) means
   * "leave this field alone," the ordinary PATCH-semantics distinction.
   * Returns null on no match, including a malformed id (CastError
   * tolerated the same way every other ownership-scoped update in this
   * codebase already handles it). */
  async updateProfile(
    userId: string,
    updates: { email?: string; firstName?: string | null; lastName?: string | null },
  ): Promise<SafeUserDocument | null> {
    const $set: Record<string, string> = {};
    const $unset: Record<string, string> = {};
    if (updates.email !== undefined) $set.email = updates.email;
    if (updates.firstName !== undefined) {
      if (updates.firstName === null) $unset.firstName = "";
      else $set.firstName = updates.firstName;
    }
    if (updates.lastName !== undefined) {
      if (updates.lastName === null) $unset.lastName = "";
      else $set.lastName = updates.lastName;
    }

    try {
      return await UserModel.findByIdAndUpdate(
        userId,
        {
          ...(Object.keys($set).length > 0 ? { $set } : {}),
          ...(Object.keys($unset).length > 0 ? { $unset } : {}),
        },
        { new: true },
      ).lean<SafeUserDocument | null>();
    } catch (err) {
      if (err instanceof Error && err.name === "CastError") {
        return null;
      }
      throw err;
    }
  }

  /** AUTH-7: sets a new password hash. Verifying the caller's *current*
   * password first is routes/auth.ts's job -- the same layering
   * ADR-0018 already established (this repository only ever stores/
   * reads a hash it's given, it never hashes or verifies one itself).
   * Returns whether a matching user was found, not the document --
   * nothing about this response should ever echo password state back. */
  async updatePassword(userId: string, passwordHash: string): Promise<boolean> {
    try {
      const result = await UserModel.updateOne({ _id: userId }, { $set: { passwordHash } });
      return result.matchedCount > 0;
    } catch (err) {
      if (err instanceof Error && err.name === "CastError") {
        return false;
      }
      throw err;
    }
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

  /** AUTH-8/ADR-0047: the one hard delete in this codebase -- see that
   * ADR for why deleting a User is deliberately not a soft-archive the
   * way every other delete here is (Transaction.isRemoved,
   * Category.archived, Account.archived). Returns whether a matching
   * user was found and removed; tolerates a malformed id the same way
   * every other id-scoped method in this repository already does. */
  async deleteById(userId: string): Promise<boolean> {
    try {
      const result = await UserModel.deleteOne({ _id: userId });
      return result.deletedCount > 0;
    } catch (err) {
      if (err instanceof Error && err.name === "CastError") {
        return false;
      }
      throw err;
    }
  }
}
