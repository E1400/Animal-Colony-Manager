import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCageByCode } from "@/lib/queries/views";
import { cageUrl, qrSvg } from "@/lib/qr";
import { PrintButton } from "@/components/print-button";
import { formatDate, humanize } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The physical cage card: what gets printed and taped to the cage.
 *
 * The QR encodes a URL rather than a bare cage code, so a phone's stock camera
 * opens this cage's record with nothing installed. The card prints the address
 * it was printed at *and* the date, because a card outlives the placement it
 * describes — a cage moves and the card is now wrong, which is exactly why the
 * database never trusts what is printed on it.
 */
export default async function CageCardPage({ params }: PageProps<"/cages/[code]/print">) {
  const { code } = await params;
  const data = await getCageByCode(decodeURIComponent(code));
  if (!data) notFound();

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = cageUrl(`${proto}://${host}`, data.cage.code);
  const svg = await qrSvg(url, 200);

  const { cage, address, rack, room, occupants } = data;

  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <Link
          href={`/cages/${encodeURIComponent(cage.code)}`}
          className="flex min-h-11 items-center rounded-xl border border-border px-3 text-sm font-medium hover:border-accent"
        >
          ← Back to cage
        </Link>
        <PrintButton />
      </div>

      <article className="print-card rounded-xl border-2 border-foreground bg-surface p-5">
        <header className="flex items-start justify-between gap-4 border-b-2 border-foreground pb-3">
          <div className="min-w-0">
            <h1 className="font-mono text-4xl font-bold leading-none">{cage.code}</h1>
            <p className="mt-2 text-xl">
              {address ? (
                <span className="font-mono font-semibold">{address}</span>
              ) : (
                <span className="italic">unplaced</span>
              )}
            </p>
            <p className="mt-1 text-sm">
              {room?.name}
              {rack ? ` · Rack ${rack.code}` : ""}
            </p>
          </div>
          <div
            className="shrink-0 [&>svg]:h-[110px] [&>svg]:w-[110px]"
            role="img"
            aria-label={`QR code linking to ${url}`}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </header>

        <section className="mt-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            Occupants ({occupants.length})
          </h2>
          {occupants.length === 0 ? (
            <p className="mt-1 text-sm italic">Empty</p>
          ) : (
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-1 pr-2 font-medium">Tag</th>
                  <th className="py-1 pr-2 font-medium">Sex</th>
                  <th className="py-1 pr-2 font-medium">Strain</th>
                  <th className="py-1 font-medium">Born</th>
                </tr>
              </thead>
              <tbody>
                {occupants.map((a) => {
                  const tag = a.identifiers.find((i) => i.isPrimary) ?? a.identifiers[0];
                  return (
                    <tr key={a.id} className="border-b border-border last:border-0">
                      <td className="py-1 pr-2 font-mono font-semibold">
                        {tag?.value ?? "—"}
                      </td>
                      <td className="py-1 pr-2">{humanize(a.sex)}</td>
                      <td className="py-1 pr-2">{a.strain?.commonName ?? "—"}</td>
                      <td className="py-1">{a.birthDate ? formatDate(a.birthDate) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <footer className="mt-4 flex items-end justify-between gap-4 border-t border-border pt-2 text-xs">
          <span>{cage.lab.name}</span>
          <span>
            Printed {formatDate(new Date())} — scan for the current record, which
            may differ from this card.
          </span>
        </footer>
      </article>
    </>
  );
}

