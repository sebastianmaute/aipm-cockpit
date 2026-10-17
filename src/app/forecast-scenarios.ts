/** Saved forecast scenarios (§502) — pure, i18n-free, DOM-free. */
import type { WhatIf } from "./forecast";
import { isValidIsoDate } from "./forecast/throughput";
import { isAttributableMilestone } from "./forecast/milestones";
import { isBudgetCurrency } from "./types";
import type { BudgetCurrency, Milestone, Resource } from "./types";

export type AvailabilityChange = { kind: "availability"; percent: number; from: string; until: string }; // until "" = to the end
export type AddedPeopleWho =
  | { resourceId: number; hoursPerWeek: number }
  | { label: string; count: number; rate: number; currency: BudgetCurrency; hoursPerWeek: number };
export type AddPeopleChange = { kind: "addPeople"; who: AddedPeopleWho; from: string; until: string; rampWeeks: number };
export type ScopeChange = { kind: "scope"; tasks: number; on: string; milestoneId?: number };
export type ScenarioChange = AvailabilityChange | AddPeopleChange | ScopeChange;
export type ForecastScenario = { id: number; name: string; changes: readonly ScenarioChange[] };

export const MAX_FORECAST_SCENARIOS = 4;
export const MAX_SCENARIO_CHANGES = 20;
export const SCENARIO_NAME_MAX = 60;
export const AVAILABILITY_MIN = 10;
export const AVAILABILITY_MAX = 300;
export const ADDED_HOURS_MIN = 1;
export const ADDED_HOURS_MAX = 60;
export const ADDED_COUNT_MAX = 20;
export const RAMP_WEEKS_MAX = 26;
export const DEFAULT_RAMP_WEEKS = 4;
export const PLACEHOLDER_RATE_MAX = 100_000;
export const SCOPE_TASKS_MAX = 1000; // |tasks|, the What-if field's own bound (MAX_SCOPE_TASKS)

export type ScenarioChangeError =
  | "date" | "until-before-from" | "percent" | "hours" | "count" | "ramp" | "rate" | "currency" | "label"
  | "tasks" | "milestone-unknown" | "milestone-finished" | "resource-unknown" | "resource-archived" | "on-team";
export type ScenarioError = "name-empty" | "name-long" | "name-taken" | "too-many-changes" | "cap";
export type ValidationContext = {
  milestones: readonly Milestone[];
  resources: readonly Resource[];
  onTeam: ReadonlySet<number>;
};

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function isId(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/** `until` is "" (to the end) or a valid date not before `from`. */
function untilOk(from: string, until: unknown): until is string {
  return until === "" || (typeof until === "string" && isValidIsoDate(until) && until >= from);
}

function sanitizeWho(raw: unknown): AddedPeopleWho | null {
  if (!isRec(raw) || !isNum(raw.hoursPerWeek)) return null;
  const hoursPerWeek = clamp(raw.hoursPerWeek, ADDED_HOURS_MIN, ADDED_HOURS_MAX);
  const hasResource = "resourceId" in raw;
  const hasLabel = "label" in raw || "count" in raw || "rate" in raw || "currency" in raw;
  if (hasResource === hasLabel) return null;
  if (hasResource) return isId(raw.resourceId) ? { resourceId: raw.resourceId, hoursPerWeek } : null;
  if (typeof raw.label !== "string" || !isNum(raw.count) || !isNum(raw.rate) || !isBudgetCurrency(raw.currency)) return null;
  const label = raw.label.trim().slice(0, SCENARIO_NAME_MAX);
  if (label === "") return null;
  return {
    label,
    count: clamp(Math.round(raw.count), 1, ADDED_COUNT_MAX),
    rate: clamp(raw.rate, 0, PLACEHOLDER_RATE_MAX),
    currency: raw.currency,
    hoursPerWeek,
  };
}

function sanitizeChange(raw: unknown): ScenarioChange | null {
  if (!isRec(raw)) return null;
  if (raw.kind === "scope") {
    if (!isNum(raw.tasks) || typeof raw.on !== "string" || !isValidIsoDate(raw.on)) return null;
    const tasks = clamp(Math.round(raw.tasks), -SCOPE_TASKS_MAX, SCOPE_TASKS_MAX);
    if (tasks === 0) return null;
    return isId(raw.milestoneId)
      ? { kind: "scope", tasks, on: raw.on, milestoneId: raw.milestoneId }
      : { kind: "scope", tasks, on: raw.on };
  }
  if (raw.kind !== "availability" && raw.kind !== "addPeople") return null;
  if (typeof raw.from !== "string" || !isValidIsoDate(raw.from) || !untilOk(raw.from, raw.until)) return null;
  const { from, until } = raw as { from: string; until: string };
  if (raw.kind === "availability") {
    if (!isNum(raw.percent)) return null;
    return { kind: "availability", percent: clamp(raw.percent, AVAILABILITY_MIN, AVAILABILITY_MAX), from, until };
  }
  const who = sanitizeWho(raw.who);
  if (!who) return null;
  const ramp = raw.rampWeeks === undefined ? DEFAULT_RAMP_WEEKS : raw.rampWeeks;
  if (!isNum(ramp)) return null;
  return { kind: "addPeople", who, from, until, rampWeeks: clamp(Math.round(ramp), 0, RAMP_WEEKS_MAX) };
}

/** Read-side sanitizer (§4.3). The 4-cap and name uniqueness are creation rules, so they are not enforced here. */
export function sanitizeForecastScenarios(raw: unknown): ForecastScenario[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: ForecastScenario[] = [];
  for (const item of raw) {
    if (!isRec(item) || !isId(item.id) || seen.has(item.id) || typeof item.name !== "string") continue;
    const name = item.name.trim().slice(0, SCENARIO_NAME_MAX).trim();
    if (name === "") continue;
    seen.add(item.id);
    const rows = Array.isArray(item.changes) ? item.changes : [];
    const changes: ScenarioChange[] = [];
    for (const row of rows) {
      const c = sanitizeChange(row);
      if (c) changes.push(c);
      if (changes.length >= MAX_SCENARIO_CHANGES) break;
    }
    out.push({ id: item.id, name, changes });
  }
  return out;
}

function validateWho(who: AddedPeopleWho, ctx: ValidationContext): ScenarioChangeError | null {
  if (!isNum(who.hoursPerWeek) || who.hoursPerWeek < ADDED_HOURS_MIN || who.hoursPerWeek > ADDED_HOURS_MAX) return "hours";
  if ("resourceId" in who) {
    const r = ctx.resources.find((x) => x.id === who.resourceId);
    if (!r) return "resource-unknown";
    if (r.active === false) return "resource-archived";
    return ctx.onTeam.has(who.resourceId) ? "on-team" : null;
  }
  const label = typeof who.label === "string" ? who.label.trim() : "";
  if (label === "" || label.length > SCENARIO_NAME_MAX) return "label";
  if (!Number.isInteger(who.count) || who.count < 1 || who.count > ADDED_COUNT_MAX) return "count";
  if (!isNum(who.rate) || who.rate < 0 || who.rate > PLACEHOLDER_RATE_MAX) return "rate";
  return isBudgetCurrency(who.currency) ? null : "currency";
}

/** Write-side check of one row (the editor and the AI tools). Returns the first error, or null. */
export function validateScenarioChange(c: ScenarioChange, ctx: ValidationContext): ScenarioChangeError | null {
  if (c.kind === "scope") {
    if (!isValidIsoDate(c.on)) return "date";
    if (!Number.isInteger(c.tasks) || c.tasks === 0 || Math.abs(c.tasks) > SCOPE_TASKS_MAX) return "tasks";
    if (c.milestoneId === undefined) return null;
    const m = ctx.milestones.find((x) => x.id === c.milestoneId);
    if (!m) return "milestone-unknown";
    return isAttributableMilestone(m) ? null : "milestone-finished";
  }
  if (!isValidIsoDate(c.from) || (c.until !== "" && !isValidIsoDate(c.until))) return "date";
  if (c.until !== "" && c.until < c.from) return "until-before-from";
  if (c.kind === "availability") {
    return isNum(c.percent) && c.percent >= AVAILABILITY_MIN && c.percent <= AVAILABILITY_MAX ? null : "percent";
  }
  if (!Number.isInteger(c.rampWeeks) || c.rampWeeks < 0 || c.rampWeeks > RAMP_WEEKS_MAX) return "ramp";
  return validateWho(c.who, ctx);
}

export function isScenarioNameTaken(list: readonly ForecastScenario[], name: string, exceptId: number | null): boolean {
  const key = name.trim().toLowerCase();
  return list.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === key);
}

