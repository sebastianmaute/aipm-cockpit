/**
 * Added people in a saved forecast scenario (§502, spec §4.1a) — pure, i18n-free, DOM-free.
 * An "Add people" row adds delivery at the current team's throughput per booked hour (ramped from the stored
 * `from`) and its own cost from day one (not ramped). Both are per-day arrays aligned with `simulatedDates`.
 */
import type { ForecastFacts } from "./budget-forecast";
import { MIN_SPEND_WORKING_DAYS } from "./forecast/constants";
import { spendSamples } from "./forecast/cost";
import { dayOnOrAfter, dayOnOrBefore } from "./forecast/day-index";
import type { AddPeopleChange } from "./forecast-scenarios";
import { currencyToBase, resolveRateSource } from "./fx";
import { absencesForResource } from "./resource-capacity";
import { resourceDisplayName } from "./resource-foundation";
import { materializeRoleRates } from "./role-rates";
import { DEFAULT_WEEK_HOURS } from "./types";
import type { Absence, BudgetBucket, BudgetCurrency, FxRates, Milestone, Resource, Role, Shift, Task } from "./types";
import { addCalendarDays, countWorkingDays } from "./working-days";

export type ScenarioDirectory = {
  resources: readonly Resource[]; roles: readonly Role[]; shifts: readonly Shift[]; absences: readonly Absence[];
  budgets: readonly BudgetBucket[]; fxRates: FxRates | null; workdayHours: number; baseCurrency: BudgetCurrency;
};

export type ScheduleContext = {
  today: string; holidaySet: ReadonlySet<string>; dates: readonly string[]; // simulatedDates(today, horizon, holidaySet)
  tasks: readonly Task[]; milestones: readonly Milestone[]; directory: ScenarioDirectory;
  windowDates: readonly string[]; hoursFacts: ForecastFacts | null;
  onTeam: ReadonlySet<number>; teamHours: number | null; // derived once from windowDates and hoursFacts
};

export type AddedPersonStatus =
  | { kind: "sized"; name: string; weeklyHours: number; ratePerHour: number;
      rateNote: "ok" | "no-rate" | "external" | "at-par"; shareAtFullSpeed: number }
  | { kind: "inert"; reason: "person-gone" | "on-team" | "ended" | "needs-booked-hours" };

const WORKING_WEEKDAYS = 5;
const MIN_TEAM_HOURS_PER_DAY = 1;

/** Booked hours on the window days / number of window days (zero days included); null when there are no hours
 *  facts, the hours samples miss the spend floor or are all zero, or the result is under 1 h. */
export function teamHoursPerDay(hoursFacts: ForecastFacts | null, windowDates: readonly string[]): number | null {
  if (hoursFacts === null) return null;
  const samples = spendSamples(hoursFacts.dated, windowDates);
  if (samples.length < MIN_SPEND_WORKING_DAYS || samples.every((s) => s === 0)) return null;
  const windowSet = new Set(windowDates);
  let booked = 0;
  for (const d of hoursFacts.dated) if (windowSet.has(d.date)) booked += d.value;
  const perDay = booked / windowDates.length;
  return perDay >= MIN_TEAM_HOURS_PER_DAY ? perDay : null;
}

/** A resource id for `resourceId` when it is in the directory, else the first resource whose case-folded display
 *  name is the trimmed, case-folded `name` (an empty name never matches) — the join `buildResourceWorkload` uses. */
function resourceResolver(resources: readonly Resource[]): (resourceId: number | null | undefined, name: string) => number | null {
  const ids = new Set(resources.map((r) => r.id));
  const byName = new Map<string, number>();
  for (const r of resources) {
    const key = resourceDisplayName(r).toLowerCase();
    if (key !== "" && !byName.has(key)) byName.set(key, r.id);
  }
  return (resourceId, name) => {
    if (resourceId != null && ids.has(resourceId)) return resourceId;
    return byName.get((name ?? "").trim().toLowerCase()) ?? null;
  };
}

/** Ids in any bucket's allocations[].resourceIds or disciplineAllocations[].resourceIds, plus the resource (by
 *  resourceId, else case-folded display name) of every Done task whose completedDate is a window date. */
export function onTeamResourceIds(
  tasks: readonly Task[], directory: ScenarioDirectory, windowDates: readonly string[],
): ReadonlySet<number> {
  const out = new Set<number>();
  for (const b of directory.budgets) {
    for (const a of b.allocations ?? []) for (const id of a.resourceIds) out.add(id);
    for (const a of b.disciplineAllocations ?? []) for (const id of a.resourceIds) out.add(id);
  }
  const windowSet = new Set(windowDates);
  const resolve = resourceResolver(directory.resources);
  for (const t of tasks) {
    if (t.status !== "Done" || !t.completedDate || !windowSet.has(t.completedDate)) continue;
    const id = resolve(t.resourceId, t.assignee);
    if (id !== null) out.add(id);
  }
  return out;
}

function weekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** Mon–Fri hours (index 0..6, Sun..Sat) summing to `hoursPerWeek` in the Shift's weekday proportions. */
function weekdayHours(shift: Shift | undefined, hoursPerWeek: number): number[] {
  const base = shift ? shift.hoursPerWeekday : DEFAULT_WEEK_HOURS;
  const weekdays = [1, 2, 3, 4, 5];
  const sum = weekdays.reduce((s, i) => s + Math.max(0, base[i]), 0);
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const i of weekdays) out[i] = sum > 0 ? (Math.max(0, base[i]) * hoursPerWeek) / sum : hoursPerWeek / WORKING_WEEKDAYS;
  return out;
}

