import { prisma } from "@/lib/db";

export type Actor = { id: string; name: string | null; labId: string | null };

/**
 * Who is performing a write.
 *
 * PLACEHOLDER until Auth.js is wired. Every write is already attributed to a
 * real user row and tagged with a changeset, so switching this to a session
 * lookup is a change to this one function rather than to every call site —
 * which is the reason it exists this early.
 *
 * It resolves server-side and is never accepted from the client, the property
 * that has to keep holding once this becomes real authorization.
 *
 * Returns null rather than throwing when there is nobody: a freshly deployed,
 * unseeded database is a normal state, and read-only pages must still render
 * in it. Write paths use `requireActor` instead.
 */
export async function getCurrentActor(): Promise<Actor | null> {
  const actor = await prisma.user.findFirst({
    where: { memberships: { some: { role: "LAB_MANAGER" } } },
    include: { memberships: { include: { lab: true }, take: 1 } },
  });

  if (!actor) return null;

  return {
    id: actor.id,
    name: actor.name,
    labId: actor.memberships[0]?.labId ?? null,
  };
}

/** For write paths, where having no actor genuinely is an error. */
export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) {
    throw new Error(
      "No user account exists yet. Seed the database before recording anything.",
    );
  }
  return actor;
}
