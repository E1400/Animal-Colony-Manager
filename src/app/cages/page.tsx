import Link from "next/link";

import { listCages } from "@/lib/queries/views";
import { EmptyState, PageHeader } from "@/components/ui";
import { SearchBox } from "@/components/search-box";

export const dynamic = "force-dynamic";

export default async function CagesPage({ searchParams }: PageProps<"/cages">) {
  const { q } = await searchParams;
  const search = typeof q === "string" ? q : undefined;
  const cages = await listCages({ search });

  return (
    <>
      <PageHeader
        title="Cages"
        subtitle={`${cages.length} cage${cages.length === 1 ? "" : "s"}${search ? ` matching “${search}”` : ""}`}
      />

      <SearchBox defaultValue={search ?? ""} />

      {cages.length === 0 ? (
        <div className="mt-5">
          <EmptyState>No cages match that.</EmptyState>
        </div>
      ) : (
        <ul className="mt-5 grid gap-2">
          {cages.map((cage) => (
            <li key={cage.id}>
              <Link
                href={`/cages/${encodeURIComponent(cage.code)}`}
                className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:border-accent"
              >
                <span className="min-w-0">
                  <span className="block font-mono text-lg font-semibold">
                    {cage.code}
                  </span>
                  <span className="block text-sm text-muted">
                    {cage.address ? `Slot ${cage.address}` : "Not on a rack"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-2xl font-semibold tabular-nums">
                    {cage.occupantCount}
                  </span>
                  <span className="block text-xs text-muted">
                    {cage.occupantCount === 1 ? "animal" : "animals"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
