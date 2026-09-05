import { withChangeset, type Tx } from "@/lib/changeset";
import { activeAt } from "@/lib/queries/placement";
import type { PlacementReason } from "@/generated/prisma/client";

type MoveAnimalsInput = {
  animalIds: string[];
  cageId: string;
  /** When the move actually happened. Defaults to now, but backdating is normal. */
  occurredAt?: Date;
  actorId?: string | null;
  labId?: string | null;
  reason?: PlacementReason;
  notes?: string | null;
  summary?: string;
};

/**
 * Move animals into a cage as one undoable action.
 *
 * The placement closed is the one in effect *at `occurredAt`*, not the latest
 * one — backdating a move that was noticed three weeks late has to slot into
 * history at the right point rather than clobbering the present. If that would
 * produce overlapping intervals, the database's exclusion constraint rejects
 * the whole transaction; we do not try to guess a repair.
 */
export async function moveAnimalsToCage(input: MoveAnimalsInput) {
  const occurredAt = input.occurredAt ?? new Date();
  const reason = input.reason ?? "CAGE_CHANGE";

  return withChangeset(
    {
      summary:
        input.summary ??
        `Moved ${input.animalIds.length} animal${input.animalIds.length === 1 ? "" : "s"}`,
      actorId: input.actorId,
      labId: input.labId,
      reason: input.notes,
    },
    async (tx, changesetId) => {
      const moved: string[] = [];

      for (const animalId of input.animalIds) {
        const current = await tx.animalCagePlacement.findFirst({
          where: { animalId, ...activeAt(occurredAt) },
          select: { id: true, cageId: true },
        });

        // Already where it is being sent — nothing to record.
        if (current?.cageId === input.cageId) continue;

        if (current) {
          await closeAnimalPlacement(tx, {
            id: current.id,
            endedAt: occurredAt,
            endedById: input.actorId ?? null,
            changesetId,
          });
        }

        await tx.animalCagePlacement.create({
          data: {
            animalId,
            cageId: input.cageId,
            startedAt: occurredAt,
            startedById: input.actorId ?? null,
            reason,
            notes: input.notes ?? null,
            changesetId,
          },
        });

        moved.push(animalId);
      }

      return moved;
    },
  );
}

async function closeAnimalPlacement(
  tx: Tx,
  args: {
    id: string;
    endedAt: Date;
    endedById: string | null;
    changesetId: string;
  },
) {
  await tx.animalCagePlacement.update({
    where: { id: args.id },
    data: {
      endedAt: args.endedAt,
      endedById: args.endedById,
      endRecordedAt: new Date(),
      endChangesetId: args.changesetId,
    },
  });
}

type MoveCageInput = {
  cageId: string;
  rackPositionId: string;
  occurredAt?: Date;
  actorId?: string | null;
  labId?: string | null;
  reason?: string | null;
  summary?: string;
};

/**
 * Move a cage to a rack slot. The animals inside come with it implicitly —
 * their placement is in the *cage*, so nothing about them changes. That is the
 * payoff of two placement tables instead of one denormalized address.
 */
export async function moveCageToPosition(input: MoveCageInput) {
  const occurredAt = input.occurredAt ?? new Date();

  return withChangeset(
    {
      summary: input.summary ?? "Moved cage",
      actorId: input.actorId,
      labId: input.labId,
      reason: input.reason,
    },
    async (tx, changesetId) => {
      const current = await tx.cagePlacement.findFirst({
        where: { cageId: input.cageId, ...activeAt(occurredAt) },
        select: { id: true, rackPositionId: true },
      });

      if (current?.rackPositionId === input.rackPositionId) return null;

      if (current) {
        await tx.cagePlacement.update({
          where: { id: current.id },
          data: {
            endedAt: occurredAt,
            endedById: input.actorId ?? null,
            endRecordedAt: new Date(),
            endChangesetId: changesetId,
          },
        });
      }

      return tx.cagePlacement.create({
        data: {
          cageId: input.cageId,
          rackPositionId: input.rackPositionId,
          startedAt: occurredAt,
          startedById: input.actorId ?? null,
          reason: input.reason ?? null,
          changesetId,
        },
      });
    },
  );
}
