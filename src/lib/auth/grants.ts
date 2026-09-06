import { prisma } from "@/lib/db";
import { emptyGrant, grantFrom, type Grant } from "@/lib/auth/permissions";

/**
 * Resolves what a user may do in a lab, right now.
 *
 * Two sources feed in:
 *
 *   1. Their own membership in that lab.
 *   2. Any active coverage assignment naming them as the covering person —
 *      which lends them the *owner's* role for the window of the handoff.
 *
 * Coverage is resolved here rather than checked separately at call sites,
 * because a delegation that lives beside the permission check is a delegation
 * that will eventually disagree with it. A handoff expiring is then just the
 * window closing; nothing has to be revoked.
 *
 * Always resolved server-side from the database. A role never arrives from the
 * client, and this function is the only thing that decides.
 */
export async function resolveGrant(userId: string, labId: string): Promise<Grant> {
  const now = new Date();

  const [membership, coveringFor] = await Promise.all([
    prisma.membership.findUnique({
      where: { userId_labId: { userId, labId } },
      select: { role: true },
    }),
    prisma.coverageAssignment.findMany({
      where: {
        labId,
        coveringUserId: userId,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: {
        owner: {
          select: {
            id: true,
            name: true,
            memberships: { where: { labId }, select: { role: true } },
          },
        },
      },
    }),
  ]);

  const entries: Parameters<typeof grantFrom>[0] = [];

  if (membership) {
    entries.push({ role: membership.role, source: "membership" });
  }

  for (const coverage of coveringFor) {
    const ownerRole = coverage.owner.memberships[0]?.role;
    if (!ownerRole) continue;
    entries.push({
      role: ownerRole,
      source: "coverage",
      from: coverage.owner.name,
    });
  }

  if (entries.length === 0) return emptyGrant();
  return grantFrom(entries);
}

/** Labs this user can see at all, whether by membership or active coverage. */
export async function labsForUser(userId: string) {
  const now = new Date();
  const [memberships, coverage] = await Promise.all([
    prisma.membership.findMany({
      where: { userId },
      select: { labId: true, role: true, lab: { select: { name: true, slug: true } } },
    }),
    prisma.coverageAssignment.findMany({
      where: {
        coveringUserId: userId,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { labId: true, lab: { select: { name: true, slug: true } } },
    }),
  ]);

  const byId = new Map<string, { id: string; name: string; slug: string }>();
  for (const m of memberships) {
    byId.set(m.labId, { id: m.labId, name: m.lab.name, slug: m.lab.slug });
  }
  for (const c of coverage) {
    byId.set(c.labId, { id: c.labId, name: c.lab.name, slug: c.lab.slug });
  }
  return [...byId.values()];
}
