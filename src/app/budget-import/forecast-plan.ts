// src/app/budget-import/forecast-plan.ts — turns validated forecast rows into a
// cell diff against ONE budget bucket (§500) and applies that diff immutably.
// Pure: no i18n, no React, and no input is ever mutated.
import { bucketActivePeriods } from "../budget-report";
import type { Period } from "../resource-capacity";
import type { BucketAllocation, BudgetBucket, DisciplineAllocation, Resource, ResourcePlan, Role } from "../types";
import type { ForecastCollision, ForecastRow } from "./forecast-types";
import { sourcePeriodBounds, splitToGranularity, toCents } from "./period-split";

/** Relative rate difference above which a sheet rate is reported. */
const RATE_MISMATCH = 0.005;

export type PersonOverride = number | "skip"; // resource id, or skip
export type ImportCtx = {
  bucket: BudgetBucket;
  resources: readonly Resource[];
  roles: readonly Role[];
  plan: ResourcePlan;
  holidaySet: ReadonlySet<string>;
  /** Key: `normalisePerson` of the sheet person. */
  overrides: ReadonlyMap<string, PersonOverride>;
  /** The validator's same-row collisions; any one blocks (`same-row-period`). */
  collisions?: readonly ForecastCollision[];
};
export type AllocationKey = { kind: "role"; roleId: number } | { kind: "discipline"; disciplineId: number };
/** `partial` is set when the target period has working days that no sheet period
 *  for this allocation covers, so the written cell understates the period. */
export type CellChange = {
  alloc: AllocationKey;
  period: string;
  old: number | undefined;
  next: number;
  partial?: true;
  /** Members of the allocation's line the sheet does not list for this
   *  period: the imported value replaces the whole cell, their share included. */
  othersOnLine?: string[];
  /** Members of the line who ARE in the sheet but were not routed to it (on
   *  several lines, or skipped): the value replaces their share too (rr14). */
  unmatchedOnLine?: string[];
};
/** `several-lines`: the matched resource sits on more than one line of the
 *  target bucket, so which line their hours go to is not settled (final
 *  review 3, M3); `candidates` is empty. */
export type UnresolvedPerson = {
  person: string;
  email?: string;
  why: "no-match" | "ambiguous" | "no-role" | "several-lines";
  candidates: number[];
};
export type RateNote = {
  person: string;
  resourceId: number;
  sheetRate: number;
  internalRate: number;
  externalRate: number;
};
export type ImportBlocker = "follows-plan" | "closed" | "same-row-period" | "nothing-to-apply";
export type ImportPlan = {
  changes: CellChange[];
  unresolved: UnresolvedPerson[];
  skipped: string[];
  outOfRange: { person: string; period: string }[];
  rateNotes: RateNote[];
  addResources: { alloc: AllocationKey; resourceIds: number[] }[];
  newAllocations: AllocationKey[];
  blockers: ImportBlocker[];
  hoursDelta: number;
};

