// pages/TransactionsPage.tsx — WEB-8: the general ledger. Every linked
// account's transactions, most recent first, offset-paginated
// (TransactionRepository.findPageForUser()) rather than loading a
// potentially-thousands-of-rows history in one response.
import { useState } from "react";
import { useTransactionsQuery } from "../api/transactions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { TransactionsTable } from "../components/TransactionsTable";
import { Button } from "../components/ui/button";

const PAGE_SIZE = 50;

export default function TransactionsPage() {
  const [page, setPage] = useState(1);
  const query = useTransactionsQuery({ page, pageSize: PAGE_SIZE });

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-lg font-medium tracking-tight text-ink">Transactions</h1>
        <p className="text-sm text-ink-secondary">
          Every transaction across your linked accounts, most recent first.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All transactions</CardTitle>
          <CardDescription>{PAGE_SIZE} per page.</CardDescription>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
          {query.isError && (
            <p className="text-sm text-critical-text">
              Could not load transactions. Try again shortly.
            </p>
          )}
          {query.data && query.data.items.length === 0 && (
            <p className="text-sm text-ink-muted">
              {page === 1
                ? "No transactions yet -- link an account to start syncing."
                : "No more transactions."}
            </p>
          )}
          {query.data && query.data.items.length > 0 && (
            <>
              <TransactionsTable items={query.data.items} />
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
