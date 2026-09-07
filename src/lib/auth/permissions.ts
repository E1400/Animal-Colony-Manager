import type { Role } from "@/generated/prisma/client";

/**
 * Authorization, as distinct from authentication.
 *
 * GitHub tells us who someone is. What they may do is a fact about *our*
 * system, scoped to a lab, and it never travels in a token or a form field —
 * it is resolved server-side from the Membership table on every request.
 *
 * The roles here are not a ladder. A veterinarian outranks a lab manager on
 * animal welfare and cannot touch breeding records; an auditor can read
 * everything and change nothing. Modelling that as a single privilege level
 * would force the vet and the undergrad into the same box.
 */
export const CAPABILITIES = [
  "colony:read",
  "event:log",
  "event:correct",
  "animal:write",
  "animal:delete",
  "cage:write",
  "cage:delete",
  "breeding:write",
  "import:run",
  "changeset:undo",
  "changeset:undo-any",
  "coverage:manage",
  "member:manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  PI: [
    "colony:read",
    "event:log",
    "event:correct",
    "animal:write",
    "animal:delete",
    "cage:write",
    "cage:delete",
    "breeding:write",
    "import:run",
    "changeset:undo",
    "changeset:undo-any",
    "coverage:manage",
    "member:manage",
  ],
  LAB_MANAGER: [
    "colony:read",
    "event:log",
    "event:correct",
    "animal:write",
    "animal:delete",
    "cage:write",
    "cage:delete",
    "breeding:write",
    "import:run",
    "changeset:undo",
    "changeset:undo-any",
    "coverage:manage",
    "member:manage",
  ],
  // Welfare authority, deliberately narrow elsewhere: a vet must be able to
  // record and correct a health finding on any animal, and has no business
  // editing breeding plans or importing spreadsheets.
  VETERINARIAN: ["colony:read", "event:log", "event:correct", "changeset:undo"],
  RESEARCHER: [
    "colony:read",
    "event:log",
    "event:correct",
    "animal:write",
    "cage:write",
    "breeding:write",
    "import:run",
    "changeset:undo",
  ],
  // Bulk import is the same authority as creating animals and cages one at a
  // time, which a technician already has. Withholding it only pushes the work
  // back into the spreadsheet this app is meant to replace.
  TECHNICIAN: [
    "colony:read",
    "event:log",
    "event:correct",
    "animal:write",
    "cage:write",
    "import:run",
    "changeset:undo",
  ],
  // The person most likely to be at a rack at 11pm, and most likely to be
  // nervous about it. They can record what they did and undo their own
  // mistake; they cannot delete anything.
  UNDERGRAD: ["colony:read", "event:log", "changeset:undo"],
  AUDITOR: ["colony:read"],
};

export function capabilitiesForRole(role: Role): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

/**
 * What a user may do in a given lab.
 *
 * `via` records how the authority was obtained. Coverage is not a separate
 * feature bolted beside permissions — it is a time-bounded delegation resolved
 * here, so a vacation handoff cannot drift out of sync with the permission
 * check the way a duplicated rule would.
 */
export type Grant = {
  capabilities: Set<Capability>;
  roles: Role[];
  via: Array<{ role: Role; source: "membership" | "coverage"; from?: string | null }>;
};

export function emptyGrant(): Grant {
  return { capabilities: new Set(), roles: [], via: [] };
}

export function grantFrom(
  entries: Array<{ role: Role; source: "membership" | "coverage"; from?: string | null }>,
): Grant {
  const capabilities = new Set<Capability>();
  for (const entry of entries) {
    for (const capability of capabilitiesForRole(entry.role)) {
      capabilities.add(capability);
    }
  }
  return {
    capabilities,
    roles: [...new Set(entries.map((e) => e.role))],
    via: entries,
  };
}

export function can(grant: Grant, capability: Capability): boolean {
  return grant.capabilities.has(capability);
}

/**
 * Whether `grant` may undo a particular changeset.
 *
 * Undoing your own mistake is a much lower bar than undoing someone else's:
 * the first is correcting your own work, the second is overriding a colleague.
 * Managers and PIs get the second; everyone who can write gets the first.
 */
export function canUndoChangeset(
  grant: Grant,
  changeset: { actorId: string | null; revertedAt: Date | null },
  userId: string,
): { allowed: boolean; reason?: string } {
  if (changeset.revertedAt) {
    return { allowed: false, reason: "That change has already been undone." };
  }
  if (can(grant, "changeset:undo-any")) return { allowed: true };
  if (!can(grant, "changeset:undo")) {
    return { allowed: false, reason: "Your role cannot undo changes." };
  }
  if (changeset.actorId && changeset.actorId === userId) return { allowed: true };
  return {
    allowed: false,
    reason: "Only a lab manager or PI can undo someone else's change.",
  };
}
