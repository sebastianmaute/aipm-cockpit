// src/app/use-reassign-hours.ts — §774: reassigning a task moves its planned hours.
//
// Deps-object hook (AGENTS.md "Extraction conventions" 1): called UNCONDITIONALLY
// from task-manager with live render-scope values, returns NON-memoized handlers.
// It glues the pure planner (`reassign-hours.ts`) and notice (`reassign-hours-notice.ts`)
// to the setters, the undo stack and the activity log.
//
// ★ Undo is ONE entry per action. The resources fragment is a `captureFieldPart` and
//   is never primary, so undo / redo merge `utilization` PER KEY (`mergeFieldPatch`) —
//   a later edit to a period the move did not touch survives the undo. The task
//   fragment is the caller's own: a `captureFieldPart` here and on the Task 4 paths,
//   a whole-row `capturePart` flagged `isPrimary` on the chat `update_task` path.
// ★★ TWO MOVES IN ONE TICK (R10). The render snapshot of `resources`/`tasks` is
//   stale for a second call made before React re-renders — planning both from it
//   double-spends the giver's hours (or creates hours out of nothing). So planning
//   reads `resourcesRef`/`tasksRef`, which a write ADVANCES synchronously to the
//   planned next state and a layout effect re-syncs to the live state.
//   ★ That covers prepare→commit→prepare→commit. Two `prepare`s before either
//   commits still plan from the same state: commit each step before the next prepare.
// ★ The forward resources write applies the planned moves in SHOWN hours to `prev`
//   (`applyShownDeltas`, never the absolute `after`), so a same-key write by another
//   writer in the same tick is kept by the FORWARD write; when that write left a giver
//   less (or a receiver less room) than planned, the period's moves are scaled down and
//   converted with the planner's own rule, absences included, so no hours are created
//   or lost.
// ★★ UNDO IS ABSOLUTE PER KEY (ruling R11, the codebase convention for every
//   `captureFieldPart`). Undo restores each key the move touched to its value just
//   before the move AS THIS HOOK SAW IT (the ref state); keys the move did not touch
//   keep their live value. So undo of a later move returns its keys to the earlier
//   move's result — but an external write to the SAME cell in the same tick, before
//   the move, is NOT preserved by undo (or redo). Pinned as a known limit by the
//   "same-key write" test.
import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { ActivityActor, ActivityKind } from "./activity-log";
import type { LogActivityAsFn } from "./activity-log-context";
import { type Lang } from "./i18n";
import { applyShownDeltas, planHoursMoves, plannedShownDeltas, type HoursMovePlan, type OwnerChange } from "./reassign-hours";
import { defaultPeriodLabel, hoursMoveNotice } from "./reassign-hours-notice";
import { linkPersonForWrite, resourceDisplayName } from "./resource-foundation";
import type { Absence, Resource, ResourcePlan, Task } from "./types";
import { captureFieldPart, type CaptureCompositeOpts, type CompositeFragment, type UndoEntityKey } from "./undo/use-undo-stack";

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
  /** For a path that records nothing today: writes the task owner fields AND the hours, one undo entry, one notice.
   *  `opts.toastText` is the caller's own confirmation; it leads the entry's toast (before any hours notice), so the
   *  confirmation keeps the Undo button instead of replacing the undo toast with a second one. */
  reassignTasks(edits: readonly OwnerEdit[], actor: ActivityActor, opts?: { toastText?: string }): void;
  /** For a `prepare` caller: records `entry.taskPart` plus the step's resources part as ONE undo entry whose
   *  toast is the notice (in a popout, or with no undo, it shows the notice alone). Returns false and records
   *  nothing when the step neither moved hours nor has a notice: the caller then keeps its own capture. */
  record(step: HoursMoveStep, entry: StepEntry): boolean;
}

/** The caller's half of the ONE undo entry a save records: its own task fragment and label. */
export interface StepEntry {
  kind: ActivityKind;
  primaryCount: number;
  name?: string;
  entityKey?: UndoEntityKey;
  taskPart: CompositeFragment | null;
}

type OwnerFields = Pick<Task, "assignee" | "assigneeEmail" | "resourceId">;

/** Constraint "No move, no notice": the linked owner is unchanged, the owner was cleared to nobody,
 *  (R14) the task had no owner at all — blank name, no link — and is now assigned, or (R17) an
 *  unlinked name gains the link of the SAME person: the old name strictly names `to` by the match
 *  `linkPersonForWrite` uses (a same-lane Kanban status drag stamps the link this way). */
function movesSilently(change: OwnerChange, resources: readonly Resource[]): boolean {
  if (change.fromResourceId === change.toResourceId) return true;
  if (change.fromResourceId === undefined && change.fromAssignee !== undefined) {
    if (change.fromAssignee.trim() === "") return true;
    if (change.toResourceId !== undefined && linkPersonForWrite({ assignee: change.fromAssignee }, resources) === change.toResourceId) return true;
  }
  return change.task.assignee.trim() === "" && change.toResourceId === undefined;
}

