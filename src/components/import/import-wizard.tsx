"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";

import {
  analyzeSample,
  analyzeUpload,
  commitUpload,
  replan,
  type AnalyzeResult,
  type SerializableRow,
} from "@/app/import/actions";
import { FIELD_LABELS, IMPORT_FIELDS, type ImportField, type Mapping } from "@/lib/import/mapping";
import type { DateOrder } from "@/lib/import/normalize";
import type { Sheet } from "@/lib/import/parse";

type Analysis = Extract<AnalyzeResult, { ok: true }>;

type Filter = "all" | "problems" | "new" | "rejected";

const STATUS_STYLE: Record<string, { rail: string; chip: string; label: string }> = {
  CREATED: { rail: "bg-accent", chip: "bg-accent/15 text-accent", label: "new" },
  UPDATED: { rail: "bg-sky-500", chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400", label: "update" },
  FLAGGED: { rail: "bg-warn", chip: "bg-warn/15 text-warn", label: "check" },
  ERROR: { rail: "bg-rose-500", chip: "bg-rose-500/15 text-rose-600 dark:text-rose-400", label: "rejected" },
  SKIPPED_BLANK: { rail: "bg-border", chip: "bg-surface-muted text-muted", label: "blank" },
  SKIPPED_DUPLICATE: { rail: "bg-border", chip: "bg-surface-muted text-muted", label: "duplicate" },
};

export function ImportWizard({ samples }: { samples: Array<{ name: string; description: string }> }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [dateOrder, setDateOrder] = useState<DateOrder | "">("");
  const [done, setDone] = useState<{ batchId: string; counts: Record<string, number> } | null>(null);
  const [busy, startTransition] = useTransition();

  function apply(result: AnalyzeResult, keepName?: string) {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setAnalysis((prev) => ({
      ...result,
      filename: result.filename || keepName || prev?.filename || "",
      sourceFormat: result.sourceFormat || prev?.sourceFormat || "csv",
    }));
  }

  function remap(field: ImportField, header: string) {
    if (!analysis) return;
    const mapping: Mapping = { ...analysis.mapping };
    // A header can only feed one field; claiming it releases it elsewhere.
    for (const key of Object.keys(mapping) as ImportField[]) {
      if (mapping[key] === header) delete mapping[key];
    }
    if (header) mapping[field] = header;
    else delete mapping[field];

    startTransition(async () => {
      apply(await replan(analysis.sheet, mapping, dateOrder || undefined), analysis.filename);
    });
  }

  function changeDateOrder(order: DateOrder | "") {
    setDateOrder(order);
    if (!analysis) return;
    startTransition(async () => {
      apply(await replan(analysis.sheet, analysis.mapping, order || undefined), analysis.filename);
    });
  }

  const visible = useMemo(() => {
    if (!analysis) return [];
    return analysis.rows.filter((r) => {
      if (filter === "all") return r.status !== "SKIPPED_BLANK";
      if (filter === "problems") return r.issues.some((i) => i.level !== "info");
      if (filter === "new") {
        return r.status === "CREATED" || r.status === "FLAGGED" || r.status === "UPDATED";
      }
      return r.status === "ERROR";
    });
  }, [analysis, filter]);

  if (done) {
    return <Finished counts={done.counts} onAgain={() => { setDone(null); setAnalysis(null); }} />;
  }

  if (!analysis) {
    return (
      <Upload
        samples={samples}
        busy={busy}
        error={error}
        onFile={(form) => startTransition(async () => apply(await analyzeUpload(form)))}
        onSample={(name) => startTransition(async () => apply(await analyzeSample(name), name))}
      />
    );
  }

  const importable =
    (analysis.counts.CREATED ?? 0) + (analysis.counts.FLAGGED ?? 0) + (analysis.counts.UPDATED ?? 0);
  const mappedHeaders = new Set(Object.values(analysis.mapping));

  return (
    <div>
      <SummaryBar
        analysis={analysis}
        filter={filter}
        onFilter={setFilter}
        dateOrder={dateOrder}
        onDateOrder={changeDateOrder}
        busy={busy}
      />

      {analysis.duplicateOfBatchId ? (
        <p className="mt-4 rounded-xl bg-warn/15 px-4 py-3 text-warn">
          This exact sheet has been imported before. Committing it again would change
          nothing, so it is blocked.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 rounded-xl bg-rose-500/15 px-4 py-3 text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}

      <Grid
        sheet={analysis.sheet}
        mapping={analysis.mapping}
        rows={visible}
        mappedHeaders={mappedHeaders}
        onRemap={remap}
        busy={busy}
      />

      <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {importable} row{importable === 1 ? "" : "s"} will be written.
            {analysis.counts.ERROR ? ` ${analysis.counts.ERROR} rejected and recorded.` : ""}
            {analysis.newCageCodes.length
              ? ` ${analysis.newCageCodes.length} cage${analysis.newCageCodes.length === 1 ? "" : "s"} created.`
              : ""}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAnalysis(null)}
              className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold"
            >
              Start over
            </button>
            <button
              type="button"
              disabled={busy || importable === 0 || !!analysis.duplicateOfBatchId}
              onClick={() =>
                startTransition(async () => {
                  const res = await commitUpload(
                    analysis.sheet,
                    analysis.mapping,
                    analysis.filename,
                    analysis.sourceFormat,
                    dateOrder || undefined,
                  );
                  if (res.ok) setDone({ batchId: res.batchId, counts: res.counts });
                  else setError(res.error);
                })
              }
              className="min-h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-contrast disabled:opacity-50"
            >
              {busy ? "Working…" : `Import ${importable} rows`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Upload({
  samples,
  busy,
  error,
  onFile,
  onSample,
}: {
  samples: Array<{ name: string; description: string }>;
  busy: boolean;
  error: string | null;
  onFile: (form: FormData) => void;
  onSample: (name: string) => void;
}) {
  const [dragging, setDragging] = useState(false);

  function send(file: File) {
    const form = new FormData();
    form.set("file", file);
    onFile(form);
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) send(file);
        }}
        className={`flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? "border-accent bg-accent/5" : "border-border bg-surface"
        }`}
      >
        <input
          type="file"
          accept=".csv,.xlsx,.txt"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) send(file);
          }}
        />
        <span className="text-lg font-semibold">
          {busy ? "Reading the sheet…" : "Drop a spreadsheet here"}
        </span>
        <span className="mt-1 text-sm text-muted">
          CSV or XLSX, up to 8 MB. Nothing is written until you review it.
        </span>
      </label>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl bg-rose-500/15 px-4 py-3 text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-base font-semibold">Or try one of the awkward ones</h2>
        <p className="mt-1 text-sm text-muted">
          These are the fixtures the importer is tested against.
        </p>
        <ul className="mt-3 grid gap-2">
          {samples.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onSample(s.name)}
                className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left hover:border-accent disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block font-mono text-sm font-semibold">{s.name}</span>
                  <span className="block text-sm text-muted">{s.description}</span>
                </span>
                <span aria-hidden className="shrink-0 text-muted">→</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SummaryBar({
  analysis,
  filter,
  onFilter,
  dateOrder,
  onDateOrder,
  busy,
}: {
  analysis: Analysis;
  filter: Filter;
  onFilter: (f: Filter) => void;
  dateOrder: DateOrder | "";
  onDateOrder: (o: DateOrder | "") => void;
  busy: boolean;
}) {
  const c = analysis.counts;
  const problems = analysis.rows.filter((r) => r.issues.some((i) => i.level !== "info")).length;

  const tabs: Array<{ id: Filter; label: string; count: number }> = [
    { id: "all", label: "All rows", count: analysis.rows.length - (c.SKIPPED_BLANK ?? 0) },
    {
      id: "new",
      label: "Will import",
      count: (c.CREATED ?? 0) + (c.FLAGGED ?? 0) + (c.UPDATED ?? 0),
    },
    { id: "problems", label: "Needs a look", count: problems },
    { id: "rejected", label: "Rejected", count: c.ERROR ?? 0 },
  ];

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold">{analysis.filename}</p>
          <p className="mt-0.5 text-sm text-muted">
            Header on row {analysis.sheet.headerRow}
            {analysis.sheet.preambleRows > 0
              ? `, ${analysis.sheet.preambleRows} row${analysis.sheet.preambleRows === 1 ? "" : "s"} of preamble skipped`
              : ""}
            {c.SKIPPED_BLANK ? `, ${c.SKIPPED_BLANK} blank` : ""}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Dates read as</span>
          <select
            value={dateOrder}
            disabled={busy}
            onChange={(e) => onDateOrder(e.target.value as DateOrder | "")}
            className="min-h-11 rounded-lg border border-border bg-surface px-2"
          >
            <option value="">Guess (warn if unclear)</option>
            <option value="MDY">Month / day / year</option>
            <option value="DMY">Day / month / year</option>
          </select>
        </label>
      </div>

      <div className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onFilter(tab.id)}
            aria-pressed={filter === tab.id}
            className={`flex min-h-12 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 text-sm font-medium transition-colors ${
              filter === tab.id
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs tabular-nums">
              {tab.count}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The sheet, shown as a sheet.
 *
 * Column headers double as the mapping control, so correcting a mis-guessed
 * column happens over the data it affects rather than in a separate form —
 * the row-level consequences update underneath as soon as it changes.
 */
function Grid({
  sheet,
  mapping,
  rows,
  mappedHeaders,
  onRemap,
  busy,
}: {
  sheet: Sheet;
  mapping: Mapping;
  rows: SerializableRow[];
  mappedHeaders: Set<string | undefined>;
  onRemap: (field: ImportField, header: string) => void;
  busy: boolean;
}) {
  const fieldFor = (header: string): ImportField | "" => {
    const hit = (Object.keys(mapping) as ImportField[]).find((f) => mapping[f] === header);
    return hit ?? "";
  };

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-20 bg-surface-muted">
          <tr>
            {/* The verdict travels with the row number and stays pinned, so
                scrolling right to read a column never hides what the row is
                actually going to do. */}
            <th className="sticky left-0 z-30 w-28 border-b border-border bg-surface-muted px-2 py-2 text-left text-xs font-semibold">
              Row
            </th>
            {sheet.headers.map((header) => {
              const mapped = mappedHeaders.has(header);
              return (
                <th
                  key={header}
                  className={`min-w-40 border-b border-l border-border px-2 py-2 text-left align-top ${
                    mapped ? "" : "opacity-60"
                  }`}
                >
                  <span className="block truncate font-semibold" title={header}>
                    {header}
                  </span>
                  <select
                    value={fieldFor(header)}
                    disabled={busy}
                    onChange={(e) => onRemap(e.target.value as ImportField, header)}
                    aria-label={`Map column ${header}`}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-1 py-1 text-xs"
                  >
                    <option value="">— not imported —</option>
                    {IMPORT_FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {FIELD_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const style = STATUS_STYLE[row.status] ?? STATUS_STYLE.SKIPPED_BLANK;
            const notable = row.issues.filter((i) => i.level !== "info");
            return (
              <Fragment key={row.rowNumber}>
                <tr className="group hover:bg-surface-muted/60">
                  <td className="sticky left-0 z-10 border-b border-border bg-surface px-2 py-1.5 group-hover:bg-surface-muted">
                    <span className={`absolute inset-y-0 left-0 w-1 ${style.rail}`} aria-hidden />
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted">{row.rowNumber}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${style.chip}`}>
                        {style.label}
                      </span>
                    </span>
                  </td>
                  {sheet.headers.map((header) => (
                    <td
                      key={header}
                      className="max-w-64 truncate border-b border-l border-border px-2 py-1.5 font-mono text-xs"
                      title={row.raw[header]}
                    >
                      {row.raw[header] || <span className="text-muted">—</span>}
                    </td>
                  ))}
                </tr>
                {notable.length > 0 ? (
                  <tr className="bg-surface-muted/40">
                    <td className="sticky left-0 z-10 border-b border-border bg-surface-muted/40" />
                    <td
                      colSpan={sheet.headers.length}
                      className="border-b border-l border-border px-2 py-1.5"
                    >
                      {/* The spanning cell is as wide as the table, which is
                          wider than the screen. Pinning the text to the left
                          edge keeps a reason readable without scrolling to it. */}
                      <ul className="sticky left-28 max-w-[calc(100vw-10rem)] space-y-0.5">
                        {notable.map((issue, i) => (
                          <li
                            key={i}
                            className={`text-xs ${
                              issue.level === "error"
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-warn"
                            }`}
                          >
                            <span className="font-semibold">{issue.field}:</span> {issue.message}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={sheet.headers.length + 1} className="px-4 py-8 text-center text-muted">
                Nothing in this view.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function Finished({
  counts,
  onAgain,
}: {
  counts: Record<string, number>;
  onAgain: () => void;
}) {
  const created = (counts.CREATED ?? 0) + (counts.FLAGGED ?? 0);
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-xl font-semibold">Imported</h2>
      <p className="mt-2 text-base text-muted">
        {created} animal{created === 1 ? "" : "s"} created
        {counts.UPDATED ? `, ${counts.UPDATED} updated` : ""}
        {counts.ERROR ? `, ${counts.ERROR} rejected and recorded` : ""}.
      </p>
      <p className="mt-2 text-base text-muted">
        This landed as a single entry in the activity log, so it can be undone in one
        action if it turns out to be wrong.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href="/activity"
          className="flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-contrast"
        >
          See it in the activity log
        </Link>
        <Link
          href="/cages"
          className="flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-semibold"
        >
          Browse cages
        </Link>
        <button
          type="button"
          onClick={onAgain}
          className="flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-semibold"
        >
          Import another
        </button>
      </div>
    </div>
  );
}
