// src/app/scope-epoch.ts
//
// §548 — the SCOPE EPOCH: the one mechanism that stops a Graph/AI call which was
// already in flight when a project swap or backend change started from writing its
// result into the NEXT project.
//
// `useStorageBackend` owns the counter (`scopeEpochRef`, beside `scopeTargetKeyRef`)
// and publishes the reader as `getScopeEpoch`. A writer that awaits Graph or the AI
// captures the value through its `ScopeEpochReader` BEFORE its first await and calls
// `dropStaleScopeWrite` before it touches workspace state: a different value means the
// workspace it would write into is no longer the one it read from, so the write is
// DROPPED. Dropped, never queued — the auto-sync / auto-pull / recommendation runners
// regenerate on their next tick.
//
// ★★★ IT MEANS "A DIFFERENT PROJECT", NOT "A LOAD IS HAPPENING", and this header said
//   the wrong one for a release: the first cut bumped on every false->true transition
//   of `loadPending`, which also fires for a same-target reload, a held op the user
//   CANCELLED at the OS file picker, and a same-target rebuild — dropping results that
//   would have landed in the RIGHT project (for `useCommitteeOutlookPush` that costs a
//   permanent orphan AND a duplicate event). There are now exactly THREE bump sites,
//   all in `useStorageBackend` / `useStorageFilePickerOps`, each synchronous and
//   immediately BEFORE the replacement it announces:
//     (a) `resolveLogModeAndStamp` returning "replace" — §591's own merge/replace rule,
//         so there is no second copy of it (the load effect and `reloadCurrentProject`);
//     (b) `applyWorkspaceForOp` — the wrapper the two project-op hooks receive as their
//         `applyWorkspace` dep, covering switchToProject / createProject /
//         loadProjectFromFile / createDemoProject / switchToTursoProject /
//         createTursoProject. NOT redundant with (a): `storageTargetKey` keys `browser`
//         and every `local-*` kind on the KIND ALONE (§591 ruling 3);
//     (c) `onOpenStorageFile`'s ACCEPT branch, which replaces tasks+raid through raw
//         setters and so reaches neither (a) nor (b).
//   A failed load, the empty-load refusal, `onPickStorageFile` and
//   `migrateCurrentProjectToTurso` apply nothing of another project's and never bump.
//
// ★★★ THE EPOCH DOES NOT REPLACE EACH WRITER'S `!loadPending` START GATE — the two are
//   a JOINT guarantee and removing either re-opens §548. The epoch closes the
//   RESOLUTION side: a call that started before the swap and resolves after it. The
//   start gate closes the other side: between a bump and React's commit the epoch
//   already reads NEW while the OUTGOING project is still in render scope, so a writer
//   that STARTED there would capture the new value against old data and write after the
//   commit — a real misattribution the epoch alone cannot see. It cannot happen because
//   `loadPending` is committed-TRUE at the instant of every bump ((b)/(c) run inside
//   `holdDuring`; (a)'s "replace" requires `targetKey` to have moved, so
//   `backend !== settledBackend`), and every writer's START is gated on it — the four
//   `<entity>AutoSyncActive` flags and `useCalendarAutoPull`'s `enabled`
//   (`use-calendar-integrations.ts`), `useInsightRecommendRunner`'s `enabled` plus
//   `applyInsightRecommendation`'s own early return (`use-insight-recommendations.ts`),
//   and the `PanelSkeleton` render hold for every manual control.
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
