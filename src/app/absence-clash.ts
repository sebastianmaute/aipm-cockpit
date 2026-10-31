// src/app/absence-clash.ts — the one rule for "does this work land on a day its owner is away" (§773)
// and the one "who is away" summary the AI features read. Pure and i18n-free: the sentence lives in
// absence-clash-notice.ts.
import { absenceWorkdays, absencesForResource, workdaysInRange } from "./resource-capacity";
import { isoAddDays } from "./due-dates";
import { oneLine } from "./rich-text-plain";
import { resourceDisplayName } from "./resource-foundation";
import type { Absence, Milestone, Resource, Task } from "./types";

export interface AbsenceCtx {
  absences: readonly Absence[];
  resources: readonly Resource[];
  holidaySet: ReadonlySet<string>;
}
export interface PersonRef { resourceId?: number | null; name: string }
export interface AbsenceRange { start: string; end: string }
export type ClashReason = "date-on-absence" | "absent-most-of-span";
/** Which date of the work fell on the absence (set for `date-on-absence` only). */
export type ClashDate = "due" | "start" | "milestone";
export interface AbsenceClash {
  person: string;
  resourceId?: number;
  reason: ClashReason;
  which?: ClashDate;
  date?: string;
  ranges: AbsenceRange[];
}

/** One clash as the AI reads it (§773): who, why, the date when one fell on the absence, and the absence
 *  ranges — only "absent" and the dates, never the absence's type or note. The chat's date-tool results and
 *  its staged results both use it, so Claude sees one shape. */
export interface AbsenceClashForAi { person: string; reason: ClashReason; date?: string; ranges: AbsenceRange[] }

export function clashesForAi(clashes: readonly AbsenceClash[]): AbsenceClashForAi[] {
  return clashes.map(({ person, reason, date, ranges }) => ({
    person, reason, ...(date !== undefined ? { date } : {}), ranges: ranges.map((r) => ({ ...r })),
  }));
}

export const AWAY_SUMMARY_MAX_LINES = 60;
/** Ranges listed on one person's line; the rest are summarised as " +K more". */
export const AWAY_SUMMARY_MAX_RANGES = 10;
/** Days past today a "who is away" window reaches: the readers' window, and the WBS plan's fallback. */
export const AWAY_WINDOW_DAYS = 28;
/** The holiday set for a caller that has none to thread: no day is a holiday. Shared so every caller
 *  falls back to the same (frozen-by-convention) instance. */
export const NO_HOLIDAYS: ReadonlySet<string> = new Set();
/** Same bound as `absenceDayMap`: an absence counts for its first 366 days only. */
const ABSENCE_MAX_DAYS = 366;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDay(v: string | undefined): v is string {
  return typeof v === "string" && ISO_DAY.test(v);
}

/** The usable range of an absence: null when malformed or ending before it starts. */
function usableRange(a: Absence): AbsenceRange | null {
  if (!isIsoDay(a.startDate) || !isIsoDay(a.endDate) || a.endDate < a.startDate) return null;
  const cap = isoAddDays(a.startDate, ABSENCE_MAX_DAYS - 1);
  return { start: a.startDate, end: a.endDate < cap ? a.endDate : cap };
}

function linkedResource(p: PersonRef, ctx: AbsenceCtx): Resource | undefined {
  return p.resourceId == null ? undefined : ctx.resources.find((r) => r.id === p.resourceId);
}

/** The matcher: a `resourceId` naming a listed resource goes through `absencesForResource`; an unlinked
 *  person (no id, or an id that names no listed resource) matches on the typed name, trimmed and
 *  case-insensitive, against `Absence.assignee`. */
export function absencesOfPerson(p: PersonRef, ctx: AbsenceCtx): Absence[] {
  const resource = linkedResource(p, ctx);
  if (resource) return absencesForResource(ctx.absences, resource);
  const key = p.name.trim().toLowerCase();
  if (!key) return [];
  return ctx.absences.filter((a) => (a.assignee ?? "").trim().toLowerCase() === key);
}

