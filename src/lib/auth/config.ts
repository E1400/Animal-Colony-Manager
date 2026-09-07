import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";

import { prisma } from "@/lib/db";
import type { Role } from "@/generated/prisma/client";

/**
 * Authentication: proving who someone is. Authorization — what they may do —
 * lives entirely in `src/lib/auth/permissions.ts` and is resolved from our own
 * Membership table. A GitHub identity never carries a role with it, and the
 * session deliberately does not contain one, so a stale or forged token cannot
 * grant access to anything.
 *
 * Production stores sessions in the database rather than in a JWT. Roles
 * change, staff leave, and coverage windows close; a self-contained token would
 * keep working until it expired, while a database session can be revoked the
 * moment it should be.
 *
 * Development falls back to JWT because Auth.js cannot issue a database session
 * for the Credentials provider — the seeded shortcut simply produces no session
 * under the database strategy, and fails silently while appearing to work.
 */
// Empty strings count as unset: a placeholder pasted into a dashboard is a
// very common way to end up "configured" with nothing behind it.
const githubConfigured =
  !!process.env.AUTH_GITHUB_ID?.trim() && !!process.env.AUTH_GITHUB_SECRET?.trim();

/**
 * Available in development regardless of whether GitHub is configured.
 *
 * Once real OAuth credentials sit in .env, requiring a round trip through
 * GitHub to click a button makes local work and automated browser tests
 * needlessly painful. Production is the line that matters, and this never
 * crosses it.
 */
const devSignInEnabled = process.env.NODE_ENV !== "production";

/**
 * A local-only sign-in used when no GitHub OAuth App is configured.
 *
 * It exists so the app is usable from a cold clone before anyone registers an
 * OAuth application, and so the role-scoped behaviour can be exercised as each
 * seeded persona. It refuses to load in production, and it never accepts a
 * password or creates an account — it only matches an email that is already a
 * seeded member of a lab.
 */
const devProviders = !devSignInEnabled
  ? []
  : [
        Credentials({
          id: "seeded-user",
          name: "Seeded lab member",
          credentials: { email: { label: "Email", type: "email" } },
          async authorize(credentials) {
            const email = String(credentials?.email ?? "").trim().toLowerCase();
            if (!email) return null;

            const user = await prisma.user.findFirst({
              where: { email, memberships: { some: {} } },
              select: { id: true, name: true, email: true, image: true },
            });
            return user ?? null;
          },
        }),
      ];

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: devSignInEnabled ? "jwt" : "database" },
  pages: { signIn: "/signin" },
  providers: [
    ...(githubConfigured
      ? [
          GitHub({
            clientId: process.env.AUTH_GITHUB_ID,
            clientSecret: process.env.AUTH_GITHUB_SECRET,
            allowDangerousEmailAccountLinking: false,
          }),
        ]
      : []),
    ...devProviders,
  ],
  events: {
    /**
     * Demo affordance, off unless DEMO_AUTO_MEMBERSHIP names a role.
     *
     * Without it, a brand-new GitHub identity has no membership anywhere, so
     * signing in leaves you exactly as powerless as being signed out — correct
     * for a real vivarium, useless for someone evaluating the app. When the
     * variable is set, a user with no membership at all is given that role in
     * the demo lab.
     *
     * Deliberately opt-in and deliberately not a privileged role: it lets a
     * visitor exercise the permission system, including being refused things,
     * without handing a stranger the ability to delete a colony. It never
     * touches a user who already has a membership, so it cannot quietly
     * escalate anyone.
     */
    async signIn({ user }) {
      const role = process.env.DEMO_AUTO_MEMBERSHIP?.trim();
      if (!role || !user.id) return;

      const existing = await prisma.membership.count({ where: { userId: user.id } });
      if (existing > 0) return;

      const lab = await prisma.lab.findFirst({ orderBy: { createdAt: "asc" } });
      if (!lab) return;

      await prisma.membership.create({
        data: { userId: user.id, labId: lab.id, role: role as Role },
      });
    },
  },
  callbacks: {
    async session({ session, user, token }) {
      // Surface the database user id, which is what every authorization lookup
      // keys on. Nothing role-shaped is added here on purpose.
      if (session.user) {
        session.user.id = user?.id ?? (token?.sub as string) ?? session.user.id;
      }
      return session;
    },
  },
});

export const isGithubConfigured = githubConfigured;

/**
 * Whether the local seeded-user sign-in is actually registered.
 *
 * Distinct from `!isGithubConfigured`: in production with no OAuth app, neither
 * provider exists and there is genuinely no way to sign in. The sign-in page
 * has to say that rather than offering a button wired to nothing.
 */
export const isDevSignInEnabled = devSignInEnabled;
