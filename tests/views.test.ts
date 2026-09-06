import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { getAnimal, getCageByCode, listCages, searchColony } from "@/lib/queries/views";
import { moveAnimalsToCage, moveCageToPosition } from "@/lib/operations/placement";

import { at, makeFixture, resetDb } from "./helpers";

beforeEach(resetDb);

describe("listCages", () => {
  it("derives address and occupant count without a cached column", async () => {
    const { cages, positions, animals } = await makeFixture({ animals: 3, cages: 2 });

    await moveCageToPosition({
      cageId: cages[0].id,
      rackPositionId: positions[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });
    await moveAnimalsToCage({
      animalIds: animals.map((a) => a.id),
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });

    const rows = await listCages();
    const first = rows.find((r) => r.id === cages[0].id)!;
    const second = rows.find((r) => r.id === cages[1].id)!;

    expect(first.address).toBe(positions[0].label);
    expect(first.occupantCount).toBe(3);
    // A cage that was never placed is legitimately addressless, not an error.
    expect(second.address).toBeNull();
    expect(second.occupantCount).toBe(0);
  });

  it("reports the historical address when asked as of an earlier date", async () => {
    const { cages, positions } = await makeFixture({ cages: 1 });

    await moveCageToPosition({
      cageId: cages[0].id,
      rackPositionId: positions[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });
    await moveCageToPosition({
      cageId: cages[0].id,
      rackPositionId: positions[1].id,
      occurredAt: at("2026-07-01T09:00:00Z"),
    });

    const inJune = await listCages({ asOf: at("2026-06-15T00:00:00Z") });
    const now = await listCages();

    expect(inJune[0].address).toBe(positions[0].label);
    expect(now[0].address).toBe(positions[1].label);
  });

  it("does not count soft-deleted animals as occupants", async () => {
    const { cages, animals } = await makeFixture({ animals: 2, cages: 1 });
    await moveAnimalsToCage({
      animalIds: animals.map((a) => a.id),
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });
    await prisma.animal.update({
      where: { id: animals[0].id },
      data: { deletedAt: new Date() },
    });

    const rows = await listCages();
    expect(rows[0].occupantCount).toBe(1);
  });
});

describe("getCageByCode", () => {
  it("returns the occupants as of the requested moment", async () => {
    const { cages, animals } = await makeFixture({ animals: 1, cages: 2 });

    await moveAnimalsToCage({
      animalIds: [animals[0].id],
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });
    await moveAnimalsToCage({
      animalIds: [animals[0].id],
      cageId: cages[1].id,
      occurredAt: at("2026-06-10T09:00:00Z"),
    });

    const inJune = await getCageByCode(cages[0].code, at("2026-06-03T00:00:00Z"));
    const now = await getCageByCode(cages[0].code);

    expect(inJune!.occupants).toHaveLength(1);
    expect(now!.occupants).toHaveLength(0);
  });

  it("returns null for an unknown code rather than throwing", async () => {
    expect(await getCageByCode("CG-does-not-exist")).toBeNull();
  });
});

describe("searchColony", () => {
  it("finds a cage by code, by rack slot, and an animal by ear tag", async () => {
    const { cages, positions, animals } = await makeFixture({ animals: 1, cages: 1 });

    await moveCageToPosition({
      cageId: cages[0].id,
      rackPositionId: positions[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });
    await prisma.animalIdentifier.create({
      data: {
        animalId: animals[0].id,
        namespace: "testlab",
        scheme: "EAR_TAG",
        value: "7788",
        isPrimary: true,
        assignedAt: at("2026-06-01T09:00:00Z"),
      },
    });

    const byCode = await searchColony(cages[0].code);
    expect(byCode.some((h) => h.kind === "cage" && h.code === cages[0].code)).toBe(true);

    const bySlot = await searchColony(positions[0].label);
    expect(bySlot.some((h) => h.kind === "cage" && h.code === cages[0].code)).toBe(true);

    const byTag = await searchColony("7788");
    expect(byTag.some((h) => h.kind === "animal" && h.id === animals[0].id)).toBe(true);
  });

  it("ignores retired ear tags, so a reissued number finds its current holder", async () => {
    const { animals } = await makeFixture({ animals: 2 });

    await prisma.animalIdentifier.create({
      data: {
        animalId: animals[0].id,
        namespace: "testlab",
        scheme: "EAR_TAG",
        value: "4242",
        assignedAt: at("2025-01-01T00:00:00Z"),
        retiredAt: at("2026-01-01T00:00:00Z"),
      },
    });
    await prisma.animalIdentifier.create({
      data: {
        animalId: animals[1].id,
        namespace: "testlab",
        scheme: "EAR_TAG",
        value: "4242",
        isPrimary: true,
        assignedAt: at("2026-02-01T00:00:00Z"),
      },
    });

    const hits = await searchColony("4242");
    const animalHits = hits.filter((h) => h.kind === "animal");
    expect(animalHits).toHaveLength(1);
    expect(animalHits[0]).toMatchObject({ id: animals[1].id });
  });
});

describe("getAnimal", () => {
  it("treats a malformed id as not-found instead of a database error", async () => {
    // Postgres rejects a non-uuid at the type level; this must surface as a
    // 404, not a 500.
    await expect(getAnimal("nonexistent")).resolves.toBeNull();
  });

  it("derives status from events rather than a column", async () => {
    const { cages, animals, lab } = await makeFixture({ animals: 1, cages: 1 });
    await moveAnimalsToCage({
      animalIds: [animals[0].id],
      cageId: cages[0].id,
      occurredAt: at("2026-06-01T09:00:00Z"),
    });

    expect((await getAnimal(animals[0].id))!.status).toBe("ALIVE");

    await prisma.husbandryEvent.create({
      data: {
        labId: lab.id,
        type: "DEATH",
        animalId: animals[0].id,
        occurredAt: at("2026-07-01T09:00:00Z"),
      },
    });

    expect((await getAnimal(animals[0].id))!.status).toBe("DEATH");
  });
});
