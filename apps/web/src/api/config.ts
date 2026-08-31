// api/config.ts — one deployment-level flag today (WEB-7's sandbox-mode
// badge): which Plaid environment this deployment is running against.
// `staleTime: Infinity` on purpose -- this can't change without a
// redeploy, so there's nothing to ever refetch it for within a session.
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface AppConfig {
  plaidEnv: "sandbox" | "development" | "production";
}

export function useConfigQuery() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => apiFetch<AppConfig>("/api/config"),
    staleTime: Infinity,
  });
}
