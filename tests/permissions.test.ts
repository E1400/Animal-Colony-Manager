import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { resolveGrant } from "@/lib/auth/grants";
import { can, canUndoChangeset } from "@/lib/auth/permissions";

import { makeFixture, resetDb } from "./helpers";

beforeEach(resetDb);

async function memberOf(labId: string, role: Parameters<typeof prisma.membership.create>[0]["data"]["role"], name: string) {
  const user = await prisma.user.create({
    data: { name, email: `${name.replace(/\W/g, "")}-${Date.now()}${Math.random()}@example.edu` },
  });
  await prisma.membership.create({ data: { userId: user.id, labId, role } });
  return user;
}

describe("role capabilities", () => {
  it("gives an undergrad logging but never deletion", async () => {
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    const user = await memberOf(lab.id, "UNDERGRAD", "Undergrad");

    const grant = await resolveGrant(user.id, lab.id);
    expect(can(grant, "colony:read")).toBe(true);
    expect(can(grant, "event:log")).toBe(true);
    expect(can(grant, "animal:delete")).toBe(false);
    expect(can(grant, "cage:delete")).toBe(false);
    expect(can(grant, "import:run")).toBe(false);
  });

  it("gives a vet welfare authority without breeding or import rights", async () => {
    // The interesting case: a vet is not simply "below" a lab manager. They
    // must be able to correct a health record, and have no business editing
    // breeding plans.
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    const user = await memberOf(lab.id, "VETERINARIAN", "Vet");

    const grant = await resolveGrant(user.id, lab.id);
    expect(can(grant, "event:log")).toBe(true);
    expect(can(grant, "event:correct")).toBe(true);
    expect(can(grant, "breeding:write")).toBe(false);
    expect(can(grant, "import:run")).toBe(false);
  });

  it("gives an auditor reading and nothing else", async () => {
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    const user = await memberOf(lab.id, "AUDITOR", "Auditor");

    const grant = await resolveGrant(user.id, lab.id);
    expect(can(grant, "colony:read")).toBe(true);
    expect(can(grant, "event:log")).toBe(false);
    expect(can(grant, "changeset:undo")).toBe(false);
  });

  it("grants nothing at all in a lab the user does not belong to", async () => {
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    const other = await prisma.lab.create({
      data: { slug: `other-${Date.now()}`, name: "Other Lab" },
    });
    const user = await memberOf(lab.id, "PI", "PI Elsewhere");

    const grant = await resolveGrant(user.id, other.id);
    expect(grant.capabilities.size).toBe(0);
    expect(can(grant, "colony:read")).toBe(false);
  });
});

describe("coverage as delegation", () => {
  it("lends the owner's role for the window, and takes it back after", async () => {
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    const manager = await memberOf(lab.id, "LAB_MANAGER", "Manager");
    const undergrad = await memberOf(lab.id, "UNDERGRAD", "Cover");

    // Before any coverage, the undergrad cannot delete.
    expect(can(await resolveGrant(undergrad.id, lab.id), "animal:delete")).toBe(false);

    const active = await prisma.coverageAssignment.create({
      data: {
        labId: lab.id,
        ownerUserId: manager.id,
        coveringUserId: undergrad.id,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
        reason: "Conference",
      },
    });

    const covering = await resolveGrant(undergrad.id, lab.id);
    expect(can(covering, "animal:delete")).toBe(true);
    expect(covering.via.some((v) => v.source === "coverage")).toBe(true);

    // Once the window closes the delegation lapses on its own — nothing has
    // to be revoked.
    await prisma.coverageAssignment.update({
      where: { id: active.id },
      data: { endsAt: new Date(Date.now() - 1_000) },
    });

    expect(can(await resolveGrant(undergrad.id, lab.id), "animal:delete")).toBe(false);
  });

  it("ignores coverage that has not started yet", async () => {
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    const pi = await memberOf(lab.id, "PI", "Boss");
    const tech = await memberOf(lab.id, "TECHNICIAN", "Tech");

    await prisma.coverageAssignment.create({
      data: {
        labId: lab.id,
        ownerUserId: pi.id,
        coveringUserId: tech.id,
        startsAt: new Date(Date.now() + 86_400_000),
        reason: "Next week",
      },
    });

    expect(can(await resolveGrant(tech.id, lab.id), "member:manage")).toBe(false);
  });
});

describe("who may undo what", () => {
  const unreverted = { revertedAt: null };

  it("lets someone undo their own change but not a colleague's", async () => {
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    const tech = await memberOf(lab.id, "TECHNICIAN", "Tech");
    const grant = await resolveGrant(tech.id, lab.id);

    expect(
      canUndoChangeset(grant, { actorId: tech.id, ...unreverted }, tech.id).allowed,
    ).toBe(true);

    const other = canUndoChangeset(
      grant,
      { actorId: "someone-else", ...unreverted },
      tech.id,
    );
    expect(other.allowed).toBe(false);
    expect(other.reason).toMatch(/lab manager or PI/);
  });

  it("lets a lab manager undo anyone's change", async () => {
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    const manager = await memberOf(lab.id, "LAB_MANAGER", "Manager");
    const grant = await resolveGrant(manager.id, lab.id);

    expect(
      canUndoChangeset(grant, { actorId: "someone-else", ...unreverted }, manager.id)
        .allowed,
    ).toBe(true);
  });

  it("refuses to undo something already undone, whoever asks", async () => {
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    const pi = await memberOf(lab.id, "PI", "Boss");
    const grant = await resolveGrant(pi.id, lab.id);

    const result = canUndoChangeset(
      grant,
      { actorId: pi.id, revertedAt: new Date() },
      pi.id,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/already been undone/);
  });
});
