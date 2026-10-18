/**
 * The lever engine (§502, part 4): the smallest single lever — people added, or tasks removed — that lifts a target's
 * chance to the goal. Pure, immutable, i18n-free, React-free.
 *
 * Every probe is one `computeScenarioColumn` over the same input and context, so the probes share random numbers
 * with As is and with each other: the chance is non-decreasing in n up to a trial's resolution, which is what makes
 * bisection sound. The search is a step machine (`startSearch` / `nextProbe` / `applyProbe` / `searchOutcome`) so a
 * hook can run one probe per macrotask and discard the whole state when the inputs change.
 */
import type { ScenarioDirectory, ScheduleContext } from "./forecast-added-people";
import { computeScenarioColumn, type ScenarioColumn, type ScenarioRunInput } from "./forecast-scenario-compare";
import {
  ADDED_COUNT_MAX, ADDED_HOURS_MAX, ADDED_HOURS_MIN, DEFAULT_RAMP_WEEKS,
  type AddedPeopleWho, type ScenarioChange,
} from "./forecast-scenarios";
import type { TargetConfidence } from "./forecast-target";
import { materializeRoleRates } from "./role-rates";
import { isTaskClosed } from "./task-closed";
import type { Task } from "./types";

export type LeverTarget = { kind: "milestone"; id: number } | { kind: "planEnd" };
export type LeverKind = "people" | "tasks";
export type LeverOutcome =
  /** `hours`: the tasks lever's n in hours (n × the mean estimate of the target's estimated open tasks, whole hours);
   *  null for people, and for tasks when none of them carries an estimate. */
  | { state: "reaches"; n: number; chance: number; hours: number | null }
  | { state: "out-of-reach" }
  /** `too-few-tasks`: open tasks exist but fewer than two, so the tasks lever (at most half of them) has nothing to drop. */
  | { state: "inert"; reason: "needs-booked-hours" | "no-open-tasks" | "too-few-tasks" }
  | { state: "on-target" };
export type WhatItTakes = {
  target: LeverTarget;
  /** As is. */
  chance: number;
  /** The milestone's chance when its own tasks come first; null for the plan end. */
  prioritised: number | null;
  people: LeverOutcome;
  tasks: LeverOutcome;
};

/** The engine's default label for the placeholder row (it stays i18n-free: a caller that shows the row to a person
 *  overrides it with the translated placeholder name, as `exploreSeeds` does). */
const LEVER_PLACEHOLDER_LABEL = "Placeholder";
const WORKING_WEEKDAYS = 5;
const PERCENT = 100;
const TASKS_BOUND_DIVISOR = 2;
const MINUTES_PER_HOUR = 60;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Open tasks the lever can take off: the milestone's open linked tasks, or every open task for the plan end. */
function openTasks(target: LeverTarget, context: ScheduleContext): readonly Task[] {
  if (target.kind === "planEnd") return context.tasks.filter((t) => !isTaskClosed(t));
  const milestone = context.milestones.find((m) => m.id === target.id);
  if (!milestone) return [];
  const linked = new Set(milestone.linkedTaskIds);
  return context.tasks.filter((t) => linked.has(t.id) && !isTaskClosed(t));
}

function openCount(target: LeverTarget, context: ScheduleContext): number {
  return openTasks(target, context).length;
}

/** The mean estimate, in hours, of the target's open tasks that carry one (the field effort mode reads,
 *  `originalEstimateMinutes` > 0); null when none does. */
export function meanTaskHours(target: LeverTarget, context: ScheduleContext): number | null {
  const minutes = openTasks(target, context).map((t) => t.originalEstimateMinutes ?? 0).filter((m) => m > 0);
  return minutes.length === 0 ? null : minutes.reduce((s, m) => s + m, 0) / minutes.length / MINUTES_PER_HOUR;
}

/** One added placeholder, sized from the team: the team's booked hours per person per week, at the mean internal
 *  rate of the on-team people who have one (an external or role-less person has no internal rate to average).
 *  Null when there are no booked hours or no team. */
export function placeholderWho(context: ScheduleContext, directory: ScenarioDirectory): AddedPeopleWho | null {
  if (context.teamHours === null || context.onTeam.size === 0) return null;
  const hoursPerWeek = clamp(
    Math.round((context.teamHours * WORKING_WEEKDAYS) / context.onTeam.size), ADDED_HOURS_MIN, ADDED_HOURS_MAX,
  );
  const rates: number[] = [];
  for (const r of directory.resources) {
    if (!context.onTeam.has(r.id) || r.isExternal || r.roleId == null) continue;
    const role = directory.roles.find((x) => x.id === r.roleId);
    const rate = role ? materializeRoleRates(role, directory.workdayHours).internalRate : 0;
    if (rate > 0) rates.push(rate);
  }
  const rate = rates.length === 0 ? 0 : rates.reduce((s, x) => s + x, 0) / rates.length;
  return { label: LEVER_PLACEHOLDER_LABEL, count: 1, rate, currency: directory.baseCurrency, hoursPerWeek };
}

