// src/app/activity-log-merge.ts
//
// Pure, i18n-free, DOM-free. Reconciles two activity logs that were appended
// independently — the multi-device case created by promoting the log to
// workspace data (before, each device kept its own localStorage copy and there
// was nothing to collide).
//
// ★★ This NARROWS the lose-window; it does not close it. An entry appended on
// device A between device B's load and B's save is still lost. Closing it fully
// needs append-level writes, which the meta-blob shape cannot express. Accepted
// deliberately — do not record this as solved.
// ★ ACTIVITY_MAX_ENTRIES is imported, NOT redeclared. `activity-log.ts` already
// holds it — two declarations of the same cap drift the moment one is changed,
// and the merge and the append path disagreeing about the cap is silent
// history loss.
import { ACTIVITY_MAX_ENTRIES, type ActivityEntry } from "./activity-log";

export { ACTIVITY_MAX_ENTRIES };

/**
 * Union by `id`, sorted by `timestamp` ascending, capped to the newest
 * ACTIVITY_MAX_ENTRIES. `b` wins on a duplicate id — arbitrary but total, and
 * duplicate ids carry identical payloads by construction (the id encodes the
 * minting device and its counter).
 *
 * ALWAYS returns a new array: the workspace dirty check is reference equality
 * (`prev.activityLog !== next.activityLog`), so returning an input unchanged
 * would silently skip the save.
 */
export function mergeActivityLogs(
  a: readonly ActivityEntry[] | undefined,
  b: readonly ActivityEntry[] | undefined,
): ActivityEntry[] {
  const byId = new Map<string, ActivityEntry>();
  for (const e of a ?? []) byId.set(e.id, e);
  for (const e of b ?? []) byId.set(e.id, e);
  const all = [...byId.values()].sort((x, y) => (x.timestamp < y.timestamp ? -1 : x.timestamp > y.timestamp ? 1 : 0));
  return all.length > ACTIVITY_MAX_ENTRIES ? all.slice(-ACTIVITY_MAX_ENTRIES) : all;
}
