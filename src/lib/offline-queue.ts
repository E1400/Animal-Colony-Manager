/**
 * A small write queue for work done at a rack with no signal.
 *
 * The scope is deliberately narrow: the handful of actions someone performs
 * standing in front of a cage, where the alternative to queueing is a spinner
 * that fails and an entry that never gets written down. Anything structural —
 * moving animals between cages, weaning a litter — is not queued, because
 * merging those offline is a genuine distributed-systems problem and getting
 * it subtly wrong corrupts the colony's history. Those still require a
 * connection and say so.
 *
 * Each entry carries the timestamp of the tap. Syncing an hour later must
 * record that it happened an hour ago, which the schema can express because
 * occurred_at and recorded_at are separate columns.
 *
 * Exposed as an external store rather than component state so React can
 * subscribe with useSyncExternalStore: localStorage cannot be read during
 * server rendering, and this keeps the server and first client render
 * agreeing on an empty queue instead of hydrating mismatched markup.
 */

const KEY = "colony.pending-writes.v1";

export type QueuedWrite =
  | { id: string; kind: "cage_change"; code: string; occurredAt: string }
  | { id: string; kind: "health_check"; code: string; notes: string; occurredAt: string };

/** Stable empty reference — getSnapshot must not return a fresh array. */
const EMPTY: QueuedWrite[] = [];

let cache: QueuedWrite[] | null = null;
const listeners = new Set<() => void>();

/** Every access is guarded: Safari private mode throws on localStorage. */
function readStorage(): QueuedWrite[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedWrite[]) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function writeStorage(items: QueuedWrite[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage unavailable or full. The caller has already surfaced the
    // failure to the user; silently dropping is better than throwing here.
  }
  cache = items;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): QueuedWrite[] {
  if (cache === null) cache = readStorage();
  return cache;
}

/** The server has no queue; rendering one would break hydration. */
export function getServerSnapshot(): QueuedWrite[] {
  return EMPTY;
}

export function enqueue(item: QueuedWrite): void {
  writeStorage([...getSnapshot(), item]);
}

export function dequeue(id: string): void {
  writeStorage(getSnapshot().filter((i) => i.id !== id));
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

/**
 * Attempts each queued write in order, removing the ones that succeed.
 *
 * A write that fails stops the run rather than skipping ahead: order matters
 * within a cage, and draining past a failure risks applying later work on top
 * of earlier work that never landed.
 */
export async function flushQueue(
  send: (item: QueuedWrite) => Promise<{ ok: boolean }>,
): Promise<{ sent: number; remaining: number }> {
  let sent = 0;
  for (const item of getSnapshot()) {
    try {
      const result = await send(item);
      if (!result.ok) break;
      dequeue(item.id);
      sent++;
    } catch {
      break;
    }
  }
  return { sent, remaining: getSnapshot().length };
}
