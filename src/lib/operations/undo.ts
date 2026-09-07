import { prisma } from "@/lib/db";
import type { Tx } from "@/lib/changeset";

/**
 * Everything a revert took away, kept so the revert can be undone in turn.
 *
 * `deleted` is whole rows, keyed by table and re-inserted in dependency order.
 * `reopened` is only the closing half of an interval, because reverting a move
 * reopens a placement rather than deleting it.
 */
export type RestorePayload = {
  originalChangesetId: string;
  deleted: Record<string, unknown[]>;
  reopened: Array<{
    table: "animalCagePlacement" | "cagePlacement";
    id: string;
    endedAt: string;
    endedById: string | null;
    endRecordedAt: string | null;
    endChangesetId: string | null;
  }>;
};

/** Re-insert order mirrors the foreign keys, same as the backup script. */
const RESTORE_ORDER = [
  "animalIdentifier",
  "genotype",
  "breedingPair",
  "litter",
  "coverageAssignment",
  "cagePlacement",
  "animalCagePlacement",
  "husbandryEvent",
] as const;

export type UndoSummary = {
  revertChangesetId: string;
  placementsRemoved: number;
  placementsReopened: number;
  eventsRemoved: number;
  otherRowsRemoved: number;
  /** True when this call put a previous undo back rather than undoing work. */
  redo: boolean;
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
      select: {
        id: true,
        labId: true,
        summary: true,
        revertedAt: true,
        restorePayload: true,
      },
    });
    if (!original) throw new Error("That change no longer exists.");
    if (original.revertedAt) throw new Error("That change has already been undone.");

    // Undoing a revert means putting back exactly what it took away, which is
    // only possible because the revert wrote down what that was.
    if (original.restorePayload) {
      return replay(tx, original.restorePayload as unknown as RestorePayload, opts);
    }

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

    // Capture before destroying. Rows the changeset created are read out whole
    // so they can be re-inserted; intervals it closed keep only their closing
    // half, since reverting a move reopens a row rather than removing it.
    const deleted: Record<string, unknown[]> = {};
    for (const table of RESTORE_ORDER) {
      const rows = await (
        tx as unknown as Record<string, { findMany: (a: object) => Promise<unknown[]> }>
      )[table].findMany({ where: { changesetId: original.id } });
      if (rows.length) deleted[table] = rows;
    }

    const [animalToReopen, cageToReopen] = await Promise.all([
      tx.animalCagePlacement.findMany({
        where: { endChangesetId: original.id },
        select: { id: true, endedAt: true, endedById: true, endRecordedAt: true },
      }),
      tx.cagePlacement.findMany({
        where: { endChangesetId: original.id },
        select: { id: true, endedAt: true, endedById: true, endRecordedAt: true },
      }),
    ]);

    const reopened: RestorePayload["reopened"] = [
      ...animalToReopen.map((r) => ({
        table: "animalCagePlacement" as const,
        id: r.id,
        endedAt: r.endedAt!.toISOString(),
        endedById: r.endedById,
        endRecordedAt: r.endRecordedAt?.toISOString() ?? null,
        endChangesetId: original.id,
      })),
      ...cageToReopen.map((r) => ({
        table: "cagePlacement" as const,
        id: r.id,
        endedAt: r.endedAt!.toISOString(),
        endedById: r.endedById,
        endRecordedAt: r.endRecordedAt?.toISOString() ?? null,
        endChangesetId: original.id,
      })),
    ];

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
        data: { endedAt: null, endedById: null, endRecordedAt: null, endChangesetId: null },
      }),
      tx.cagePlacement.updateMany({
        where: { endChangesetId: original.id },
        data: { endedAt: null, endedById: null, endRecordedAt: null, endChangesetId: null },
      }),
    ]);

    await tx.changeset.update({
      where: { id: revert.id },
      data: {
        restorePayload: {
          originalChangesetId: original.id,
          deleted,
          reopened,
        } as object,
      },
    });

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
      redo: false,
    };
  });
}

/**
 * Puts back what a revert removed.
 *
 * The reverse of the unwind, in reverse order: intervals are re-closed only
 * after the rows that used to sit on top of them exist again, or the overlap
 * constraint rejects the transaction.
 */
