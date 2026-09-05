import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import {
  animalsInCage,
  cageOfAnimal,
  censusCount,
  locateAnimal,
} from "@/lib/queries/placement";
import { moveAnimalsToCage, moveCageToPosition } from "@/lib/operations/placement";

import { at, makeFixture, resetDb } from "./helpers";

beforeEach(resetDb);

describe("current occupancy", () => {
  it("reports who is in a cage right now", async () => {
    const { cages, animals } = await makeFixture({ animals: 3 });

    await moveAnimalsToCage({
      animalIds: animals.map((a) => a.id),
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });

    const occupants = await animalsInCage(cages[0].id);
    expect(occupants.map((a) => a.id).sort()).toEqual(animals.map((a) => a.id).sort());
  });

  it("excludes soft-deleted animals without losing their history", async () => {
    const { cages, animals } = await makeFixture({ animals: 2 });
    await moveAnimalsToCage({
      animalIds: animals.map((a) => a.id),
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });

    await prisma.animal.update({
      where: { id: animals[0].id },
      data: { deletedAt: new Date(), deleteReason: "Entered twice by mistake" },
    });

    const occupants = await animalsInCage(cages[0].id);
    expect(occupants.map((a) => a.id)).toEqual([animals[1].id]);

    // The placement row itself survives — a soft delete is not an erasure.
    const rows = await prisma.animalCagePlacement.count({
      where: { animalId: animals[0].id },
    });
    expect(rows).toBe(1);
  });
});

describe("as-of queries", () => {
  it("answers 'who was in this cage on June 3rd' differently from 'now'", async () => {
    const { cages, animals } = await makeFixture({ animals: 1 });
    const [animal] = animals;

    await moveAnimalsToCage({
      animalIds: [animal.id],
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });
    await moveAnimalsToCage({
      animalIds: [animal.id],
      cageId: cages[1].id,
      occurredAt: at("2026-06-10T09:00:00Z"),
    });

    const onJune3 = await cageOfAnimal(animal.id, at("2026-06-03T12:00:00Z"));
    const now = await cageOfAnimal(animal.id);

    expect(onJune3?.id).toBe(cages[0].id);
    expect(now?.id).toBe(cages[1].id);
  });

  it("treats intervals as half-open, so a handover instant has one occupant", async () => {
    const { cages, animals } = await makeFixture({ animals: 1 });
    const [animal] = animals;
    const handover = at("2026-06-10T09:00:00Z");

    await moveAnimalsToCage({
      animalIds: [animal.id],
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });
    await moveAnimalsToCage({
      animalIds: [animal.id],
      cageId: cages[1].id,
      occurredAt: handover,
    });

    // At exactly the handover instant the animal is in the new cage, not both.
    expect((await animalsInCage(cages[0].id, handover)).length).toBe(0);
    expect((await animalsInCage(cages[1].id, handover)).length).toBe(1);
  });

  it("returns nothing before the animal was ever placed", async () => {
    const { cages, animals } = await makeFixture({ animals: 1 });
    await moveAnimalsToCage({
      animalIds: [animals[0].id],
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });

    expect(await cageOfAnimal(animals[0].id, at("2026-05-01T00:00:00Z"))).toBeNull();
  });
});

