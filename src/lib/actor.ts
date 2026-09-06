import { prisma } from "@/lib/db";

/**
 * Who is performing a write.
 *
 * PLACEHOLDER until milestone 5 wires up Auth.js. Every write is already
 * attributed to a real user row and tagged with a changeset, so switching this
 * to a session lookup is a change to this one function rather than to every
 * call site — that is the whole reason it exists this early.
 *
 * It resolves server-side and is never accepted from the client, which is the
 * property that has to hold once this becomes real authorization.
 */
export async function getCurrentActor() {
  const actor = await prisma.user.findFirst({
    where: { memberships: { some: { role: "LAB_MANAGER" } } },
    include: { memberships: { include: { lab: true }, take: 1 } },
  });

  if (!actor) {
    throw new Error(
      "No user found — run `npm run db:seed` before recording anything.",
    );
  }

  return {
    id: actor.id,
    name: actor.name,
    labId: actor.memberships[0]?.labId ?? null,
  };
}
