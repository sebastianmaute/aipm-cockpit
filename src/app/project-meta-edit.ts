// src/app/project-meta-edit.ts — §715: what one project-record edit changed, the `project.updated` row both
// writers log for it, and the undo fragment that reverts Claude's edit.
//
// ★ Owner decision B: the project form and Claude both LOG; only Claude's edit is UNDOABLE. A form save takes no
// undo entry at all.
//
// ★★ The activity log belongs to the project open NOW, so each writer logs only once its write resolved true AND
// the scope epoch did not move during the write — otherwise the row would land in another project's log.
//
// ★★ The undo fragment writes THROUGH the project writer, never a `setProject`: in Turso multi-project mode the
// record lives in the projects table, which the workspace save does not write (use-project-tools.ts says why).
// The writer is async while an undo runner is synchronous, so the fragment starts the write and TRACKS it (§759):
// the stack says "Undone"/"Redone" only once it is stored, puts the entry back on a failure (rolling back any array
// fragment of the same composite), and drops a finish that lands after a project switch (docs/AGENTS/undo.md).
import type { LogActivityAsFn } from "./activity-log-context";
import { logDiag } from "./diagnostics";
import { dropStaleScopeWrite, type ScopeEpochReader } from "./scope-epoch";
import type { ProjectMeta } from "./types";
import { mergeFieldValue } from "./undo/merge-field-value";
import type { CompositeFragment } from "./undo/use-undo-stack";

/** The project form's writer: resolves true once the record is stored, false after its own error toast. */
export type ProjectWriter = (meta: ProjectMeta) => Promise<boolean>;

/** A blank optional field reads the same whether it is absent, `""` or an empty list: the form fills blanks a
 *  stored record may omit, and that is not a change. */
function comparable(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value) && value.length === 0) return "";
  return JSON.stringify(value);
}

/** The keys whose values differ, in the record's own key order (`before`'s, then keys only `next` has). */
export function changedProjectFields(before: ProjectMeta, next: ProjectMeta): (keyof ProjectMeta)[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(next)])] as (keyof ProjectMeta)[];
  return keys.filter((k) => comparable(before[k]) !== comparable(next[k]));
}

/** The one activity row for a project-record edit: the changed keys joined by ", " (model-independent field keys,
 *  rendered through `activityProjectUpdated`). Nothing is logged when nothing changed. */
export function logProjectUpdate(
  logActivityAs: LogActivityAsFn | undefined,
  actor: "user" | "ai",
  fields: readonly (keyof ProjectMeta)[],
): void {
  if (fields.length > 0) logActivityAs?.(actor, "project.updated", fields.join(", "));
}

/** The project form's save: write, then log as the user only when the write stored the record in the project
 *  still open. Not undoable (owner decision B). */
export async function saveProjectFromForm(args: {
  write: ProjectWriter;
  before: ProjectMeta | undefined;
  next: ProjectMeta;
  getScopeEpoch: ScopeEpochReader;
  logActivityAs?: LogActivityAsFn;
}): Promise<void> {
  const { write, before, next, getScopeEpoch, logActivityAs } = args;
  const startEpoch = getScopeEpoch();
  const written = await write(next);
  if (dropStaleScopeWrite(getScopeEpoch, startEpoch, "project.formSave")) return;
  if (!written || !before) return;
  logProjectUpdate(logActivityAs, "user", changedProjectFields(before, next));
}

/** Claude's edit as ONE undo fragment. Undo moves each changed field toward its BEFORE value on the live record,
 *  redo toward its NEXT value; every other field keeps its live value, so a form edit made since survives.
 *  ★★ Each changed field is a THREE-WAY merge (`mergeFieldValue`), not a whole-value revert: a form save is not
 *  undoable, so Claude's entry can still be on top after the user edited the same list, and writing `before` whole
 *  would drop that edit (Claude adds GDPR, the form adds NIS2, undo must keep NIS2). With no race the result is
 *  exactly the target value; a scalar the form changed since is still set to the target (the helper's last rule).
 *  ★ A failure is reported, never swallowed: a writer that resolves false has already shown its own error toast,
 *  and this adds the diagnostic; one that throws (outside its contract) is logged and shown through `onThrow`.
 *  ★ §759 — each write is TRACKED, so the stack says "Undone"/"Redone" only once it is stored; a failed one leaves
 *  the entry where it was (rolling back any array fragment of the same composite), and the error above is the only
 *  message. See `docs/AGENTS/undo.md` "The runners". */
export function projectUndoFragment(args: {
  getWriter: () => ProjectWriter | null;
  getLive: () => ProjectMeta | null;
  before: ProjectMeta;
  next: ProjectMeta;
  fields: readonly (keyof ProjectMeta)[];
  onThrow: (err: unknown) => void;
}): CompositeFragment {
  const { getWriter, getLive, before, next, fields, onThrow } = args;
  const apply = (target: ProjectMeta, other: ProjectMeta, direction: "undo" | "redo"): Promise<boolean> => {
    const live = getLive() ?? target;
    const meta: ProjectMeta = { ...live };
    for (const f of fields) (meta as Record<string, unknown>)[f] = mergeFieldValue(target[f], other[f], live[f]);
    const fail = (err?: unknown) => {
      const message = err === undefined ? "not stored" : err instanceof Error ? err.message : String(err);
      logDiag("error", "undo.projectRestoreFailed", { direction, message });
      if (err !== undefined) onThrow(err);
      return false;
    };
    const write = getWriter();
    if (write === null) return Promise.resolve(fail(new Error("no project writer")));
    return write(meta).then((ok) => ok || fail(), (err: unknown) => fail(err));
  };
  return {
    isPrimary: false,
    followsPrimary: false, // a single record, no id a re-mint could move
    // ★ The write runs FIRST, then is handed over: `track?.(apply(…))` would skip the write itself with no tracker.
    restore: (_remap, _isPrimary, _arm, track) => {
      const undone = apply(before, next, "undo");
      track?.(undone);
      return (trackRedo) => {
        const redone = apply(next, before, "redo");
        trackRedo?.(redone);
      };
    },
  };
}
