import { defineConfig, mergeConfig } from "vitest/config";
import base from "@financial-os/config/vitest.config.base.ts";

// Repository-layer integration tests here run against mongodb-memory-server
// (DATA-10) — still a Node environment, no jsdom needed. Longer timeouts
// than the shared base: spinning up a real mongod (and downloading its
// binary on first run) is slower than a typical unit test.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.{test,spec}.ts"],
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  }),
);
