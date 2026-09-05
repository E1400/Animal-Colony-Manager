import path from "node:path";
import { defineConfig } from "vitest/config";

import { testDatabaseUrl } from "./tests/database-url";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    // Tests run against their own database so `npm test` never wipes the
    // seeded colony a reviewer is looking at.
    env: { DATABASE_URL: testDatabaseUrl() },
    // The suite asserts on real constraint behaviour against one shared
    // Postgres, so files must not truncate each other's fixtures concurrently.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
