// src/app/workload-triage-handlers.ts
//
// The Resources workload triage handlers, extracted from task-manager.tsx's
// `workspaceProps` (§491, sixteenth step). Reassign and reschedule come from
// the overdue-task popover (#24); clear-unlinked drops an unlinked owner string
// from every record that carries it. A plain builder, not a hook: nothing here
// calls a hook, so it takes the live render-scope values in a typed `deps`
// object and returns fresh, non-memoized handlers each render, exactly as the
// inline arrows were. Move-only: no behaviour change.
//
// ★ task-manager still wraps each handler in `guardEdit` at the call site, so
// the popout read-only guard stays where `task-manager.popout-guard.test.tsx`
// expects it; nothing here knows about popouts.
//
// ★ Coverage-GATED on purpose: clear-unlinked deletes records, and its arming
// rule is real logic. `workload-triage-handlers.test.ts` pins it, and
// `destructive-save-arming.ui.test.ts` scans this file for the arm.
import type { Dispatch, SetStateAction } from "react";
import { resourceDisplayName } from "./resource-foundation";
import type { Absence, RaidItem, Resource, Shift, Task } from "./types";

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
}

export function buildWorkloadTriageHandlers({
  absences,
  shifts,
  setTasks,
  setRaid,
  setAbsences,
  setShifts,
  allowDestructiveSave,
}: WorkloadTriageDeps) {
  // Functional setter so bulk edits from the popover compose; reassign copies
  // the resource's identity onto the task.
  const onReassignTask = (taskId: number, resource: Resource | null) =>
    setTasks((prev) =>
      prev.map((tk) =>
        tk.id === taskId
          ? {
              ...tk,
              assignee: resource ? resourceDisplayName(resource) : "",
              assigneeEmail: resource?.email ?? "",
              resourceId: resource?.id ?? undefined,
            }
          : tk,
      ),
    );

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
