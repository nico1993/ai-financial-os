import type { ReactNode, SVGProps } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useLogoutMutation, useSessionQuery } from "../auth/session";
import { useConfigQuery } from "../api/config";
import { Button } from "../components/ui/button";
import { useDashboardEvents } from "../lib/useDashboardEvents";
import { cn } from "../lib/utils";

function IconAccounts(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M3 10l9-6 9 6M4 10v9h16v-9M9 19v-6h6v6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconLedger(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M7 9h10M7 13h10M7 17h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconTrend(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M3 17l5-6 4 4 8-9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconFlow(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M3 12h4l2-7 4 14 2-7h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconPie(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 3.5A8.5 8.5 0 0 1 12 20.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
function IconFlag(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M9 11l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: (props: SVGProps<SVGSVGElement>) => ReactNode;
}

// The five destinations WEB-2 actually names in BACKLOG.md, in the order
// listed there, plus Accounts (WEB-7) and Transactions (WEB-8) leading
// them. Accounts is first -- connecting a bank is the one thing that has
// to happen before anything else has real data to show. Transactions is
// second, ahead of the four analytics pages, since it's the raw ledger
// those four are aggregates OF -- someone checking "did that charge
// actually post" wants the ledger, not a chart.
const NAV_ITEMS: NavItem[] = [
  { to: "/accounts", label: "Accounts", icon: IconAccounts },
  { to: "/transactions", label: "Transactions", icon: IconLedger },
  { to: "/net-worth", label: "Net worth", icon: IconTrend },
  { to: "/cash-flow", label: "Cash flow", icon: IconFlow },
  { to: "/spending", label: "Spending", icon: IconPie },
  { to: "/subscriptions", label: "Subscriptions", icon: IconCalendar },
  { to: "/review", label: "Needs review", icon: IconFlag },
];

/** WEB-4's base layout: sidebar nav + header, `<Outlet/>` for the routed
 * page. Sits inside ProtectedRoute in router.tsx, so everything here can
 * assume `useSessionQuery().data` is a real user.
 *
 * ANLY-10's SSE client mounts here rather than in any one page -- one
 * connection for the whole authenticated app, alive across every route
 * change, invalidating the shared `["analytics"]` query prefix no matter
 * which dashboard page happens to be showing when an event arrives.
 *
 * WEB-7 addition: a "Sandbox" badge next to the wordmark whenever
 * `useConfigQuery()`'s `plaidEnv` isn't `"production"` -- deployment-wide
 * (there's only one Plaid environment per deployment today), so it's read
 * here once rather than by every page that might otherwise want to know. */
export function AppShell() {
  const session = useSessionQuery();
  const logout = useLogoutMutation();
  const config = useConfigQuery();
  const user = session.data;
  useDashboardEvents();

  return (
    <div className="flex min-h-screen bg-background font-sans text-ink">
      <aside className="flex w-60 flex-shrink-0 flex-col border-r border-border bg-surface-secondary p-4">
        <div className="flex items-center gap-2 px-2 pb-5 pt-1.5 text-sm font-semibold tracking-tight">
          Financial OS
          {config.data && config.data.plaidEnv !== "production" && (
            <span className="rounded-full bg-accent-wash px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
              Sandbox
            </span>
          )}
        </div>

        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-ink-secondary",
                  isActive && "bg-accent-wash font-medium text-ink",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute -left-4 top-1.5 bottom-1.5 w-[3px] rounded-r-sm bg-accent" />
                  )}
                  <Icon
                    className={cn(
                      "h-4 w-4 flex-shrink-0 opacity-75",
                      isActive && "text-accent opacity-100",
                    )}
                  />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex items-center gap-2.5 border-t border-border pt-3">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-button-primary text-[11px] font-semibold text-white">
            {user?.email.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{user?.email}</div>
            <div className="text-[11px] text-ink-muted">Owner · single-user</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            aria-label="Sign out"
            className="px-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 17l5-5-5-5M20 12H9M12 19H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
