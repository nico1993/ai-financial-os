interface PageStubProps {
  title: string;
  description: string;
}

/** WEB-2 lays out the route table; the pages themselves belong to
 * ANLY-9..11 (net worth, cash flow, spending, subscriptions) and CAT-7
 * (the review queue). This stub is what each route renders until its
 * owning story lands, so the shell/nav (WEB-4) has something real to
 * navigate between in the meantime. */
export function PageStub({ title, description }: PageStubProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-12 py-24 text-center">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Coming soon</p>
      <h2 className="text-xl font-medium tracking-tight text-ink">{title}</h2>
      <p className="max-w-sm text-sm text-ink-secondary">{description}</p>
    </div>
  );
}