/** Net moved hours per resource, language-neutral ("Maya Patel -16; Liam Foster +16"): the stored activity
 *  argument. The activity panel formats it for the viewer (`ACTIVITY_ARG_DISPLAY` in activity-message.ts); the
 *  audit download and the AI prompt read it as stored. */
function activitySummary(plan: HoursMovePlan, name: (id: number) => string): string {
  const net = new Map<number, number>();
  for (const move of plan.moves) {
    if (move.movedHours <= 0 || move.fromResourceId === undefined || move.toResourceId === undefined) continue;
    net.set(move.fromResourceId, (net.get(move.fromResourceId) ?? 0) - move.movedHours);
    net.set(move.toResourceId, (net.get(move.toResourceId) ?? 0) + move.movedHours);
  }
  // Rounded to a tenth BEFORE the zero check: a person who gives and receives in one batch nets to float noise.
  return [...net]
    .map(([id, hours]) => [id, Math.round(hours * 10) / 10] as const)
    .filter(([, hours]) => hours !== 0)
    .map(([id, hours]) => `${name(id)} ${hours > 0 ? "+" : "-"}${Math.abs(hours)}`)
    .join("; ");
}

function emptyPlan(resources: readonly Resource[]): HoursMovePlan {
  return { moves: [], nextResources: [...resources], edits: [], overCapacity: [] };
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

  // The caller wrote the owner through its own setter; advance this hook's copy too, so a reassignTasks later in
  // the same tick reads the new owner, not the render snapshot's. Every change, the silent ones included.
  const advanceTaskCopy = (changes: readonly OwnerChange[]): void => {
    const owners = new Map(changes.map((c) => [c.task.id, c.task]));
    tasksRef.current = tasksRef.current.map((row) => {
      const next = owners.get(row.id);
      return next ? { ...row, assignee: next.assignee, assigneeEmail: next.assigneeEmail, resourceId: next.resourceId } : row;
    });
  };

  const inert = (): HoursMoveStep => ({ resourcesPart: null, commit: () => {}, notice: null, plan: emptyPlan(resourcesRef.current) });

  const prepare = (changes: readonly OwnerChange[]): HoursMoveStep => {
    if (loadPending) return inert();
    const moving = changes.filter((c) => !movesSilently(c, resourcesRef.current));
    if (moving.length === 0) return { ...inert(), commit: () => advanceTaskCopy(changes) };
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
        advanceTaskCopy(changes);
        const deltas = plannedShownDeltas(hoursPlan);
        if (deltas.size > 0) {
          const ctx = { plan, absences, workdayHours, holidaySet, today };
          resourcesRef.current = applyShownDeltas(resourcesRef.current, deltas, ctx);
          const stamp = new Date().toISOString();
          const touched = new Set(deltas.keys());
          setResources((prev) => applyShownDeltas(prev, deltas, ctx).map((r) => (touched.has(r.id) ? { ...r, localModifiedAt: stamp } : r)));
        }
        const summary = moved ? activitySummary(hoursPlan, resourceName) : "";
        if (summary) logActivityAs?.(actor, "resource.hoursMoved", summary);
      },
    };
  };

  const reassignTasks = (edits: readonly OwnerEdit[], actor: ActivityActor, opts?: { toastText?: string }): void => {
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
      changes.push({ task: { ...task, ...after }, fromResourceId: task.resourceId, toResourceId: e.resourceId, fromAssignee: task.assignee });
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

    captureOrNotify(step, {
      leadText: opts?.toastText,
      kind: "task.updated",
      primaryCount: taskEdits.length,
      taskPart: captureFieldPart<Task>({ setter: setTasks, edits: taskEdits, stampField: "localModifiedAt" }),
      // A name describes one row; several fall back to the count label.
      name: taskEdits.length === 1 ? byId.get(taskEdits[0].id)?.taskName : undefined,
    });
  };

  // No undo in a popout (or for a caller without one): the notice is shown on its own.
  function captureOrNotify(step: HoursMoveStep, { taskPart, leadText, ...label }: StepEntry & { leadText?: string }): void {
    const text = [leadText, step.notice].filter((x): x is string => !!x).join(" ") || undefined;
    if (isPopout || !captureComposite) {
      if (text) showToast("info", text);
      return;
    }
    captureComposite({ ...label, parts: [taskPart, step.resourcesPart], toastText: text });
  }

  const record = (step: HoursMoveStep, entry: StepEntry): boolean => {
    if (step.resourcesPart === null && step.notice === null) return false;
    captureOrNotify(step, entry);
    return true;
  };

  return { prepare, reassignTasks, record };
}
