import { defineConfig, mergeConfig } from "vitest/config";
import base from "@financial-os/config/vitest.config.base.ts";

// Repository-layer integration tests here run against mongodb-memory-server
// (DATA-10) — still a Node environment, no jsdom needed.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.{test,spec}.ts"],
    },
  }),
);
