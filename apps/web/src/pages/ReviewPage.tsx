// pages/ReviewPage.tsx — CAT-7: the Tier 4 review queue. Every
// transaction Tier 1-3 couldn't confidently resolve (`category.status
// === "needs_review"`), with a control to manually assign the right
// category -- which both clears the review flag and (via the PATCH
// route's CAT-6 write-back) teaches Tier 1 that merchant for next time.
//
// Deliberately reuses WEB-8's fetch hook and table (`status:
// "needs_review"` is the only difference from TransactionsPage.tsx) and
// only adds `renderRowAction`, exactly what BACKLOG.md's CAT-7 rescoping
// asked for ("reuse WEB-8's transaction-row component and list page").
import { useState } from "react";
import { useTransactionsQuery } from "../api/transactions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { TransactionsTable } from "../components/TransactionsTable";
import { ReviewCategoryControl } from "../components/ReviewCategoryControl";
import { Button } from "../components/ui/button";

const PAGE_SIZE = 50;

export default function ReviewPage() {
  const [page, setPage] = useState(1);
  const query = useTransactionsQuery({ page, pageSize: PAGE_SIZE, status: "needs_review" });

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-lg font-medium tracking-tight text-ink">Needs Review</h1>
        <p className="text-sm text-ink-secondary">
          Transactions Tier 1-3 categorization did not confidently resolve. Pick the right category
          for each -- it is remembered for that merchant next time.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Needs review</CardTitle>
          <CardDescription>{PAGE_SIZE} per page.</CardDescription>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
          {query.isError && (
            <p className="text-sm text-critical-text">
              Could not load the review queue. Try again shortly.
            </p>
          )}
          {query.data && query.data.items.length === 0 && (
            <p className="text-sm text-ink-muted">
              Nothing needs review right now -- every transaction has a confirmed category.
            </p>
          )}
          {query.data && query.data.items.length > 0 && (
            <>
              <TransactionsTable
                items={query.data.items}
                renderRowAction={(item) => <ReviewCategoryControl transaction={item} />}
              />
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-ink-muted">Page {page}</span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!query.data.hasMore}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
