// src/app/version-capture-format.ts
// Pure, DOM-free. A format marker stamped on a version-history capture payload,
// so a restore can tell "the user had none of these" from "this capture predates
// the slice and cannot speak about it".
//
// ★★★ WHY THIS EXISTS AT ALL — the two are otherwise INDISTINGUISHABLE, and the
// ambiguity is destructive in one direction and useless in the other.
// `workspaceToJson` omits an additive slice's key whenever the live array is
// empty, and `getVersionPayload` did not emit these six slices AT ALL until
// db217e08 (2026-08-25). So `{"tasks":[…]}` is byte-identical whether the user
// had zero knowledge items yesterday or the capture format simply could not
// carry them.
//   - Read as "genuinely empty", every live record diffs as `"added"` and
//     `applyRestore` deletes the lot. Real, permanent data loss.
//   - Read as "cannot speak", nothing is deleted — but a restore can then NEVER
//     remove a record added since the capture, for any of the six, forever. Safe
//     and silently useless.
// Neither is acceptable, and no amount of care inside the diff can separate
// them: the information is not in the payload. This marker puts it there.

/** Bumped when a capture starts carrying slices it previously could not. `1` is
 *  implied by ABSENCE of the marker: every capture written before db217e08. */
export const CAPTURE_FORMAT = 2;

/** ★★★ EXACTLY the six slices `db217e08` added to `getVersionPayload`, and the
 *  precision matters in BOTH directions.
 *  - Narrower than "every additive slice": the other additive keys (`project`,
 *    `steeringCommittee`, `timelogLinks`, …) were emitted all along, so for them
 *    an absent key has always meant "genuinely unset" and MUST stay revertible.
 *    Guarding them too would silently turn every revert-to-unset into a no-op.
 *  - Wider than the five ARRAYS: `settingsOverrides` is a SINGLETON and rode the
 *    same commit. Guarding only the arrays let a restore blank a project's
 *    timezone / notification / next-actions overrides.
 *  ★ Verify against the commit, never against this list's plausibility:
 *    `git show db217e08 -- src/app/task-manager.tsx | grep '^+'` */
export const PRE_FORMAT_2_BLIND_SLICES: ReadonlySet<string> = new Set([
  "knowledgeItems", "insights", "documents", "documentVersions",
  "settingsOverrides", "calendarEvents",
]);

/** Stamp a payload produced by `workspaceToJson`. ★ String surgery rather than
 *  parse/re-stringify: the payload is the largest string the app handles and
 *  this runs on every debounced capture. `workspaceToJson` ends in
 *  `JSON.stringify(obj, null, 2)` over an object whose first key is always
 *  `tasks`, so the output always opens `{\n  "`.
 *  ★ The guard is not defensive padding — it is what keeps this total. Anything
 *  not matching that shape (an empty object, a future formatter change) is
 *  returned UNCHANGED, which downgrades it to a format-1 capture: the safe
 *  reading, and the one this module's absence already means. */
export function stampCaptureFormat(json: string): string {
  if (!json.startsWith('{\n  "')) return json;
  return `{\n  "captureFormat": ${CAPTURE_FORMAT},\n` + json.slice(2);
}

/** The stamped format, or `null` for an unstamped (pre-db217e08) capture.
 *  ★ A full `JSON.parse` rather than a regex over the head: every caller is
 *  about to hand the same string to `jsonToWorkspace`, which parses it anyway,
 *  so this is not the hot path — and a regex would silently read `1` out of a
 *  payload whose keys a future writer reordered. A malformed payload yields
 *  `null`, the safe reading; the caller's own strict parse reports it. */
export function readCaptureFormat(json: string): number | null {
  try {
    const raw: unknown = JSON.parse(json);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const v = (raw as Record<string, unknown>).captureFormat;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Whether a capture at this format can be trusted to say a slice was EMPTY by
 *  omitting its key — i.e. whether an absent key means "none" rather than
 *  "cannot speak". ★ `>=`, not `===`: a payload written by a NEWER build (a
 *  second tab mid-upgrade, a shared Turso project) carries a higher number and
 *  still speaks for all six. Reading that as "cannot speak" is safe but wrong. */
export function speaksForEmptySlices(format: number | null): boolean {
  return format !== null && format >= CAPTURE_FORMAT;
}
