// src/app/use-reassign-hours.ts — §774: reassigning a task moves its planned hours.
//
// Deps-object hook (AGENTS.md "Extraction conventions" 1): called UNCONDITIONALLY
// from task-manager with live render-scope values, returns NON-memoized handlers.
// It glues the pure planner (`reassign-hours.ts`) and notice (`reassign-hours-notice.ts`)
// to the setters, the undo stack and the activity log.
//
// ★ Undo is ONE entry per action: every fragment is a `captureFieldPart`, so the
//   composite has no whole-row `capturePart` and no id-remap to follow, and undo /
//   redo merge `utilization` PER KEY (`mergeFieldPatch`) — a later edit to a period
//   the move did not touch survives the undo.
// ★ The forward write merges the same patch onto the LIVE rows, so a write that
//   landed between render and the call is kept the same way.
import type { Dispatch, SetStateAction } from "react";
import type { ActivityActor } from "./activity-log";
import type { LogActivityAsFn } from "./activity-log-context";
import { t, type Lang } from "./i18n";
import { planHoursMoves, type HoursMovePlan, type OwnerChange, type ResourceUtilEdit } from "./reassign-hours";
import { defaultPeriodLabel, formatHours, hoursMoveNotice } from "./reassign-hours-notice";
import { resourceDisplayName } from "./resource-foundation";
import type { Absence, Resource, ResourcePlan, Task } from "./types";
import { captureFieldPart, type CaptureCompositeOpts, type CompositeFragment } from "./undo/use-undo-stack";
import { mergeFieldPatch } from "./undo/merge-field-value";

export interface ReassignHoursDeps {
  lang: Lang;
  today: string;
  isPopout: boolean;
  loadPending: boolean;
  /** Live tasks — `reassignTasks` reads each task's current owner and estimate from them. */
  tasks: readonly Task[];
  setTasks: Dispatch<SetStateAction<readonly Task[]>>;
  resources: readonly Resource[];
  setResources: Dispatch<SetStateAction<readonly Resource[]>>;
  plan: ResourcePlan;
  absences: readonly Absence[];
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
  captureComposite?: (opts: CaptureCompositeOpts) => void;
  logActivityAs?: LogActivityAsFn;
  showToast: (kind: "info" | "error", text: string) => void;
}

export interface HoursMoveStep {
  /** Resources fragment to add to the caller's own captureComposite parts; null when nothing moved. */
  resourcesPart: CompositeFragment | null;
  /** Writes the resources (functional setter) and logs the activity. Call once, after the task write. */
  commit(actor: ActivityActor): void;
  /** Text for the caller's toastText (or for showToast when it captures nothing); null when silent. */
  notice: string | null;
  plan: HoursMovePlan;
}

export interface OwnerEdit {
  taskId: number;
  assignee: string;
  assigneeEmail: string;
  resourceId: number | undefined;
}

export interface ReassignHours {
  /** For a path that already records its own undo entry for this save. */
  prepare(changes: readonly OwnerChange[]): HoursMoveStep;
  /** For a path that records nothing today: writes the task owner fields AND the hours, one undo entry, one notice. */
  reassignTasks(edits: readonly OwnerEdit[], actor: ActivityActor): void;
}

type OwnerFields = Pick<Task, "assignee" | "assigneeEmail" | "resourceId">;

/** Constraint "No move, no notice": the linked owner is unchanged, or the owner was cleared to nobody. */
function movesSilently(change: OwnerChange): boolean {
  if (change.fromResourceId === change.toResourceId) return true;
  return change.task.assignee.trim() === "" && change.toResourceId === undefined;
}

/** Net moved hours per resource, e.g. "Maya Patel -16 h, Liam Foster +16 h" — the activity entry's argument. */
function activitySummary(plan: HoursMovePlan, name: (id: number) => string, lang: Lang): string {
  const net = new Map<number, number>();
  for (const move of plan.moves) {
    if (move.movedHours <= 0 || move.fromResourceId === undefined || move.toResourceId === undefined) continue;
    net.set(move.fromResourceId, (net.get(move.fromResourceId) ?? 0) - move.movedHours);
    net.set(move.toResourceId, (net.get(move.toResourceId) ?? 0) + move.movedHours);
  }
  const unit = t(lang, "hoursMovedUnit");
  return [...net]
    .filter(([, hours]) => hours !== 0)
    .map(([id, hours]) => `${name(id)} ${hours > 0 ? "+" : "-"}${formatHours(Math.abs(hours), lang)} ${unit}`)
    .join(", ");
}

function emptyPlan(resources: readonly Resource[]): HoursMovePlan {
  return { moves: [], nextResources: [...resources], edits: [], overCapacity: [] };
}

