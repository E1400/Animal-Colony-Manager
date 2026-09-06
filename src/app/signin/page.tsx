import { redirect } from "next/navigation";

import { auth, isGithubConfigured, signIn } from "@/lib/auth/config";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { humanize } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  // Only used by the local sign-in below, and only when there is no OAuth app.
  const seeded = isGithubConfigured
    ? []
    : await prisma.user.findMany({
        where: { memberships: { some: {} } },
        select: {
          email: true,
          name: true,
          memberships: { select: { role: true }, take: 1 },
        },
        orderBy: { name: "asc" },
        take: 8,
      });

  return (
    <>
      <PageHeader
        title="Sign in"
        subtitle="Identity comes from GitHub. What you can do comes from your role in this lab."
      />

      {isGithubConfigured ? (
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="flex min-h-14 w-full items-center justify-center rounded-xl bg-accent px-4 text-lg font-semibold text-accent-contrast"
          >
            Continue with GitHub
          </button>
        </form>
      ) : (
        <Card>
          <h2 className="text-base font-semibold">Local sign-in</h2>
          <p className="mt-2 text-base leading-relaxed text-muted">
            No GitHub OAuth app is configured, so this deployment falls back to
            picking a seeded lab member. This exists so the app works from a cold
            clone and so each role can be tried out; it refuses to load in
            production and never creates an account.
          </p>

          {seeded.length === 0 ? (
            <p className="mt-3 text-base text-warn">
              No seeded users found. Run <code className="font-mono">npm run db:seed</code>{" "}
              first.
            </p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {seeded.map((user) => (
                <li key={user.email}>
                  <form
                    action={async () => {
                      "use server";
                      await signIn("seeded-user", {
                        email: user.email,
                        redirectTo: "/",
                      });
                    }}
                  >
                    <button
                      type="submit"
                      className="flex min-h-14 w-full items-center justify-between rounded-xl border border-border px-4 text-left hover:border-accent"
                    >
                      <span className="font-medium">{user.name}</span>
                      <span className="text-sm text-muted">
                        {user.memberships[0]
                          ? humanize(user.memberships[0].role)
                          : "no role"}
                      </span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
