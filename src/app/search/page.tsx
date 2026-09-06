import Link from "next/link";

import { searchColony } from "@/lib/queries/views";
import { EmptyState, PageHeader } from "@/components/ui";
import { SearchBox } from "@/components/search-box";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const hits = query ? await searchColony(query) : [];

  return (
    <>
      <PageHeader
        title="Search"
        subtitle="Type what is printed in front of you — a cage code, a rack slot, or an ear tag."
      />

      <SearchBox defaultValue={query} autoFocus={!query} />

      <div className="mt-5">
        {!query ? null : hits.length === 0 ? (
          <EmptyState>
            Nothing matches “{query}”. Ear tags are matched only against
            identifiers that are still active.
          </EmptyState>
        ) : (
          <ul className="grid gap-2">
            {hits.map((hit) => (
              <li key={hit.kind === "cage" ? `c-${hit.code}` : `a-${hit.id}`}>
                <Link
                  href={
                    hit.kind === "cage"
                      ? `/cages/${encodeURIComponent(hit.code)}`
                      : `/animals/${hit.id}`
                  }
                  className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:border-accent"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-lg font-semibold">
                      {hit.label}
                    </span>
                    <span className="block text-sm text-muted">{hit.detail}</span>
                  </span>
                  <span aria-hidden className="shrink-0 text-muted">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
