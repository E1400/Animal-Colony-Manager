import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db";

export type Actor = { id: string; name: string | null; labId: string | null };

/**
 * Who is acting, resolved from the session on the server.
 *
 * The session carries an identity and nothing else — no role, no lab. Those
 * are looked up here from our own tables, so what someone may do can be
 * changed or revoked without waiting for a token to expire, and a tampered
 * cookie cannot grant anything.
 *
 * Returns null when nobody is signed in, or when the signed-in identity has no
 * membership yet. Both are ordinary states: read-only pages still render, and
 * a new GitHub account with no lab membership should see an empty colony
 * rather than an error.
 */
export async function getCurrentActor(): Promise<Actor | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      memberships: { select: { labId: true }, take: 1 },
    },
  });
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    labId: user.memberships[0]?.labId ?? null,
  };
}

/** For write paths, where having nobody to attribute a change to is an error. */
export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) {
    throw new Error("You need to be signed in to record that.");
  }
  return actor;
}
