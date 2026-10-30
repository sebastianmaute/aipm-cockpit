// src/app/workload-triage-handlers.ts
//
// The Resources workload triage handlers, extracted from task-manager.tsx's
// `workspaceProps` (§491, sixteenth step). Reassign and reschedule come from
// the overdue-task popover (#24); clear-unlinked drops an unlinked owner string
// from every record that carries it. A plain builder, not a hook: nothing here
// calls a hook, so it takes the live render-scope values in a typed `deps`
// object and returns fresh, non-memoized handlers each render, exactly as the
// inline arrows were. Move-only at extraction; since §774 reassign goes through
// the shared reassign step, so it also moves the task's planned hours and is undoable.
//
// ★ The handlers themselves know nothing about popouts: task-manager wraps each
// one in its `guardEdit` through `workloadPaneProps` below, which also carries
// §769's reassign step and undo stack to the pane. Its test pins that all three
// are wrapped.
//
// ★ Coverage-GATED on purpose: clear-unlinked deletes records, and its arming
// rule is real logic. `workload-triage-handlers.test.ts` pins it, and
// `destructive-save-arming.ui.test.ts` scans this file for the arm.
import type { Dispatch, SetStateAction } from "react";
import { resourceDisplayName } from "./resource-foundation";
import type { Absence, RaidItem, Resource, Shift, Task } from "./types";
import type { ReassignHours } from "./use-reassign-hours";
import type { makeEditGuard } from "./read-only-guard";
import type { UndoStackApi } from "./undo/use-undo-stack";

/** The identity of an unlinked workload row, as `ResourceWorkload` hands it over. */
export interface UnlinkedWorkloadRow {
  display: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface WorkloadTriageDeps {
  absences: readonly Absence[];
  shifts: readonly Shift[];
  setTasks: Dispatch<SetStateAction<readonly Task[]>>;
  setRaid: Dispatch<SetStateAction<readonly RaidItem[]>>;
  setAbsences: Dispatch<SetStateAction<readonly Absence[]>>;
  setShifts: Dispatch<SetStateAction<readonly Shift[]>>;
  allowDestructiveSave: (() => void) | undefined;
  /** §774 — the reassign writes the owner AND moves the planned hours, as one undo entry. */
  reassignTasks: ReassignHours["reassignTasks"];
}

export function buildWorkloadTriageHandlers({
  absences,
  shifts,
  setTasks,
  setRaid,
  setAbsences,
  setShifts,
  allowDestructiveSave,
  reassignTasks,
}: WorkloadTriageDeps) {
  // Reassign copies the resource's identity onto the task through the shared
  // reassign step (§774), which writes with a functional setter so bulk edits
  // from the popover compose, and moves the task's planned hours with it.
  const onReassignTask = (taskId: number, resource: Resource | null) =>
    reassignTasks([{
      taskId,
      assignee: resource ? resourceDisplayName(resource) : "",
      assigneeEmail: resource?.email ?? "",
      resourceId: resource?.id ?? undefined,
    }], "user");

  const onRescheduleTask = (taskId: number, iso: string) =>
    setTasks((prev) => prev.map((tk) => (tk.id === taskId ? { ...tk, dueDate: iso } : tk)));

  // Clear an unlinked workload row (an owner string matching NO resource, so a
  // name/email string match can't hit a managed resource's record; a task
  // linked by resourceId keeps that link — we only touch the free-text field).
  // Tasks + RAID support an empty assignee/owner, so they are UNASSIGNED and
  // kept. Absences + shifts REQUIRE an assignee (sanitizeAbsence/sanitizeShift
  // drop an empty one on reload — an "unassigned absence" isn't representable),
  // so the stray records are REMOVED outright.
  const onClearUnlinked = (row: UnlinkedWorkloadRow) => {
    const name = row.display.trim().toLowerCase();
    const email = row.email.trim().toLowerCase();
    const matchName = (s: string | undefined | null) => !!name && !!s && s.trim().toLowerCase() === name;
    const matchEmail = (e: string | undefined | null) => !!email && !!e && e.trim().toLowerCase() === email;
    // ★ Whether anything is REMOVED, decided from the live arrays before any
    // setter runs — never inside an updater, which React may invoke twice.
    // The task/raid writes below are field EDITS (they map), so they remove
    // no record and must not count; only the two filters do. `absences` and
    // `shifts` are both COUNTED slices and this route drops an UNBOUNDED
    // number of their rows on one confirm, so it can trip the save-time
    // mass-deletion guard on its own — hence the one-shot bypass, armed only
    // when a row genuinely went (arming on a no-op leaks it to a later save).
    const removesAbsence = absences.some((a) => matchName(a.assignee));
    const removesShift = shifts.some((s) => matchName(s.assignee));
    setTasks((prev) => prev.map((tk) =>
      matchName(tk.assignee) || matchEmail(tk.assigneeEmail) ? { ...tk, assignee: "", assigneeEmail: "" } : tk));
    setRaid((prev) => prev.map((r) => matchName(r.owner) ? { ...r, owner: "" } : r));
    setAbsences((prev) => prev.filter((a) => !matchName(a.assignee)));
    setShifts((prev) => prev.filter((s) => !matchName(s.assignee)));
    if (removesAbsence || removesShift) allowDestructiveSave?.();
  };

  return { onReassignTask, onRescheduleTask, onClearUnlinked };
}

/** The Resources pane's workload props: each triage handler behind the popout guard, plus §774's reassign step and
 *  the undo stack Plan with AI records its ONE entry on (§769), the same stack as every other edit. */
export function workloadPaneProps(
  triage: ReturnType<typeof buildWorkloadTriageHandlers>,
  guardEdit: ReturnType<typeof makeEditGuard>,
  reassignTasks: ReassignHours["reassignTasks"],
  captureComposite: UndoStackApi["captureComposite"],
) {
  return {
    onReassignTask: guardEdit(triage.onReassignTask),
    onRescheduleTask: guardEdit(triage.onRescheduleTask),
    onClearUnlinked: guardEdit(triage.onClearUnlinked),
    onReassignTasks: reassignTasks,
    onCaptureComposite: captureComposite,
  };
}
