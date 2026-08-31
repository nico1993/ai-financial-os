import { defineConfig, mergeConfig } from "vitest/config";
import base from "@financial-os/config/vitest.config.base.ts";

// jsdom + include .tsx: this workspace's tests exercise React components
// via Testing Library (WEB-6). setupFiles registers jest-dom's matchers
// once for every test file -- see src/test/setup.ts.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      setupFiles: ["./src/test/setup.ts"],
    },
  }),
);
