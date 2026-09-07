import Link from "next/link";

import { getCurrentActor } from "@/lib/actor";
import { auth, signOut } from "@/lib/auth/config";
import { resolveGrant } from "@/lib/auth/grants";
import { humanize } from "@/components/ui";

/**
 * Identity, in the right-hand end of the navigation bar.
 *
 * The role is shown because "why can't I press that button" is otherwise a
 * mystery, and a covering user is told whose authority they are borrowing —
 * acting as someone else without knowing it is how mistakes get made. On a
 * phone there is no room for either, so the name and role drop away and the
 * control alone remains.
 */
export async function SessionBar() {
  const [session, actor] = await Promise.all([auth(), getCurrentActor()]);

  if (!session?.user || !actor) {
    return (
      <Link
        href="/signin"
        className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-accent"
      >
        Sign in
      </Link>
    );
  }

  const grant = actor.labId ? await resolveGrant(actor.id, actor.labId) : null;
  const covering = grant?.via.filter((v) => v.source === "coverage") ?? [];
  const roles = grant?.roles.map(humanize).join(", ");

  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-56 truncate text-sm text-muted sm:block">
        {actor.name}
        {roles ? <> · {roles}</> : <> · no role</>}
        {covering.length > 0 ? (
          <span className="text-warn">
            {" "}
            · covering {covering.map((c) => c.from).filter(Boolean).join(", ")}
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
  );
}
