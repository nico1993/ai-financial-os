import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";

export interface AuthUser {
  id: string;
  email: string;
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

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, null);
    },
  });
}
