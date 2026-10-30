// src/test/reassign-hours-rig.ts — §774 Task 4: the shared fixture for the
// path tests (triage, editor, inline, Kanban, Action Center). It runs the REAL
// `useReassignHours` over real state cells and the REAL undo stack, so a path
// test reads utilization and the undo toast as the app would produce them.
import { useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { vi, type Mock } from "vitest";
import type { LogActivityAsFn } from "../app/activity-log-context";
import type { ToastAction } from "../app/use-toast";
import { planHoursMoves, type OwnerChange } from "../app/reassign-hours";
import { defaultPeriodLabel, hoursMoveNotice } from "../app/reassign-hours-notice";
import type { Resource, ResourcePlan, Task } from "../app/types";
import { useReassignHours, type ReassignHours } from "../app/use-reassign-hours";
import { useUndoStack } from "../app/undo/use-undo-stack";

// Sep 1 – Dec 31, monthly. The task spans Sep 1 – Oct 30: 22 workdays in each
// month, so 16 h split 8 h / 8 h.
export const RIG_PLAN: ResourcePlan = { startDate: "2026-09-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
export const RIG_TODAY = "2026-09-01";
const NO_HOLIDAYS: ReadonlySet<string> = new Set<string>();

export const MAYA: Resource = {
  id: 1, firstName: "Maya", lastName: "Patel", email: "maya@x.com", roleId: null, utilizationMode: "hours",
  utilization: { "2026-09": 40, "2026-10": 40, "2026-11": 20 },
};
export const LIAM: Resource = { id: 2, firstName: "Liam", lastName: "Foster", email: "liam@x.com", roleId: null, utilizationMode: "hours", utilization: {} };

/** Maya owns it; 16 h left over Sep 1 – Oct 30. */
export const RIG_TASK: Task = {
  id: 10, taskName: "Design review", assignee: "Maya Patel", assigneeEmail: "maya@x.com", resourceId: 1,
  startDate: "2026-09-01", dueDate: "2026-10-30", remainingEstimateMinutes: 16 * 60,
  lastUpdateDate: "2026-09-01", priority: "Medium", status: "To Do", blockers: "", description: "",
};
export const LIAM_OWNS = { assignee: "Liam Foster", assigneeEmail: "liam@x.com", resourceId: 2 } as const;

/** The notice the app must show for `change`, built from the planner and formatter on the rig's inputs. */
export function expectedNotice(change: OwnerChange, resources: readonly Resource[] = [MAYA, LIAM]): string | null {
  const plan = planHoursMoves([change], resources, { plan: RIG_PLAN, absences: [], workdayHours: 8, holidaySet: NO_HOLIDAYS, today: RIG_TODAY });
  return hoursMoveNotice(plan, {
    lang: "en-US",
    resourceName: (id) => (id === 1 ? "Maya Patel" : "Liam Foster"),
    periodLabel: (key) => defaultPeriodLabel(key, "en-US"),
    taskName: () => change.task.taskName,
  });
}

type ShowToast = (kind: "info" | "error", text: string) => void;
type ShowToastAction = (kind: "info" | "error", text: string, action: ToastAction) => void;

export interface RigSpies {
  showToast: Mock<ShowToast>;
  showToastAction: Mock<ShowToastAction>;
  logActivityAs: Mock<LogActivityAsFn>;
}

export function rigSpies(): RigSpies {
  return { showToast: vi.fn<ShowToast>(), showToastAction: vi.fn<ShowToastAction>(), logActivityAs: vi.fn<LogActivityAsFn>() };
}

/** State cells + the undo stack + the hours hook, as task-manager wires them. Call inside `renderHook`. */
export function useReassignRig(spies: RigSpies, initialTasks: readonly Task[] = [RIG_TASK]) {
  const [tasks, setTasks] = useState<readonly Task[]>(initialTasks);
  const [resources, setResources] = useState<readonly Resource[]>([MAYA, LIAM]);
  return useReassignRigOver(spies, { tasks, setTasks, resources, setResources });
}

interface RigCells {
  tasks: readonly Task[];
  setTasks: Dispatch<SetStateAction<readonly Task[]>>;
  resources: readonly Resource[];
  setResources: Dispatch<SetStateAction<readonly Resource[]>>;
}

/** The same rig over state the caller owns (e.g. a real WorkspaceProvider's slices). */
export function useReassignRigOver(spies: RigSpies, { tasks, setTasks, resources, setResources }: RigCells) {
  const tasksRef = useRef<readonly Task[]>(tasks);
  useLayoutEffect(() => { tasksRef.current = tasks; }, [tasks]);
  const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction: spies.showToastAction });
  const reassignHours = useReassignHours({
    lang: "en-US", today: RIG_TODAY, isPopout: false, loadPending: false,
    tasks, setTasks, resources, setResources,
    plan: RIG_PLAN, absences: [], workdayHours: 8, holidaySet: NO_HOLIDAYS,
    captureComposite: undo.captureComposite, logActivityAs: spies.logActivityAs, showToast: spies.showToast,
  });
  return { tasks, setTasks, tasksRef, resources, undo, reassignHours };
}

/** A `ReassignHours` that never moves anything — the default for a path test about something else. */
export function inertReassignHours(): ReassignHours {
  return {
    prepare: () => ({ resourcesPart: null, commit: () => {}, notice: null, plan: { moves: [], nextResources: [], edits: [], overCapacity: [] } }),
    reassignTasks: vi.fn(),
    record: () => false,
  };
}

export const utilOf = (rs: readonly Resource[], id: number) => rs.find((r) => r.id === id)?.utilization;
