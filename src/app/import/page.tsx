import Link from "next/link";

import { getCurrentActor } from "@/lib/actor";
import { resolveGrant } from "@/lib/auth/grants";
import { can } from "@/lib/auth/permissions";
import { listSamples } from "@/app/import/actions";
import { Card, PageHeader } from "@/components/ui";
import { ImportWizard } from "@/components/import/import-wizard";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const actor = await getCurrentActor();
  const grant = actor?.labId ? await resolveGrant(actor.id, actor.labId) : null;
  const allowed = grant ? can(grant, "import:run") : false;
  const samples = await listSamples();

  return (
    <>
      <PageHeader
        title="Import"
        subtitle="Upload a spreadsheet and check every row before importing."
      />

      {!allowed ? (
        <Card>
          <h2 className="text-base font-semibold">
            {actor ? "Your role cannot run imports" : "Sign in to import"}
          </h2>
          <p className="mt-2 text-base leading-relaxed text-muted">
            {actor
              ? "Importing can create and overwrite hundreds of records at once, so it is limited to lab managers, PIs, researchers and technicians."
              : "Importing writes to the colony, so it needs an account with a role in this lab."}
          </p>
          {!actor ? (
            <Link
              href="/signin"
              className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-accent px-4 font-semibold text-accent-contrast"
            >
              Sign in
            </Link>
          ) : null}
        </Card>
      ) : (
        <ImportWizard samples={samples} />
      )}
    </>
  );
}
