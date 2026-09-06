import { beforeEach, describe, expect, it, vi } from "vitest";

// next-auth pulls in Next's server runtime, which does not resolve under the
// Vitest node environment. The session is the only thing we need from it, so
// it is mocked here and driven per test.
const mockAuth = vi.fn<() => Promise<{ user?: { id: string } } | null>>();
vi.mock("@/lib/auth/config", () => ({
  auth: () => mockAuth(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
  isGithubConfigured: false,
}));

const { getCurrentActor, requireActor } = await import("@/lib/actor");
const { prisma } = await import("@/lib/db");
const { makeFixture, resetDb } = await import("./helpers");

beforeEach(async () => {
  await resetDb();
  mockAuth.mockReset();
});

describe("resolving the acting user", () => {
  it("returns null when nobody is signed in", async () => {
    // A signed-out visitor is an ordinary state: read-only pages must render.
    // This threw once, and /activity returned a 500 on the first production
    // deploy because of it.
    mockAuth.mockResolvedValue(null);
    await expect(getCurrentActor()).resolves.toBeNull();
  });

  it("returns null when the session names a user that no longer exists", async () => {
    mockAuth.mockResolvedValue({ user: { id: "00000000-0000-4000-8000-000000000000" } });
    await expect(getCurrentActor()).resolves.toBeNull();
  });

  it("refuses to attribute a write with no session", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(requireActor()).rejects.toThrow(/signed in/i);
  });

  it("resolves the signed-in user and their lab", async () => {
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    const user = await prisma.user.create({
      data: { name: "Manager", email: `mgr-${Date.now()}@example.edu` },
    });
    await prisma.membership.create({
      data: { userId: user.id, labId: lab.id, role: "LAB_MANAGER" },
    });

    mockAuth.mockResolvedValue({ user: { id: user.id } });
    await expect(getCurrentActor()).resolves.toMatchObject({
      id: user.id,
      labId: lab.id,
    });
  });

  it("resolves a signed-in user who has no lab membership yet", async () => {
    // A brand-new GitHub account that nobody has added to a lab should see an
    // empty colony, not an error.
    const user = await prisma.user.create({
      data: { name: "Newcomer", email: `new-${Date.now()}@example.edu` },
    });
    mockAuth.mockResolvedValue({ user: { id: user.id } });

    await expect(getCurrentActor()).resolves.toMatchObject({
      id: user.id,
      labId: null,
    });
  });
});