/** The Shift `buildResourceWorkload` gives `r`: each Shift joins the resource `resourceResolver` names for it, and
 *  the LAST Shift joined to `r` wins, so a later name match replaces an earlier id match. */
export function shiftFor(r: Resource, dir: ScenarioDirectory): Shift | undefined {
  const resolve = resourceResolver(dir.resources);
  let found: Shift | undefined;
  for (const s of dir.shifts) if (resolve(s.resourceId, s.assignee) === r.id) found = s;
  return found;
}

type Sizing = { name: string; weeklyHours: number; ratePerHour: number; rateNote: "ok" | "no-rate" | "external" | "at-par";
  hoursOn: (date: string) => number };

function directorySizing(r: Resource, hoursPerWeek: number, dir: ScenarioDirectory): Sizing {
  const perWeekday = weekdayHours(shiftFor(r, dir), hoursPerWeek);
  const away = absencesForResource(dir.absences, r);
  const hoursOn = (date: string) => (away.some((a) => a.startDate <= date && date <= a.endDate) ? 0 : perWeekday[weekday(date)]);
  const role = r.roleId == null ? undefined : dir.roles.find((x) => x.id === r.roleId);
  const internalRate = role ? materializeRoleRates(role, dir.workdayHours).internalRate : 0;
  const name = resourceDisplayName(r);
  if (r.isExternal) return { name, weeklyHours: hoursPerWeek, ratePerHour: 0, rateNote: "external", hoursOn };
  if (!(internalRate > 0)) return { name, weeklyHours: hoursPerWeek, ratePerHour: 0, rateNote: "no-rate", hoursOn };
  return { name, weeklyHours: hoursPerWeek, ratePerHour: internalRate, rateNote: "ok", hoursOn };
}

function placeholderSizing(
  who: { label: string; count: number; rate: number; currency: BudgetCurrency; hoursPerWeek: number }, dir: ScenarioDirectory,
): Sizing {
  const weeklyHours = who.count * who.hoursPerWeek;
  const perDay = weeklyHours / WORKING_WEEKDAYS;
  const bucket = { currency: who.currency };
  const atPar = resolveRateSource(bucket, dir.fxRates, dir.baseCurrency) === "unresolved";
  return {
    name: who.label, weeklyHours,
    ratePerHour: currencyToBase(who.rate, bucket, dir.fxRates, dir.baseCurrency),
    rateNote: atPar ? "at-par" : "ok",
    hoursOn: () => perDay,
  };
}

function inert(reason: "person-gone" | "on-team" | "ended" | "needs-booked-hours", length: number) {
  return { status: { kind: "inert", reason } as AddedPersonStatus, share: new Float64Array(length), cost: new Float64Array(length) };
}

/** The row's day window `[max(1, dayOnOrAfter(from)), until ? dayOnOrBefore(until) : horizon]`, shared with
 *  availability rows; empty (first > last) when `from` is past the last simulated day. */
export function changeDayWindow(dates: readonly string[], from: string, until: string): { first: number; last: number } {
  return { first: Math.max(1, dayOnOrAfter(dates, from)), last: until ? dayOnOrBefore(dates, until) : dates.length - 1 };
}

/** One "Add people" row as per-day `share` (capacity added to the multiplier) and `cost` (baseline currency). */
export function resolveAddedPeople(
  c: AddPeopleChange, ctx: ScheduleContext,
): { status: AddedPersonStatus; share: Float64Array; cost: Float64Array } {
  const { dates, directory: dir } = ctx;
  let sizing: Sizing;
  if ("resourceId" in c.who) {
    const resourceId = c.who.resourceId;
    const r = dir.resources.find((x) => x.id === resourceId);
    if (!r) return inert("person-gone", dates.length);
    if (ctx.onTeam.has(r.id)) return inert("on-team", dates.length);
    sizing = directorySizing(r, c.who.hoursPerWeek, dir);
  } else {
    sizing = placeholderSizing(c.who, dir);
  }
  if (c.until !== "" && c.until < ctx.today) return inert("ended", dates.length);
  const teamHours = ctx.teamHours;
  if (teamHours === null) return inert("needs-booked-hours", dates.length);

  const share = new Float64Array(dates.length);
  const cost = new Float64Array(dates.length);
  const { first, last } = changeDayWindow(dates, c.from, c.until);
  const fullRamp = WORKING_WEEKDAYS * c.rampWeeks;
  // w = working days since the stored `from`, the first one counting 1, so progress made before today is kept.
  // `from` <= dates[first] and consecutive indices are consecutive working days, so w grows by one per index:
  // counted once, not per day (a stored `from` years back would make a per-day count quadratic).
  const wFirst = first <= last ? countWorkingDays(c.from, addCalendarDays(dates[first], 1), ctx.holidaySet) : 0;
  for (let d = first; d <= last; d += 1) {
    const hours = sizing.hoursOn(dates[d]);
    const w = wFirst + (d - first);
    const ramp = c.rampWeeks === 0 ? 1 : Math.min(1, w / fullRamp);
    share[d] = (hours * ramp) / teamHours;
    cost[d] = hours * sizing.ratePerHour;
  }
  return {
    status: {
      kind: "sized", name: sizing.name, weeklyHours: sizing.weeklyHours, ratePerHour: sizing.ratePerHour,
      rateNote: sizing.rateNote, shareAtFullSpeed: sizing.weeklyHours / WORKING_WEEKDAYS / teamHours,
    },
    share,
    cost,
  };
}