export function validateScenarioDraft(
  d: { name: string; changes: readonly ScenarioChange[] },
  list: readonly ForecastScenario[],
  exceptId: number | null,
): ScenarioError | null {
  // "cap" first: no edit to the draft can fix it, so a caller at the cap is told so before anything else.
  if (exceptId === null && list.length >= MAX_FORECAST_SCENARIOS) return "cap";
  const name = d.name.trim();
  if (name === "") return "name-empty";
  if (name.length > SCENARIO_NAME_MAX) return "name-long";
  if (isScenarioNameTaken(list, name, exceptId)) return "name-taken";
  if (d.changes.length > MAX_SCENARIO_CHANGES) return "too-many-changes";
  return null;
}

export function addScenario(list: readonly ForecastScenario[], s: ForecastScenario): ForecastScenario[] {
  return [...list, s];
}

export function replaceScenario(list: readonly ForecastScenario[], s: ForecastScenario): ForecastScenario[] {
  return list.map((x) => (x.id === s.id ? s : x));
}

export function removeScenario(list: readonly ForecastScenario[], id: number): ForecastScenario[] {
  return list.filter((x) => x.id !== id);
}

/** "Save as scenario", fed the CLAMPED What-if the panel uses (`usedWhatIf`): an availability row from today with no
 *  end when capacity ≠ 100, and one unattributed scope row on today of scopeTasks + round-half-up(openCount ×
 *  scopePercent / 100) when that is ≠ 0. Exact parity with What-if holds in the tasks unit only (effort takes the
 *  percent of the effort sum; a scenario sizes each task at the median). The row is clamped to ±SCOPE_TASKS_MAX (What-if
 *  allows 1000 plus a percent on top); `clamped` says so, and `percentTasks` stays the unclamped percent part. */
export function whatIfToScenarioChanges(
  w: WhatIf,
  openCount: number,
  today: string,
): { changes: ScenarioChange[]; percentTasks: number; clamped: boolean } {
  const changes: ScenarioChange[] = [];
  if (w.capacityPercent !== 100) {
    changes.push({ kind: "availability", percent: w.capacityPercent, from: today, until: "" });
  }
  const percentTasks = Math.round((openCount * w.scopePercent) / 100);
  const total = w.scopeTasks + percentTasks;
  const tasks = clamp(total, -SCOPE_TASKS_MAX, SCOPE_TASKS_MAX);
  if (tasks !== 0) changes.push({ kind: "scope", tasks, on: today });
  return { changes, percentTasks, clamped: tasks !== total };
}
