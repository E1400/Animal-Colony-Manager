"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";

import { logCageChange, logHealthCheck } from "@/app/cages/[code]/actions";
import {
  dequeue,
  enqueue,
  flushQueue,
  getServerSnapshot,
  getSnapshot,
  newId,
  subscribe,
  type QueuedWrite,
} from "@/lib/offline-queue";

/**
 * The actions someone performs standing at the rack, one thumb, gloves on.
 *
 * "Cage changed" is a single tap with no confirmation step — a dialog is what
 * makes people stop logging and reconstruct the week badly on Friday. Anything
 * that failed to reach the server is queued and shown as pending, so a dead
 * WiFi patch behind a rack is never a silent loss.
 */
export function CageActions({ code }: { code: string }) {
  const router = useRouter();
  const pending = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  const send = useCallback(async (item: QueuedWrite) => {
    if (item.kind === "cage_change") {
      return logCageChange(item.code, item.occurredAt);
    }
    return logHealthCheck(item.code, item.notes, item.occurredAt);
  }, []);

  const drain = useCallback(async () => {
    if (getSnapshot().length === 0) return;
    const { sent, remaining } = await flushQueue(send);
    if (sent > 0) {
      setStatus(`Synced ${sent} pending ${sent === 1 ? "entry" : "entries"}.`);
      router.refresh();
    }
    if (remaining > 0) setError(`${remaining} still waiting for a connection.`);
  }, [router, send]);

  useEffect(() => {
    window.addEventListener("online", drain);
    // Deferred rather than awaited inline: flushing is a network round trip
    // and should not sit between mount and first paint.
    const timer = setTimeout(() => void drain(), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", drain);
    };
  }, [drain]);

  async function run(item: QueuedWrite) {
    setStatus(null);
    setError(null);

    // Queue first, then attempt. If the tab dies mid-request the entry
    // survives; a write that exists only in flight is a write that can vanish.
    enqueue(item);

    try {
      const result = await send(item);
      dequeue(item.id);
      if (result.ok) {
        setStatus(result.message);
        startTransition(() => router.refresh());
      } else {
        setError(result.error);
      }
    } catch {
      // Network failure: leave it queued and say so plainly.
      setError("Saved on this phone. Waiting to sync.");
    }
  }

  return (
    <section className="no-print mt-6" aria-label="Quick actions">
      <h2 className="mb-2 text-lg font-semibold">Log</h2>

      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          void run({
            id: newId(),
            kind: "cage_change",
            code,
            occurredAt: new Date().toISOString(),
          })
        }
        className="flex min-h-14 w-full items-center justify-center rounded-xl bg-accent px-4 text-lg font-semibold text-accent-contrast disabled:opacity-60"
      >
        Log a cage change
      </button>

      <div className="mt-3 flex gap-2">
        <label htmlFor="health-note" className="sr-only">
          Health check note
        </label>
        <input
          id="health-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Health check note"
          className="min-h-14 min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 text-base placeholder:text-muted"
        />
        <button
          type="button"
          disabled={isPending || note.trim() === ""}
          onClick={() => {
            const notes = note.trim();
            if (!notes) return;
            setNote("");
            void run({
              id: newId(),
              kind: "health_check",
              code,
              notes,
              occurredAt: new Date().toISOString(),
            });
          }}
          className="min-h-14 rounded-xl border border-border px-4 font-semibold disabled:opacity-50"
        >
          Save
        </button>
      </div>

      <div aria-live="polite" className="mt-3 space-y-2 text-base">
        {status ? <p className="text-accent">{status}</p> : null}
        {error ? <p className="text-warn">{error}</p> : null}
        {pending.length > 0 ? (
          <p className="rounded-xl bg-warn/15 px-4 py-3 text-warn">
            {pending.length} waiting to sync
          </p>
        ) : null}
      </div>
    </section>
  );
}
