// Placeholder root component -- WEB-1 only bootstraps the toolchain.
// Real routes/pages land with WEB-2 (routing) through WEB-4 (auth shell)
// and beyond; this exists so `pnpm dev`/`pnpm build` have something to
// render and prove the Tailwind + design-token wiring actually works.
export default function App() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background font-sans text-ink">
      <div className="rounded-lg border border-border bg-surface px-8 py-6 text-center shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">apps/web</p>
        <h1 className="mt-2 text-2xl font-medium tracking-tight text-ink">Financial OS</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Vite + React + Tailwind bootstrap (WEB-1). Routing lands next.
        </p>
        <p className="mt-4 font-mono text-lg tabular-nums text-accent">$130,664.49</p>
      </div>
    </div>
  );
}
