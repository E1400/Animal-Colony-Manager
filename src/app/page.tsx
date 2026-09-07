import Link from "next/link";

import { colonySummary } from "@/lib/queries/views";
import { Card, PageHeader, Stat } from "@/components/ui";
import { SearchBox } from "@/components/search-box";

// Colony data changes constantly; prerendering it at build time would ship a
// snapshot that is wrong before anyone opens it.
export const dynamic = "force-dynamic";

export default async function Home() {
  const summary = await colonySummary();

  return (
    <>
      <PageHeader
        title="Colony"
        subtitle={`${summary.animals} animals across ${summary.cages} cages, and where every one of them has been.`}
      />

      <SearchBox autoFocus={false} />

      <section aria-label="Colony at a glance" className="mt-5 grid grid-cols-2 gap-3">
        <Stat label="Animals housed" value={summary.animals} />
        <Stat label="Cages" value={summary.cages} />
        <Stat label="Genotypes pending" value={summary.pendingGenotypes} />
        <Stat label="Litters pre-wean" value={summary.littersInFlight} />
      </section>

      <nav aria-label="Shortcuts" className="mt-5 grid gap-3">
        <Link
          href="/cages"
          className="flex min-h-14 items-center justify-between rounded-xl border border-border bg-surface px-4 text-lg font-medium hover:border-accent"
        >
          Browse cages
          <span aria-hidden className="text-muted">
            →
          </span>
        </Link>
        <Link
          href="/search"
          className="flex min-h-14 items-center justify-between rounded-xl border border-border bg-surface px-4 text-lg font-medium hover:border-accent"
        >
          Find by ear tag or rack slot
          <span aria-hidden className="text-muted">
            →
          </span>
        </Link>
      </nav>

      <Card className="mt-5">
        <h2 className="text-base font-semibold">Nothing here is overwritten</h2>
        <p className="mt-2 text-base leading-relaxed text-muted">
          Moves, weights and health checks are recorded with the date they
          happened, so a cage can tell you who it holds now and who it held in
          June. Every entry says who made it, and any of them can be undone.
        </p>
      </Card>
    </>
  );
}