describe("late and out-of-order entry", () => {
  it("slots a backdated move into the middle of history", async () => {
    const { cages, animals } = await makeFixture({ animals: 1, cages: 3 });
    const [animal] = animals;

    await moveAnimalsToCage({
      animalIds: [animal.id],
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });

    // Three weeks later someone remembers the animal actually moved on Jun 5.
    await moveAnimalsToCage({
      animalIds: [animal.id],
      cageId: cages[1].id,
      occurredAt: at("2026-06-05T09:00:00Z"),
    });

    expect((await cageOfAnimal(animal.id, at("2026-06-03T00:00:00Z")))?.id).toBe(cages[0].id);
    expect((await cageOfAnimal(animal.id, at("2026-06-07T00:00:00Z")))?.id).toBe(cages[1].id);
  });

  it("keeps occurred_at and recorded_at independent", async () => {
    const { cages, animals } = await makeFixture({ animals: 1 });
    const occurredAt = at("2026-06-01T09:00:00Z");

    await moveAnimalsToCage({
      animalIds: [animals[0].id],
      cageId: cages[0].id,
      occurredAt,
    });

    const placement = await prisma.animalCagePlacement.findFirstOrThrow({
      where: { animalId: animals[0].id },
    });

    expect(placement.startedAt.toISOString()).toBe(occurredAt.toISOString());
    // Recorded now, for something that happened in June.
    expect(placement.recordedAt.getTime()).toBeGreaterThan(occurredAt.getTime());
  });
});

describe("database-level integrity", () => {
  it("refuses to put one animal in two cages at the same time", async () => {
    const { cages, animals } = await makeFixture({ animals: 1 });
    const [animal] = animals;

    await prisma.animalCagePlacement.create({
      data: {
        animalId: animal.id,
        cageId: cages[0].id,
        startedAt: at("2026-06-01T09:00:00Z"),
      },
    });

    // Bypasses the operations layer on purpose: this asserts the *database*
    // rejects it, not that our application code remembered to check.
    await expect(
      prisma.animalCagePlacement.create({
        data: {
          animalId: animal.id,
          cageId: cages[1].id,
          startedAt: at("2026-06-03T09:00:00Z"),
        },
      }),
    ).rejects.toThrow(/animal_cage_placements_no_overlap/);
  });

  it("refuses to put two cages in one rack slot at the same time", async () => {
    const { cages, positions } = await makeFixture();

    await prisma.cagePlacement.create({
      data: {
        cageId: cages[0].id,
        rackPositionId: positions[0].id,
        startedAt: at("2026-06-01T09:00:00Z"),
      },
    });

    await expect(
      prisma.cagePlacement.create({
        data: {
          cageId: cages[1].id,
          rackPositionId: positions[0].id,
          startedAt: at("2026-06-02T09:00:00Z"),
        },
      }),
    ).rejects.toThrow(/cage_placements_no_overlap_per_position/);
  });

  it("allows a rack slot to be reused once the previous cage has left", async () => {
    const { cages, positions } = await makeFixture();

    await prisma.cagePlacement.create({
      data: {
        cageId: cages[0].id,
        rackPositionId: positions[0].id,
        startedAt: at("2026-06-01T09:00:00Z"),
        endedAt: at("2026-06-10T09:00:00Z"),
      },
    });

    await expect(
      prisma.cagePlacement.create({
        data: {
          cageId: cages[1].id,
          rackPositionId: positions[0].id,
          startedAt: at("2026-06-10T09:00:00Z"),
        },
      }),
    ).resolves.toBeDefined();
  });

  it("rejects an interval that ends before it starts", async () => {
    const { cages, animals } = await makeFixture({ animals: 1 });

    await expect(
      prisma.animalCagePlacement.create({
        data: {
          animalId: animals[0].id,
          cageId: cages[0].id,
          startedAt: at("2026-06-10T09:00:00Z"),
          endedAt: at("2026-06-01T09:00:00Z"),
        },
      }),
    ).rejects.toThrow(/interval_ordered/);
  });
});

describe("lab-local identifiers", () => {
  it("lets a retired ear tag be reissued but blocks an active duplicate", async () => {
    const { animals } = await makeFixture({ animals: 2 });

    await prisma.animalIdentifier.create({
      data: {
        animalId: animals[0].id,
        namespace: "testlab",
        scheme: "EAR_TAG",
        value: "2051",
        assignedAt: at("2025-01-01T00:00:00Z"),
        retiredAt: at("2026-01-01T00:00:00Z"),
      },
    });

    // The same tag, reissued after the first animal's tag was retired.
    await expect(
      prisma.animalIdentifier.create({
        data: {
          animalId: animals[1].id,
          namespace: "testlab",
          scheme: "EAR_TAG",
          value: "2051",
          assignedAt: at("2026-02-01T00:00:00Z"),
        },
      }),
    ).resolves.toBeDefined();

    // But two *active* holders of the same tag is a data-entry error.
    await expect(
      prisma.animalIdentifier.create({
        data: {
          animalId: animals[0].id,
          namespace: "testlab",
          scheme: "EAR_TAG",
          value: "2051",
          assignedAt: at("2026-03-01T00:00:00Z"),
        },
      }),
    ).rejects.toThrow(/animal_identifiers_active_unique/);
  });
});

