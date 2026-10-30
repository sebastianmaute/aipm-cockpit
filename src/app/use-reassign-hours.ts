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
// ★★ TWO MOVES IN ONE TICK (R10). The render snapshot of `resources`/`tasks` is
//   stale for a second call made before React re-renders — planning both from it
//   double-spends the giver's hours (or creates hours out of nothing). So planning
//   reads `resourcesRef`/`tasksRef`, which a write ADVANCES synchronously to the
//   planned next state and a layout effect re-syncs to the live state.
//   ★ That covers prepare→commit→prepare→commit. Two `prepare`s before either
//   commits still plan from the same state: commit each step before the next prepare.
// ★ The forward resources write applies each planned DELTA per key to `prev`
//   (never the absolute `after`), so a same-key write by another writer in the
//   same tick is kept by the FORWARD write.
// ★★ UNDO IS ABSOLUTE PER KEY (ruling R11, the codebase convention for every
//   `captureFieldPart`). Undo restores each key the move touched to its value just
//   before the move AS THIS HOOK SAW IT (the ref state); keys the move did not touch
//   keep their live value. So undo of a later move returns its keys to the earlier
//   move's result — but an external write to the SAME cell in the same tick, before
//   the move, is NOT preserved by undo (or redo). Pinned as a known limit by the
//   "same-key write" test.
import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { ActivityActor } from "./activity-log";
import type { LogActivityAsFn } from "./activity-log-context";
import { t, type Lang } from "./i18n";
import { planHoursMoves, type HoursMovePlan, type OwnerChange, type ResourceUtilEdit } from "./reassign-hours";
import { defaultPeriodLabel, formatHours, hoursMoveNotice } from "./reassign-hours-notice";
import { resourceDisplayName } from "./resource-foundation";
import type { Absence, Resource, ResourcePlan, Task } from "./types";
import { captureFieldPart, type CaptureCompositeOpts, type CompositeFragment } from "./undo/use-undo-stack";

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
  /** Writes the resources (functional setter) and logs the activity. Call once, after the task write.
   *  ★ Commit each step before the next `prepare`: two `prepare` calls before either commits plan from the same state. */
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
  /** For a path that already records its own undo entry for this save.
   *  ★ Commit each step before the next `prepare`: two `prepare` calls before either commits plan from the same state. */
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

type UtilDeltas = ReadonlyMap<number, ReadonlyMap<string, number>>;

const MAX_PERCENT = 100; // `sanitizeResource` clamps percent-mode utilization to this
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Per resource, per period: the stored-value change the plan made (keys it left alone are absent). */
function utilDeltas(edits: readonly ResourceUtilEdit[]): UtilDeltas {
  const out = new Map<number, Map<string, number>>();
  for (const { id, before, after } of edits) {
    const keys = new Map<string, number>();
    for (const k of new Set([...Object.keys(before.utilization), ...Object.keys(after.utilization)])) {
      const d = (after.utilization[k] ?? 0) - (before.utilization[k] ?? 0);
      if (d !== 0) keys.set(k, d);
    }
    if (keys.size > 0) out.set(id, keys);
  }
  return out;
}

/** Add each delta to the row's CURRENT value — pure, so it serves both the ref advance and the setter updater. */
function applyUtilDeltas(rows: readonly Resource[], deltas: UtilDeltas, stamp?: string): Resource[] {
  return rows.map((r) => {
    const keys = deltas.get(r.id);
    if (!keys) return r;
    const utilization = { ...r.utilization };
    for (const [k, d] of keys) {
      const next = Math.max(0, round2((utilization[k] ?? 0) + d));
      utilization[k] = r.utilizationMode === "percent" ? Math.min(MAX_PERCENT, next) : next;
    }
    return stamp ? { ...r, utilization, localModifiedAt: stamp } : { ...r, utilization };
  });
}

export function useReassignHours(deps: ReassignHoursDeps): ReassignHours {
  const { lang, today, isPopout, loadPending, tasks, setTasks, resources, setResources, plan, absences, workdayHours, holidaySet, captureComposite, logActivityAs, showToast } = deps;

  // Latest-value refs (R10): re-synced to the live state after each commit that
  // changes it, advanced synchronously by every write below.
  const resourcesRef = useRef(resources);
  const tasksRef = useRef(tasks);
  useLayoutEffect(() => { resourcesRef.current = resources; }, [resources]);
  useLayoutEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const resourceName = (id: number): string => {
    const r = resourcesRef.current.find((x) => x.id === id);
    return r ? resourceDisplayName(r) : `#${id}`;
  };

  const inert = (): HoursMoveStep => ({ resourcesPart: null, commit: () => {}, notice: null, plan: emptyPlan(resourcesRef.current) });

  const prepare = (changes: readonly OwnerChange[]): HoursMoveStep => {
    if (loadPending) return inert();
    const moving = changes.filter((c) => !movesSilently(c));
    if (moving.length === 0) return inert();
    const hoursPlan = planHoursMoves(moving, resourcesRef.current, { plan, absences, workdayHours, holidaySet, today });
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
        const deltas = utilDeltas(hoursPlan.edits);
        if (deltas.size > 0) {
          resourcesRef.current = applyUtilDeltas(resourcesRef.current, deltas);
          const stamp = new Date().toISOString();
          setResources((prev) => applyUtilDeltas(prev, deltas, stamp));
        }
        if (moved) logActivityAs?.(actor, "resource.hoursMoved", activitySummary(hoursPlan, resourceName, lang));
      },
    };
  };

  const reassignTasks = (edits: readonly OwnerEdit[], actor: ActivityActor): void => {
    if (loadPending) return;
    const byId = new Map(tasksRef.current.map((x) => [x.id, x]));
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
    const withOwners = (rows: readonly Task[]): Task[] => rows.map((row) => {
      const after = afterById.get(row.id);
      return after ? { ...row, ...after, localModifiedAt: stamp } : row;
    });
    tasksRef.current = withOwners(tasksRef.current);
    setTasks(withOwners);
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
