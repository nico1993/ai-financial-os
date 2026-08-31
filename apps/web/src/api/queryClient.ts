import { QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./client";
import { AUTH_ME_QUERY_KEY } from "../auth/session";

// WEB-3's "shared 401 -> redirect-to-login handling": any query anywhere
// in the app that gets a 401 marks the session gone by writing `null`
// into the one auth/me query key every ProtectedRoute (WEB-4) reads --
// no separate event bus, no raw `window.location` redirect buried in a
// fetch wrapper. Every route in this app requires auth today, so "the
// session is gone" is the only reason anything should 401; if a query
// that's allowed to 401 for some other reason is ever added, it should
// opt out via its own `meta` flag, not by weakening this handler.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // A 401 means "not logged in", not "transient failure" --
        // retrying just delays the redirect ProtectedRoute is about to do.
        if (error instanceof ApiError && error.status === 401) return false;
        return failureCount < 2;
      },
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        queryClient.setQueryData(AUTH_ME_QUERY_KEY, null);
      }
    },
  }),
});
