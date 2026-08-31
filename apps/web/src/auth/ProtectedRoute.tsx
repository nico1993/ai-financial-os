import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSessionQuery } from "./session";

/**
 * WEB-4's "redirect-if-unauthenticated route wrapper" -- used in router.tsx
 * (WEB-2) as a layout route wrapping every page except /login.
 *
 * Three states, matching useSessionQuery's three readings: still
 * resolving (a bare loading line -- this is the very first thing any
 * visitor sees, so it can't depend on anything that itself depends on
 * being authenticated), resolved to a user (render the nested route via
 * Outlet), or resolved to `null` (redirect to /login, remembering where
 * we came from in location state so LoginPage can send them back).
 */
export function ProtectedRoute() {
  const location = useLocation();
  const session = useSessionQuery();

  if (session.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-ink-muted">
        Loading…
      </div>
    );
  }

  if (!session.data) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
