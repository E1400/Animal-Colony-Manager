import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";

/** Wipes every table between tests. Cheap at fixture scale. */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (!tables.length) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export const DAY = 24 * 60 * 60 * 1000;
export const at = (iso: string) => new Date(iso);

/**
 * A minimal but complete facility: one lab, one room, one rack with a handful
 * of slots, two cages, and however many animals the test asks for.
 */
export async function makeFixture(opts: { animals?: number; cages?: number } = {}) {
  const animalCount = opts.animals ?? 2;
  const cageCount = opts.cages ?? 2;

  const lab = await prisma.lab.create({
    data: { slug: `lab-${randomUUID().slice(0, 8)}`, name: "Test Lab" },
  });

  const user = await prisma.user.create({
    data: { name: "Test Tech", email: `tech-${randomUUID().slice(0, 8)}@example.edu` },
  });

  const room = await prisma.room.create({
    data: { code: `R-${randomUUID().slice(0, 6)}`, name: "Test Room" },
  });

  const rack = await prisma.rack.create({
    data: { roomId: room.id, labId: lab.id, code: "B", rowCount: 4, colCount: 4 },
  });

  const positions = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      prisma.rackPosition.create({
        data: {
          rackId: rack.id,
          side: "A",
          row: 4,
          col: i + 1,
          label: `B-04-${String(i + 1).padStart(2, "0")}`,
        },
      }),
    ),
  );

  const cages = await Promise.all(
    Array.from({ length: cageCount }, (_, i) =>
      prisma.cage.create({
        data: { labId: lab.id, code: `CG-${randomUUID().slice(0, 8)}-${i}` },
      }),
    ),
  );

  const animals = await Promise.all(
    Array.from({ length: animalCount }, () =>
      prisma.animal.create({ data: { labId: lab.id, sex: "FEMALE" } }),
    ),
  );

  return { lab, user, room, rack, positions, cages, animals };
}