/** Lower-case, trim, collapse whitespace: the key a sheet person is matched and overridden by. */
export function normalisePerson(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------- matching

type Indexes = {
  byId: Map<number, Resource>;
  byEmail: Map<string, number[]>;
  byName: Map<string, number[]>;
  roleById: Map<number, Role>;
};

/** `resourceId`: the resource the sheet person matched, when it is known but
 *  their hours were not routed (`several-lines`, or skipped after it). */
type Resolution =
  | { kind: "skip"; resourceId?: number }
  | { kind: "unresolved"; why: UnresolvedPerson["why"]; candidates: number[]; resourceId?: number }
  | { kind: "matched"; resource: Resource; role: Role };

function addIndexed(index: Map<string, number[]>, key: string, id: number): void {
  if (!key) return;
  const ids = index.get(key);
  if (!ids) index.set(key, [id]);
  else if (!ids.includes(id)) ids.push(id);
}

function buildIndexes(resources: readonly Resource[], roles: readonly Role[]): Indexes {
  const ix: Indexes = { byId: new Map(), byEmail: new Map(), byName: new Map(), roleById: new Map() };
  for (const r of resources) {
    ix.byId.set(r.id, r);
    // An archived resource is never matched automatically (nor offered in the picker).
    if (r.active === false) continue;
    for (const email of [r.email, ...(r.emails ?? [])]) addIndexed(ix.byEmail, normalisePerson(email ?? ""), r.id);
    addIndexed(ix.byName, normalisePerson(`${r.firstName} ${r.lastName}`), r.id);
  }
  for (const role of roles) ix.roleById.set(role.id, role);
  return ix;
}

/** "Müller, Hans" as "Hans Müller"; null for a name without exactly one comma. */
function firstLast(name: string): string | null {
  const parts = name.split(",");
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : null;
}

/** Email beats name: an address that matches anyone settles the question. A
 *  name also matches written "Last, First". */
function candidateIds(row: ForecastRow, ix: Indexes): number[] {
  const byEmail = ix.byEmail.get(normalisePerson(row.email ?? ""));
  if (byEmail && byEmail.length > 0) return byEmail;
  const byName = ix.byName.get(normalisePerson(row.person));
  if (byName) return byName;
  const reordered = firstLast(row.person);
  return reordered === null ? [] : (ix.byName.get(normalisePerson(reordered)) ?? []);
}

function resolveIds(ids: readonly number[], ix: Indexes): Resolution {
  if (ids.length === 0) return { kind: "unresolved", why: "no-match", candidates: [] };
  if (ids.length > 1) return { kind: "unresolved", why: "ambiguous", candidates: [...ids] };
  const resource = ix.byId.get(ids[0]);
  if (!resource) return { kind: "unresolved", why: "no-match", candidates: [] };
  const role = resource.roleId == null ? undefined : ix.roleById.get(resource.roleId);
  if (!role) return { kind: "unresolved", why: "no-role", candidates: [resource.id] };
  return { kind: "matched", resource, role };
}

/** An override only settles a row the automatic match could not: a row that
 *  resolves by email or by a unique name ignores overrides, so settling one
 *  ambiguous namesake never re-routes another person's rows. */
function resolveRow(row: ForecastRow, ix: Indexes, overrides: ImportCtx["overrides"]): Resolution {
  const auto = resolveIds(candidateIds(row, ix), ix);
  if (auto.kind === "matched") return auto;
  const override = overrides.get(normalisePerson(row.person));
  if (override === undefined) return auto;
  if (override === "skip") return { kind: "skip" };
  return resolveIds(ix.byId.has(override) ? [override] : [], ix);
}

// ------------------------------------------------------------- aggregation

type Acc = {
  alloc: AllocationKey;
  cents: Map<string, number>;
  people: Set<number>;
  /** Per target period, the people whose hours reach it (final review 3, M2). */
  peopleByPeriod: Map<string, Set<number>>;
  /** Sheet periods that contributed an in-range share to this allocation. */
  sources: Set<string>;
};

type Collector = {
  accs: Map<string, Acc>;
  unresolved: Map<string, UnresolvedPerson>;
  skipped: Map<string, string>;
  outOfRange: Map<string, { person: string; period: string }>;
  rateNotes: Map<string, RateNote>;
  /** Resources the sheet names but whose hours were not routed (`Resolution.resourceId`). */
  unmatchedIds: Set<number>;
};

function allocKeyOf(role: Role, blended: boolean): AllocationKey {
  return blended ? { kind: "discipline", disciplineId: role.disciplineId } : { kind: "role", roleId: role.id };
}

/** One string per allocation line ("r:<roleId>" / "d:<disciplineId>"): the key
 *  patches are grouped by, and the preview's React key. */
export function allocId(key: AllocationKey): string {
  return key.kind === "role" ? `r:${key.roleId}` : `d:${key.disciplineId}`;
}

function relativeDiff(rate: number, reference: number): number {
  if (reference === 0) return rate === 0 ? 0 : Infinity;
  return Math.abs(rate - reference) / Math.abs(reference);
}

function noteRate(row: ForecastRow, resource: Resource, role: Role, out: Collector): void {
  const rate = row.rate;
  if (rate === undefined) return;
  if (relativeDiff(rate, role.internalRate) <= RATE_MISMATCH) return;
  if (relativeDiff(rate, role.externalRate) <= RATE_MISMATCH) return;
  const key = `${resource.id}|${rate}`;
  if (out.rateNotes.has(key)) return;
  out.rateNotes.set(key, {
    person: row.person,
    resourceId: resource.id,
    sheetRate: rate,
    internalRate: role.internalRate,
    externalRate: role.externalRate,
  });
}

function recordUnresolved(row: ForecastRow, res: Extract<Resolution, { kind: "unresolved" }>, out: Collector): void {
  const key = normalisePerson(row.person);
  if (out.unresolved.has(key)) return;
  const entry: UnresolvedPerson = { person: row.person, why: res.why, candidates: res.candidates };
  if (row.email) entry.email = row.email;
  out.unresolved.set(key, entry);
}

function addShare(
  acc: Acc | undefined,
  alloc: AllocationKey,
  key: string,
  cents: number,
  resourceId: number,
  source: string,
  out: Collector,
): void {
  const target = acc ?? { alloc, cents: new Map<string, number>(), people: new Set<number>(), peopleByPeriod: new Map<string, Set<number>>(), sources: new Set<string>() };
  out.accs.set(allocId(alloc), target);
  target.cents.set(key, (target.cents.get(key) ?? 0) + cents);
  target.people.add(resourceId);
  target.peopleByPeriod.set(key, new Set([...(target.peopleByPeriod.get(key) ?? []), resourceId]));
  target.sources.add(source);
}

/** A matched person and the line their hours go to; `rateRole` is the role a
 *  sheet rate is compared against (the line's own, on a role line). */
type Routed = { kind: "routed"; resource: Resource; alloc: AllocationKey; rateRole: Role };
type Routing = Routed | Exclude<Resolution, { kind: "matched" }>;

/** The lines of the bucket's planning mode that list `resourceId`, one key each. */
function memberLines(bucket: BudgetBucket, resourceId: number): AllocationKey[] {
  const keys: AllocationKey[] = bucket.planningMode === "blended"
    ? (bucket.disciplineAllocations ?? []).filter((a) => (a.resourceIds ?? []).includes(resourceId)).map((a) => ({ kind: "discipline", disciplineId: a.disciplineId }))
    : bucket.allocations.filter((a) => (a.resourceIds ?? []).includes(resourceId)).map((a) => ({ kind: "role", roleId: a.roleId }));
  return [...new Map(keys.map((k) => [allocId(k), k])).values()];
}

/**
 * ★★ Where a matched person's hours go (final review 3, M3, owner decision
 * 2026-10-13): the ONE line of the bucket that already lists them, whatever
 * its role; on several such lines they are unresolved (`several-lines`); on
 * none, the line of their role (or, blended, its discipline). Routing by role
 * alone once created a Dev line beside Ann's Senior line and counted her
 * January twice.
 */
function routeOf(res: Resolution, bucket: BudgetBucket, ix: Indexes): Routing {
  if (res.kind !== "matched") return res;
  const lines = memberLines(bucket, res.resource.id);
  if (lines.length > 1) return { kind: "unresolved", why: "several-lines", candidates: [], resourceId: res.resource.id };
  if (lines.length === 0) return { kind: "routed", resource: res.resource, alloc: allocKeyOf(res.role, bucket.planningMode === "blended"), rateRole: res.role };
  const line = lines[0];
  const lineRole = line.kind === "role" ? ix.roleById.get(line.roleId) : undefined;
  return { kind: "routed", resource: res.resource, alloc: line, rateRole: lineRole ?? res.role };
}

/** `resolveRow`, routed (`routeOf`). A person on several lines takes the
 *  picker's choice: another resource, or Skip. */
function resolveAndRoute(row: ForecastRow, ix: Indexes, ctx: ImportCtx): Routing {
  const first = routeOf(resolveRow(row, ix, ctx.overrides), ctx.bucket, ix);
  if (first.kind !== "unresolved" || first.why !== "several-lines") return first;
  const override = ctx.overrides.get(normalisePerson(row.person));
  if (override === undefined) return first;
  if (override === "skip") return { kind: "skip", resourceId: first.resourceId };
  return routeOf(resolveIds(ix.byId.has(override) ? [override] : [], ix), ctx.bucket, ix);
}

function processMatched(
  row: ForecastRow,
  routed: Routed,
  ctx: ImportCtx,
  inRange: ReadonlyMap<string, Period>,
  out: Collector,
): void {
  const { resource, alloc } = routed;
  const shares = splitToGranularity(row.period, row.hours, ctx.plan.granularity, ctx.holidaySet);
  if (shares.some((share) => inRange.has(share.key))) noteRate(row, resource, routed.rateRole, out);
  for (const share of shares) {
    if (!inRange.has(share.key)) {
      const key = `${normalisePerson(row.person)}|${share.key}`;
      if (!out.outOfRange.has(key)) out.outOfRange.set(key, { person: row.person, period: share.key });
      continue;
    }
    addShare(out.accs.get(allocId(alloc)), alloc, share.key, toCents(share.hours), resource.id, row.period, out);
  }
}

function collect(rows: readonly ForecastRow[], ctx: ImportCtx, ix: Indexes, active: ReadonlyMap<string, Period>): Collector {
  const out: Collector = {
    accs: new Map(),
    unresolved: new Map(),
    skipped: new Map(),
    outOfRange: new Map(),
    rateNotes: new Map(),
    unmatchedIds: new Set(),
  };
  for (const row of rows) {
    const res = resolveAndRoute(row, ix, ctx);
    if (res.kind !== "routed" && res.resourceId !== undefined) out.unmatchedIds.add(res.resourceId);
    // An unresolved name's candidates (namesakes, a role-less match) are in the sheet too (final review 4, M2).
    if (res.kind === "unresolved") res.candidates.forEach((id) => out.unmatchedIds.add(id));
    if (res.kind === "skip") {
      const key = normalisePerson(row.person);
      if (!out.skipped.has(key)) out.skipped.set(key, row.person);
    } else if (res.kind === "unresolved") recordUnresolved(row, res, out);
    else processMatched(row, res, ctx, active, out);
  }
  return out;
}

// -------------------------------------------------------------------- plan

type StoredAlloc = BucketAllocation | DisciplineAllocation;

function findStored(bucket: BudgetBucket, key: AllocationKey): StoredAlloc | undefined {
  return key.kind === "role"
    ? bucket.allocations.find((a) => a.roleId === key.roleId)
    : bucket.disciplineAllocations?.find((a) => a.disciplineId === key.disciplineId);
}

type Diff = Pick<ImportPlan, "changes" | "addResources" | "newAllocations" | "hoursDelta">;

type DiffScope = {
  active: ReadonlyMap<string, Period>;
  holidaySet: ReadonlySet<string>;
  byId: ReadonlyMap<number, Resource>;
  unmatchedIds: ReadonlySet<number>;
};

/** The names of a stored line's members that `keep` selects. */
function lineMembers(stored: StoredAlloc | undefined, byId: ReadonlyMap<number, Resource>, keep: (id: number) => boolean): string[] {
  return (stored?.resourceIds ?? [])
    .filter(keep)
    .map((id) => {
      const r = byId.get(id);
      return r ? `${r.firstName} ${r.lastName}`.trim() : `#${id}`;
    });
}

/** True when a working day (Mon-Fri, not a holiday) of `target` lies in none of
 *  the covering sheet periods. */
function hasUncoveredWorkday(target: Period, covers: readonly Period[], holidaySet: ReadonlySet<string>): boolean {
  const cur = new Date(`${target.start}T00:00:00Z`);
  const last = new Date(`${target.end}T00:00:00Z`);
  for (; cur <= last; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const weekday = cur.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const day = cur.toISOString().slice(0, 10);
    if (holidaySet.has(day)) continue;
    if (!covers.some((c) => day >= c.start && day <= c.end)) return true;
  }
  return false;
}

function diffAllocation(acc: Acc, stored: StoredAlloc | undefined, scope: DiffScope): Diff {
  const changes: CellChange[] = [];
  const covers = [...acc.sources].map(sourcePeriodBounds);
  let delta = 0;
  for (const period of [...acc.cents.keys()].sort()) {
    const next = (acc.cents.get(period) ?? 0) / 100;
    const old = stored?.budgetHours[period];
    if (old === next) continue;
    const change: CellChange = { alloc: acc.alloc, period, old, next };
    const target = scope.active.get(period);
    if (target && hasUncoveredWorkday(target, covers, scope.holidaySet)) change.partial = true;
    // ★ Per period (final review 3, M2): a member the sheet lists for January
    // but leaves blank for April loses their April share, and April says so.
    // ★ A member the sheet names but did not route here (rr14 M3a) is no
    // "not in the sheet": they are named apart.
    const routed = acc.peopleByPeriod.get(period) ?? new Set<number>();
    const others = lineMembers(stored, scope.byId, (id) => !routed.has(id) && !scope.unmatchedIds.has(id));
    const unmatched = lineMembers(stored, scope.byId, (id) => !routed.has(id) && scope.unmatchedIds.has(id));
    if (others.length > 0) change.othersOnLine = others;
    if (unmatched.length > 0) change.unmatchedOnLine = unmatched;
    changes.push(change);
    delta += next - (old ?? 0);
  }
  const present = new Set(stored?.resourceIds ?? []);
  const added = [...acc.people].filter((id) => !present.has(id));
  return {
    changes,
    addResources: added.length > 0 ? [{ alloc: acc.alloc, resourceIds: added }] : [],
    newAllocations: stored ? [] : [acc.alloc],
    hoursDelta: delta,
  };
}

function blockersOf(ctx: ImportCtx, changeCount: number): ImportBlocker[] {
  const blockers: ImportBlocker[] = [];
  if (ctx.plan.budgetFollowsPlan === true) blockers.push("follows-plan");
  if (ctx.bucket.status === "closed") blockers.push("closed");
  if ((ctx.collisions?.length ?? 0) > 0) blockers.push("same-row-period");
  if (changeCount === 0) blockers.push("nothing-to-apply");
  return blockers;
}

/** Diffs the forecast against the bucket. Rows must already be validated. */
export function buildForecastImportPlan(rows: readonly ForecastRow[], ctx: ImportCtx): ImportPlan {
  const active = new Map(bucketActivePeriods(ctx.bucket, ctx.plan).map((p) => [p.key, p]));
  const ix = buildIndexes(ctx.resources, ctx.roles);
  const collected = collect(rows, ctx, ix, active);
  const scope: DiffScope = { active, holidaySet: ctx.holidaySet, byId: ix.byId, unmatchedIds: collected.unmatchedIds };
  const diffs = [...collected.accs.values()].map((acc) => diffAllocation(acc, findStored(ctx.bucket, acc.alloc), scope));
  const changes = diffs.flatMap((d) => d.changes);
  return {
    changes,
    unresolved: [...collected.unresolved.values()],
    skipped: [...collected.skipped.values()],
    outOfRange: [...collected.outOfRange.values()],
    rateNotes: [...collected.rateNotes.values()],
    addResources: diffs.flatMap((d) => d.addResources),
    newAllocations: diffs.flatMap((d) => d.newAllocations),
    blockers: blockersOf(ctx, changes.length),
    // Exact differences summed first, rounded once; `|| 0` turns -0 into 0.
    hoursDelta: Math.round(diffs.reduce((sum, d) => sum + d.hoursDelta, 0) * 100) / 100 || 0,
  };
}

// ------------------------------------------------------------------- apply

type Patch = { alloc: AllocationKey; hours: Record<string, number>; ids: number[] };

function patchFor(patches: Map<string, Patch>, alloc: AllocationKey): Patch {
  const id = allocId(alloc);
  const patch = patches.get(id) ?? { alloc, hours: {}, ids: [] };
  patches.set(id, patch);
  return patch;
}

function collectPatches(plan: ImportPlan): Map<string, Patch> {
  const patches = new Map<string, Patch>();
  for (const c of plan.changes) patchFor(patches, c.alloc).hours[c.period] = c.next;
  for (const a of plan.addResources) patchFor(patches, a.alloc).ids.push(...a.resourceIds);
  return patches;
}

function mergeStored<T extends StoredAlloc>(stored: T, patch: Patch): T {
  const fresh = [...new Set(patch.ids)].filter((id) => !stored.resourceIds.includes(id));
  return {
    ...stored,
    resourceIds: fresh.length > 0 ? [...stored.resourceIds, ...fresh] : stored.resourceIds,
    budgetHours: { ...stored.budgetHours, ...patch.hours },
  };
}

/** Merges the patches of one kind into a list: a matched allocation becomes a
 *  new object, an unmatched patch appends a created one, the rest is untouched. */
function applyToList<T extends StoredAlloc>(
  list: readonly T[],
  patches: readonly Patch[],
  idOf: (a: T) => string,
  create: (patch: Patch) => T,
): T[] {
  const byId = new Map(patches.map((p) => [allocId(p.alloc), p]));
  const used = new Set<string>();
  const next = list.map((a) => {
    const id = idOf(a);
    const patch = byId.get(id);
    if (!patch || used.has(id)) return a;
    used.add(id);
    return mergeStored(a, patch);
  });
  for (const patch of patches) if (!used.has(allocId(patch.alloc))) next.push(create(patch));
  return next;
}

function freshFields(patch: Patch) {
  return { resourceIds: [...new Set(patch.ids)], budgetHours: { ...patch.hours }, actualHours: {} };
}

/** Applies a plan to a bucket and returns a NEW bucket; touched allocations are
 *  new objects, everything untouched is carried by reference. Does not read
 *  `plan.blockers` — the caller must not call it when blockers exist. */
export function applyForecastImport(bucket: BudgetBucket, plan: ImportPlan): BudgetBucket {
  const patches = [...collectPatches(plan).values()];
  const result: BudgetBucket = { ...bucket };
  const roles = patches.filter((p) => p.alloc.kind === "role");
  const disciplines = patches.filter((p) => p.alloc.kind === "discipline");
  if (roles.length > 0) {
    result.allocations = applyToList(
      bucket.allocations,
      roles,
      (a) => `r:${a.roleId}`,
      (p) => ({ roleId: p.alloc.kind === "role" ? p.alloc.roleId : 0, ...freshFields(p) }),
    );
  }
  if (disciplines.length > 0) {
    result.disciplineAllocations = applyToList(
      bucket.disciplineAllocations ?? [],
      disciplines,
      (a) => `d:${a.disciplineId}`,
      (p) => ({ disciplineId: p.alloc.kind === "discipline" ? p.alloc.disciplineId : 0, ...freshFields(p) }),
    );
  }
  return result;
}
