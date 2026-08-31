// lib/useDashboardEvents.ts — ANLY-10's live-update client for ANLY-8's
// SSE stream (apps/api/src/routes/events.ts, ADR-0037). One EventSource,
// mounted once for the whole authenticated app (layout/AppShell.tsx), not
// per page -- a page-level mount would open/close a connection on every
// route change for no benefit, since every analytics query this app has
// lives under the same `["analytics", ...]` query-key prefix
// (api/analytics.ts) regardless of which page is currently showing it.
//
// Deliberately coarse invalidation: all three named events
// (sync.completed, transfer.matched, rollup.completed) invalidate the
// entire `["analytics"]` prefix rather than mapping each event to the one
// query it most precisely affects. rollup.completed is the real
// "dashboard numbers changed" signal (ADR-0037); the other two fire
// slightly earlier in the same pipeline and would otherwise need their
// own bespoke query-key mapping for a saving that doesn't matter here --
// every analytics query is a cheap indexed read (ADR-0035), so an extra
// redundant refetch costs nothing a user would notice.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const DASHBOARD_EVENT_TYPES = ["sync.completed", "transfer.matched", "rollup.completed"] as const;

export function useDashboardEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource("/events", { withCredentials: true });

    const invalidate = (): void => {
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
    };

    for (const type of DASHBOARD_EVENT_TYPES) {
      source.addEventListener(type, invalidate);
    }

    // EventSource reconnects on its own after a transient error (e.g. the
    // API restarting) -- there's nothing this hook needs to do beyond not
    // crashing the app over it.
    source.onerror = () => {};

    return () => {
      for (const type of DASHBOARD_EVENT_TYPES) {
        source.removeEventListener(type, invalidate);
      }
      source.close();
    };
  }, [queryClient]);
}
