import Link from "next/link";
import { notFound } from "next/navigation";

import { getAnimal } from "@/lib/queries/views";
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

export default async function AnimalPage({ params }: PageProps<"/animals/[id]">) {
  const { id } = await params;
  const data = await getAnimal(id);
  if (!data) notFound();

  const { animal, currentCage, address, placements, events, status, terminalEvent } = data;
  const primary = animal.identifiers.find((i) => i.isPrimary && !i.retiredAt);
  const alive = status === "ALIVE";

  return (
    <>
      <PageHeader
        title={primary ? primary.value : "Untagged animal"}
        subtitle={
          <>
            {humanize(animal.sex)}
            {animal.strain?.commonName ? ` · ${animal.strain.commonName}` : ""}
            {animal.birthDate ? ` · born ${formatDate(animal.birthDate)}` : ""}
          </>
        }
        action={!alive ? <Badge tone="warn">{humanize(status)}</Badge> : null}
      />

      <Card>
        <dl className="divide-y divide-border">
          <Field
            label="Current cage"
            value={
              currentCage ? (
                <Link
                  href={`/cages/${encodeURIComponent(currentCage.code)}`}
                  className="font-mono underline underline-offset-4"
                >
                  {currentCage.code}
                </Link>
              ) : (
                <span className="text-muted">not housed</span>
              )
            }
          />
          <Field
            label="Rack slot"
            value={address ? <span className="font-mono">{address}</span> : <span className="text-muted">—</span>}
          />
          {animal.strain ? <Field label="Strain" value={animal.strain.name} /> : null}
          <Field label="Source" value={humanize(animal.source)} />
          {animal.birthDate ? (
            <Field
              label="Born"
              value={
                <>
                  {formatDate(animal.birthDate)}
                  {animal.birthDatePrecision !== "DAY" ? (
                    <span className="ml-2 text-sm text-muted">
                      ({animal.birthDatePrecision.toLowerCase()} precision)
                    </span>
                  ) : null}
                </>
              }
            />
          ) : null}
          {terminalEvent ? (
            <Field
              label={humanize(terminalEvent.type)}
              value={
                <OccurredAt
                  occurredAt={terminalEvent.occurredAt}
                  recordedAt={terminalEvent.recordedAt}
                />
              }
            />
          ) : null}
          {/* The system id is shown because it is the only identifier that is
              guaranteed stable — ear tags get reused and reassigned. */}
          <Field
            label="System ID"
            value={<span className="font-mono text-xs break-all">{animal.id}</span>}
          />
        </dl>
      </Card>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold">Identifiers</h2>
        <ul className="grid gap-2">
          {animal.identifiers.map((ident) => (
            <li
              key={ident.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <span>
                <span className="font-mono text-lg font-semibold">{ident.value}</span>
                <span className="ml-2 text-sm text-muted">
                  {humanize(ident.scheme)} · {ident.namespace}
                </span>
              </span>
              {ident.retiredAt ? (
                <Badge tone="warn">retired {formatDate(ident.retiredAt)}</Badge>
              ) : ident.isPrimary ? (
                <Badge tone="accent">primary</Badge>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {animal.genotypes.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">Genotype</h2>
          <ul className="grid gap-2">
            {animal.genotypes.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3"
              >
                <span>
                  <span className="font-medium">{g.locus}</span>
                  <span className="ml-2 text-sm text-muted">
                    expected {humanize(g.expected)}
                  </span>
                </span>
                <Badge tone={g.result === "PENDING" ? "warn" : "neutral"}>
                  {humanize(g.result)}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold">Where it has lived</h2>
        {placements.length === 0 ? (
          <EmptyState>No placement history.</EmptyState>
        ) : (
          <ol className="grid gap-2">
            {placements.map((p) => (
              <li
                key={p.id}
                className="rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    href={`/cages/${encodeURIComponent(p.cage.code)}`}
                    className="font-mono font-semibold underline underline-offset-4"
                  >
                    {p.cage.code}
                  </Link>
                  {p.endedAt === null ? (
                    <Badge tone="accent">current</Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted">
                  {formatDate(p.startedAt)} –{" "}
                  {p.endedAt ? formatDate(p.endedAt) : "present"} · {humanize(p.reason)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold">History</h2>
        {events.length === 0 ? (
          <EmptyState>Nothing logged for this animal yet.</EmptyState>
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
                {typeof (event.payload as { grams?: number })?.grams === "number" ? (
                  <p className="mt-1 text-sm text-muted">
                    {(event.payload as { grams: number }).grams} g
                  </p>
                ) : null}
                {event.notes ? (
                  <p className="mt-1 text-sm text-muted">{event.notes}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
