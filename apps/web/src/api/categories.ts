// api/categories.ts — CAT-7's typed client for
// apps/api/src/routes/categories.ts: this user's active category list,
// the dropdown source for manual correction. Its own file rather than
// folded into api/transactions.ts -- categories aren't transaction data,
// and a future "manage categories" UI (CAT-9/CAT-10) would grow this file
// on its own regardless.
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface CategoryListItem {
  id: string;
  name: string;
  color: string;
}

// staleTime: Infinity, same reasoning as api/config.ts's useConfigQuery()
// -- a user's category list doesn't change from outside this app's own
// (not-yet-built) category-management UI, so there's nothing external
// this needs to poll for. Revisit if CAT-9/CAT-10 ever add one.
export function useCategoriesQuery() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<CategoryListItem[]>("/api/categories"),
    staleTime: Infinity,
  });
}
