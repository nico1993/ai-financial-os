import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";

export interface AuthUser {
  id: string;
  email: string;
  /** AUTH-7: `null` when never set, not `undefined` -- routes/auth.ts's
   * responses always include both keys explicitly (`?? null`), so a
   * component can read `user.firstName ?? ""` with no extra undefined
   * check. */
  firstName: string | null;
  lastName: string | null;
}

export const AUTH_ME_QUERY_KEY = ["auth", "me"] as const;

/**
 * The one place `GET /api/auth/me` is called from -- WEB-4's "session
 * bootstrap". Every route, login included (so it can send an
 * already-authenticated visitor straight past the form), reads this same
 * query rather than each maintaining its own "am I logged in" state;
 * React Query's cache is the single source of truth, and
 * queryClient.ts's global 401 handler writes `null` into this exact key
 * whenever any request's session turns out to be gone.
 *
 * Reads as one of three states: `isLoading` (still resolving),
 * `data` a real `AuthUser` (signed in), or `data === null` (signed out --
 * either a real 401 here or the global handler catching a 401 elsewhere).
 * `retry: false`: a 401 means "not logged in", not "transient failure".
 */
export function useSessionQuery() {
  return useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: () => apiFetch<AuthUser>("/api/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
}

/** Posts credentials to `/api/auth/login` and seeds the session query
 * with the returned user directly (`setQueryData`, not `invalidateQueries`
 * + a refetch) -- the login response already IS the up-to-date `/me`
 * shape (routes/auth.ts returns the identical `{id, email}` from both),
 * so there's nothing a refetch would learn that the response doesn't
 * already say. */
export function useLoginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      apiFetch<AuthUser>("/api/auth/login", { method: "POST", body: credentials }),
    onSuccess: (user) => {
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, user);
    },
  });
}

/** AUTH-6: posts new-account credentials to `/api/auth/register`. Same
 * `setQueryData`-not-`invalidateQueries` shortcut as `useLoginMutation()`
 * above, for the same reason -- `routes/auth.ts`'s register handler
 * returns the identical `{id, email}` shape and also sets
 * `req.session.userId` itself, so the caller is signed in the moment
 * this resolves. The backend enforces *when* registration is allowed
 * (bootstrap, or an already-authenticated user adding another --
 * ADR-0018); this hook has no opinion on that, it just surfaces
 * whatever `apiFetch` throws (a 403 "registration is closed" included)
 * through the normal `ApiError`/`getApiErrorMessage()` path. */
export function useRegisterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      apiFetch<AuthUser>("/api/auth/register", { method: "POST", body: credentials }),
    onSuccess: (user) => {
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, user);
    },
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, null);
    },
  });
}

// -- AUTH-7: Settings page's Profile card ------------------------------------

export interface UpdateProfileInput {
  email?: string;
  /** Empty string clears the field -- mirrors routes/auth.ts's own
   * clear-via-empty-string contract for these two fields
   * (updateProfileSchema's doc comment). */
  firstName?: string;
  lastName?: string;
}

/** Same setQueryData-not-invalidateQueries shortcut useLoginMutation()
 * already uses above -- PATCH /api/auth/me's response is the
 * authoritative, up-to-date AuthUser shape, so there's nothing a
 * refetch would learn that the response doesn't already say. */
export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      apiFetch<AuthUser>("/api/auth/me", { method: "PATCH", body: input }),
    onSuccess: (user) => {
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, user);
    },
  });
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/** No query invalidation -- POST /api/auth/me/password's 204 response
 * carries nothing AuthUser-shaped to write back, and a password change
 * doesn't touch any other cached state in this app. */
export function useChangePasswordMutation() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      apiFetch<void>("/api/auth/me/password", { method: "POST", body: input }),
  });
}
