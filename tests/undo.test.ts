import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { moveAnimalsToCage } from "@/lib/operations/placement";
import { logEvent } from "@/lib/operations/events";
import { revertChangeset } from "@/lib/operations/undo";
import { cageOfAnimal } from "@/lib/queries/placement";

import { at, makeFixture, resetDb } from "./helpers";

beforeEach(resetDb);

describe("revertChangeset", () => {
  it("puts animals back where they were, as one action", async () => {
    const { cages, animals, user, lab } = await makeFixture({ animals: 4, cages: 2 });

    await moveAnimalsToCage({
      animalIds: animals.map((a) => a.id),
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
      actorId: user.id,
      labId: lab.id,
    });

    // The mistake: all four moved to the wrong cage.
    const { changesetId } = await moveAnimalsToCage({
      animalIds: animals.map((a) => a.id),
      cageId: cages[1].id,
      occurredAt: at("2026-06-10T09:00:00Z"),
      actorId: user.id,
      labId: lab.id,
      summary: "Moved 4 mice to the wrong cage",
    });

    for (const animal of animals) {
      expect((await cageOfAnimal(animal.id))?.id).toBe(cages[1].id);
    }

    const summary = await revertChangeset({ changesetId, actorId: user.id });

    // All four are back in the original cage, and the interval is open again.
    for (const animal of animals) {
      expect((await cageOfAnimal(animal.id))?.id).toBe(cages[0].id);
    }
    expect(summary.placementsRemoved).toBe(4);
    expect(summary.placementsReopened).toBe(4);

    // Exactly one open placement each — reopening must not duplicate.
    for (const animal of animals) {
      const open = await prisma.animalCagePlacement.count({
        where: { animalId: animal.id, endedAt: null },
      });
      expect(open).toBe(1);
    }
  });

  it("leaves the original changeset in the trail, marked as undone", async () => {
    const { cages, animals, user, lab } = await makeFixture({ animals: 1, cages: 1 });

    const { changesetId } = await moveAnimalsToCage({
      animalIds: [animals[0].id],
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
      actorId: user.id,
      labId: lab.id,
    });

    const { revertChangesetId } = await revertChangeset({
      changesetId,
      actorId: user.id,
      reason: "Wrong cage",
    });

    const original = await prisma.changeset.findUniqueOrThrow({
      where: { id: changesetId },
    });
    expect(original.revertedAt).not.toBeNull();
    expect(original.revertedByChangesetId).toBe(revertChangesetId);

    const revert = await prisma.changeset.findUniqueOrThrow({
      where: { id: revertChangesetId },
    });
    expect(revert.kind).toBe("REVERT");
    expect(revert.reason).toBe("Wrong cage");
  });

  it("refuses to undo the same change twice", async () => {
    const { cages, animals, user, lab } = await makeFixture({ animals: 1, cages: 1 });

    const { changesetId } = await moveAnimalsToCage({
      animalIds: [animals[0].id],
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
      actorId: user.id,
      labId: lab.id,
    });

    await revertChangeset({ changesetId, actorId: user.id });
    await expect(revertChangeset({ changesetId, actorId: user.id })).rejects.toThrow(
      /already been undone/,
    );
  });

  it("removes an event logged in error", async () => {
    const { cages, user, lab } = await makeFixture({ cages: 1 });

    const { changesetId } = await logEvent({
      type: "CAGE_CHANGE",
      labId: lab.id,
      actorId: user.id,
      cageId: cages[0].id,
      summary: "Cage change logged by mistake",
    });

    expect(await prisma.husbandryEvent.count({ where: { cageId: cages[0].id } })).toBe(1);

    const summary = await revertChangeset({ changesetId, actorId: user.id });
    expect(summary.eventsRemoved).toBe(1);
    expect(await prisma.husbandryEvent.count({ where: { cageId: cages[0].id } })).toBe(0);
  });

  it("can be undone in turn, putting the original change back", async () => {
    const { cages, animals, user, lab } = await makeFixture({ animals: 2, cages: 2 });

    await moveAnimalsToCage({
      animalIds: animals.map((a) => a.id),
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
      actorId: user.id,
      labId: lab.id,
    });
    const { changesetId } = await moveAnimalsToCage({
      animalIds: animals.map((a) => a.id),
      cageId: cages[1].id,
      occurredAt: at("2026-06-10T09:00:00Z"),
      actorId: user.id,
      labId: lab.id,
    });

    const undone = await revertChangeset({ changesetId, actorId: user.id });
    for (const animal of animals) {
      expect((await cageOfAnimal(animal.id))?.id).toBe(cages[0].id);
    }

    // Undoing the undo restores exactly what it removed. This only works
    // because the revert recorded the rows it deleted before deleting them.
    const redone = await revertChangeset({
      changesetId: undone.revertChangesetId,
      actorId: user.id,
    });
    expect(redone.redo).toBe(true);

    for (const animal of animals) {
      expect((await cageOfAnimal(animal.id))?.id).toBe(cages[1].id);
    }

    // The original stands again rather than staying marked as undone.
    const original = await prisma.changeset.findUniqueOrThrow({
      where: { id: changesetId },
    });
    expect(original.revertedAt).toBeNull();
    expect(original.revertedByChangesetId).toBeNull();

    // And no duplicate intervals were left behind.
    for (const animal of animals) {
      const open = await prisma.animalCagePlacement.count({
        where: { animalId: animal.id, endedAt: null },
      });
      expect(open).toBe(1);
    }
  });

  it("unwinds in an order the overlap constraint accepts", async () => {
    // Reopening the closed interval before deleting the one stacked on top of
    // it would collide with the exclusion constraint and roll the whole undo
    // back. This asserts the ordering, not just the end state.
    const { cages, animals, user, lab } = await makeFixture({ animals: 1, cages: 2 });
    const [animal] = animals;

    await moveAnimalsToCage({
      animalIds: [animal.id],
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
      actorId: user.id,
      labId: lab.id,
    });
    const { changesetId } = await moveAnimalsToCage({
      animalIds: [animal.id],
      cageId: cages[1].id,
      occurredAt: at("2026-06-10T09:00:00Z"),
      actorId: user.id,
      labId: lab.id,
    });

    await expect(
      revertChangeset({ changesetId, actorId: user.id }),
    ).resolves.toMatchObject({ placementsRemoved: 1, placementsReopened: 1 });

    const rows = await prisma.animalCagePlacement.findMany({
      where: { animalId: animal.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].cageId).toBe(cages[0].id);
    expect(rows[0].endedAt).toBeNull();
  });
});
