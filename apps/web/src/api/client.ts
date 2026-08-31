// Typed fetch wrapper against apps/api (WEB-3). The one place `fetch()`
// is called from in this app -- every data-fetching hook goes through
// `apiFetch`, not a raw fetch call, so the credentials/error-shape/401
// handling below is guaranteed rather than something each call site has
// to remember.

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** A plain object/array is JSON.stringify'd with a matching
   * Content-Type set automatically; a string/FormData/etc. is passed
   * through untouched (matches native fetch's own BodyInit handling). */
  body?: unknown;
}

function isPlainJsonBody(body: unknown): boolean {
  if (body === undefined || typeof body === "string") return false;
  if (body instanceof FormData || body instanceof Blob) return false;
  if (body instanceof URLSearchParams || body instanceof ArrayBuffer) return false;
  if (ArrayBuffer.isView(body)) return false; // typed arrays, DataView
  return true;
}

function hasErrorMessage(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * `credentials: 'include'` always -- AUTH-2's session cookie has to ride
 * along whether the request ends up same-origin (Caddy in production, and
 * Vite's dev proxy -- see vite.config.ts) or genuinely cross-origin.
 *
 * Non-ok responses throw `ApiError` (status + parsed body) instead of
 * returning one, so a caller's happy path never branches on
 * `response.ok`. 204/205 responses (logout) resolve to `undefined`
 * rather than trying to JSON-parse an empty body.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  const isJsonBody = isPlainJsonBody(body);

  // Normalize via the Headers constructor rather than object-spreading
  // `headers` directly -- a caller passing a real `Headers` instance or an
  // array of [key, value] tuples (both valid RequestInit.headers shapes)
  // would silently spread to `{}` otherwise, since neither exposes its
  // entries as plain enumerable properties.
  const requestHeaders = new Headers(headers);
  if (isJsonBody && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...rest,
    credentials: "include",
    body: isJsonBody ? JSON.stringify(body) : (body as BodyInit | undefined),
    headers: requestHeaders,
  });

  // 204/205 are 2xx by definition (Response.ok is literally `status >=
  // 200 && status < 300`), so there's no "non-ok 204" to guard against --
  // logout's real response always lands here as a clean no-op.
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const text = await response.text();
  const parsed: unknown = text.length > 0 ? safeJsonParse(text) : null;

  if (!response.ok) {
    throw new ApiError(response.status, parsed, hasErrorMessage(parsed) ? parsed.error : undefined);
  }

  return parsed as T;
}

/** Renders an error from `apiFetch` for display -- apps/api's routes
 * consistently send `{error: "..."}` (routes/auth.ts) on failure, so this
 * is the one place that shape gets unwrapped instead of every page
 * re-checking `error instanceof ApiError && ...`. */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && hasErrorMessage(error.body)) {
    return error.body.error;
  }
  return fallback;
}
