"use client";
// src/app/task-kanban-swimlanes.tsx — status x person swimlane surface for the
// Open Points view. A SIBLING of task-kanban-board.tsx (1-D status board), not a
// mode inside it: the grid structure, drop payload (lane + status, not just
// status) and headers all differ. Named distinctly from the pure `task-kanban.ts`
// (grouping engine) it imports: a bare `./task-kanban` import resolves `.ts`
// AHEAD of `.tsx`, so a sibling `task-kanban.tsx` would silently hijack the
// engine import (see AGENTS.md).
import { useMemo } from "react";
import { XMarkIcon } from "./icons";
import { type Lang, t } from "./i18n";
import { TASK_STATUSES, type ChangeItem, type RaidItem, type Resource, type Task, type TaskStatus } from "./types";
import { statusLabelKey } from "./task-status-ui";
import { groupByStatusAndPerson, UNASSIGNED_LANE, type KanbanLane } from "./task-kanban";
import { KANBAN_STATUS_COL_CLASS } from "./task-kanban-board";
import { isJiraSynced } from "./jira-status-map";
import { isReadOnlyIssue } from "./jira-projects";
import type { JiraExtraProject } from "./settings-types";
import type { ProjectDocument } from "./document-model";
import { TaskKanbanCard } from "./task-kanban-card";
import { flashOutlineClass } from "./use-deeplink-row-flash";
import { INTERACTIVE } from "./interaction-styles";
import { buildRowTokens, rowLabel } from "./row-tokens";

interface TaskKanbanSwimlanesProps {
  lang: Lang;
  tasks: readonly Task[];
  /** Directory lookup (id -> Resource) driving both lane derivation (LIVE names)
   *  and the per-card assignee display. Required — the grouping engine can't
   *  derive lanes without it. */
  resourcesById: ReadonlyMap<number, Resource>;
  /** Resource ids pulled in explicitly (e.g. via an "Add person lane" picker) so
   *  an as-yet-empty lane is still droppable. Required — pass `[]` when none. */
  extraLaneIds: readonly number[];
  /** Row-unique display tokens for `tasks`, keyed by task id. Built by the list
   *  owner (`tasks-section.tsx`) because uniqueness is a property of the
   *  rendered list and a card cannot see its siblings.
   *  ★★ REQUIRED, deliberately — mirrors `rowToken` on TaskStatusSelect: an
   *  optional prop defaulting to an empty map would silently reinstate the
   *  WCAG 2.4.6 collision this branch exists to remove, and no gate can see
   *  a duplicate accessible name to catch that regression. Required means
   *  tsc enumerates every caller. */
  tokens: ReadonlyMap<number, string>;
  /** today/holidaySet drive the per-card health dot + overdue emphasis. Optional
   *  so lightweight callers (tests) can omit them; the live pane always passes
   *  the same values the table rows use. */
  today?: string;
  holidaySet?: Set<string>;
  /** Jira config subset — drives the per-card read-only badge variant via isReadOnlyIssue. */
  jiraProjectKey?: string;
  jiraExtraProjects?: readonly JiraExtraProject[];
  /** Per-task RAID / change references (same maps the table rows use). */
  raidByTask?: Map<number, RaidItem[]>;
  changeByTask?: Map<number, ChangeItem[]>;
  /** Linked-documents reverse index (`refKey(kind, id)` → documents), the SAME
   *  one the table rows and the registers read. Optional so lightweight
   *  callers/tests can omit it — no badge renders without it. */
  documentsByEntity?: ReadonlyMap<string, readonly ProjectDocument[]>;
  /** Deep-link to the Documents pane, filtered to one task. Optional, as above. */
  onOpenDocuments?: (taskId: number) => void;
  /** Swimlane cell drop: the cell identifies BOTH the person (lane) and the
   *  status, so one drop writes both in a single call. */
  onSwimlaneDrop: (id: number, lane: KanbanLane, status: TaskStatus) => void;
  /** Keyboard equivalent of the drag: assigns/unassigns a task via a per-card
   *  person select. Reuses onSwimlaneDrop under the hood at the caller. Both
   *  optional (mirrors TaskKanbanCard) so lightweight callers/tests can omit
   *  them — the control simply doesn't render on any card. */
  assignableResources?: readonly Resource[];
  onAssign?: (taskId: number, resourceId: number | null) => void;
  onStatusChange: (id: number, next: TaskStatus) => void;
  onEdit: (task: Task) => void;
  /** Remove an explicitly-added, still-empty linked lane (the reverse of
   *  extraLaneIds). Never called for the Unassigned lane or a lane holding tasks. */
  onRemoveLane: (resourceId: number) => void;
  /** Deep-link to the RAID register for a task. Optional so lightweight callers
   *  (tests) can omit it; falls back to a no-op when no RAID refs are present. */
  onJumpToRaid?: (taskId: number) => void;
  /** Deep-link scroll/flash wiring (shared with the table via useDeepLinkRowFlash).
   *  Optional so lightweight callers/tests can omit them. */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  flashId?: number | null;
  /** Inline "Ask Claude" task edit (board wiring): per-card trigger + its
   *  enablement gate, threaded from the same useInlineAiEdit instance the
   *  table rows use. Optional so lightweight callers/tests can omit them. */
  onAiEdit?: (task: Task) => void;
  aiEditEnabled?: (task: Task) => boolean;
}

