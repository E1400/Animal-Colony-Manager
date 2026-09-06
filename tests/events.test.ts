import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/operations/events";

import { at, makeFixture, resetDb } from "./helpers";

beforeEach(resetDb);

describe("logEvent", () => {
  it("records an event inside its own changeset", async () => {
    const { cages, lab, user } = await makeFixture({ cages: 1 });

    const { changesetId } = await logEvent({
      type: "CAGE_CHANGE",
      labId: lab.id,
      actorId: user.id,
      cageId: cages[0].id,
      summary: "Cage change logged",
    });

    const event = await prisma.husbandryEvent.findFirstOrThrow({
      where: { cageId: cages[0].id },
    });
    expect(event.changesetId).toBe(changesetId);
    expect(event.recordedById).toBe(user.id);

    const changeset = await prisma.changeset.findUniqueOrThrow({
      where: { id: changesetId },
    });
    expect(changeset.actorId).toBe(user.id);
  });

  it("keeps the time of the action separate from the time it was stored", async () => {
    // This is the property the offline write queue depends on: an entry tapped
    // behind a rack with no signal syncs later, and must land in history at
    // the moment of the tap rather than the moment of the upload.
    const { cages, lab, user } = await makeFixture({ cages: 1 });
    const tappedAt = at("2026-09-01T08:30:00Z");

    await logEvent({
      type: "CAGE_CHANGE",
      labId: lab.id,
      actorId: user.id,
      cageId: cages[0].id,
      occurredAt: tappedAt,
      summary: "Queued offline, synced later",
    });

    const event = await prisma.husbandryEvent.findFirstOrThrow({
      where: { cageId: cages[0].id },
    });

    expect(event.occurredAt.toISOString()).toBe(tappedAt.toISOString());
    expect(event.recordedAt.getTime()).toBeGreaterThan(tappedAt.getTime());
  });

  it("stores a weight in the typed payload rather than on the animal", async () => {
    const { cages, animals, lab, user } = await makeFixture({ animals: 1, cages: 1 });

    await logEvent({
      type: "WEIGHT",
      labId: lab.id,
      actorId: user.id,
      animalId: animals[0].id,
      cageId: cages[0].id,
      payload: { grams: 24.5 },
      summary: "Weight recorded",
    });

    const event = await prisma.husbandryEvent.findFirstOrThrow({
      where: { animalId: animals[0].id },
    });
    expect(event.payload).toMatchObject({ grams: 24.5 });
  });

  it("refuses an event that is about nothing", async () => {
    const { lab, user } = await makeFixture({ cages: 0, animals: 0 });

    await expect(
      logEvent({
        type: "NOTE",
        labId: lab.id,
        actorId: user.id,
        summary: "Orphan event",
      }),
    ).rejects.toThrow(/cage, an animal, or both/);
  });
});
