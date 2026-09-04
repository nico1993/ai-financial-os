// User — an authenticated account (ADR-0018). Distinct from the `userId`
// string already used on every other collection (Connection, Account,
// Transaction, ...): those predate this model and stay plain strings
// rather than a `ref`, matching the existing convention — a User's
// `_id.toString()` is simply the value that gets stored there.
import mongoose, { Schema, model, type Model } from "mongoose";

export interface UserDocument {
  _id: mongoose.Types.ObjectId;
  email: string;
  /** bcrypt hash — never the plaintext password. `select: false` so it's
   * excluded from every query by default, same pattern as
   * Connection.accessToken (ADR-0016). */
  passwordHash: string;
  /** AUTH-7: optional -- every user created before this field existed has
   * neither stored at all, the same "optional at the type level despite
   * being a normal, freely-editable field" honesty this codebase already
   * applies to Account.nickname/Category.icon. Only the Settings page's
   * Profile form (`UserRepository.updateProfile()`) ever writes these --
   * no sync/seed path sets them the way a provider owns other fields
   * elsewhere in this schema set. */
  firstName?: string;
  lastName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });

export const UserModel: Model<UserDocument> =
  mongoose.models.User ?? model<UserDocument>("User", userSchema);