function mergeRanges(ranges: readonly AbsenceRange[]): AbsenceRange[] {
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const out: AbsenceRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= isoAddDays(last.end, 1)) {
      if (r.end > last.end) out[out.length - 1] = { start: last.start, end: r.end };
    } else out.push({ ...r });
  }
  return out;
}

function baseClash(p: PersonRef, ctx: AbsenceCtx): Pick<AbsenceClash, "person" | "resourceId"> {
  const resource = linkedResource(p, ctx);
  return resource
    ? { person: oneLine(resourceDisplayName(resource)), resourceId: resource.id }
    : { person: oneLine(p.name) };
}

function dateClash(p: PersonRef, date: string | undefined, which: ClashDate, ctx: AbsenceCtx): AbsenceClash | null {
  if (!isIsoDay(date)) return null;
  const hits = absencesOfPerson(p, ctx)
    .map(usableRange)
    .filter((r): r is AbsenceRange => r !== null && r.start <= date && date <= r.end);
  if (hits.length === 0) return null;
  return { ...baseClash(p, ctx), reason: "date-on-absence", which, date, ranges: mergeRanges(hits) };
}

function spanClash(
  p: PersonRef,
  start: string | undefined,
  end: string | undefined,
  ctx: AbsenceCtx,
): AbsenceClash | null {
  if (!isIsoDay(start) || !isIsoDay(end) || end < start) return null;
  const usable = absencesOfPerson(p, ctx)
    .map((a) => ({ a, r: usableRange(a) }))
    .filter((x): x is { a: Absence; r: AbsenceRange } => x.r !== null);
  const overlapping = usable.filter(({ r }) => r.start <= end && start <= r.end);
  if (overlapping.length === 0) return null;
  const total = workdaysInRange(start, end, ctx.holidaySet);
  if (total === 0) return null;
  const away = absenceWorkdays(
    overlapping.map(({ a, r }) => ({ ...a, startDate: r.start, endDate: r.end })),
    start,
    end,
    ctx.holidaySet,
  );
  if (away * 2 <= total) return null;
  return {
    ...baseClash(p, ctx),
    reason: "absent-most-of-span",
    ranges: mergeRanges(overlapping.map(({ r }) => r)),
  };
}

/** A task's clash for its owner, at most one: a date on an absence day (due date first, then start),
 *  else absent on more than half of its working days (stored start AND due date; exactly half is not
 *  a clash). Rule (a) wins when both hold, as the more specific statement.
 *  `ignoreStart` (§773 R2): the start date is not newly the owner's (a due-only move), so rule (a) is not
 *  asked of it — it still bounds the span for rule (b). */
export function taskClashes(
  t: Pick<Task, "assignee" | "resourceId" | "startDate" | "dueDate">,
  ctx: AbsenceCtx,
  opts: { ignoreStart?: boolean } = {},
): AbsenceClash[] {
  const person: PersonRef = { resourceId: t.resourceId ?? null, name: t.assignee ?? "" };
  if (!linkedResource(person, ctx) && !person.name.trim()) return [];
  const clash =
    dateClash(person, t.dueDate, "due", ctx) ??
    (opts.ignoreStart ? null : dateClash(person, t.startDate, "start", ctx)) ??
    spanClash(person, t.startDate, t.dueDate, ctx);
  return clash ? [clash] : [];
}

/** A milestone's people are the owners of its linked tasks; one clash per owner away on its date.
 *  No linked tasks, no check. */
