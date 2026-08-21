// Translates Plaid/axios failures into the provider-neutral taxonomy
// (errors.ts, ADR-0023). Pure and dependency-free on purpose: it reads an
// `unknown` structurally rather than importing axios's types, so it can be
// unit-tested against hand-built error shapes and doesn't tie this package
// to whichever HTTP client the Plaid SDK ships with.
import { ProviderRateLimitError, type ProviderError } from "../errors.js";

interface PlaidErrorBody {
  error_type?: unknown;
  error_code?: unknown;
  error_message?: unknown;
}

interface HttpErrorShape {
  status?: number;
  headers?: Record<string, unknown>;
  body?: PlaidErrorBody;
}

/** Digs the pieces we care about out of an axios-shaped error without
 * assuming any of them are present. */
function readHttpError(err: unknown): HttpErrorShape {
  if (typeof err !== "object" || err === null) return {};
  const response = (err as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return {};

  const status = (response as { status?: unknown }).status;
  const headers = (response as { headers?: unknown }).headers;
  const data = (response as { data?: unknown }).data;

  return {
    status: typeof status === "number" ? status : undefined,
    headers:
      typeof headers === "object" && headers !== null
        ? (headers as Record<string, unknown>)
        : undefined,
    body: typeof data === "object" && data !== null ? (data as PlaidErrorBody) : undefined,
  };
}

/** `Retry-After` is defined in seconds. Returns undefined for a missing or
 * unparseable value so the caller can apply its own default rather than
 * backing off for NaN milliseconds. */
export function parseRetryAfterMs(
  headers: Record<string, unknown> | undefined,
): number | undefined {
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (raw === undefined || raw === null) return undefined;

  const seconds = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds * 1000;
}

/**
 * Maps a thrown Plaid SDK error onto the neutral taxonomy, or returns
 * undefined when it isn't a case anything upstream treats specially — in
 * which case the caller rethrows the original, preserving its stack and
 * message rather than flattening every failure into a generic wrapper.
 */
export function mapPlaidError(err: unknown): ProviderError | undefined {
  const { status, headers, body } = readHttpError(err);

  const isRateLimited =
    status === 429 ||
    body?.error_type === "RATE_LIMIT_EXCEEDED" ||
    body?.error_code === "RATE_LIMIT_EXCEEDED";

  if (isRateLimited) {
    const detail =
      typeof body?.error_message === "string" ? body.error_message : "Plaid rate limit exceeded";
    return new ProviderRateLimitError(detail, {
      cause: err,
      retryAfterMs: parseRetryAfterMs(headers),
    });
  }

  return undefined;
}

/** Wraps a Plaid SDK call so every exit path out of the adapter carries a
 * neutral error type where one applies. */
export async function withPlaidErrorMapping<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const mapped = mapPlaidError(err);
    throw mapped ?? err;
  }
}
