import { prisma } from "@/lib/db";
import type { Tx } from "@/lib/changeset";

export type UndoSummary = {
  revertChangesetId: string;
  placementsRemoved: number;
  placementsReopened: number;
  eventsRemoved: number;
  otherRowsRemoved: number;
};

/**
 * Undoes one changeset as a single action.
 *
 * This is the payoff for tagging every write with a changeset id: a weaning
 * that split one cage into four is one action to the person who did it, so it
 * has to be one action to undo. Reverting per-row would leave the colony in a
 * state that never existed.
 *
 * Ordering is load-bearing. Rows *created* by the changeset are deleted before
 * rows it *closed* are reopened — do it the other way round and the reopened
 * interval overlaps the one still sitting on top of it, and the database
 * rejects the whole transaction. That is the exclusion constraint doing its
 * job, but it means undo has to unwind in the reverse order of the original
 * write.
 *
 * The original changeset is not deleted. It is marked reverted and linked to
 * the changeset that undid it, so the audit trail shows that something was
 * done and then undone, rather than quietly showing nothing.
 */
export async function revertChangeset(opts: {
  changesetId: string;
  actorId: string;
  reason?: string | null;
}): Promise<UndoSummary> {
  return prisma.$transaction(async (tx) => {
    const original = await tx.changeset.findUnique({
      where: { id: opts.changesetId },
      select: { id: true, labId: true, summary: true, revertedAt: true },
    });
    if (!original) throw new Error("That change no longer exists.");
    if (original.revertedAt) throw new Error("That change has already been undone.");

    const revert = await tx.changeset.create({
      data: {
        labId: original.labId,
        actorId: opts.actorId,
        kind: "REVERT",
        summary: `Undid: ${original.summary}`,
        reason: opts.reason ?? null,
      },
      select: { id: true },
    });

    // 1. Remove what the changeset created.
    const [animalPlacements, cagePlacements, events] = await Promise.all([
      tx.animalCagePlacement.deleteMany({ where: { changesetId: original.id } }),
      tx.cagePlacement.deleteMany({ where: { changesetId: original.id } }),
      tx.husbandryEvent.deleteMany({ where: { changesetId: original.id } }),
    ]);

    const others = await removeCreatedRows(tx, original.id);

    // 2. Only now reopen what it closed — the intervals that were sitting on
    //    top of these have just been deleted, so there is room again.
    const [reopenedAnimals, reopenedCages] = await Promise.all([
      tx.animalCagePlacement.updateMany({
        where: { endChangesetId: original.id },
        data: {
          endedAt: null,
          endedById: null,
          endRecordedAt: null,
          endChangesetId: null,
        },
      }),
      tx.cagePlacement.updateMany({
        where: { endChangesetId: original.id },
        data: {
          endedAt: null,
          endedById: null,
          endRecordedAt: null,
          endChangesetId: null,
        },
      }),
    ]);

    await tx.changeset.update({
      where: { id: original.id },
      data: { revertedAt: new Date(), revertedByChangesetId: revert.id },
    });

    return {
      revertChangesetId: revert.id,
      placementsRemoved: animalPlacements.count + cagePlacements.count,
      placementsReopened: reopenedAnimals.count + reopenedCages.count,
      eventsRemoved: events.count,
      otherRowsRemoved: others,
    };
  });
}

/**
 * The remaining tables that carry a changeset id. Kept separate so adding a
 * new changeset-tagged table is one line here rather than a silent gap in undo.
 */
async function removeCreatedRows(tx: Tx, changesetId: string): Promise<number> {
  const [identifiers, genotypes, litters, pairs, coverage] = await Promise.all([
    tx.animalIdentifier.deleteMany({ where: { changesetId } }),
    tx.genotype.deleteMany({ where: { changesetId } }),
    tx.litter.deleteMany({ where: { changesetId } }),
    tx.breedingPair.deleteMany({ where: { changesetId } }),
    tx.coverageAssignment.deleteMany({ where: { changesetId } }),
  ]);
  return (
    identifiers.count + genotypes.count + litters.count + pairs.count + coverage.count
  );
}

/** Recent changesets for the audit trail, newest first. */
export async function recentChangesets(opts: { labId?: string; limit?: number } = {}) {
  return prisma.changeset.findMany({
    where: opts.labId ? { labId: opts.labId } : {},
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
    include: {
      actor: { select: { id: true, name: true } },
      _count: {
        select: {
          animalPlacementsStarted: true,
          cagePlacementsStarted: true,
          events: true,
        },
      },
    },
  });
}
