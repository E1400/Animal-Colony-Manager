import { getCurrentActor } from "@/lib/actor";
import { resolveGrant } from "@/lib/auth/grants";
import { can, canUndoChangeset } from "@/lib/auth/permissions";
import { changesetLinks, recentChangesets } from "@/lib/operations/undo";
import Link from "next/link";

import { Badge, EmptyState, PageHeader, humanize } from "@/components/ui";
import { UndoButton } from "@/components/undo-button";

export const dynamic = "force-dynamic";

function when(d: Date) {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The audit trail is not a separate log table — it is the changesets
 * themselves. Every write already had to belong to one, so "who changed what,
 * when, and can I take it back" falls out of the write path rather than being
 * maintained alongside it, where it could drift.
 */
export default async function ActivityPage() {
  const actor = await getCurrentActor();
  const changesets = await recentChangesets({ limit: 50 });

  // A freshly deployed database has no users yet. The log is still readable;
  // there is simply nobody to attribute an undo to.
  const grant =
    actor?.labId != null ? await resolveGrant(actor.id, actor.labId) : null;

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Every change, who made it, and a button to undo it."
      />

      {grant && grant.via.some((v) => v.source === "coverage") ? (
        <p className="mb-4 rounded-xl bg-warn/15 px-4 py-3 text-warn">
          You are currently covering for{" "}
          {grant.via
            .filter((v) => v.source === "coverage")
            .map((v) => v.from)
            .filter(Boolean)
            .join(", ")}
          , so you can act with their permissions until the handoff ends.
        </p>
      ) : null}

      {changesets.length === 0 ? (
        <EmptyState>
          Nothing has been recorded yet.
          {actor === null ? " This database has not been seeded." : ""}
        </EmptyState>
      ) : (
        <ul className="grid gap-2">
          {changesets.map((cs) => {
            const verdict =
              grant && actor
                ? canUndoChangeset(grant, cs, actor.id)
                : { allowed: false, reason: "Sign in to undo." };

            const links = changesetLinks(cs);

            const touched =
              cs._count.animalPlacementsStarted +
              cs._count.cagePlacementsStarted +
              cs._count.events;

            return (
              <li
                key={cs.id}
                className="rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{cs.summary}</p>
                    <p className="mt-1 text-sm text-muted">
                      {cs.actor?.name ?? "system"} · {when(cs.createdAt)}
                      {touched > 0 ? ` · ${touched} record${touched === 1 ? "" : "s"}` : ""}
                    </p>
                    {cs.reason ? (
                      <p className="mt-1 text-sm text-muted">“{cs.reason}”</p>
                    ) : null}

                    {/*
                      Individual subjects rather than one link on the title: a
                      health check on an animal in a cage should get you to
                      either, and "which one did this touch" is what the log is
                      usually asked.

                      Grouped under their own word because "CG-1000" and "2101"
                      are both just tokens on a chip — without the labels there
                      is nothing telling you which is a cage and which a mouse.
                    */}
                    {(["cage", "animal"] as const).map((kind) => {
                      const of = links.filter((l) => l.kind === kind);
                      if (of.length === 0) return null;
                      const word =
                        kind === "cage"
                          ? of.length === 1 ? "Cage" : "Cages"
                          : of.length === 1 ? "Mouse" : "Mice";
                      return (
                        <div key={kind} className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs uppercase tracking-wide text-muted">
                            {word}
                          </span>
                          {of.map((link) => (
                            <Link
                              key={link.href}
                              href={link.href}
                              className={`inline-flex min-h-8 items-center rounded-md border px-2 font-mono text-xs hover:border-accent ${
                                kind === "cage"
                                  ? "border-border bg-surface-muted"
                                  : "border-accent/40 bg-accent/10"
                              }`}
                            >
                              {link.label}
                            </Link>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                  {cs.kind !== "MANUAL" ? <Badge>{humanize(cs.kind)}</Badge> : null}
                </div>

                {cs.revertedAt ? (
                  // Already undone: say so here, and by whom. The revert has no
                  // row of its own — one human action is one entry — so the way
                  // back is offered from this row too.
                  <>
                    <p className="mt-2 text-sm text-warn">
                      Undone by {cs.revertedBy?.actor?.name ?? "someone"}
                      {cs.revertedBy?.createdAt
                        ? ` · ${when(cs.revertedBy.createdAt)}`
                        : ""}
                    </p>
                    {cs.revertedBy?.id && grant && actor ? (
                      <UndoButton
                        mode="redo"
                        changesetId={cs.revertedBy.id}
                        summary={cs.summary}
                        disabledReason={
                          can(grant, "changeset:undo") ? undefined : "Your role cannot undo changes."
                        }
                      />
                    ) : null}
                  </>
                ) : (
                  <UndoButton
                    changesetId={cs.id}
                    summary={cs.summary}
                    disabledReason={verdict.allowed ? undefined : verdict.reason}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
