"use client";
// src/app/task-kanban-board.tsx — Kanban board surface for the Open Points view.
// Named distinctly from the pure `task-kanban.ts` (grouping engine) it imports:
// a bare `./task-kanban` import resolves `.ts` AHEAD of `.tsx`, so a sibling
// `task-kanban.tsx` would silently hijack the engine import (see AGENTS.md).
import { useMemo } from "react";
import { type Lang, t } from "./i18n";
import { TASK_STATUSES, type ChangeItem, type RaidItem, type Task, type TaskStatus } from "./types";
import { statusLabelKey } from "./task-status-ui";
import { groupByStatus } from "./task-kanban";
import { isJiraSynced } from "./jira-status-map";
import { isReadOnlyIssue } from "./jira-projects";
import type { JiraExtraProject } from "./settings-types";
import { TaskKanbanCard } from "./task-kanban-card";
import { flashOutlineClass } from "./use-deeplink-row-flash";

interface TaskKanbanProps {
  lang: Lang;
  tasks: readonly Task[];
  /** today/holidaySet drive the per-card health dot + overdue emphasis. Optional
   *  so lightweight callers (tests) can omit them; the live board always passes
   *  the same values the table rows use. */
  today?: string;
  holidaySet?: Set<string>;
  /** Jira config subset — drives the per-card read-only badge variant via isReadOnlyIssue. */
  jiraProjectKey?: string;
  jiraExtraProjects?: readonly JiraExtraProject[];
  /** Per-task RAID / change references (same maps the table rows use). */
  raidByTask?: Map<number, RaidItem[]>;
  changeByTask?: Map<number, ChangeItem[]>;
  onStatusChange: (id: number, next: TaskStatus) => void;
  onEdit: (task: Task) => void;
  /** Deep-link to the RAID register for a task. Optional so lightweight callers
   *  (tests) can omit it; falls back to a no-op when no RAID refs are present. */
  onJumpToRaid?: (taskId: number) => void;
  /** Deep-link scroll/flash wiring (shared with the table via useDeepLinkRowFlash).
   *  Optional so lightweight callers/tests can omit them. */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  flashId?: number | null;
}

const EMPTY_HOLIDAYS: Set<string> = new Set();
const EMPTY_EXTRA_PROJECTS: readonly JiraExtraProject[] = [];
const NOOP_JUMP_TO_RAID: (taskId: number) => void = () => {};

export function TaskKanban({
  lang,
  tasks,
  today = "",
  holidaySet = EMPTY_HOLIDAYS,
  jiraProjectKey = "",
  jiraExtraProjects = EMPTY_EXTRA_PROJECTS,
  raidByTask,
  changeByTask,
  onStatusChange,
  onEdit,
  onJumpToRaid = NOOP_JUMP_TO_RAID,
  containerRef,
  flashId = null,
}: TaskKanbanProps) {
  const cols = useMemo(() => groupByStatus(tasks), [tasks]);
  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
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
                  data-deeplink-row={task.id}
                  draggable={!synced}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", String(task.id))}
                  className={["rounded-lg border border-line bg-surface-muted p-2 text-sm", flashOutlineClass(flashId === task.id)]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <TaskKanbanCard
                    lang={lang}
                    task={task}
                    today={today}
                    holidaySet={holidaySet}
                    raidRefs={raidByTask?.get(task.id)}
                    changeRefs={changeByTask?.get(task.id)}
                    onStatusChange={onStatusChange}
                    onEdit={onEdit}
                    onJumpToRaid={onJumpToRaid}
                    readOnlyProject={!!task.jiraKey && isReadOnlyIssue(task.jiraKey, { projectKey: jiraProjectKey, extraProjects: jiraExtraProjects })}
                  />
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
