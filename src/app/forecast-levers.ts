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

export type LeverTarget = { kind: "milestone"; id: number } | { kind: "planEnd" };
export type LeverKind = "people" | "tasks";
export type LeverOutcome =
  | { state: "reaches"; n: number; chance: number }
  | { state: "out-of-reach" }
  | { state: "inert"; reason: "needs-booked-hours" | "no-open-tasks" }
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

/** The label a placeholder row carries when no one has named it (the editor's own placeholder option, in data). */
export const LEVER_PLACEHOLDER_LABEL = "Placeholder";
const WORKING_WEEKDAYS = 5;
const PERCENT = 100;
const TASKS_BOUND_DIVISOR = 2;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Open tasks the lever can take off: the milestone's open linked tasks, or every open task for the plan end. */
function openCount(target: LeverTarget, context: ScheduleContext): number {
  if (target.kind === "planEnd") return context.tasks.filter((t) => !isTaskClosed(t)).length;
  const milestone = context.milestones.find((m) => m.id === target.id);
  if (!milestone) return 0;
  const linked = new Set(milestone.linkedTaskIds);
  return context.tasks.filter((t) => linked.has(t.id) && !isTaskClosed(t)).length;
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

/** `lo..hi` still undecided, `hi` known to reach (with `hiChance`); `probes` counts what was applied. */
export type LeverSearch = {
  bound: number;
  goal: number;
  phase: "bound" | "bisect" | "done";
  lo: number;
  hi: number;
  hiChance: number;
  probes: number;
  reached: boolean;
};

export function startSearch(bound: number, goal: number): LeverSearch {
  const hasRoom = bound >= 1;
  return { bound, goal, phase: hasRoom ? "bound" : "done", lo: 1, hi: bound, hiChance: 0, probes: 0, reached: false };
}

/** The n to probe next; null when the search is done. */
export function nextProbe(s: LeverSearch): number | null {
  if (s.phase === "done") return null;
  return s.phase === "bound" ? s.bound : Math.floor((s.lo + s.hi) / 2);
}

/** Folds one probe result in. A null chance does not reach the goal. */
export function applyProbe(s: LeverSearch, n: number, chance: number | null): LeverSearch {
  const reaches = chance !== null && chance >= s.goal / PERCENT;
  const probes = s.probes + 1;
  if (s.phase === "done") return s;
  if (s.phase === "bound") {
    if (!reaches) return { ...s, phase: "done", probes };
    return settle({ ...s, phase: "bisect", hi: n, hiChance: chance, probes, reached: true });
  }
  return settle(reaches ? { ...s, hi: n, hiChance: chance, probes } : { ...s, lo: n + 1, probes });
}

function settle(s: LeverSearch): LeverSearch {
  return s.lo >= s.hi ? { ...s, phase: "done" } : s;
}

/** The result of a finished search (an unfinished one reads as out of reach: ask `nextProbe` first). */
export function searchOutcome(s: LeverSearch): LeverOutcome {
  return s.phase === "done" && s.reached ? { state: "reaches", n: s.hi, chance: s.hiChance } : { state: "out-of-reach" };
}

function runSearch(
  input: ScenarioRunInput, context: ScheduleContext, target: LeverTarget, goal: TargetConfidence,
  kind: LeverKind, who: AddedPeopleWho | null,
): LeverOutcome {
  let s = startSearch(leverBound(kind, target, context), goal);
  for (let n = nextProbe(s); n !== null; n = nextProbe(s)) {
    const column = computeScenarioColumn(input, [leverChange(kind, n, target, who, input.today)], context);
    s = applyProbe(s, n, chanceFor(column, target));
  }
  return searchOutcome(s);
}

/**
 * Both searches, run to completion (the AI tool and the exports; the Reports section drives the step machine itself).
 * Defined only for a target with a chance: null when As is has none — callers skip those targets.
 */
export function whatItTakesSync(
  input: ScenarioRunInput, context: ScheduleContext, target: LeverTarget, goal: TargetConfidence, asIs: ScenarioColumn,
): WhatItTakes | null {
  const chance = chanceFor(asIs, target);
  if (chance === null) return null;
  const milestone = asIs.forecast.kind === "forecast" && target.kind === "milestone"
    ? asIs.forecast.milestones.find((x) => x.id === target.id) : undefined;
  const prioritised = milestone !== undefined && milestone.state === "chance" ? milestone.chancePrioritised : null;
  const base = { target, chance, prioritised };
  if (chance >= goal / PERCENT) return { ...base, people: { state: "on-target" }, tasks: { state: "on-target" } };
  const who = placeholderWho(context, input.directory);
  const people: LeverOutcome = who === null
    ? { state: "inert", reason: "needs-booked-hours" }
    : runSearch(input, context, target, goal, "people", who);
  const tasks: LeverOutcome = openCount(target, context) === 0
    ? { state: "inert", reason: "no-open-tasks" }
    : runSearch(input, context, target, goal, "tasks", null);
  return { ...base, people, tasks };
}
