"use client";

// Glue wrapper for the Gantt view: reads workspace/settings/tab-context state
// so the caller (workspace-section) doesn't have to thread it, and mounts the
// AI "Deduplicate & unify" hook — the ONE dependency (undo capture) that isn't
// reachable via context, so it arrives as a prop from the call site instead.
// This is the lazy boundary (see workspace-panels.tsx), inherited from the
// GanttPanel export it replaced: the chart itself still loads only when the
// Gantt view is visited, and GanttPanel stays a pure presentational component.
// ★ It does NOT keep the dedup call/engine/modal out of the main bundle —
// tasks-section.tsx imports the same hook and is imported STATICALLY by
// task-manager.tsx, so that code ships regardless. Preserving the existing
// laziness is the whole reason this is a dynamic import; there is no
// bundle-size win here to protect.
import { GanttPanel } from "./gantt";
import { type GanttBarEdit } from "./gantt-engine";
import { t } from "./i18n";
import { useActivityLogger } from "./activity-log-context";
import { useSettings } from "./use-settings";
import { useTasksDedup } from "./use-tasks-dedup";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { type Milestone, type Task } from "./types";
import { type UndoStackApi } from "./undo/use-undo-stack";

export interface GanttViewProps {
  onUpdateBar?: (edit: GanttBarEdit) => void;
  onAddTask?: () => void;
  onEditTask?: (task: Task) => void;
  onAddMilestone?: () => void;
  onEditMilestone?: (m: Milestone) => void;
  showHints?: boolean;
  milestonesEnabled: boolean;
  baselineMilestoneDates?: ReadonlyMap<number, string>;
  /** Single-entry undo capture — only the call site holds the undo stack. */
  onCaptureUndo?: UndoStackApi["capture"];
}

export function GanttView({
  onUpdateBar,
  onAddTask,
  onEditTask,
  onAddMilestone,
  onEditMilestone,
  showHints,
  milestonesEnabled,
  baselineMilestoneDates,
  onCaptureUndo,
}: GanttViewProps) {
  const { settings, lang } = useSettings();
  const { tasks, setTasks, absences, resources, milestones } = useWorkspace();
  const { isPopout, requestHelpConcept } = useWorkspaceTab();
  const logActivity = useActivityLogger();

  const dedup = useTasksDedup({
    settings,
    isPopout,
    lang,
    tasks,
    setTasks,
    capture: onCaptureUndo,
    logActivity: logActivity ?? undefined,
    triggerQualifier: t(lang, "tabGantt"),
  });

  return (
    <>
      <GanttPanel
        lang={lang}
        tasks={tasks}
        absences={absences}
        resources={resources}
        milestones={milestonesEnabled ? milestones : []}
        onUpdateBar={onUpdateBar}
        onAddTask={onAddTask}
        onEditTask={onEditTask}
        onAddMilestone={onAddMilestone}
        onEditMilestone={onEditMilestone}
        showHints={showHints}
        isPopout={isPopout}
        onLearnMore={requestHelpConcept}
        baselineMilestoneDates={baselineMilestoneDates}
        dedupButton={dedup.button}
      />
      {dedup.modal}
    </>
  );
}
