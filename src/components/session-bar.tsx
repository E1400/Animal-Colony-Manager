import Link from "next/link";

import { getCurrentActor } from "@/lib/actor";
import { auth, signOut } from "@/lib/auth/config";
import { resolveGrant } from "@/lib/auth/grants";
import { humanize } from "@/components/ui";

/**
 * Who you are and what that lets you do, stated plainly.
 *
 * The role is shown because "why can't I press that button" is otherwise a
 * mystery, and a covering user is told whose authority they are borrowing —
 * acting as someone else without knowing it is how mistakes get made.
 */
export async function SessionBar() {
  const [session, actor] = await Promise.all([auth(), getCurrentActor()]);

  if (!session?.user || !actor) {
    return (
      <div className="no-print border-b border-border bg-surface-muted">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2">
          <span className="text-sm text-muted">Signed out — read only</span>
          <Link
            href="/signin"
            className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-accent"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const grant = actor.labId ? await resolveGrant(actor.id, actor.labId) : null;
  const covering = grant?.via.filter((v) => v.source === "coverage") ?? [];

  return (
    <div className="no-print border-b border-border bg-surface-muted">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2">
        <span className="min-w-0 truncate text-sm text-muted">
          {actor.name}
          {grant?.roles.length ? (
            <> · {grant.roles.map(humanize).join(", ")}</>
          ) : (
            <> · no role in this lab</>
          )}
          {covering.length > 0 ? (
            <span className="text-warn">
              {" "}
              · covering for {covering.map((c) => c.from).filter(Boolean).join(", ")}
            </span>
          ) : null}
        </span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-muted hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
