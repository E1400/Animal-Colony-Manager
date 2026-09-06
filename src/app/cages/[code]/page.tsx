import Link from "next/link";
import { notFound } from "next/navigation";

import { getCageByCode } from "@/lib/queries/views";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  OccurredAt,
  PageHeader,
  formatDate,
  humanize,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CagePage({ params }: PageProps<"/cages/[code]">) {
  const { code } = await params;
  const data = await getCageByCode(decodeURIComponent(code));
  if (!data) notFound();

  const { cage, address, rack, room, since, occupants, events } = data;

  return (
    <>
      <PageHeader
        title={cage.code}
        subtitle={
          address ? (
            <>
              Slot <span className="font-mono font-medium">{address}</span>
              {rack ? ` · Rack ${rack.code}` : ""}
              {room ? ` · ${room.name}` : ""}
            </>
          ) : (
            "Not currently on a rack"
          )
        }
        action={
          <Link
            href={`/cages/${encodeURIComponent(cage.code)}/print`}
            className="no-print flex min-h-11 shrink-0 items-center rounded-xl border border-border px-3 text-sm font-medium hover:border-accent"
          >
            Cage card
          </Link>
        }
      />

      <Card>
        <dl className="divide-y divide-border">
          <Field label="Status" value={<Badge>{humanize(cage.status)}</Badge>} />
          <Field label="Animals" value={occupants.length} />
          {since ? <Field label="In this slot since" value={formatDate(since)} /> : null}
          {cage.cageType ? <Field label="Cage type" value={cage.cageType} /> : null}
          <Field label="Lab" value={cage.lab.name} />
        </dl>
      </Card>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold">Occupants</h2>
        {occupants.length === 0 ? (
          <EmptyState>This cage is empty right now.</EmptyState>
        ) : (
          <ul className="grid gap-2">
            {occupants.map((animal) => {
              const tag = animal.identifiers.find((i) => i.isPrimary) ?? animal.identifiers[0];
              const pending = animal.genotypes.filter((g) => g.result === "PENDING");
              return (
                <li key={animal.id}>
                  <Link
                    href={`/animals/${animal.id}`}
                    className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:border-accent"
                  >
                    <span className="min-w-0">
                      <span className="block text-lg font-semibold">
                        {tag ? (
                          <span className="font-mono">{tag.value}</span>
                        ) : (
                          <span className="text-muted">no tag</span>
                        )}
                      </span>
                      <span className="block truncate text-sm text-muted">
                        {humanize(animal.sex)}
                        {animal.strain?.commonName ? ` · ${animal.strain.commonName}` : ""}
                        {animal.birthDate ? ` · born ${formatDate(animal.birthDate)}` : ""}
                      </span>
                    </span>
                    {pending.length > 0 ? (
                      <Badge tone="warn">genotype pending</Badge>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold">Recent activity</h2>
        {events.length === 0 ? (
          <EmptyState>Nothing logged for this cage yet.</EmptyState>
        ) : (
          <ul className="grid gap-2">
            {events.map((event) => (
              <li
                key={event.id}
                className="rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{humanize(event.type)}</span>
                  <span className="text-sm text-muted">
                    <OccurredAt occurredAt={event.occurredAt} recordedAt={event.recordedAt} />
                  </span>
                </div>
                {event.notes ? (
                  <p className="mt-1 text-sm text-muted">{event.notes}</p>
                ) : null}
                {event.recordedBy?.name ? (
                  <p className="mt-1 text-xs text-muted">by {event.recordedBy.name}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
