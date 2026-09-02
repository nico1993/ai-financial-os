// api/categories.ts — CAT-7's typed client for
// apps/api/src/routes/categories.ts: this user's active category list,
// the dropdown source for manual correction. Its own file rather than
// folded into api/transactions.ts -- categories aren't transaction data,
// and a future "manage categories" UI (CAT-9/CAT-10) would grow this file
// on its own regardless. CAT-11 adds `icon`; CAT-14 adds the create
// mutation below.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type CategoryKind = "income" | "expense";

export interface CategoryListItem {
  id: string;
  name: string;
  color: string;
  /** CAT-11: a lucide-react icon key from design/categoryIcons.tsx's
   * curated set, or undefined for a category created before this field
   * existed -- CategoryIcon() handles the fallback. */
  icon?: string;
  /** CAT-16: true for one of CategoryRepository.seedDefaults()'s rows,
   * false for a user-added custom category -- CategoriesPage.tsx's
   * Custom/Income/Expense grouping signal (see that page's own comment
   * for the full grouping rule: Custom is `!isDefault` regardless of
   * kind, Income/Expense only splits the `isDefault: true` rows). */
  isDefault: boolean;
  /** CAT-16: always a real "income" | "expense" -- the API route
   * normalizes a pre-CAT-16 row's missing value to "expense" before this
   * ever reaches the client (routes/categories.ts's own comment has the
   * mechanics of why the DB value itself can still be undefined). */
  kind: CategoryKind;
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

// -- CAT-14: create a custom category ---------------------------------------

export interface CreateCategoryInput {
  name: string;
  icon?: string;
  /** CAT-16: optional -- the API itself defaults to "expense" when
   * omitted (routes/categories.ts's createCategorySchema), so callers
   * that don't care (none today; AddCategoryForm.tsx always sends one
   * via its own default) don't have to. */
  kind?: CategoryKind;
}

export function useCreateCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      apiFetch<CategoryListItem>("/api/categories", { method: "POST", body: input }),
    onSuccess: () => {
      // staleTime: Infinity above means this is the only thing that ever
      // makes a freshly-created category show up anywhere else in the
      // app (the transaction/review category selects, WEB-10's category
      // filter) without a full page reload.
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

// -- CAT-16: recolor / re-icon / re-kind an existing category ------------

export interface UpdateCategoryInput {
  categoryId: string;
  color?: string;
  icon?: string;
  kind?: CategoryKind;
}

/** CategoriesPage.tsx's inline edit control (color + IconPicker re-use)
 * is this mutation's one caller -- activates the `PATCH
 * /api/categories/:id` route CAT-16 also added, same "invalidate the
 * whole list" reasoning useCreateCategoryMutation() above already uses
 * (staleTime: Infinity means nothing else refreshes this list on its
 * own). */
export function useUpdateCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, ...body }: UpdateCategoryInput) =>
      apiFetch<CategoryListItem>(`/api/categories/${categoryId}`, { method: "PATCH", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}
