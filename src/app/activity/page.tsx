import { getCurrentActor } from "@/lib/actor";
import { resolveGrant } from "@/lib/auth/grants";
import { canUndoChangeset } from "@/lib/auth/permissions";
import { recentChangesets } from "@/lib/operations/undo";
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

            const touched =
              cs._count.animalPlacementsStarted +
              cs._count.cagePlacementsStarted +
              cs._count.events;

            return (
              <li
                key={cs.id}
                className="rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{cs.summary}</p>
                    <p className="mt-1 text-sm text-muted">
                      {cs.actor?.name ?? "system"} · {when(cs.createdAt)}
                      {touched > 0 ? ` · ${touched} record${touched === 1 ? "" : "s"}` : ""}
                    </p>
                    {cs.reason ? (
                      <p className="mt-1 text-sm text-muted">“{cs.reason}”</p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {cs.kind !== "MANUAL" ? (
                      <Badge tone={cs.kind === "REVERT" ? "warn" : "neutral"}>
                        {humanize(cs.kind)}
                      </Badge>
                    ) : null}
                    {cs.revertedAt ? (
                      <Badge tone="warn">undone</Badge>
                    ) : (
                      <UndoButton
                        changesetId={cs.id}
                        summary={cs.summary}
                        disabledReason={verdict.allowed ? undefined : verdict.reason}
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
