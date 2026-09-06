import { beforeEach, describe, expect, it } from "vitest";

import { getCurrentActor, requireActor } from "@/lib/actor";
import { prisma } from "@/lib/db";

import { makeFixture, resetDb } from "./helpers";

beforeEach(resetDb);

describe("resolving the acting user", () => {
  it("returns null on an empty database instead of throwing", async () => {
    // A freshly deployed, unseeded database is a normal state. Read-only pages
    // have to render in it — this threw once, and /activity returned a 500 on
    // the first production deploy because of it.
    await expect(getCurrentActor()).resolves.toBeNull();
  });

  it("still refuses to attribute a write when there is nobody", async () => {
    await expect(requireActor()).rejects.toThrow(/no user account/i);
  });

  it("resolves the lab manager and their lab once seeded", async () => {
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    const user = await prisma.user.create({
      data: { name: "Manager", email: `mgr-${Date.now()}@example.edu` },
    });
    await prisma.membership.create({
      data: { userId: user.id, labId: lab.id, role: "LAB_MANAGER" },
    });

    const actor = await getCurrentActor();
    expect(actor).toMatchObject({ id: user.id, labId: lab.id });
  });
});
