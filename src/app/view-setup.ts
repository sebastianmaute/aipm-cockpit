// Setup checklists for the Gantt, RACI and Resources views (§736, §734, §731): pure, i18n-free
// logic in the shape of the Budget checklist's (`budget-setup.ts`, §710). Each step is ticked from
// project data; nothing new is stored on the Workspace. Only the Gantt checklist can be hidden,
// and that choice is remembered per device, view and project.
import { budgetSetupSteps } from "./budget-setup";
import { parseISO } from "./gantt-engine";
import type { Discipline, Grade, Milestone, Resource, Role, Stakeholder, Task } from "./types";

/** 1 = a task with a due date, 2 = a dependency, 3 = a milestone (when the function is on). */
export interface GanttSetupSteps {
  datedDone: boolean;
  depsDone: boolean;
  milestonesDone: boolean;
  /** False when the Milestones function is off for the project: step 3 is then not a step at all. */
  milestonesApplicable: boolean;
  /** First step not done, in order. `null` when every applicable step is done. */
  next: 1 | 2 | 3 | null;
}

export function ganttSetupSteps(input: {
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  milestonesApplicable: boolean;
}): GanttSetupSteps {
  // The same test `deriveBar` applies: a due date that does not parse draws no bar.
  const datedDone = input.tasks.some((task) => parseISO(task.dueDate) !== null);
  const depsDone = input.tasks.some((task) => (task.dependencies?.length ?? 0) > 0);
  const milestonesDone = input.milestones.length > 0;
  const { milestonesApplicable } = input;
  const next = !datedDone ? 1 : !depsDone ? 2 : milestonesApplicable && !milestonesDone ? 3 : null;
  return { datedDone, depsDone, milestonesDone, milestonesApplicable, next };
}

/** 1 = milestones, 2 = stakeholders, 3 = a RACI assignment. */
export interface RaciSetupSteps {
  milestonesDone: boolean;
  stakeholdersDone: boolean;
  assignedDone: boolean;
  next: 1 | 2 | 3 | null;
}

export function raciSetupSteps(input: {
  milestones: readonly Milestone[];
  stakeholders: readonly Stakeholder[];
}): RaciSetupSteps {
  const milestonesDone = input.milestones.length > 0;
  const stakeholdersDone = input.stakeholders.length > 0;
  // `raci` is sparse and keeps keys of deleted milestones (filtered at render), so count only live ones.
  const live = new Set(input.milestones.map((m) => String(m.id)));
  const assignedDone = input.stakeholders.some((s) => Object.entries(s.raci ?? {}).some(([id, role]) => !!role && live.has(id)));
  const next = !milestonesDone ? 1 : !stakeholdersDone ? 2 : !assignedDone ? 3 : null;
  return { milestonesDone, stakeholdersDone, assignedDone, next };
}

/** 1 = roles with a rate, 2 = disciplines and grades, 3 = people. Capacity, absences and
 *  allocations need people first, so the checklist names them in its intro, not as steps. */
export interface ResourcesSetupSteps {
  ratesDone: boolean;
  structureDone: boolean;
  peopleDone: boolean;
  next: 1 | 2 | 3 | null;
}

export function resourcesSetupSteps(input: {
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  resources: readonly Resource[];
}): ResourcesSetupSteps {
  // Steps 1 and 3 are the Budget checklist's steps 1 and 2: the same predicates, not a copy.
  const budget = budgetSetupSteps({ roles: input.roles, resources: input.resources, buckets: [] });
  const ratesDone = budget.ratesDone;
  const structureDone = input.disciplines.length > 0 && input.grades.length > 0;
  const peopleDone = budget.peopleDone;
  const next = !ratesDone ? 1 : !structureDone ? 2 : !peopleDone ? 3 : null;
  return { ratesDone, structureDone, peopleDone, next };
}

export type SetupViewId = "gantt";

const DISMISS_PREFIX = "aipm-cockpit:view-setup-dismissed:";
const DISMISSED = "1";

function dismissKey(view: SetupViewId, projectKey: string): string {
  return `${DISMISS_PREFIX}${view}:${projectKey}`;
}

export function isViewSetupDismissed(view: SetupViewId, projectKey: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(view, projectKey)) === DISMISSED;
  } catch {
    return false;
  }
}

export function setViewSetupDismissed(view: SetupViewId, projectKey: string): void {
  try {
    window.localStorage.setItem(dismissKey(view, projectKey), DISMISSED);
  } catch {
    // Storage refused: the line simply reappears on the next visit.
  }
}
