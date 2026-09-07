"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { undoChangeset } from "@/app/activity/actions";

/**
 * The undo a tired person can find.
 *
 * Two taps, not one: undo is itself a write other people will see, so it asks
 * once. The confirmation names the change rather than saying "Are you sure?",
 * because what makes people hesitate is not knowing what the button will do.
 *
 * It occupies its own full-width row rather than sitting in the card's
 * right-hand controls. The confirmation is a sentence, and a sentence inside a
 * `shrink-0` column overflows and lands on top of the summary text beside it.
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

  if (result) {
    return <p className="mt-2 text-sm text-accent">{result}</p>;
  }

  if (disabledReason) {
    return <p className="mt-2 text-sm text-muted">{disabledReason}</p>;
  }

  if (!confirming) {
    return (
      <div className="mt-2 flex justify-end">
        {error ? (
          <p role="alert" className="mr-auto self-center text-sm text-warn">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold hover:border-accent"
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-sm text-muted">
        Undo <span className="font-medium text-foreground">{summary}</span>? This is
        recorded in the log and can be seen by the rest of the lab.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
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
    </div>
  );
}
