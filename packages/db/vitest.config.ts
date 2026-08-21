import { defineConfig, mergeConfig } from "vitest/config";
import base from "@financial-os/config/vitest.config.base.ts";

// Repository-layer integration tests here run against mongodb-memory-server
// (DATA-10) — still a Node environment, no jsdom needed. Longer timeouts
// than the shared base: spinning up a real mongod (and downloading its
// binary on first run) is slower than a typical unit test.
//
// `fileParallelism: false` is the important line. Vitest runs test files in
// parallel by default, and every file here calls MongoMemoryServer.create().
// On a cold binary cache they all race to download the same mongod, fight
// over ~/.cache/mongodb-binaries/<version>.lock, and the losers die with
// `UnableToUnlockLockfileError: ... not locked by this process`. That is a
// first-run-only race, which makes it exactly the kind of failure that
// passes locally forever and then breaks CI, where the cache is always
// cold. Running these files one at a time removes the contention entirely;
// they're a handful of fast integration tests, so the wall-clock cost is
// small and the unit-test packages still run fully parallel.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.{test,spec}.ts"],
      testTimeout: 30_000,
      hookTimeout: 60_000,
      fileParallelism: false,
    },
  }),
);
