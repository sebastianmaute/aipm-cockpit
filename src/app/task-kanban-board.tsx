"use client";
// src/app/task-kanban-board.tsx — Kanban board surface for the Open Points view.
// Named distinctly from the pure `task-kanban.ts` (grouping engine) it imports:
// a bare `./task-kanban` import resolves `.ts` AHEAD of `.tsx`, so a sibling
// `task-kanban.tsx` would silently hijack the engine import (see AGENTS.md).
import { useMemo } from "react";
import { type Lang, t } from "./i18n";
import { TASK_STATUSES, type Task, type TaskStatus } from "./types";
import { statusLabelKey } from "./task-status-ui";
import { groupByStatus } from "./task-kanban";
import { isJiraSynced } from "./jira-status-map";

interface TaskKanbanProps {
  lang: Lang;
  tasks: readonly Task[];
  onStatusChange: (id: number, next: TaskStatus) => void;
  onEdit: (task: Task) => void;
}

export function TaskKanban({ lang, tasks, onStatusChange, onEdit }: TaskKanbanProps) {
  const cols = useMemo(() => groupByStatus(tasks), [tasks]);
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
      {TASK_STATUSES.map((status) => (
        <section
          key={status}
          data-testid={`kanban-col-${status}`}
          aria-label={t(lang, statusLabelKey(status))}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const raw = e.dataTransfer.getData("text/plain");
            if (raw) onStatusChange(Number(raw), status);
          }}
          className="flex w-64 shrink-0 flex-col rounded-xl border border-line bg-surface"
        >
          <h3 className="flex items-center justify-between border-b border-line px-3 py-2 text-sm font-medium text-foreground">
            <span>{t(lang, statusLabelKey(status))}</span>
            <span className="text-xs text-muted-foreground">{cols[status].length}</span>
          </h3>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
            {cols[status].map((task) => {
              const synced = isJiraSynced(task);
              return (
                <article
                  key={task.id}
                  data-testid={`kanban-card-${task.id}`}
                  draggable={!synced}
                  onDragStart={(e) => {
                    if (!synced) e.dataTransfer.setData("text/plain", String(task.id));
                  }}
                  className="rounded-lg border border-line bg-surface-muted p-2 text-sm"
                >
                  {/* Minimal card — SP-B Task 6 replaces with <TaskKanbanCard>. */}
                  <button
                    type="button"
                    className="block text-left font-medium text-foreground"
                    onClick={() => onEdit(task)}
                  >
                    {task.taskName}
                  </button>
                  <select
                    aria-label={`${t(lang, "colTaskStatus")} – ${task.taskName}`}
                    value={task.status}
                    disabled={synced}
                    title={synced ? t(lang, "jiraManagedTooltip") : undefined}
                    onChange={(e) => onStatusChange(task.id, e.target.value as TaskStatus)}
                    className="mt-1 block rounded border border-line bg-surface px-1 py-0.5 text-xs"
                  >
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(lang, statusLabelKey(s))}
                      </option>
                    ))}
                  </select>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
