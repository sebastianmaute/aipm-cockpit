"use client";

// Inline editor for a task's predecessor dependencies inside the task modal.
//
// Renders the current dependencies as removable chips, plus a small add-row
// (type select + task select + Add button). The add-row's task dropdown
// filters out:
//   • The task being edited itself
//   • Tasks already referenced as predecessors of this task
//   • Tasks whose own dependency chain reaches back to this task (cycle prevention)
//
// All sanitization happens upstream — this component only emits valid
// `TaskDependency[]` arrays to the parent via `onChange`.

import { useMemo, useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { Select } from "./form-controls";
import { wouldCreateDependencyCycle } from "./sanitize";
import {
  DEPENDENCY_TYPES,
  type DependencyType,
  type Task,
  type TaskDependency,
} from "./types";

export function DependenciesEditor({
  lang,
  value,
  allTasks,
  ownTaskId,
  onChange,
}: {
  lang: Lang;
  value: TaskDependency[];
  /** Snapshot of all tasks; used to populate the predecessor dropdown and
   *  validate cycles. */
  allTasks: readonly Task[];
  /** Id of the task being edited; null when creating a new task (no cycles
   *  are possible yet). */
  ownTaskId: number | null;
  onChange: (next: TaskDependency[]) => void;
}) {
  const [pendingType, setPendingType] = useState<DependencyType>("FS");
  const [pendingTaskId, setPendingTaskId] = useState<number | "">("");

  const taskById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const t of allTasks) m.set(t.id, t);
    return m;
  }, [allTasks]);

  const referencedIds = useMemo(
    () => new Set(value.map((d) => d.taskId)),
    [value],
  );

  const eligibleTasks = useMemo(() => {
    return allTasks.filter((task) => {
      if (ownTaskId !== null && task.id === ownTaskId) return false;
      if (referencedIds.has(task.id)) return false;
      // Cycle check is only meaningful when editing an existing task.
      if (
        ownTaskId !== null &&
        wouldCreateDependencyCycle(ownTaskId, task.id, taskById)
      ) {
        return false;
      }
      return true;
    });
  }, [allTasks, ownTaskId, referencedIds, taskById]);

  function add() {
    if (pendingTaskId === "") return;
    const tid = pendingTaskId;
    if (
      ownTaskId !== null &&
      wouldCreateDependencyCycle(ownTaskId, tid, taskById)
    ) {
      // Defensive: shouldn't be reachable because eligibleTasks already
      // filters cycles, but guard against state races.
      return;
    }
    if (referencedIds.has(tid)) return;
    onChange([...value, { taskId: tid, type: pendingType }]);
    setPendingTaskId("");
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((dep, i) => {
            const task = taskById.get(dep.taskId);
            const label = task
              ? `${dep.type} · #${task.id} ${task.taskName}`
              : `${dep.type} · #${dep.taskId} (${t(lang, "depMissing")})`;
            return (
              <li key={`${dep.taskId}-${dep.type}-${i}`}>
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-ui-dark-blue/10 px-2 py-0.5 text-xs font-medium text-ui-dark-blue dark:bg-ui-dark-blue/30 dark:text-ui-light-grey"
                  title={t(lang, depTypeHelpKey(dep.type))}
                >
                  <span className="font-mono">{dep.type}</span>
                  <span className="opacity-70">·</span>
                  <span className="max-w-[18ch] truncate" title={label}>
                    #{dep.taskId}{" "}
                    {task ? task.taskName : `(${t(lang, "depMissing")})`}
                  </span>
                  <IconButton
                    variant="danger"
                    onClick={() => remove(i)}
                    label={t(lang, "depRemove")}
                    title={t(lang, "depRemove")}
                    className="ml-0.5"
                  >
                    <XMarkIcon aria-hidden="true" className="h-3 w-3" />
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          size="xs"
          value={pendingType}
          onChange={(e) =>
            setPendingType(e.target.value as DependencyType)
          }
          aria-label={t(lang, "depType")}
          className="font-mono"
        >
          {DEPENDENCY_TYPES.map((dt) => (
            <option key={dt} value={dt}>
              {dt} — {t(lang, depTypeShortKey(dt))}
            </option>
          ))}
        </Select>
        <Select
          size="xs"
          value={pendingTaskId === "" ? "" : String(pendingTaskId)}
          onChange={(e) =>
            setPendingTaskId(e.target.value === "" ? "" : Number(e.target.value))
          }
          aria-label={t(lang, "depPickTask")}
          className="min-w-[12rem] flex-1"
        >
          <option value="">{t(lang, "depPickTaskPlaceholder")}</option>
          {eligibleTasks.map((task) => (
            <option key={task.id} value={task.id}>
              #{task.id} — {task.taskName}
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={add} disabled={pendingTaskId === ""}>
          {t(lang, "depAdd")}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t(lang, "depHelp")}
      </p>
    </div>
  );
}

/** Translation key for a one-word friendly name of each dependency type. */
function depTypeShortKey(
  t: DependencyType,
):
  | "depTypeFsShort"
  | "depTypeSsShort"
  | "depTypeFfShort"
  | "depTypeSfShort" {
  switch (t) {
    case "FS":
      return "depTypeFsShort";
    case "SS":
      return "depTypeSsShort";
    case "FF":
      return "depTypeFfShort";
    case "SF":
      return "depTypeSfShort";
  }
}

/** Translation key for the long explanatory tooltip. */
function depTypeHelpKey(
  t: DependencyType,
): "depTypeFsHelp" | "depTypeSsHelp" | "depTypeFfHelp" | "depTypeSfHelp" {
  switch (t) {
    case "FS":
      return "depTypeFsHelp";
    case "SS":
      return "depTypeSsHelp";
    case "FF":
      return "depTypeFfHelp";
    case "SF":
      return "depTypeSfHelp";
  }
}