const EMPTY_HOLIDAYS: Set<string> = new Set();
const EMPTY_EXTRA_PROJECTS: readonly JiraExtraProject[] = [];
const NOOP_JUMP_TO_RAID: (taskId: number) => void = () => {};

const LANE_COL_CLASS = "w-40 shrink-0";
// Shared with task-kanban-board.tsx so the board and swimlane views cannot
// drift apart on status-column width.
const STATUS_COL_CLASS = KANBAN_STATUS_COL_CLASS;

export function TaskKanbanSwimlanes({
  lang,
  tasks,
  resourcesById,
  extraLaneIds,
  tokens,
  today = "",
  holidaySet = EMPTY_HOLIDAYS,
  jiraProjectKey = "",
  jiraExtraProjects = EMPTY_EXTRA_PROJECTS,
  raidByTask,
  changeByTask,
  documentsByEntity,
  onOpenDocuments,
  onSwimlaneDrop,
  onStatusChange,
  onEdit,
  onRemoveLane,
  onJumpToRaid = NOOP_JUMP_TO_RAID,
  containerRef,
  flashId = null,
  onAiEdit,
  aiEditEnabled,
  assignableResources,
  onAssign,
}: TaskKanbanSwimlanesProps) {
  const grouping = useMemo(
    () => groupByStatusAndPerson(tasks, resourcesById, extraLaneIds),
    [tasks, resourcesById, extraLaneIds],
  );

  // Lane-unique display tokens (WCAG 2.4.6). Two directory resources can
  // genuinely share a display name, and a lane's label is the LIVE directory
  // name (`effectiveAssignee`), so nothing upstream disambiguates it — two
  // "John Smith" lanes rendered two identically-named `region`s AND two
  // identical "Remove lane – John Smith" buttons.
  //
  // ★★★ TOKENISE THE COMPUTED LABEL, NOT `lane.label`. The Unassigned lane's
  // raw label is "" by construction (`task-kanban.ts` keeps that module
  // i18n-free and lets the caller supply the translated string), so tokenising
  // the raw field would name that lane off an empty string.
  //
  // ★ `buildRowTokens` is generic over the id type and lane keys are strings,
  // so it fits directly; `useRowTokens` is constrained to a numeric id and
  // does not.
  const laneTokens = useMemo(
    () =>
      buildRowTokens(
        grouping.lanes.map((lane) => ({
          id: lane.key,
          name: lane.key === UNASSIGNED_LANE ? t(lang, "swimlaneUnassigned") : lane.label,
        })),
      ),
    [grouping, lang],
  );

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-auto pb-2">
      <div className="flex">
        <div className={`sticky top-0 left-0 z-20 ${LANE_COL_CLASS} border-r border-b border-line bg-surface-muted`} />
        {TASK_STATUSES.map((status) => (
          <div
            key={status}
            className={`sticky top-0 z-10 ${STATUS_COL_CLASS} border-b border-line bg-surface-muted px-3 py-2 text-sm font-medium text-foreground`}
          >
            {t(lang, statusLabelKey(status))}
          </div>
        ))}
      </div>

      {grouping.lanes.map((lane) => {
        const laneLabel = lane.key === UNASSIGNED_LANE ? t(lang, "swimlaneUnassigned") : lane.label;
        // ★ The VISIBLE header stays the bare label — the token is an
        // ACCESSIBLE-name device, and a user reads the name the directory
        // holds. The fallback cannot fire (the map is built from these very
        // lanes) but keeps the label non-empty if that ever stops holding.
        const laneToken = laneTokens.get(lane.key) ?? laneLabel;
        const laneCells = grouping.cells[lane.key];
        const isEmptyLane = TASK_STATUSES.every((status) => laneCells[status].length === 0);
        const canRemove = lane.resourceId != null && isEmptyLane;

        return (
          <section key={lane.key} aria-label={laneToken} className="flex">
            <div
              className={`sticky left-0 z-10 ${LANE_COL_CLASS} flex items-center justify-between gap-1 border-r border-b border-line bg-surface-muted px-3 py-2 text-sm font-medium text-foreground`}
            >
              <span className="truncate">{laneLabel}</span>
              {canRemove && (
                <button
                  type="button"
                  onClick={() => onRemoveLane(lane.resourceId!)}
                  aria-label={rowLabel(t(lang, "swimlaneRemoveLane"), laneToken)}
                  title={t(lang, "swimlaneRemoveLane")}
                  className={`shrink-0 rounded p-0.5 text-muted-foreground hover:text-ui-pink-strong ${INTERACTIVE}`}
                >
                  <XMarkIcon aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {TASK_STATUSES.map((status) => {
              const statusLabel = t(lang, statusLabelKey(status));
              return (
                <div
                  key={status}
                  // ★★ `role="group"` IS LOAD-BEARING, NOT DECORATION. A bare
                  // <div>'s implicit role is `generic`, for which ARIA 1.2
                  // PROHIBITS `aria-label` — browsers and AT drop the name
                  // outright, so this cell's lane/status name was computed,
                  // tokenised and then announced to nobody. `group` is a role
                  // that supports naming, so the name is actually exposed.
                  // ★ Deliberately NOT a <section> (which is what
                  // `task-kanban-board.tsx` uses for the flat board's columns):
                  // a named <section> maps to `region`, a LANDMARK, and there
                  // are lanes × TASK_STATUSES of these — turning every drop cell
                  // into a landmark floods the AT landmark list.
                  // ★★ axe cannot police either half: `aria-prohibited-attr` is
                  // tagged `wcag2a` but lands in `incomplete`, not `violations`,
                  // so the e2e gate was silent before this and is silent now.
                  // `task-kanban-swimlanes.test.tsx` is the only detector.
                  role="group"
                  data-testid={`swimlane-cell-${lane.key}-${status}`}
                  aria-label={t(lang, "swimlaneCell", laneToken, statusLabel)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const raw = e.dataTransfer.getData("text/plain");
                    if (raw) onSwimlaneDrop(Number(raw), lane, status);
                  }}
                  className={`flex ${STATUS_COL_CLASS} flex-col gap-2 border-r border-b border-line p-2`}
                >
                  {laneCells[status].map((task) => {
                    const synced = isJiraSynced(task);
                    return (
                      <article
                        key={task.id}
                        data-testid={`swimlane-card-${task.id}`}
                        data-deeplink-row={task.id}
                        draggable={!synced}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", String(task.id))}
                        className={["group rounded-lg border border-line bg-surface p-2 text-sm", flashOutlineClass(flashId === task.id)]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <TaskKanbanCard
                          lang={lang}
                          task={task}
                          today={today}
                          holidaySet={holidaySet}
                          resourcesById={resourcesById}
                          // `laneCells` comes from `grouping` =
                          // `groupByStatusAndPerson(tasks, ...)` — a partition
                          // of the `tasks` prop, and the caller builds `tokens`
                          // from that same array, so `task.id` is always a key
                          // here; the fallback cannot fire today. Kept anyway:
                          // `tasks` and `tokens` are independently typed props,
                          // so nothing structurally binds a future caller to
                          // keep them in sync.
                          rowToken={tokens.get(task.id) ?? task.taskName}
                          raidRefs={raidByTask?.get(task.id)}
                          changeRefs={changeByTask?.get(task.id)}
                          documentsByEntity={documentsByEntity}
                          onOpenDocuments={onOpenDocuments}
                          onStatusChange={onStatusChange}
                          onEdit={onEdit}
                          onJumpToRaid={onJumpToRaid}
                          readOnlyProject={!!task.jiraKey && isReadOnlyIssue(task.jiraKey, { projectKey: jiraProjectKey, extraProjects: jiraExtraProjects })}
                          onAiEdit={onAiEdit}
                          aiEditEnabled={aiEditEnabled}
                          assignableResources={assignableResources}
                          onAssign={onAssign}
                        />
                      </article>
                    );
                  })}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
