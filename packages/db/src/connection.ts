// Mongoose connection helper. apps/api and apps/worker both call connectDb()
// once at startup; no other module should call mongoose.connect() directly
// (ADR-0005 — no raw driver calls outside packages/db).
import mongoose from "mongoose";

export interface ConnectDbOptions {
  uri: string;
}

let connectionPromise: Promise<typeof mongoose> | null = null;

/** Connects Mongoose to `uri`, reusing the in-flight/established connection
 * on repeat calls rather than opening a new one each time. */
export function connectDb({ uri }: ConnectDbOptions): Promise<typeof mongoose> {
  const promise: Promise<typeof mongoose> = connectionPromise ?? mongoose.connect(uri);
  connectionPromise = promise;
  return promise;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  connectionPromise = null;
}
