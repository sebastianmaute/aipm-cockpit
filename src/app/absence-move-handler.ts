// Builds the Resources → Calendar drag-move/resize/reassign handler (R5 S2).
// Extracted from task-manager.tsx so the wiring — route through the SAME
// save path a modal edit uses, capture exactly one undo entry covering every
// field the resolved gesture touched — is unit-testable without rendering
// the whole shell.
//
// `handleSaveAbsence` (use-resource-planner.ts) itself captures no undo, by
// design: a manual modal edit stays undo-free, unchanged by this feature.
// Capture happens HERE instead, via ONE `captureFieldEdit` call per gesture
// (not the multi-group `captureFieldChanges` a modal-style multi-field save
// would use, which can split one save into several entries) — a drag is far
// easier to trigger by accident than a deliberate typed edit, and the user
// won't remember the pre-drag dates to redo it by hand.
import type { Dispatch, SetStateAction } from "react";
import { pick } from "./undo/field-groups";
import type { Absence } from "./types";
import type { UndoStackApi } from "./undo/use-undo-stack";

export function buildMoveAbsenceHandler(
  absences: readonly Absence[],
  setAbsences: Dispatch<SetStateAction<readonly Absence[]>>,
  captureFieldEdit: UndoStackApi["captureFieldEdit"],
  handleSaveAbsence: (next: Absence) => void,
): (id: number, patch: Partial<Absence>) => void {
  return (id, patch) => {
    const target = absences.find((a) => a.id === id);
    if (!target) return; // stale id (e.g. deleted mid-drag) — no-op, nothing to save or undo.
    const keys = Object.keys(patch) as (keyof Absence & string)[];
    captureFieldEdit({
      setter: setAbsences,
      kind: "absence.updated",
      id,
      before: pick(target, keys),
      after: patch,
      stampField: "localModifiedAt",
      name: target.assignee,
    });
    // The actual write goes through handleSaveAbsence — not a raw setAbsences
    // call — so a drag never becomes a second way to persist an absence: it
    // stamps localModifiedAt and logs absence.updated exactly as a manual
    // modal save would.
    handleSaveAbsence({ ...target, ...patch });
  };
}
