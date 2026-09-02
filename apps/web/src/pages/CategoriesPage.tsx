// pages/CategoriesPage.tsx — CAT-16: a dedicated "/categories" management
// page, three grouped sections (Custom / Income / Expense) plus an "Add
// category" affordance (AddCategoryForm, relocated from ReviewPage.tsx --
// see that component's own comment).
//
// Grouping interpretation, made explicit here since the request that
// prompted this page was three lists without saying exactly how a
// category picks one (worth a second look, not silently decided, the
// same way this codebase already flags ACCT-2/WEB-7/ANLY-14's own open
// interpretation calls):
//   - "Custom" = `!isDefault` -- a user's own category, regardless of
//     its `kind`. A custom category never duplicates into Income/Expense
//     even if it has a kind set (AddCategoryForm.tsx lets a user pick
//     one at creation, mainly so a future income-vs-expense distinction
//     elsewhere in the app has something to read -- not for this page's
//     own bucketing).
//   - "Income" / "Expense" = the seeded defaults (`isDefault: true`)
//     split by `kind`. `kind` is already normalized to a real
//     "income" | "expense" by the API (routes/categories.ts) even for a
//     pre-CAT-16 row with nothing stored -- see CategoryListItem's own
//     doc comment (api/categories.ts) for why that's safe to rely on
//     here without an extra `?? "expense"` at this layer.
//
// Known limitation, not fixed by this page: a user whose "Income"
// category was already seeded *before* CAT-16 shipped has a DB row with
// no `kind` stored at all (CategoryRepository.seedDefaults()'s
// $setOnInsert never touches an existing row) -- it reads back here as
// `kind: "expense"` (the API's own safe-but-wrong-for-this-one-case
// normalization) and shows under Expense until someone edits it through
// the PATCH route with `kind: "income"`. This page's own inline edit
// control is scoped to color + icon only (per this ticket's own text),
// not kind, so today that requires a direct API call, not a UI action --
// worth a look if an existing user's Income category shows up in the
// wrong section.
import { useState } from "react";
import { useCategoriesQuery, useUpdateCategoryMutation } from "../api/categories";
import type { CategoryListItem } from "../api/categories";
import { getApiErrorMessage } from "../api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { CategoryIcon } from "../design/categoryIcons";
import { IconPicker } from "../components/IconPicker";
import { ColorPicker } from "../components/ColorPicker";
import { AddCategoryForm } from "../components/AddCategoryForm";

function CategoryRow({ category }: { category: CategoryListItem }) {
  const update = useUpdateCategoryMutation();
  const [editing, setEditing] = useState(false);
  const [color, setColor] = useState(category.color);
  const [icon, setIcon] = useState(category.icon ?? "tag");

  function startEditing(): void {
    setColor(category.color);
    setIcon(category.icon ?? "tag");
    setEditing(true);
  }

  function save(): void {
    const changes: { color?: string; icon?: string } = {};
    if (color !== category.color) changes.color = color;
    if (icon !== (category.icon ?? "tag")) changes.icon = icon;
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    update.mutate({ categoryId: category.id, ...changes }, { onSuccess: () => setEditing(false) });
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-2 rounded-md border border-border bg-surface-secondary p-2.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-3 w-3 flex-shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <CategoryIcon icon={icon} className="h-4 w-4 flex-shrink-0 text-ink-secondary" />
          <span className="text-sm text-ink">{category.name}</span>
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" disabled={update.isPending} onClick={save}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
        <ColorPicker value={color} onChange={setColor} />
        <IconPicker value={icon} onChange={setIcon} />
        {update.isError && (
          <p role="alert" className="text-xs text-critical-text">
            {getApiErrorMessage(update.error, "Could not update that category.")}
          </p>
        )}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm">
      <span
        aria-hidden="true"
        className="h-3 w-3 flex-shrink-0 rounded-full"
        style={{ backgroundColor: category.color }}
      />
      <CategoryIcon icon={category.icon} className="h-4 w-4 flex-shrink-0 text-ink-secondary" />
      <span className="text-ink">{category.name}</span>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto px-2 text-xs"
        onClick={startEditing}
        aria-label={`Edit ${category.name}`}
      >
        Edit
      </Button>
    </li>
  );
}

function CategoryGroup({
  title,
  description,
  categories,
  emptyText,
}: {
  title: string;
  description: string;
  categories: CategoryListItem[];
  emptyText: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {categories.length === 0 ? (
          <p className="text-sm text-ink-muted">{emptyText}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {categories.map((c) => (
              <CategoryRow key={c.id} category={c} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function CategoriesPage() {
  const categories = useCategoriesQuery();

  const custom = categories.data?.filter((c) => !c.isDefault) ?? [];
  const income = categories.data?.filter((c) => c.isDefault && c.kind === "income") ?? [];
  const expense = categories.data?.filter((c) => c.isDefault && c.kind !== "income") ?? [];

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium tracking-tight text-ink">Categories</h1>
          <p className="text-sm text-ink-secondary">
            Manage your category list -- rename a color or icon, or add a custom category of your
            own.
          </p>
        </div>
        <AddCategoryForm />
      </div>

      {categories.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
      {categories.isError && (
        <p className="text-sm text-critical-text">
          Could not load your categories. Try again shortly.
        </p>
      )}

      {categories.data && (
        <div className="flex flex-col gap-4">
          <CategoryGroup
            title="Custom categories"
            description="Categories you've added yourself."
            categories={custom}
            emptyText="No custom categories yet -- add one above."
          />
          <CategoryGroup
            title="Income categories"
            description="Default categories tagged as income."
            categories={income}
            emptyText="No income categories yet."
          />
          <CategoryGroup
            title="Expense categories"
            description="Default categories tagged as expenses (includes Transfer and Uncategorized, neither of which is cleanly either -- see BACKLOG.md CAT-16)."
            categories={expense}
            emptyText="No expense categories yet."
          />
        </div>
      )}
    </div>
  );
}
