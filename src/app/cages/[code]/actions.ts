"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/operations/events";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

async function resolveCage(code: string) {
  const cage = await prisma.cage.findFirst({
    where: { code, deletedAt: null },
    select: { id: true, code: true, labId: true },
  });
  if (!cage) throw new Error(`No cage with code ${code}`);
  return cage;
}

/**
 * When an action was performed, as opposed to when it reached the server.
 *
 * Work queued offline at a rack syncs minutes or hours later, and it must
 * land in history at the moment of the tap — otherwise every dropped-WiFi
 * entry silently records the wrong time. The client supplies it, so it is
 * bounded here: a little clock skew forward is tolerated, anything further is
 * ignored in favour of the server's own clock rather than rejected, because
 * losing the entry is worse than losing its precise timestamp.
 */
function resolveOccurredAt(iso?: string): Date {
  if (!iso) return new Date();
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return new Date();

  const now = Date.now();
  const skewAllowance = 5 * 60 * 1000;
  const oldestSensible = now - 30 * 24 * 60 * 60 * 1000;

  if (parsed.getTime() > now + skewAllowance) return new Date();
  if (parsed.getTime() < oldestSensible) return new Date();
  return parsed;
}

/**
 * The five-second action: one tap at the rack to record that this cage was
 * changed. No form, no date picker, no confirmation dialog — those are what
 * make people stop logging and reconstruct it badly on Friday instead.
 */
export async function logCageChange(
  code: string,
  occurredAtIso?: string,
): Promise<ActionResult> {
  try {
    const [cage, actor] = await Promise.all([resolveCage(code), requireActor()]);

    await logEvent({
      type: "CAGE_CHANGE",
      labId: cage.labId,
      actorId: actor.id,
      cageId: cage.id,
      occurredAt: resolveOccurredAt(occurredAtIso),
      summary: `Cage change logged for ${cage.code}`,
    });

    revalidatePath(`/cages/${encodeURIComponent(code)}`);
    return { ok: true, message: "Cage change logged." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not log that." };
  }
}

export async function logHealthCheck(
  code: string,
  notes: string,
  occurredAtIso?: string,
): Promise<ActionResult> {
  const text = notes.trim();
  if (!text) return { ok: false, error: "Add a note before saving." };

  try {
    const [cage, actor] = await Promise.all([resolveCage(code), requireActor()]);

    await logEvent({
      type: "HEALTH_CHECK",
      labId: cage.labId,
      actorId: actor.id,
      cageId: cage.id,
      notes: text,
      occurredAt: resolveOccurredAt(occurredAtIso),
      summary: `Health check logged for ${cage.code}`,
    });

    revalidatePath(`/cages/${encodeURIComponent(code)}`);
    return { ok: true, message: "Health check logged." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not log that." };
  }
}

/**
 * Weights arrive from a scale at the rack, one animal at a time. `grams` is
 * validated here rather than trusted from the client, and stored in the typed
 * event payload rather than as a column on Animal.
 */
export async function logWeight(
  code: string,
  animalId: string,
  grams: number,
  occurredAtIso?: string,
): Promise<ActionResult> {
  if (!Number.isFinite(grams) || grams <= 0 || grams > 200) {
    return { ok: false, error: "Enter a weight between 0 and 200 g." };
  }

  try {
    const [cage, actor] = await Promise.all([resolveCage(code), requireActor()]);

    const animal = await prisma.animal.findFirst({
      where: { id: animalId, deletedAt: null },
      select: { id: true },
    });
    if (!animal) return { ok: false, error: "That animal no longer exists." };

    await logEvent({
      type: "WEIGHT",
      labId: cage.labId,
      actorId: actor.id,
      animalId: animal.id,
      cageId: cage.id,
      occurredAt: resolveOccurredAt(occurredAtIso),
      payload: { grams },
      summary: `Weight recorded in ${cage.code}`,
    });

    revalidatePath(`/cages/${encodeURIComponent(code)}`);
    return { ok: true, message: `Recorded ${grams} g.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not log that." };
  }
}
