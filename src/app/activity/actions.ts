"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { resolveGrant } from "@/lib/auth/grants";
import { canUndoChangeset } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { revertChangeset } from "@/lib/operations/undo";

export type UndoResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Undo one changeset.
 *
 * The permission check happens here, server-side, against a grant resolved
 * from the database — not against anything the page sent us. The button being
 * visible is a convenience; this is the actual gate.
 */
export async function undoChangeset(changesetId: string): Promise<UndoResult> {
  try {
    const actor = await requireActor();

    const changeset = await prisma.changeset.findUnique({
      where: { id: changesetId },
      select: { id: true, labId: true, actorId: true, revertedAt: true, summary: true },
    });
    if (!changeset) return { ok: false, error: "That change no longer exists." };
    if (!changeset.labId) {
      return { ok: false, error: "That change is not scoped to a lab." };
    }

    const grant = await resolveGrant(actor.id, changeset.labId);
    const verdict = canUndoChangeset(grant, changeset, actor.id);
    if (!verdict.allowed) {
      return { ok: false, error: verdict.reason ?? "You cannot undo that change." };
    }

    const summary = await revertChangeset({
      changesetId,
      actorId: actor.id,
      reason: `Undone from the activity log`,
    });

    revalidatePath("/activity");
    revalidatePath("/cages");

    const parts = [
      summary.placementsReopened > 0 ? `${summary.placementsReopened} placement(s) restored` : null,
      summary.placementsRemoved > 0 ? `${summary.placementsRemoved} removed` : null,
      summary.eventsRemoved > 0 ? `${summary.eventsRemoved} event(s) removed` : null,
    ].filter(Boolean);

    return {
      ok: true,
      message: parts.length ? `Undone — ${parts.join(", ")}.` : "Undone.",
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not undo that change.",
    };
  }
}