export function milestoneClashes(
  m: Pick<Milestone, "date" | "linkedTaskIds">,
  tasks: readonly Task[],
  ctx: AbsenceCtx,
): AbsenceClash[] {
  const linked = new Set(m.linkedTaskIds ?? []);
  if (linked.size === 0) return [];
  const seen = new Set<string>();
  const out: AbsenceClash[] = [];
  for (const task of tasks) {
    if (!linked.has(task.id)) continue;
    const person: PersonRef = { resourceId: task.resourceId ?? null, name: task.assignee ?? "" };
    const resource = linkedResource(person, ctx);
    const name = person.name.trim().toLowerCase();
    if (!resource && !name) continue;
    const key = resource ? `r${resource.id}` : `n${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const clash = dateClash(person, m.date, "milestone", ctx);
    if (clash) out.push(clash);
  }
  return out;
}

interface AwayPerson { rid: number | null; name: string; ranges: AbsenceRange[] }

function clipToWindow(ranges: readonly AbsenceRange[], from: string, to: string): AbsenceRange[] {
  const clipped: AbsenceRange[] = [];
  for (const r of ranges) {
    const start = r.start > from ? r.start : from;
    const end = r.end < to ? r.end : to;
    if (start <= end) clipped.push({ start, end });
  }
  return mergeRanges(clipped);
}

function usableRanges(absences: readonly Absence[]): AbsenceRange[] {
  return absences.map(usableRange).filter((r): r is AbsenceRange => r !== null);
}

function collectAway(
  absences: readonly Absence[],
  resources: readonly Resource[],
  from: string,
  to: string,
): AwayPerson[] {
  const people: AwayPerson[] = [];
  const claimed = new Set<Absence>();
  // An unlinked absence (no `resourceId`) is claimed by name only when exactly ONE resource carries that
  // display name. Two people of one name would each claim it through `absencesForResource` and list it
  // twice, so an ambiguous one stays unclaimed and is listed once, under its typed name (`#-`).
  const nameCount = new Map<string, number>();
  for (const r of resources) {
    const key = resourceDisplayName(r).toLowerCase();
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
  }
  for (const resource of resources) {
    const unique = nameCount.get(resourceDisplayName(resource).toLowerCase()) === 1;
    const mine = absencesForResource(absences, resource).filter((a) => unique || a.resourceId != null);
    mine.forEach((a) => claimed.add(a));
    const ranges = clipToWindow(usableRanges(mine), from, to);
    if (ranges.length) people.push({ rid: resource.id, name: resourceDisplayName(resource), ranges });
  }
  const byName = new Map<string, { name: string; absences: Absence[] }>();
  for (const a of absences) {
    if (claimed.has(a)) continue;
    const name = (a.assignee ?? "").trim();
    if (!name) continue;
    const entry = byName.get(name.toLowerCase()) ?? { name, absences: [] };
    entry.absences.push(a);
    byName.set(name.toLowerCase(), entry);
  }
  for (const { name, absences: theirs } of byName.values()) {
    const ranges = clipToWindow(usableRanges(theirs), from, to);
    if (ranges.length) people.push({ rid: null, name, ranges });
  }
  return people;
}

const formatRange = (r: AbsenceRange): string => (r.start === r.end ? r.start : `${r.start}..${r.end}`);

/** "Who is away" for an AI digest: absent days only (never type or reason), ranges clipped to
 *  [from, to], sorted by first day. Empty when nobody is away, so a digest adds nothing. Unlinked
 *  people carry `#-` where a linked one carries `#<resource id>`. */
export function buildAwaySummary(args: {
  absences: readonly Absence[];
  resources: readonly Resource[];
  from: string;
  to: string;
  maxLines?: number;
}): string[] {
  const { absences, resources, from, to, maxLines = AWAY_SUMMARY_MAX_LINES } = args;
  if (!isIsoDay(from) || !isIsoDay(to) || from > to) return [];
  const people = collectAway(absences, resources, from, to).sort((a, b) => {
    const x = a.ranges[0].start;
    const y = b.ranges[0].start;
    if (x !== y) return x < y ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  if (people.length === 0) return [];
  const shown = people.slice(0, Math.max(0, maxLines));
  const lines = ["AWAY (absent days; type and reason not shown):"];
  for (const p of shown) {
    const id = p.rid === null ? "#-" : `#${p.rid}`;
    const listed = p.ranges.slice(0, AWAY_SUMMARY_MAX_RANGES).map(formatRange).join(", ");
    const more = p.ranges.length - AWAY_SUMMARY_MAX_RANGES;
    lines.push(`${id}|name: ${JSON.stringify(oneLine(p.name))} away ${listed}${more > 0 ? ` +${more} more` : ""}`);
  }
  const cut = people.length - shown.length;
  if (cut > 0) lines.push(`…(${cut} more people truncated)`);
  return lines;
}
