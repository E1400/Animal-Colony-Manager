import { execFileSync } from "node:child_process";
import { Client } from "pg";

import { testDatabaseUrl } from "./database-url";

/**
 * Brings the test database up to the current migrations, after checking it is
 * not the development one.
 *
 * The guard is not paranoia: the local dev server routes every database and
 * schema name to a single store, so a misconfigured TEST_DATABASE_URL points
 * at the seeded colony while looking completely correct. The suite truncates
 * every table between tests, so getting this wrong is destructive and silent.
 */
export default async function setup() {
  const url = testDatabaseUrl();

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const seeded = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'labs'`,
    );
    if (seeded.rowCount) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM public.labs WHERE slug = 'kaplan'`,
      );
      if (rows[0].n > 0) {
        throw new Error(
          "Refusing to run: TEST_DATABASE_URL points at a database containing " +
            "the seeded development colony. The suite truncates every table.\n" +
            "Start a separate server with `npm run db:up:test` and set " +
            "TEST_DATABASE_URL to the URL it prints.",
        );
      }
    }
  } finally {
    await client.end();
  }

  // Real migration files rather than a schema push, so tests exercise the same
  // DDL production gets — including the exclusion constraints.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
