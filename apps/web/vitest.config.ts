import { defineConfig, mergeConfig } from "vitest/config";
import base from "@financial-os/config/vitest.config.base.ts";

// jsdom + include .tsx: this workspace's tests will exercise React
// components (Testing Library) once ANLY-9 adds the real dashboard UI.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
  }),
);
