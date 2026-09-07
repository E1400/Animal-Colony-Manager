import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { moveAnimalsToCage } from "@/lib/operations/placement";
import { logEvent } from "@/lib/operations/events";
import { cageOfAnimal } from "@/lib/queries/placement";

import { exportSnapshot, restoreSnapshot } from "../scripts/backup";
import { at, makeFixture, resetDb } from "./helpers";

let dir: string;

beforeEach(async () => {
  await resetDb();
  dir = await mkdtemp(join(tmpdir(), "colony-backup-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("backup and restore", () => {
  it("round-trips a colony and verifies it came back whole", async () => {
    const { lab, user, cages, animals } = await makeFixture({ animals: 3, cages: 2 });

    await moveAnimalsToCage({
      animalIds: animals.map((a) => a.id),
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
      actorId: user.id,
      labId: lab.id,
    });
    await logEvent({
      type: "CAGE_CHANGE",
      labId: lab.id,
      actorId: user.id,
      cageId: cages[0].id,
      summary: "Cage change before backup",
    });

    const path = join(dir, "snapshot.json");
    const snapshot = await exportSnapshot(path);

    expect(snapshot.counts.animal).toBe(3);
    expect(snapshot.counts.animalCagePlacement).toBe(3);
    expect(snapshot.counts.husbandryEvent).toBe(1);

    // Simulate the disaster.
    await resetDb();
    expect(await prisma.animal.count()).toBe(0);

    await restoreSnapshot(path);

    expect(await prisma.animal.count()).toBe(3);
    expect(await prisma.husbandryEvent.count()).toBe(1);

    // Row counts are necessary but not sufficient — the placement history has
    // to still answer questions correctly, which is the point of restoring it.
    const cage = await cageOfAnimal(animals[0].id, at("2026-06-02T00:00:00Z"));
    expect(cage?.id).toBe(cages[0].id);
  });

  it("refuses to restore over a database that still holds data", async () => {
    const { lab, user, cages, animals } = await makeFixture({ animals: 1, cages: 1 });
    await moveAnimalsToCage({
      animalIds: [animals[0].id],
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
      actorId: user.id,
      labId: lab.id,
    });

    const path = join(dir, "snapshot.json");
    await exportSnapshot(path);

    // Restoring on top would interleave two histories rather than replace one.
    await expect(restoreSnapshot(path)).rejects.toThrow(/already holds/i);
  });

  it("replaces the target completely when forced", async () => {
    const first = await makeFixture({ animals: 2, cages: 1 });
    const path = join(dir, "snapshot.json");
    await exportSnapshot(path);

    // A different colony now occupies the target.
    await resetDb();
    await makeFixture({ animals: 5, cages: 3 });
    expect(await prisma.animal.count()).toBe(5);

    await restoreSnapshot(path, { force: true });

    // Not merged: the snapshot's colony is the only one left.
    expect(await prisma.animal.count()).toBe(2);
    const labs = await prisma.lab.findMany({ select: { id: true } });
    expect(labs.map((l) => l.id)).toEqual([first.lab.id]);
  });

  it("rejects a file that is not a snapshot", async () => {
    const { writeFile } = await import("node:fs/promises");
    const path = join(dir, "not-a-snapshot.json");
    await writeFile(path, JSON.stringify({ hello: "world" }));

    await expect(restoreSnapshot(path)).rejects.toThrow(/not a colony snapshot/i);
  });
});
