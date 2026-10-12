// src/app/budget-import/forecast-plan.ts — turns validated forecast rows into a
// cell diff against ONE budget bucket (§500) and applies that diff immutably.
// Pure: no i18n, no React, and no input is ever mutated.
import { generatePeriods } from "../resource-capacity";
import type { BucketAllocation, BudgetBucket, DisciplineAllocation, Resource, ResourcePlan, Role } from "../types";
import type { ForecastRow } from "./forecast-types";
import { splitToGranularity } from "./period-split";

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
};
export type AllocationKey = { kind: "role"; roleId: number } | { kind: "discipline"; disciplineId: number };
export type CellChange = { alloc: AllocationKey; period: string; old: number | undefined; next: number };
export type UnresolvedPerson = {
  person: string;
  email?: string;
  why: "no-match" | "ambiguous" | "no-role";
  candidates: number[];
};
export type RateNote = {
  person: string;
  resourceId: number;
  sheetRate: number;
  internalRate: number;
  externalRate: number;
};
export type ImportBlocker = "follows-plan" | "closed" | "nothing-to-apply";
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

type Resolution =
  | { kind: "skip" }
  | { kind: "unresolved"; why: UnresolvedPerson["why"]; candidates: number[] }
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
    for (const email of [r.email, ...(r.emails ?? [])]) addIndexed(ix.byEmail, normalisePerson(email ?? ""), r.id);
    addIndexed(ix.byName, normalisePerson(`${r.firstName} ${r.lastName}`), r.id);
  }
  for (const role of roles) ix.roleById.set(role.id, role);
  return ix;
}

/** Email beats name: an address that matches anyone settles the question. */
function candidateIds(row: ForecastRow, ix: Indexes): number[] {
  const byEmail = ix.byEmail.get(normalisePerson(row.email ?? ""));
  if (byEmail && byEmail.length > 0) return byEmail;
  return ix.byName.get(normalisePerson(row.person)) ?? [];
}

function resolveRow(row: ForecastRow, ix: Indexes, overrides: ImportCtx["overrides"]): Resolution {
  const override = overrides.get(normalisePerson(row.person));
  if (override === "skip") return { kind: "skip" };
  const ids = override !== undefined ? (ix.byId.has(override) ? [override] : []) : candidateIds(row, ix);
  if (ids.length === 0) return { kind: "unresolved", why: "no-match", candidates: [] };
  if (ids.length > 1) return { kind: "unresolved", why: "ambiguous", candidates: [...ids] };
  const resource = ix.byId.get(ids[0]);
  if (!resource) return { kind: "unresolved", why: "no-match", candidates: [] };
  const role = resource.roleId == null ? undefined : ix.roleById.get(resource.roleId);
  if (!role) return { kind: "unresolved", why: "no-role", candidates: [resource.id] };
  return { kind: "matched", resource, role };
}

// ------------------------------------------------------------- aggregation

type Acc = { alloc: AllocationKey; cents: Map<string, number>; people: Set<number> };

type Collector = {
  accs: Map<string, Acc>;
  unresolved: Map<string, UnresolvedPerson>;
  skipped: Map<string, string>;
  outOfRange: Map<string, { person: string; period: string }>;
  rateNotes: Map<string, RateNote>;
};

function allocKeyOf(role: Role, blended: boolean): AllocationKey {
  return blended ? { kind: "discipline", disciplineId: role.disciplineId } : { kind: "role", roleId: role.id };
}

function allocId(key: AllocationKey): string {
  return key.kind === "role" ? `r:${key.roleId}` : `d:${key.disciplineId}`;
}

function toCents(hours: number): number {
  return Math.round((hours + Number.EPSILON) * 100);
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
  out: Collector,
): void {
  const target = acc ?? { alloc, cents: new Map<string, number>(), people: new Set<number>() };
  out.accs.set(allocId(alloc), target);
  target.cents.set(key, (target.cents.get(key) ?? 0) + cents);
  target.people.add(resourceId);
}

function processMatched(
  row: ForecastRow,
  resource: Resource,
  role: Role,
  ctx: ImportCtx,
  inRange: ReadonlySet<string>,
  out: Collector,
): void {
  noteRate(row, resource, role, out);
  const alloc = allocKeyOf(role, ctx.bucket.planningMode === "blended");
  const shares = splitToGranularity(row.period, row.hours, ctx.plan.granularity, ctx.holidaySet);
  for (const share of shares) {
    if (!inRange.has(share.key)) {
      const key = `${normalisePerson(row.person)}|${share.key}`;
      if (!out.outOfRange.has(key)) out.outOfRange.set(key, { person: row.person, period: share.key });
      continue;
    }
    addShare(out.accs.get(allocId(alloc)), alloc, share.key, toCents(share.hours), resource.id, out);
  }
}

function collect(rows: readonly ForecastRow[], ctx: ImportCtx, ix: Indexes): Collector {
  const out: Collector = {
    accs: new Map(),
    unresolved: new Map(),
    skipped: new Map(),
    outOfRange: new Map(),
    rateNotes: new Map(),
  };
  const inRange = new Set(generatePeriods(ctx.bucket.startDate, ctx.bucket.endDate, ctx.plan.granularity).map((p) => p.key));
  for (const row of rows) {
    const res = resolveRow(row, ix, ctx.overrides);
    if (res.kind === "skip") {
      const key = normalisePerson(row.person);
      if (!out.skipped.has(key)) out.skipped.set(key, row.person);
    } else if (res.kind === "unresolved") recordUnresolved(row, res, out);
    else processMatched(row, res.resource, res.role, ctx, inRange, out);
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

function diffAllocation(acc: Acc, stored: StoredAlloc | undefined): Diff {
  const changes: CellChange[] = [];
  let deltaCents = 0;
  for (const period of [...acc.cents.keys()].sort()) {
    const cents = acc.cents.get(period) ?? 0;
    const old = stored?.budgetHours[period];
    if (old === cents / 100) continue;
    changes.push({ alloc: acc.alloc, period, old, next: cents / 100 });
    deltaCents += cents - Math.round((old ?? 0) * 100);
  }
  const present = new Set(stored?.resourceIds ?? []);
  const added = [...acc.people].filter((id) => !present.has(id));
  return {
    changes,
    addResources: added.length > 0 ? [{ alloc: acc.alloc, resourceIds: added }] : [],
    newAllocations: stored ? [] : [acc.alloc],
    hoursDelta: deltaCents / 100,
  };
}

function blockersOf(ctx: ImportCtx, changeCount: number): ImportBlocker[] {
  const blockers: ImportBlocker[] = [];
  if (ctx.plan.budgetFollowsPlan === true) blockers.push("follows-plan");
  if (ctx.bucket.status === "closed") blockers.push("closed");
  if (changeCount === 0) blockers.push("nothing-to-apply");
  return blockers;
}

/** Diffs the forecast against the bucket. Rows must already be validated. */
export function buildForecastImportPlan(rows: readonly ForecastRow[], ctx: ImportCtx): ImportPlan {
  const collected = collect(rows, ctx, buildIndexes(ctx.resources, ctx.roles));
  const diffs = [...collected.accs.values()].map((acc) => diffAllocation(acc, findStored(ctx.bucket, acc.alloc)));
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
    hoursDelta: Math.round(diffs.reduce((s, d) => s + Math.round(d.hoursDelta * 100), 0)) / 100,
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
