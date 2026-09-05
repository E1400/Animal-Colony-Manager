import { prisma } from "@/lib/db";
import type { ChangesetKind, Prisma } from "@/generated/prisma/client";

/**
 * The transaction handle handed to a changeset body. Every write inside must
 * go through this, not the module-level `prisma`, or it will not be part of
 * the transaction and will not be tagged with the changeset.
 */
export type Tx = Prisma.TransactionClient;

export type ChangesetInput = {
  /** Short human phrase shown in the undo list — "Moved 4 mice to B-04-12". */
  summary: string;
  actorId?: string | null;
  labId?: string | null;
  kind?: ChangesetKind;
  /** Free text from the user: why they did this. */
  reason?: string | null;
};

/**
 * Runs `body` inside a transaction with a Changeset row created up front, and
 * hands both the transaction and the changeset id to the body.
 *
 * Every write a human can undo goes through here. The reason it is one
 * changeset rather than per-row audit entries: a weaning that splits one cage
 * into four is a single action to the person who did it, so it has to be a
 * single action to the undo button. Reverting means walking the rows tagged
 * with one changeset id, which only works if they were all tagged together and
 * committed together.
 */
export async function withChangeset<T>(
  input: ChangesetInput,
  body: (tx: Tx, changesetId: string) => Promise<T>,
): Promise<{ result: T; changesetId: string }> {
  return prisma.$transaction(async (tx) => {
    const changeset = await tx.changeset.create({
      data: {
        summary: input.summary,
        actorId: input.actorId ?? null,
        labId: input.labId ?? null,
        kind: input.kind ?? "MANUAL",
        reason: input.reason ?? null,
      },
      select: { id: true },
    });

    const result = await body(tx, changeset.id);
    return { result, changesetId: changeset.id };
  });
}
