import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";

import { prisma } from "@/lib/db";

/**
 * Authentication: proving who someone is. Authorization — what they may do —
 * lives entirely in `src/lib/auth/permissions.ts` and is resolved from our own
 * Membership table. A GitHub identity never carries a role with it, and the
 * session deliberately does not contain one, so a stale or forged token cannot
 * grant access to anything.
 *
 * Sessions are stored in the database rather than in a JWT. Roles change, staff
 * leave, and coverage windows close; a self-contained token would keep working
 * until it expired. A database session can be revoked the moment it should be.
 */
const githubConfigured =
  !!process.env.AUTH_GITHUB_ID && !!process.env.AUTH_GITHUB_SECRET;

/**
 * A local-only sign-in used when no GitHub OAuth App is configured.
 *
 * It exists so the app is usable from a cold clone before anyone registers an
 * OAuth application, and so the role-scoped behaviour can be exercised as each
 * seeded persona. It refuses to load in production, and it never accepts a
 * password or creates an account — it only matches an email that is already a
 * seeded member of a lab.
 */
const devProviders =
  githubConfigured || process.env.NODE_ENV === "production"
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
  session: { strategy: githubConfigured ? "database" : "jwt" },
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
