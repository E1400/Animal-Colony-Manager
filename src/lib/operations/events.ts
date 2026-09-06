import { withChangeset } from "@/lib/changeset";
import type { HusbandryEventType, Prisma } from "@/generated/prisma/client";

type LogEventInput = {
  type: HusbandryEventType;
  labId: string;
  actorId: string;
  cageId?: string;
  animalId?: string;
  /** When it happened. Defaults to now; backdating is a normal thing to do. */
  occurredAt?: Date;
  notes?: string | null;
  payload?: Prisma.InputJsonValue;
  summary: string;
};

/**
 * Records one husbandry event inside its own changeset, so it can be undone as
 * a unit like everything else.
 *
 * `occurredAt` defaults to now but is a parameter, not a hardcoded `now()` —
 * the whole point of the occurred/recorded split is that someone standing at a
 * rack can log something that happened yesterday.
 */
export async function logEvent(input: LogEventInput) {
  if (!input.cageId && !input.animalId) {
    throw new Error("An event must be about a cage, an animal, or both.");
  }

  const occurredAt = input.occurredAt ?? new Date();

  return withChangeset(
    {
      summary: input.summary,
      actorId: input.actorId,
      labId: input.labId,
      reason: input.notes ?? null,
    },
    async (tx, changesetId) =>
      tx.husbandryEvent.create({
        data: {
          labId: input.labId,
          type: input.type,
          cageId: input.cageId ?? null,
          animalId: input.animalId ?? null,
          occurredAt,
          recordedById: input.actorId,
          notes: input.notes ?? null,
          payload: input.payload ?? {},
          changesetId,
        },
      }),
  );
}