async function replay(
  tx: Tx,
  payload: RestorePayload,
  opts: { changesetId: string; actorId: string; reason?: string | null },
): Promise<UndoSummary> {
  // Mirror of the unwind, and the order matters just as much. Intervals the
  // revert reopened must be re-closed *before* the rows that used to sit on
  // top of them are re-inserted, or the two overlap and the exclusion
  // constraint rejects the whole transaction. Doing it the other way round is
  // exactly what the constraint caught the first time this was written.
  let reclosed = 0;
  for (const row of payload.reopened) {
    const data = {
      endedAt: new Date(row.endedAt),
      endedById: row.endedById,
      endRecordedAt: row.endRecordedAt ? new Date(row.endRecordedAt) : null,
      endChangesetId: row.endChangesetId,
    };
    // The two delegates have structurally identical but nominally distinct
    // signatures, so a union of them is not callable.
    if (row.table === "animalCagePlacement") {
      await tx.animalCagePlacement.update({ where: { id: row.id }, data });
    } else {
      await tx.cagePlacement.update({ where: { id: row.id }, data });
    }
    reclosed++;
  }

  let restored = 0;
  for (const table of RESTORE_ORDER) {
    const rows = payload.deleted[table];
    if (!rows?.length) continue;
    await (
      tx as unknown as Record<
        string,
        { createMany: (a: { data: unknown[] }) => Promise<{ count: number }> }
      >
    )[table].createMany({ data: rows });
    restored += rows.length;
  }

  // The original stands again, and the revert is deleted rather than kept and
  // marked spent. Keeping it left a changeset that had already been reverted
  // lying around, so pressing undo again landed on it and failed with "that
  // change has already been undone". Removing it returns the log to exactly
  // the state before the undo — the original entry, and nothing else.
  await tx.changeset.update({
    where: { id: payload.originalChangesetId },
    data: { revertedAt: null, revertedByChangesetId: null },
  });
  await tx.changeset.delete({ where: { id: opts.changesetId } });

  return {
    revertChangesetId: opts.changesetId,
    placementsRemoved: 0,
    placementsReopened: reclosed,
    eventsRemoved: 0,
    otherRowsRemoved: restored,
    redo: true,
  };
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

/**
 * Recent changesets for the audit trail, newest first.
 *
 * Revert changesets are excluded. Undoing something otherwise produces two
 * entries — the original marked undone, and a second saying it was undone —
 * which reads as duplication rather than history. One human action is one row;
 * the fact it was undone, and by whom, is shown on the row it happened to.
 */
export async function recentChangesets(opts: { labId?: string; limit?: number } = {}) {
  return prisma.changeset.findMany({
    where: {
      ...(opts.labId ? { labId: opts.labId } : {}),
      kind: { not: "REVERT" },
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
    include: {
      actor: { select: { id: true, name: true } },
      revertedBy: {
        select: { id: true, createdAt: true, actor: { select: { name: true } } },
      },
      // Enough to point the row at whatever it changed. One row of each is
      // plenty: a changeset that touched forty cages still only needs a
      // sensible place to land.
      events: {
        select: {
          cage: { select: { code: true } },
          animal: {
            select: {
              id: true,
              identifiers: {
                where: { isPrimary: true, retiredAt: null },
                select: { value: true },
                take: 1,
              },
            },
          },
        },
        take: 6,
      },
      animalPlacementsStarted: {
        select: {
          cage: { select: { code: true } },
          animal: {
            select: {
              id: true,
              identifiers: {
                where: { isPrimary: true, retiredAt: null },
                select: { value: true },
                take: 1,
              },
            },
          },
        },
        take: 6,
      },
      cagePlacementsStarted: {
        select: { cage: { select: { code: true } } },
        take: 6,
      },
      importBatch: { select: { id: true, filename: true } },
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

type WithSubjects = {
  events: Array<{
    cage: { code: string } | null;
    animal: { id: string; identifiers: Array<{ value: string }> } | null;
  }>;
  animalPlacementsStarted: Array<{
    cage: { code: string };
    animal: { id: string; identifiers: Array<{ value: string }> };
  }>;
  cagePlacementsStarted: Array<{ cage: { code: string } }>;
};

/**
 * Everything a changeset touched, as links.
 *
 * A row that says "health check logged" is only useful if you can get from it
 * to the cage and the animal it was about. Cages are labelled by code and
 * animals by their primary ear tag, since that is what is written on them.
 */
export type ChangesetLink = {
  kind: "cage" | "animal";
  label: string;
  href: string;
};

export function changesetLinks(cs: WithSubjects): ChangesetLink[] {
  const links = new Map<string, ChangesetLink>();

  const addCage = (code?: string) => {
    if (code) {
      links.set(`c:${code}`, {
        kind: "cage",
        label: code,
        href: `/cages/${encodeURIComponent(code)}`,
      });
    }
  };
  const addAnimal = (a?: { id: string; identifiers: Array<{ value: string }> } | null) => {
    if (!a) return;
    links.set(`a:${a.id}`, {
      kind: "animal",
      label: a.identifiers[0]?.value ?? "untagged",
      href: `/animals/${a.id}`,
    });
  };

  for (const e of cs.events) {
    addCage(e.cage?.code);
    addAnimal(e.animal);
  }
  for (const p of cs.animalPlacementsStarted) {
    addCage(p.cage.code);
    addAnimal(p.animal);
  }
  for (const p of cs.cagePlacementsStarted) addCage(p.cage.code);

  // Cages first, then animals. A bare "CG-1000" and a bare "2101" are hard to
  // tell apart at a glance, so the caller labels them — grouping keeps the
  // labels from having to repeat on every chip.
  //
  // A bulk import touches hundreds of records; listing them all would bury the
  // row. Show a handful and let the count speak for the rest.
  const all = [...links.values()];
  return [
    ...all.filter((l) => l.kind === "cage"),
    ...all.filter((l) => l.kind === "animal"),
  ].slice(0, 8);
}