/** Merge the utilization patch onto the LIVE rows, stamped, in one setter pass. */
function writeUtilEdits(setResources: ReassignHoursDeps["setResources"], edits: readonly ResourceUtilEdit[]): void {
  if (edits.length === 0) return;
  const byId = new Map(edits.map((e) => [e.id, e]));
  const stamp = new Date().toISOString();
  setResources((prev) => prev.map((r) => {
    const edit = byId.get(r.id);
    return edit ? { ...mergeFieldPatch(r, edit.after, edit.before), localModifiedAt: stamp } : r;
  }));
}

export function useReassignHours(deps: ReassignHoursDeps): ReassignHours {
  const { lang, today, isPopout, loadPending, tasks, setTasks, resources, setResources, plan, absences, workdayHours, holidaySet, captureComposite, logActivityAs, showToast } = deps;

  const resourceName = (id: number): string => {
    const r = resources.find((x) => x.id === id);
    return r ? resourceDisplayName(r) : `#${id}`;
  };

  const inert = (): HoursMoveStep => ({ resourcesPart: null, commit: () => {}, notice: null, plan: emptyPlan(resources) });

  const prepare = (changes: readonly OwnerChange[]): HoursMoveStep => {
    if (loadPending) return inert();
    const moving = changes.filter((c) => !movesSilently(c));
    if (moving.length === 0) return inert();
    const hoursPlan = planHoursMoves(moving, resources, { plan, absences, workdayHours, holidaySet, today });
    const taskNames = new Map(moving.map((c) => [c.task.id, c.task.taskName]));
    const notice = hoursMoveNotice(hoursPlan, {
      lang,
      resourceName,
      periodLabel: (key) => defaultPeriodLabel(key, lang),
      taskName: (id) => taskNames.get(id) ?? `#${id}`,
    });
    const moved = hoursPlan.moves.some((m) => m.movedHours > 0);
    let committed = false;
    return {
      resourcesPart: captureFieldPart<Resource>({ setter: setResources, edits: hoursPlan.edits, stampField: "localModifiedAt" }),
      notice,
      plan: hoursPlan,
      commit: (actor) => {
        if (committed) return; // a second call would apply the patch twice and log twice
        committed = true;
        writeUtilEdits(setResources, hoursPlan.edits);
        if (moved) logActivityAs?.(actor, "resource.hoursMoved", activitySummary(hoursPlan, resourceName, lang));
      },
    };
  };

  const reassignTasks = (edits: readonly OwnerEdit[], actor: ActivityActor): void => {
    if (loadPending) return;
    const byId = new Map(tasks.map((x) => [x.id, x]));
    const taskEdits: { id: number; before: OwnerFields; after: OwnerFields }[] = [];
    const changes: OwnerChange[] = [];
    const seen = new Set<number>();
    for (const e of edits) {
      const task = byId.get(e.taskId);
      if (!task || seen.has(e.taskId)) continue; // captureFieldPart requires distinct ids
      seen.add(e.taskId);
      const before: OwnerFields = { assignee: task.assignee, assigneeEmail: task.assigneeEmail, resourceId: task.resourceId };
      const after: OwnerFields = { assignee: e.assignee, assigneeEmail: e.assigneeEmail, resourceId: e.resourceId };
      if (before.assignee === after.assignee && before.assigneeEmail === after.assigneeEmail && before.resourceId === after.resourceId) continue;
      taskEdits.push({ id: task.id, before, after });
      changes.push({ task: { ...task, ...after }, fromResourceId: task.resourceId, toResourceId: e.resourceId });
    }
    if (taskEdits.length === 0) return;

    const step = prepare(changes);
    const afterById = new Map(taskEdits.map((x) => [x.id, x.after]));
    const stamp = new Date().toISOString();
    setTasks((prev) => prev.map((row) => {
      const after = afterById.get(row.id);
      return after ? { ...row, ...after, localModifiedAt: stamp } : row;
    }));
    step.commit(actor);

    if (isPopout || !captureComposite) {
      if (step.notice) showToast("info", step.notice);
      return;
    }
    captureComposite({
      kind: "task.updated",
      primaryCount: taskEdits.length,
      parts: [captureFieldPart<Task>({ setter: setTasks, edits: taskEdits, stampField: "localModifiedAt" }), step.resourcesPart],
      // A name describes one row; several fall back to the count label.
      name: taskEdits.length === 1 ? byId.get(taskEdits[0].id)?.taskName : undefined,
      toastText: step.notice ?? undefined,
    });
  };

  return { prepare, reassignTasks };
}
