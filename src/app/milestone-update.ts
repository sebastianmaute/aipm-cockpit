// src/app/milestone-update.ts — the one update path for an EXISTING milestone.
//
// Shared by the Milestones panel's editor save and the Gantt's milestone drag
// (§715 project D), so a date moved on the chart gets the same apply, the same
// per-field undo entry and the same activity-log row as one typed into the
// editor. Creating a milestone is NOT here: only the editor creates, and its id
// minting (`resolveEntitySave`) belongs to it.
import type { Dispatch, SetStateAction } from "react";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { captureFieldChanges } from "./undo/capture-field-changes";
import { MILESTONE_UNDO_GROUPS } from "./undo/field-groups";
import type { UndoStackApi } from "./undo/use-undo-stack";
import type { Milestone } from "./types";

export interface MilestoneUpdateDeps {
  setMilestones: Dispatch<SetStateAction<readonly Milestone[]>>;
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
}

/**
 * Replace `previous` with `next` (same id), push one undo entry per changed
 * field group, and log the change. `next` must already carry its fresh
 * `localModifiedAt`: the caller stamps, so the undo entry's `stampField` has a
 * real apply-time value to refresh (§289).
 */
export function commitMilestoneUpdate(
  previous: Milestone,
  next: Milestone,
  deps: MilestoneUpdateDeps,
  opts?: { suppressFieldUndo?: boolean },
): void {
  const { setMilestones, captureFieldEdit, logActivity, logActivityChanges } = deps;
  setMilestones((prev) => prev.map((m) => (m.id === next.id ? next : m)));
  if (!opts?.suppressFieldUndo) {
    captureFieldChanges(captureFieldEdit, {
      setter: setMilestones, kind: "milestone.updated", id: next.id,
      prev: previous, next, groups: MILESTONE_UNDO_GROUPS,
      // §289 names THREE paths, not two: the apply, this single-row capture,
      // and the panel's bulk capture. Omitting it here once the apply started
      // stamping would CREATE the §181 defect rather than close it — undo
      // would revert the content and leave the apply's fresh timestamp
      // standing, on a row whose content no longer matches it.
      // `changedFieldGroups` can never carry the field back (it is in
      // `NEVER_CAPTURE`), so `stampField` is the only thing that refreshes it.
      stampField: "localModifiedAt", name: next.name,
    });
  }
  if (logActivityChanges) {
    logActivityChanges("milestone.updated", diffFields(previous, next), next.id);
  } else {
    logActivity?.("milestone.updated", next.id);
  }
}

export type MilestoneMoveOutcome = "moved" | "unchanged" | "achieved" | "vanished";

/**
 * Move milestone `id` to `date` (YYYY-MM-DD) through `commitMilestoneUpdate`.
 * Reads `milestones` as the caller's live list. An achieved milestone is signed
 * off and does not move; a milestone a concurrent writer deleted reports
 * "vanished" so the caller can tell the user instead of dropping the move.
 */
export function moveMilestoneDate(
  milestones: readonly Milestone[],
  id: number,
  date: string,
  deps: MilestoneUpdateDeps,
  now: () => string = () => new Date().toISOString(),
): MilestoneMoveOutcome {
  const previous = milestones.find((m) => m.id === id);
  if (!previous) return "vanished";
  if (previous.achievedDate) return "achieved";
  if (previous.date === date) return "unchanged";
  commitMilestoneUpdate(previous, { ...previous, date, localModifiedAt: now() }, deps);
  return "moved";
}