describe("moving a cage", () => {
  it("changes the animal's address without touching its cage placement", async () => {
    const { cages, positions, animals } = await makeFixture({ animals: 2 });

    await moveAnimalsToCage({
      animalIds: animals.map((a) => a.id),
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });
    await moveCageToPosition({
      cageId: cages[0].id,
      rackPositionId: positions[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });

    const before = await locateAnimal(animals[0].id);
    expect(before?.address).toBe(positions[0].label);

    await moveCageToPosition({
      cageId: cages[0].id,
      rackPositionId: positions[1].id,
      occurredAt: at("2026-07-01T09:00:00Z"),
    });

    const after = await locateAnimal(animals[0].id);
    expect(after?.address).toBe(positions[1].label);
    expect(after?.cage.id).toBe(cages[0].id);

    // Exactly one animal-placement row: the animals never moved, the cage did.
    const placementCount = await prisma.animalCagePlacement.count({
      where: { animalId: animals[0].id },
    });
    expect(placementCount).toBe(1);

    // And the old address is still correct for the earlier date.
    const inJune = await locateAnimal(animals[0].id, at("2026-06-15T00:00:00Z"));
    expect(inJune?.address).toBe(positions[0].label);
  });
});

describe("changesets", () => {
  it("groups a bulk move under one changeset", async () => {
    const { cages, animals, lab, user } = await makeFixture({ animals: 4 });

    const { changesetId } = await moveAnimalsToCage({
      animalIds: animals.map((a) => a.id),
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
      actorId: user.id,
      labId: lab.id,
      summary: "Weaned litter into 4 cages",
    });

    const tagged = await prisma.animalCagePlacement.count({ where: { changesetId } });
    expect(tagged).toBe(4);

    const changeset = await prisma.changeset.findUniqueOrThrow({ where: { id: changesetId } });
    expect(changeset.actorId).toBe(user.id);
    expect(changeset.summary).toBe("Weaned litter into 4 cages");
  });

  it("rolls back the whole move if one animal's placement is invalid", async () => {
    const { cages, animals } = await makeFixture({ animals: 2, cages: 2 });

    // Animal 1 is already in cage 1 from a later date, so a move dated earlier
    // that leaves an open interval will collide with it.
    await prisma.animalCagePlacement.create({
      data: {
        animalId: animals[1].id,
        cageId: cages[1].id,
        startedAt: at("2026-07-01T09:00:00Z"),
      },
    });

    await expect(
      moveAnimalsToCage({
        animalIds: animals.map((a) => a.id),
        cageId: cages[0].id,
        occurredAt: at("2026-06-01T09:00:00Z"),
      }),
    ).rejects.toThrow();

    // The first animal's placement must not have survived the failed batch.
    const stray = await prisma.animalCagePlacement.count({
      where: { animalId: animals[0].id },
    });
    expect(stray).toBe(0);
  });
});

describe("census", () => {
  it("counts only animals placed at the given moment", async () => {
    const { cages, animals, lab } = await makeFixture({ animals: 3 });

    await moveAnimalsToCage({
      animalIds: animals.map((a) => a.id),
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });

    expect(await censusCount(lab.id, at("2026-05-01T00:00:00Z"))).toBe(0);
    expect(await censusCount(lab.id, at("2026-06-02T00:00:00Z"))).toBe(3);
  });
});