/** The scenario change n of a lever stands for. People need a sized `who` (see `placeholderWho`). */
export function leverChange(
  kind: LeverKind, n: number, target: LeverTarget, who: AddedPeopleWho | null, today: string,
): ScenarioChange {
  if (kind === "people") {
    if (who === null || !("label" in who)) throw new Error("the people lever needs a sized placeholder");
    return { kind: "addPeople", who: { ...who, count: n }, from: today, until: "", rampWeeks: DEFAULT_RAMP_WEEKS };
  }
  return target.kind === "milestone"
    ? { kind: "scope", tasks: -n, on: today, milestoneId: target.id }
    : { kind: "scope", tasks: -n, on: today };
}

/** The most n a lever is searched up to: the team's size (capped), or half the open work. */
export function leverBound(kind: LeverKind, target: LeverTarget, context: ScheduleContext): number {
  if (kind === "people") return Math.min(context.onTeam.size, ADDED_COUNT_MAX);
  return Math.floor(openCount(target, context) / TASKS_BOUND_DIVISOR);
}

/** The target's chance in a column (0..1); null for an overdue milestone, one with nothing linked, one that is
 *  not there, an insufficient run, or a plan end with no valid date. */
export function chanceFor(column: ScenarioColumn, target: LeverTarget): number | null {
  if (target.kind === "planEnd") return column.chanceOnTime;
  if (column.forecast.kind !== "forecast") return null;
  const m = column.forecast.milestones.find((x) => x.id === target.id);
  return m !== undefined && m.state === "chance" ? m.chance : null;
}

/** `lo..hi` still undecided, `hi` known to reach (with `hiChance`). */
export type LeverSearch = {
  bound: number;
  goal: number;
  phase: "bound" | "bisect" | "done";
  lo: number;
  hi: number;
  hiChance: number;
  reached: boolean;
};

export function startSearch(bound: number, goal: number): LeverSearch {
  const hasRoom = bound >= 1;
  return { bound, goal, phase: hasRoom ? "bound" : "done", lo: 1, hi: bound, hiChance: 0, reached: false };
}

/** The n to probe next; null when the search is done. */
export function nextProbe(s: LeverSearch): number | null {
  if (s.phase === "done") return null;
  return s.phase === "bound" ? s.bound : Math.floor((s.lo + s.hi) / 2);
}

/** Folds one probe result in. A null chance does not reach the goal. */
export function applyProbe(s: LeverSearch, n: number, chance: number | null): LeverSearch {
  const reaches = chance !== null && chance >= s.goal / PERCENT;
  if (s.phase === "done") return s;
  if (s.phase === "bound") {
    if (!reaches) return { ...s, phase: "done" };
    return settle({ ...s, phase: "bisect", hi: n, hiChance: chance, reached: true });
  }
  return settle(reaches ? { ...s, hi: n, hiChance: chance } : { ...s, lo: n + 1 });
}

function settle(s: LeverSearch): LeverSearch {
  return s.lo >= s.hi ? { ...s, phase: "done" } : s;
}

/** The result of a finished search. An UNFINISHED search (phase not "done") reads as out of reach, by definition:
 *  it has proved nothing, and never reports a reach it has not confirmed. Ask `nextProbe` first. */
export function searchOutcome(s: LeverSearch): LeverOutcome {
  if (s.phase !== "done") return { state: "out-of-reach" };
  return s.reached ? { state: "reaches", n: s.hi, chance: s.hiChance, hours: null } : { state: "out-of-reach" };
}

/** A lever still searching, or its settled outcome. */
export type LeverJob = { kind: LeverKind; who: AddedPeopleWho | null; search: LeverSearch };
export type LeverSlot = LeverOutcome | LeverJob;
/** What the step machine carries for one target: the as-is facts, one slot per lever, and the hours one removed task
 *  stands for (`meanTaskHours`), which `settlePlan` turns the tasks lever's n into. */
export type WhatItTakesPlan = {
  base: Pick<WhatItTakes, "target" | "chance" | "prioritised">;
  people: LeverSlot;
  tasks: LeverSlot;
  taskHours: number | null;
};

function isJob(slot: LeverSlot): slot is LeverJob {
  return "search" in slot;
}

function jobSlot(kind: LeverKind, target: LeverTarget, context: ScheduleContext, goal: TargetConfidence, who: AddedPeopleWho | null): LeverSlot {
  const search = startSearch(leverBound(kind, target, context), goal);
  return nextProbe(search) === null ? searchOutcome(search) : { kind, who, search };
}

