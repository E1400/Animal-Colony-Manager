import "dotenv/config";

/**
 * Where the test suite is allowed to write.
 *
 * This must be a *separate database server* from development, not just a
 * different database or schema name on the same one. The local server started
 * by `npm run db:up` ignores both: every connection lands in the same store
 * regardless of the database in the URL or the `?schema=` parameter, so
 * `/colony_test` and `?schema=colony_test` both look like isolation and
 * silently share the development colony. Isolation on that server is per
 * *instance*, which is why the test database is a second `prisma dev` server
 * on its own port.
 *
 * On a real Postgres (CI uses a postgres:17 service container) a plain
 * DATABASE_URL is already a dedicated database and needs nothing else.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;

  // CI points DATABASE_URL at a throwaway Postgres, so using it is correct
  // there. Locally it is the development colony, and using it would wipe it.
  if (process.env.CI) {
    const base = process.env.DATABASE_URL;
    if (base) return base;
  }

  throw new Error(
    "TEST_DATABASE_URL is not set.\n\n" +
      "Tests need their own database server — the local dev server shares one\n" +
      "store across every database and schema name, so pointing tests at it\n" +
      "would destroy your seeded colony.\n\n" +
      "  npm run db:up:test        # starts a second server, prints a URL\n" +
      "  # put that URL in .env as TEST_DATABASE_URL\n",
  );
}
