// src/app/scope-epoch.ts
//
// §548 — the SCOPE EPOCH: the one mechanism that stops a Graph/AI call which was
// already in flight when a project swap or backend change started from writing its
// result into the NEXT project.
//
// `useStorageBackend` owns the counter (beside `loadPending`, which it derives) and
// bumps it on every false->true transition of that signal — i.e. every time the
// in-scope workspace stops being the settled project of the current backend. A
// writer that awaits Graph or the AI captures the value through its
// `ScopeEpochReader` BEFORE its first await and calls `dropStaleScopeWrite` before it
// touches workspace state: a different value means the workspace it would write into
// is no longer the one it read from, so the write is DROPPED. Dropped, never queued —
// the auto-sync/auto-pull/recommendation runners regenerate on their next tick.
//
// ★ A bump happens when the scope stops being settled, so a write resolving DURING a
//   hold is already stale — the reader covers the brief's "or when `loadPending` is
//   true then" case without a second signal.
// ★ The reader is OPTIONAL at every consumer: a hook mounted outside the storage
//   hook's reach (unit tests, `tasks-section.tsx`'s own manual push/pull) passes
//   nothing and keeps its pre-§548 behaviour rather than dropping every write.
import { logDiag } from "./diagnostics";

/** Stable reader for the epoch `useStorageBackend` publishes as `getScopeEpoch`. */
export type ScopeEpochReader = () => number;

/**
 * True when the in-scope project is no longer the one `startEpoch` was captured in.
 * An absent reader or an absent start epoch is never stale — the caller opted out.
 */
export function isScopeStale(read: ScopeEpochReader | undefined, startEpoch: number | undefined): boolean {
  if (read === undefined || startEpoch === undefined) return false;
  return read() !== startEpoch;
}

/**
 * Guard for a write that resolves after an await. Returns true when the caller must
 * DROP the write, logging ONE `storage.staleScopeWriteDropped` diagnostic naming the
 * writer. No user-facing string: an invisible, correct drop is not an error.
 */
export function dropStaleScopeWrite(
  read: ScopeEpochReader | undefined,
  startEpoch: number | undefined,
  writer: string,
  fields?: Record<string, unknown>,
): boolean {
  if (!isScopeStale(read, startEpoch)) return false;
  logDiag("warn", "storage.staleScopeWriteDropped", { writer, ...fields });
  return true;
}
