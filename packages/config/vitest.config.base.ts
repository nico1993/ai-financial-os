// Shared Vitest base, extended by every workspace's own vitest.config.ts via
// mergeConfig. See ARCHITECTURE.md 7.5: Vitest everywhere, unit tests for
// pure logic (+ React component tests where relevant), integration tests
// against mongodb-memory-server for the repository/aggregation layer.
//
// passWithNoTests: true because most workspaces have no test files yet —
// the pure-logic stories that add real tests (DATA-10, ING-12, CAT-8,
// XFER-6, ANLY-12) land later in the backlog. Flip this off once every
// workspace has real coverage, so a workspace silently losing its tests
// doesn't go unnoticed.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    watch: false,
    passWithNoTests: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/dist/**", "**/*.config.*", "**/node_modules/**"],
    },
  },
});
