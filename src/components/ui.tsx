import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-base text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface p-4 ${className}`}
    >
      {children}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-sm text-muted">{label}</div>
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn";
}) {
  const tones = {
    neutral: "bg-surface-muted text-muted",
    accent: "bg-accent text-accent-contrast",
    warn: "bg-warn/15 text-warn",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-sm font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted">
      {children}
    </div>
  );
}

/** Definition row used on the cage card and animal detail. */
export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{value}</dd>
    </div>
  );
}

/**
 * Dates are shown with both what happened and when it was written down
 * whenever those differ by more than a day — the gap is real information, and
 * hiding it is how a colony's history quietly becomes wrong.
 */
export function OccurredAt({
  occurredAt,
  recordedAt,
}: {
  occurredAt: Date;
  recordedAt?: Date | null;
}) {
  const lateBy =
    recordedAt != null
      ? Math.floor((recordedAt.getTime() - occurredAt.getTime()) / 86_400_000)
      : 0;

  return (
    <span className="whitespace-nowrap">
      <time dateTime={occurredAt.toISOString()}>{formatDate(occurredAt)}</time>
      {lateBy >= 1 ? (
        <span className="ml-1.5 text-warn" title={`Recorded ${formatDate(recordedAt!)}`}>
          (logged {lateBy}d later)
        </span>
      ) : null}
    </span>
  );
}

export function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function humanize(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
}
