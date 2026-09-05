import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The one time predicate the whole app uses to read placement history.
 *
 * Placements are half-open intervals `[startedAt, endedAt)`, so a row is in
 * effect at `t` when it started at or before `t` and has either not ended or
 * ended strictly after `t`. A cage that leaves a slot at 09:00 and another
 * that arrives at 09:00 do not both count as present.
 *
 * "Now" is not a special case — it is this predicate with `t = new Date()`.
 * That is deliberate: a separate `endedAt: null` fast path would be a second
 * definition of "current" that could drift from the as-of one, which is the
 * whole failure mode this schema exists to avoid.
 */
export function activeAt(asOf: Date): {
  startedAt: { lte: Date };
  OR: [{ endedAt: null }, { endedAt: { gt: Date } }];
} {
  return {
    startedAt: { lte: asOf },
    OR: [{ endedAt: null }, { endedAt: { gt: asOf } }],
  };
}

const liveAnimal = { deletedAt: null } satisfies Prisma.AnimalWhereInput;

/** Which animals were in a cage at `asOf`. Excludes soft-deleted animals. */
export async function animalsInCage(cageId: string, asOf: Date = new Date()) {
  const placements = await prisma.animalCagePlacement.findMany({
    where: { cageId, ...activeAt(asOf), animal: liveAnimal },
    include: { animal: { include: { identifiers: true, strain: true } } },
    orderBy: { startedAt: "asc" },
  });
  return placements.map((p) => p.animal);
}

/** Which cage an animal was in at `asOf`, or null if it was unplaced. */
export async function cageOfAnimal(animalId: string, asOf: Date = new Date()) {
  const placement = await prisma.animalCagePlacement.findFirst({
    where: { animalId, ...activeAt(asOf) },
    include: { cage: true },
  });
  return placement?.cage ?? null;
}

/** Where a cage physically sat at `asOf`, with its rack and room. */
export async function positionOfCage(cageId: string, asOf: Date = new Date()) {
  const placement = await prisma.cagePlacement.findFirst({
    where: { cageId, ...activeAt(asOf) },
    include: { rackPosition: { include: { rack: { include: { room: true } } } } },
  });
  return placement?.rackPosition ?? null;
}

/** Which cage occupied a rack slot at `asOf`. */
export async function cageAtPosition(
  rackPositionId: string,
  asOf: Date = new Date(),
) {
  const placement = await prisma.cagePlacement.findFirst({
    where: { rackPositionId, ...activeAt(asOf), cage: { deletedAt: null } },
    include: { cage: true },
  });
  return placement?.cage ?? null;
}

/**
 * Full location chain for an animal at `asOf`: animal -> cage -> slot -> rack
 * -> room. Two hops, because an animal's address is a fact about the cage it
 * is in, not about the animal.
 */
export async function locateAnimal(animalId: string, asOf: Date = new Date()) {
  const cage = await cageOfAnimal(animalId, asOf);
  if (!cage) return null;

  const position = await positionOfCage(cage.id, asOf);
  return {
    cage,
    position,
    rack: position?.rack ?? null,
    room: position?.rack.room ?? null,
    /** Null when the cage exists but was not on a rack at that moment. */
    address: position?.label ?? null,
  };
}

/**
 * Everything that happened to an animal, newest first, ordered by when it
 * actually happened rather than when it was typed in.
 */
export async function animalHistory(animalId: string) {
  const [placements, events] = await Promise.all([
    prisma.animalCagePlacement.findMany({
      where: { animalId },
      include: { cage: true },
      orderBy: { startedAt: "desc" },
    }),
    prisma.husbandryEvent.findMany({
      where: { animalId },
      orderBy: { occurredAt: "desc" },
    }),
  ]);
  return { placements, events };
}

/** Live animal count for a lab at `asOf` — the basis of a per-diem census. */
export async function censusCount(labId: string, asOf: Date = new Date()) {
  return prisma.animalCagePlacement.count({
    where: {
      ...activeAt(asOf),
      animal: { labId, ...liveAnimal },
    },
  });
}
