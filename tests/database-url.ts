import "dotenv/config";

/**
 * Tests get their own database on the same server as development, so running
 * `npm test` never destroys the seeded colony. Override with TEST_DATABASE_URL
 * if you want to point somewhere else entirely.
 */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "DATABASE_URL is not set — start a local database with `npm run db:up` " +
        "and copy the URL it prints into .env",
    );
  }

  const url = new URL(base);
  url.pathname = "/colony_test";
  return url.toString();
}

/** The same server, but the default database — used to CREATE the test one. */
export function adminDatabaseUrl(): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = "/postgres";
  return url.toString();
}
