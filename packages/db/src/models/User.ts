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
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });

export const UserModel: Model<UserDocument> =
  mongoose.models.User ?? model<UserDocument>("User", userSchema);