function stepSlot(slot: LeverSlot, input: ScenarioRunInput, context: ScheduleContext, target: LeverTarget): LeverSlot {
  if (!isJob(slot)) return slot;
  const n = nextProbe(slot.search);
  if (n === null) return searchOutcome(slot.search);
  const column = computeScenarioColumn(input, [leverChange(slot.kind, n, target, slot.who, input.today)], context);
  const search = applyProbe(slot.search, n, chanceFor(column, target));
  return nextProbe(search) === null ? searchOutcome(search) : { ...slot, search };
}

/**
 * The start of a target's search, before any probe. Null when As is has no chance for the target (callers skip those
 * targets); already settled when the target is on target or both levers are inert.
 */
export function planWhatItTakes(
  input: ScenarioRunInput, context: ScheduleContext, target: LeverTarget, goal: TargetConfidence, asIs: ScenarioColumn,
): WhatItTakesPlan | null {
  const chance = chanceFor(asIs, target);
  if (chance === null) return null;
  const milestone = asIs.forecast.kind === "forecast" && target.kind === "milestone"
    ? asIs.forecast.milestones.find((x) => x.id === target.id) : undefined;
  const prioritised = milestone !== undefined && milestone.state === "chance" ? milestone.chancePrioritised : null;
  const base = { target, chance, prioritised };
  if (chance >= goal / PERCENT) {
    return { base, people: { state: "on-target" }, tasks: { state: "on-target" }, taskHours: null };
  }
  const who = placeholderWho(context, input.directory);
  const people: LeverSlot = who === null
    ? { state: "inert", reason: "needs-booked-hours" } : jobSlot("people", target, context, goal, who);
  const open = openCount(target, context);
  const tasks: LeverSlot = open === 0
    ? { state: "inert", reason: "no-open-tasks" }
    : leverBound("tasks", target, context) < 1
      ? { state: "inert", reason: "too-few-tasks" } : jobSlot("tasks", target, context, goal, null);
  return { base, people, tasks, taskHours: meanTaskHours(target, context) };
}

export function isPlanSettled(plan: WhatItTakesPlan): boolean {
  return !isJob(plan.people) && !isJob(plan.tasks);
}

/** The input the probes run on: no cost pass, since no lever reads cost. The cost pass draws from its own seeded
 *  streams and moves no schedule number (docs/AGENTS/forecast.md, "Seeded, one sub-stream per trial"), so a probe's
 *  chance is the same with or without it; the As-is column used for display keeps its own input. Build it once per run. */
export function probeInput(input: ScenarioRunInput): ScenarioRunInput {
  return input.costOn ? { ...input, costOn: false } : input;
}

/** One probe of the first lever still searching (a settled plan comes back unchanged). */
export function stepPlan(plan: WhatItTakesPlan, input: ScenarioRunInput, context: ScheduleContext): WhatItTakesPlan {
  const { target } = plan.base;
  return isJob(plan.people)
    ? { ...plan, people: stepSlot(plan.people, input, context, target) }
    : { ...plan, tasks: stepSlot(plan.tasks, input, context, target) };
}

/** The finished result of a settled plan (an unsettled lever reads as out of reach: check `isPlanSettled` first).
 *  The ONE place a reaching tasks lever gains its hours, so `whatItTakesSync` and the hook agree by construction. */
export function settlePlan(plan: WhatItTakesPlan): WhatItTakes {
  const outcome = (slot: LeverSlot): LeverOutcome => (isJob(slot) ? searchOutcome(slot.search) : slot);
  const tasks = outcome(plan.tasks);
  const hours = tasks.state === "reaches" && plan.taskHours !== null ? Math.round(tasks.n * plan.taskHours) : null;
  return { ...plan.base, people: outcome(plan.people), tasks: tasks.state === "reaches" ? { ...tasks, hours } : tasks };
}

/**
 * Both searches, run to completion, for callers that need the whole answer at once (the AI tool and the exports are
 * planned; the Forecast view drives `stepPlan` itself through `useLeverSearch`).
 * Defined only for a target with a chance: null when As is has none — callers skip those targets.
 */
export function whatItTakesSync(
  input: ScenarioRunInput, context: ScheduleContext, target: LeverTarget, goal: TargetConfidence, asIs: ScenarioColumn,
): WhatItTakes | null {
  let plan = planWhatItTakes(input, context, target, goal, asIs);
  if (plan === null) return null;
  const probes = probeInput(input);
  while (!isPlanSettled(plan)) plan = stepPlan(plan, probes, context);
  return settlePlan(plan);
}
