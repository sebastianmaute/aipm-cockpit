"use client";

import { useRef, useState } from "react";
import { usePopoverDismiss } from "./use-popover-dismiss";
import { type Lang, t } from "./i18n";
import { resourceDisplayName } from "./resource-foundation";
import type { Resource, Task } from "./types";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";

interface Props {
  lang: Lang;
  /** The resource whose overdue tasks these are (for row-unique labels). */
  rowDisplay: string;
  overdueTasks: readonly Task[];
  resources: readonly Resource[];
  /** Reassign a task to a resource (null = unassign). Functional setter upstream. */
  onReassignTask: (taskId: number, resource: Resource | null) => void;
  /** Reschedule a task's due date (ISO YYYY-MM-DD). */
  onRescheduleTask: (taskId: number, iso: string) => void;
}

/**
 * Inline triage for a workload row's overdue tasks (#24): the overdue count is
 * a popover trigger; each task can be reassigned (resource select) or
 * rescheduled (date input) in place, turning the old soft dead-end into an
 * actionable surface. Reuses `usePopoverDismiss` (Escape / outside-click).
 */
export function WorkloadOverdueTriage({
  lang,
  rowDisplay,
  overdueTasks,
  resources,
  onReassignTask,
  onRescheduleTask,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  usePopoverDismiss(open, wrapRef, () => setOpen(false));
  const count = overdueTasks.length;

  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t(lang, "workloadTriageOverdue")} – ${rowDisplay}`}
        className={`rounded-md border border-transparent px-2 py-0.5 font-medium tabular-nums text-AIPM-pink-strong hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
      >
        {count}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${t(lang, "workloadTriageOverdue")} – ${rowDisplay}`}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 z-40 mt-1 w-80 rounded-md border border-line bg-surface p-2 text-left shadow-[var(--shadow-card)]"
        >
          <p className="px-1 pb-1 text-xs font-semibold text-muted-foreground">
            {t(lang, "workloadTriageHeading")}
          </p>
          <ul className="flex max-h-72 flex-col gap-2 overflow-auto">
            {overdueTasks.map((task) => (
              <li key={task.id} className="rounded-md border border-line p-2">
                <p className="mb-1 truncate text-sm font-medium text-foreground" title={task.taskName}>
                  {task.taskName}
                </p>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-16 shrink-0">{t(lang, "workloadTriageReassign")}</span>
                    <select
                      value={task.resourceId ?? ""}
                      aria-label={`${t(lang, "workloadTriageReassign")} – ${task.taskName}`}
                      onChange={(e) => {
                        const v = e.target.value;
                        onReassignTask(
                          task.id,
                          v === "" ? null : resources.find((r) => r.id === Number(v)) ?? null,
                        );
                      }}
                      className={`min-w-0 flex-1 rounded border border-line bg-surface px-1 py-0.5 text-xs text-foreground ${FOCUS_RING} ${TRANSITION}`}
                    >
                      <option value="">{t(lang, "workloadTriageUnassigned")}</option>
                      {resources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {resourceDisplayName(r)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-16 shrink-0">{t(lang, "workloadTriageReschedule")}</span>
                    <input
                      type="date"
                      defaultValue={task.dueDate ?? ""}
                      aria-label={`${t(lang, "workloadTriageReschedule")} – ${task.taskName}`}
                      onChange={(e) => {
                        if (e.target.value) onRescheduleTask(task.id, e.target.value);
                      }}
                      className={`min-w-0 flex-1 rounded border border-line bg-surface px-1 py-0.5 text-xs text-foreground ${FOCUS_RING} ${TRANSITION}`}
                    />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
