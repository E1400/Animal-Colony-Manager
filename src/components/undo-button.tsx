"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { undoChangeset } from "@/app/activity/actions";

/**
 * The undo a tired person can find.
 *
 * Two taps, not one: undo is itself a write that other people will see, so it
 * asks once. But the confirmation says exactly what will be undone rather than
 * "Are you sure?", because the thing that makes people hesitate is not knowing
 * what the button will do.
 */
export function UndoButton({
  changesetId,
  summary,
  disabledReason,
}: {
  changesetId: string;
  summary: string;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (disabledReason) {
    return (
      <span className="text-sm text-muted" title={disabledReason}>
        {disabledReason}
      </span>
    );
  }

  if (result) {
    return <span className="text-sm text-accent">{result}</span>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-11 shrink-0 rounded-xl border border-border px-4 text-sm font-semibold hover:border-accent"
      >
        Undo
      </button>
    );
  }

  return (
    <div className="w-full">
      <p className="text-sm text-muted">
        Undo <span className="font-medium text-foreground">{summary}</span>? This is
        recorded in the log and can be seen by the rest of the lab.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await undoChangeset(changesetId);
              if (res.ok) {
                setResult(res.message);
                router.refresh();
              } else {
                setError(res.error);
                setConfirming(false);
              }
            });
          }}
          className="min-h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-contrast disabled:opacity-60"
        >
          {isPending ? "Undoing…" : "Yes, undo it"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setConfirming(false)}
          className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold"
        >
          Keep it
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
