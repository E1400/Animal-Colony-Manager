import { execFileSync } from "node:child_process";
import { Client } from "pg";

import { adminDatabaseUrl, testDatabaseUrl } from "./database-url";

/**
 * Creates the test database if it does not exist and brings it up to the
 * current migrations. Runs the real migration files rather than pushing the
 * schema, so the tests exercise the same DDL that production gets — including
 * the exclusion constraints, which are the thing most worth testing.
 */
export default async function setup() {
  const testUrl = testDatabaseUrl();
  const dbName = new URL(testUrl).pathname.replace(/^\//, "");

  const admin = new Client({ connectionString: adminDatabaseUrl() });
  await admin.connect();
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (existing.rowCount === 0) {
      // Identifier cannot be parameterised; dbName comes from our own config.
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end();
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "inherit",
  });
}
