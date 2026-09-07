/**
 * Full logical snapshot of a colony, and the restore that puts it back.
 *
 * Neon provides point-in-time restore, and for real disaster recovery that is
 * the right tool. This exists for the cases it does not cover: moving a colony
 * to another provider, handing a lab its own data, and — the reason it is
 * written at all — being something anyone can actually run and verify. A
 * backup nobody has restored is a rumour.
 *
 *   npm run db:export -- backups/colony.json
 *   npm run db:restore -- backups/colony.json     (refuses a non-empty database)
 *
 * Tables are exported in dependency order and restored in the same order, so
 * foreign keys hold at every step without disabling constraints. Restore runs
 * in one transaction: a half-restored colony is worse than none.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Order matters: a table may only appear after everything it references.
 * Placements come last because they point at cages, animals and changesets.
 */
const TABLES = [
  "lab",
  "user",
  "membership",
  "room",
  "rack",
  "rackPosition",
  "strain",
  "changeset",
  "cage",
  "animal",
  "animalIdentifier",
  "genotype",
  "breedingPair",
  "breedingPairMember",
  "litter",
  "cagePlacement",
  "animalCagePlacement",
  "husbandryEvent",
  "coverageAssignment",
  "importBatch",
  "importRow",
  "account",
  "session",
] as const;

type TableName = (typeof TABLES)[number];

type Snapshot = {
  format: "animal-colony-manager/snapshot";
  version: 1;
  takenAt: string;
  counts: Record<string, number>;
  tables: Record<string, unknown[]>;
};

function client() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// The delegate lookup is dynamic by design — adding a model to TABLES should be
// the only change needed.
type Delegate = {
  findMany: (args?: object) => Promise<unknown[]>;
  createMany: (args: { data: unknown[] }) => Promise<{ count: number }>;
  count: () => Promise<number>;
};
const delegate = (db: unknown, table: TableName): Delegate =>
  (db as Record<string, Delegate>)[table];

export async function exportSnapshot(path: string) {
  const prisma = client();
  try {
    const tables: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};

    for (const table of TABLES) {
      const rows = await delegate(prisma, table).findMany({});
      tables[table] = rows;
      counts[table] = rows.length;
    }

    const snapshot: Snapshot = {
      format: "animal-colony-manager/snapshot",
      version: 1,
      takenAt: new Date().toISOString(),
      counts,
      tables,
    };

    await mkdir(dirname(path), { recursive: true });
    // Dates serialise to ISO strings; Prisma accepts those back on restore.
    await writeFile(path, JSON.stringify(snapshot, null, 2));

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`Wrote ${path}`);
    for (const [table, n] of Object.entries(counts)) {
      if (n > 0) console.log(`  ${table.padEnd(22)} ${n}`);
    }
    console.log(`  ${"total".padEnd(22)} ${total}`);
    return snapshot;
  } finally {
    await prisma.$disconnect();
  }
}

export async function restoreSnapshot(path: string, opts: { force?: boolean } = {}) {
  const raw = await readFile(path, "utf8");
  const snapshot = JSON.parse(raw) as Snapshot;

  if (snapshot.format !== "animal-colony-manager/snapshot") {
    throw new Error("That file is not a colony snapshot.");
  }

  const prisma = client();
  try {
    // Restoring over a live colony would interleave two histories. Refuse
    // unless told explicitly, and even then wipe first rather than merge.
    //
    // Emptiness is checked across every table, not just labs. Gating on one
    // table let leftover rows elsewhere survive the wipe and inflate the
    // restored counts — the verification below is what caught it.
    let existingRows = 0;
    for (const table of TABLES) existingRows += await delegate(prisma, table).count();

    if (existingRows > 0 && !opts.force) {
      throw new Error(
        `Target database already holds ${existingRows} row(s). ` +
          "Restore into an empty database, or pass --force to replace it.",
      );
    }

    await prisma.$transaction(
      async (tx) => {
        if (existingRows > 0) {
          const names = await tx.$queryRaw<{ tablename: string }[]>`
            SELECT tablename FROM pg_tables
            WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'
          `;
          const list = names.map((t) => `"${t.tablename}"`).join(", ");
          await tx.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
        }

        for (const table of TABLES) {
          const rows = snapshot.tables[table] ?? [];
          if (rows.length === 0) continue;
          // skipDuplicates is deliberately off: a duplicate here means the
          // snapshot is inconsistent, and silence would hide that.
          await delegate(tx, table).createMany({ data: rows });
        }
      },
      { timeout: 300_000, maxWait: 20_000 },
    );

    const restored: Record<string, number> = {};
    for (const table of TABLES) restored[table] = await delegate(prisma, table).count();

    const mismatches = Object.entries(snapshot.counts).filter(
      ([table, n]) => restored[table] !== n,
    );

    console.log(`Restored ${path} (taken ${snapshot.takenAt})`);
    for (const [table, n] of Object.entries(restored)) {
      if (n > 0) console.log(`  ${table.padEnd(22)} ${n}`);
    }

    if (mismatches.length > 0) {
      console.error("\nRow counts do not match the snapshot:");
      for (const [table, expected] of mismatches) {
        console.error(`  ${table}: expected ${expected}, got ${restored[table]}`);
      }
      throw new Error("Restore verification failed.");
    }
    console.log("\nEvery table matches the snapshot.");
    return restored;
  } finally {
    await prisma.$disconnect();
  }
}

const [, , command, file, ...flags] = process.argv;
if (command === "export" || command === "restore") {
  const path = file ?? "backups/colony.json";
  const run =
    command === "export"
      ? exportSnapshot(path)
      : restoreSnapshot(path, { force: flags.includes("--force") });
  run.catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
