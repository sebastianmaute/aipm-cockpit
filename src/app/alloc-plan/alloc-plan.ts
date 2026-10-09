// src/app/alloc-plan/alloc-plan.ts
//
// Pure, i18n-free contract + transforms for AI resource-allocation planning.
// Claude proposes ALLOCATION CELLS (resource × period × hours) via one forced
// tool call; its output is UNTRUSTED, so every id and period key it returns is
// re-grounded against the live workspace before anything can be previewed or
// applied. No React, no fetch, no i18n, no side effects.
//
// MODEL NOTE: an "allocation" is not an entity — it is a key in
// Resource.utilization, and its UNIT depends on that resource's own
// utilizationMode. The model always speaks HOURS; conversion to the stored unit
// happens in groundAllocationCells, which is also where the capacity a
// percentage is a percentage OF gets resolved.
import {
  type Absence,
  type Discipline,
  type Grade,
  type Resource,
  type ResourcePlan,
  type Role,
} from "../types";
import {
  type Period,
  absenceWorkdays,
  absencesForResource,
  generatePeriods,
  periodKeyForDate,
  workdaysInRange,
} from "../resource-capacity";
import { HOURS_MAP_MAX } from "../sanitize";

/** A raw cell as parsed from the model tool input (shape-validated only —
 *  resourceId/periodKey are NOT yet checked against the live workspace). */
export interface RawAllocCell {
  resourceId: number;
  periodKey: string;
  hours: number;
}

/** Bound on how many cells a single proposal may carry (blast-radius + token budget). */
export const MAX_ALLOC_CELLS = 200;
/** Bound on how many resources are described to the model (token budget). */
export const ALLOC_CONTEXT_MAX_RESOURCES = 120;
/**
 * Bound on how many plan periods are described to the model (token budget) —
 * the OTHER axis of the digest. `ALLOC_CONTEXT_MAX_RESOURCES` alone does not
 * bound the total: each shown resource emits one cell PER PLAN PERIOD, and
 * `generatePeriods` is otherwise uncapped, so a long-horizon plan multiplies
 * the resource cap unboundedly (120 resources × a 105-period 2-year weekly
 * plan ≈ 12.6k cells). Measured via `buildAllocContext` at the resource cap
 * (120): a 2-year weekly plan (105 periods) is ~178KB / ≈52k tokens; a
 * 10-year monthly plan (120 periods) is ~203KB / ≈59k tokens — billed on
 * EVERY "propose allocations" click, not a one-shot call cached in history
 * like `ALLOC_TOOL_MAX_CELLS`. Capping at 26 periods (~half a year of weekly
 * periods, or over two years of monthly ones) keeps the worst case to ~48KB
 * / ≈13.9k tokens while covering the horizons this feature is actually used
 * for (tokens estimated at ~3.5 chars/token). */
export const ALLOC_CONTEXT_MAX_PERIODS = 26;

export interface AllocContextArgs {
  resources: readonly Resource[];
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  plan: ResourcePlan;
  absences: readonly Absence[];
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
}

/** Display label for a resource: full name, else email, else `#<id>`. */
export function resourceLabel(r: Resource): string {
  const name = `${r.firstName} ${r.lastName}`.trim();
  if (name) return name;
  if (r.email?.trim()) return r.email.trim();
  return `#${r.id}`;
}

function roleLabel(
  roleId: number | null,
  roles: readonly Role[],
  disciplines: readonly Discipline[],
  grades: readonly Grade[],
): string {
  if (roleId == null) return "-";
  const role = roles.find((r) => r.id === roleId);
  if (!role) return "-";
  const discipline = disciplines.find((d) => d.id === role.disciplineId)?.name;
  const grade = grades.find((g) => g.id === role.gradeId)?.name;
  if (!discipline && !grade) return "-";
  return `${discipline ?? "?"} / ${grade ?? "?"}`;
}

/** Hours a resource could actually work in a period: gross workdays minus
 *  holidays and absences, with NO utilization applied.
 *
 *  Deliberately NOT `periodCapacityHours` (in "../resource-capacity") —
 *  despite its name that function multiplies by the resource's OWN STORED
 *  utilization (`percent: (util/100) × possible`, `hours: util − absence`),
 *  so it answers "hours already allocated", not "hours available". Feeding it
 *  to the planner told the model every unallocated resource had ZERO
 *  capacity. Absence resolution mirrors `periodCapacityHours` EXACTLY
 *  (`absenceOverride[key]` wins when set, else computed absence workdays) —
 *  if that precedence ever diverges between the two functions, the planner
 *  and the resource grid would disagree about the same person's capacity. */
export function availableCapacityHours(
  resource: Resource,
  period: Period,
  resourceAbsences: readonly Absence[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
): number {
  const possibleHours = workdaysInRange(period.start, period.end, holidaySet) * workdayHours;
  const override = resource.absenceOverride?.[period.key];
  const absenceHours =
    override != null
      ? override
      : absenceWorkdays(resourceAbsences, period.start, period.end, holidaySet) * workdayHours;
  return Math.max(0, possibleHours - absenceHours);
}

/** Compact, token-bounded digest of resources + their per-period capacity and
 *  current load (both in HOURS regardless of the resource's stored unit). Sent
 *  as the (volatile) user message — never in the cached system block. */
export function buildAllocContext(args: AllocContextArgs): string {
  const { resources, roles, disciplines, grades, plan, absences, workdayHours, holidaySet } = args;
  const allPeriods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
  const periods = allPeriods.slice(0, ALLOC_CONTEXT_MAX_PERIODS);
  const periodKeys = periods.map((p) => p.key);

  const lines: string[] = [];
  lines.push(`PLAN: ${plan.startDate} .. ${plan.endDate} granularity=${plan.granularity} workday=${workdayHours}h`);
  lines.push(`PERIOD KEYS (use ONLY these): ${periodKeys.join(", ")}`);
  lines.push("RESOURCES (capacity and current load are in HOURS):");

  const shown = resources.slice(0, ALLOC_CONTEXT_MAX_RESOURCES);
  for (const r of shown) {
    const resourceAbsences = absencesForResource(absences, r);
    const role = roleLabel(r.roleId, roles, disciplines, grades);
    const external = r.isExternal ? " external" : "";
    const cells = periods.map((period) => {
      const capacityRaw = availableCapacityHours(r, period, resourceAbsences, workdayHours, holidaySet);
      const stored = r.utilization[period.key] ?? 0;
      const current = r.utilizationMode === "percent" ? (stored / 100) * capacityRaw : stored;
      return `${period.key}=${Math.round(current)}/${Math.round(capacityRaw)}`;
    });
    lines.push(
      `#${r.id} ${resourceLabel(r)} [${r.utilizationMode}] role=${role}${external} :: ${cells.join(" ")}`,
    );
  }
  if (resources.length > ALLOC_CONTEXT_MAX_RESOURCES) {
    lines.push(`…(${resources.length - ALLOC_CONTEXT_MAX_RESOURCES} more resources truncated)`);
  }
  if (allPeriods.length > ALLOC_CONTEXT_MAX_PERIODS) {
    lines.push(`…(${allPeriods.length - ALLOC_CONTEXT_MAX_PERIODS} more periods truncated)`);
  }
  return lines.join("\n");
}

/** Stable, cacheable system prompt. */
export function buildAllocSystemPrompt(): string {
  return [
    "You are a senior project/resource manager helping plan resource allocation.",
    "You always plan in HOURS, regardless of how a resource stores its utilization internally.",
    "Each cell you return REPLACES that resource's value for that period — only the cells you return change; every other period on every other resource is left untouched.",
    "Use ONLY the period keys and resource ids listed in the digest — never invent a resource or a period key.",
    "The digest may be truncated for a large resource count or a long plan window — a trailing '…(N more … truncated)' line means your view is partial, so say so rather than asserting something is unplanned when it may simply be out of view.",
    "Respect the shown per-period capacity unless the user explicitly asks to overload a resource.",
    "When asked to spread work across a role, split it across the resources holding that role, preferring whoever has spare capacity (current well below capacity).",
    "If you cannot honor the request without inventing a resource or period, return an empty `cells` array rather than guessing.",
    "For a very broad request (many resources across many periods), prioritise the most impactful cells rather than exhaustively enumerating every resource and period.",
    "Call the propose_allocations tool exactly once. Keep `rationale` to one short line.",
  ].join(" ");
}

/** Anthropic tool definition. Forced via tool_choice so the model always emits
 *  one structured tool_use block. */
export const PROPOSE_ALLOCATIONS_TOOL = {
  name: "propose_allocations",
  description:
    "Propose resource-allocation cells (resource × period × hours). Call exactly once; return an empty cells array when the request cannot be honored with the listed resources/periods.",
  input_schema: {
    type: "object" as const,
    properties: {
      cells: {
        type: "array",
        description: "Allocation cells. Each REPLACES the named resource's value for that period.",
        items: {
          type: "object",
          properties: {
            resourceId: { type: "integer", description: "Id of the resource (must appear in the digest)." },
            periodKey: { type: "string", description: "Period key (must appear in the digest's PERIOD KEYS list)." },
            hours: { type: "number", description: "Hours allocated to this resource for this period." },
          },
          required: ["resourceId", "periodKey", "hours"],
        },
      },
      rationale: { type: "string", description: "One short line explaining the distribution." },
    },
    required: ["cells"],
  },
};

function toInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
}

function toFiniteNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Result of parsing the model's raw tool input: the shape-validated cells
 *  (ids/keys are grounded later, by `groundAllocationCells`) plus whether the
 *  raw `cells` array itself had to be cut short at `MAX_ALLOC_CELLS`. THIS is
 *  where a too-large proposal actually gets cut — `groundAllocationCells`'s
 *  own cap is defense in depth for a caller that skips this parse step, and
 *  in the real Anthropic-tool-response path never fires, so a caller MUST
 *  read `truncated` from here (and OR it with the ground-level flag) to
 *  learn that anything was dropped. */
export interface ParsedAllocationProposal {
  cells: RawAllocCell[];
  truncated: boolean;
}

/** Parse the untrusted model tool input into raw cells (shape only — ids/keys
 *  are grounded later). Returns null only when the overall shape is unusable
 *  (no `cells` array); individual malformed cells are dropped, not fatal.
 *  Stops at MAX_ALLOC_CELLS, and reports that stop via `truncated` — see
 *  `ParsedAllocationProposal`. */
export function parseAllocationProposal(input: unknown): ParsedAllocationProposal | null {
  if (!input || typeof input !== "object") return null;
  const cellsRaw = (input as { cells?: unknown }).cells;
  if (!Array.isArray(cellsRaw)) return null;
  const out: RawAllocCell[] = [];
  let truncated = false;
  for (const raw of cellsRaw) {
    if (out.length >= MAX_ALLOC_CELLS) {
      truncated = true;
      break;
    }
    if (!raw || typeof raw !== "object") continue;
    const c = raw as { resourceId?: unknown; periodKey?: unknown; hours?: unknown };
    const resourceId = toInt(c.resourceId);
    if (resourceId === null) continue;
    const periodKey = typeof c.periodKey === "string" ? c.periodKey.trim() : "";
    if (!periodKey) continue;
    const hours = toFiniteNumber(c.hours);
    if (hours === null) continue;
    out.push({ resourceId, periodKey, hours });
  }
  return { cells: out, truncated };
}

/** Why a proposed cell was refused instead of turned into a change. */
export type SkipReason =
  | "unknown-resource"
  | "out-of-window"
  | "no-capacity"
  | "bad-hours"
  | "duplicate"
  | "below-resolution"
  | "already-set";

export interface SkippedCell {
  resourceId: number;
  periodKey: string;
  reason: SkipReason;
}

/** A cell that survived grounding and represents a REAL change to a resource's
 *  stored utilization value (in that resource's own unit). */
export interface GroundedAllocCell {
  resourceId: number;
  resourceName: string;
  periodKey: string;
  mode: Resource["utilizationMode"];
  /** Current stored value, in the resource's own unit (percent or hours). */
  currentValue: number;
  /** Proposed value, in the resource's own unit — what would actually be written. */
  nextValue: number;
  /** What the model asked for, in hours (before conversion/clamping). */
  hours: number;
  /** Hours available in this period for this resource (absence/holiday-aware). */
  capacityHours: number;
  /** True when nextValue was trimmed to fit a bound the sanitizer also enforces. */
  clamped: boolean;
}

export interface AllocGroundContext {
  resources: readonly Resource[];
  plan: ResourcePlan;
  absences: readonly Absence[];
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
}

/** Stable identity for a (resource, period) cell — used to dedupe and to key skip entries. */
export function cellKey(c: { resourceId: number; periodKey: string }): string {
  return `${c.resourceId}:${c.periodKey}`;
}

/**
 * Convert an already-validated (non-negative, finite) hours figure into the
 * resource's own stored unit and clamp it to the SAME bounds the load-path
 * sanitizer enforces (percent 0..100, hours 0..HOURS_MAP_MAX).
 *
 * Returns `null` only for the PERCENT-MODE no-capacity case — `capacityHours
 * <= 0` (e.g. a full-period absence) means there is no fraction to express
 * `hours` as a percentage OF, so 0 and 100 would both misrepresent what the
 * model asked for. Hours-mode has no such dependency (its stored value IS
 * hours) and never returns null.
 *
 * `clamped` reports only whether the RAW converted value fell outside the
 * bound — NOT a `< 0` case, which cannot occur here: the caller has already
 * refused negative/non-finite hours, and capacityHours > 0 in the branch
 * that computes rawPercent, so neither rawPercent nor hours can go negative.
 * A `< 0` disjunct would read as handling that case while never actually
 * firing.
 */
function resolveNextValue(
  mode: Resource["utilizationMode"],
  hours: number,
  capacityHours: number,
): { nextValue: number; clamped: boolean } | null {
  if (mode === "percent") {
    if (capacityHours <= 0) return null;
    const rawPercent = Math.round((hours / capacityHours) * 100);
    return { nextValue: Math.max(0, Math.min(100, rawPercent)), clamped: rawPercent > 100 };
  }
  return { nextValue: Math.max(0, Math.min(HOURS_MAP_MAX, hours)), clamped: hours > HOURS_MAP_MAX };
}

/**
 * Ground UNTRUSTED model-proposed allocation cells against the live workspace.
 * This is the anti-hallucination gate AND the unit-conversion boundary — it is
 * the only place a model's `hours` figure is allowed to become a value that
 * could be written into Resource.utilization.
 *
 * Per-cell checks, in order (a cell is refused at the FIRST that applies):
 *   1. duplicate       — a later cell naming the same (resourceId, periodKey)
 *                         as an earlier one in THIS proposal. The first wins;
 *                         later ones are refused regardless of their own
 *                         validity, so one proposal can't silently overwrite
 *                         itself before the user even sees a diff.
 *   2. unknown-resource — resourceId does not name a resource in the live
 *                         workspace. A hallucinated id must never reach a write.
 *   3. out-of-window    — periodKey is not one of the plan's OWN period keys.
 *                         This also catches a key at the WRONG GRANULARITY
 *                         (e.g. a "2026-W32" ISO-week key against a monthly
 *                         plan) — the plan's period keys are always in its own
 *                         granularity, so a mismatched key simply isn't among
 *                         them. If a wrong-granularity key slipped through,
 *                         PERIOD_KEY_RE would still accept it on the next load
 *                         (it matches EITHER granularity's shape) and it would
 *                         sit there as a dead, never-read cell rather than
 *                         erroring — refusing it HERE is the only place that
 *                         actually stops it.
 *   4. bad-hours        — hours is negative or non-finite. The model always
 *                         speaks hours; a negative or NaN figure has no
 *                         meaningful conversion in either unit.
 *   5. no-capacity      — PERCENT-MODE ONLY: the period's available capacity
 *                         (absence- and holiday-aware, via availableCapacityHours)
 *                         is <= 0 — e.g. a full-period absence. A percentage is
 *                         a fraction OF that capacity, so with zero capacity
 *                         there is no fraction to compute; writing 0 or 100
 *                         would both be a LIE about what the model asked for.
 *                         Hours-mode cells have no such dependency (their
 *                         stored value IS hours) and are never skipped here.
 *
 * A cell that clears all of the above is then converted and clamped to the
 * SAME bounds the load-path sanitizer enforces (percent 0..100, hours
 * 0..HOURS_MAP_MAX) — `clamped` is set when that trim actually changed the
 * value, so the preview can say so. Skipping the clamp (or silently trimming
 * without flagging it) would let a user confirm a value that then gets
 * silently re-trimmed on the next load — what they approved would not be what
 * persists.
 *
 * Finally, a cell whose (clamped) next value equals the CURRENT stored value
 * is either dropped SILENTLY — only when the request itself was a genuine
 * zero against an already-zero value, i.e. nothing was actually asked for —
 * or recorded as a skip whose REASON depends on the resource's mode, because
 * the two ways this can happen are not the same fact:
 *   - `below-resolution`: PERCENT-MODE ONLY. The model's `hours` figure went
 *     through a hours-to-percent conversion (division + rounding) before it
 *     could be compared to the stored percent, so the model literally cannot
 *     see the value at the precision that conversion collapsed — the
 *     canonical case is a few tenths of an hour that rounds to 0% against an
 *     already-zero stored value.
 *   - `already-set`: HOURS-MODE. There is no conversion at all here (the
 *     stored value IS hours), so an identical nextValue/currentValue means
 *     the model asked for EXACTLY the value already stored — a routine,
 *     unambiguous restatement ("make sure Ada has 40h in August" when she
 *     already does), not a precision problem, and must not be reported as one.
 * Without one of these two skips a request the model was explicitly given
 * vanishes from both `cells` and `skipped` with no trace anywhere the user
 * can see. An explicit `0` against a non-zero current value is unaffected by
 * either branch — nextValue (0) does not equal currentValue there, so it is
 * still a real change (how a user clears a cell) and is always kept.
 *
 * Stops accumulating once `cells.length` reaches MAX_ALLOC_CELLS. This is
 * DEFENSE IN DEPTH ONLY: `parseAllocationProposal` already caps the raw
 * input to the same count before this function ever sees it, so on the real
 * Anthropic-tool-response path this branch cannot fire — a caller MUST read
 * `truncated` from `parseAllocationProposal`'s own result too (and OR the two
 * together) to learn that a too-large proposal was cut. The `truncated`
 * returned here is set precisely when THIS function's own cap is hit WITH
 * input still unconsumed — never when `raw` was simply exhausted at or under
 * the cap.
 */
export function groundAllocationCells(
  raw: readonly RawAllocCell[],
  ctx: AllocGroundContext,
): { cells: GroundedAllocCell[]; skipped: SkippedCell[]; truncated: boolean } {
  const periods = generatePeriods(ctx.plan.startDate, ctx.plan.endDate, ctx.plan.granularity);
  const periodByKey = new Map(periods.map((p) => [p.key, p]));
  const resourceById = new Map(ctx.resources.map((r) => [r.id, r]));

  const cells: GroundedAllocCell[] = [];
  const skipped: SkippedCell[] = [];
  const seen = new Set<string>();
  let truncated = false;

  for (const c of raw) {
    if (cells.length >= MAX_ALLOC_CELLS) {
      truncated = true;
      break;
    }

    const key = cellKey(c);
    if (seen.has(key)) {
      skipped.push({ resourceId: c.resourceId, periodKey: c.periodKey, reason: "duplicate" });
      continue;
    }
    seen.add(key);

    const resource = resourceById.get(c.resourceId);
    if (!resource) {
      skipped.push({ resourceId: c.resourceId, periodKey: c.periodKey, reason: "unknown-resource" });
      continue;
    }

    const period = periodByKey.get(c.periodKey);
    if (!period) {
      skipped.push({ resourceId: c.resourceId, periodKey: c.periodKey, reason: "out-of-window" });
      continue;
    }

    if (!Number.isFinite(c.hours) || c.hours < 0) {
      skipped.push({ resourceId: c.resourceId, periodKey: c.periodKey, reason: "bad-hours" });
      continue;
    }

    const resourceAbsences = absencesForResource(ctx.absences, resource);
    const capacityHours = availableCapacityHours(resource, period, resourceAbsences, ctx.workdayHours, ctx.holidaySet);

    const mode = resource.utilizationMode;
    const currentValue = resource.utilization[period.key] ?? 0;
    const resolved = resolveNextValue(mode, c.hours, capacityHours);
    if (resolved === null) {
      skipped.push({ resourceId: c.resourceId, periodKey: c.periodKey, reason: "no-capacity" });
      continue;
    }
    const { nextValue, clamped } = resolved;

    if (nextValue === currentValue) {
      // A genuinely zero request against an already-zero value is a real
      // no-op (nothing was asked for) — drop it silently. Anything else that
      // collapsed to no change must not vanish without a trace: the model
      // was asked to do something and nothing happened. WHICH reason depends
      // on the mode (see the doc comment above) — percent-mode collapses are
      // a rounding/precision artifact the model can't see; hours-mode
      // collapses are an exact, unambiguous restatement of the current value.
      if (c.hours !== 0) {
        skipped.push({
          resourceId: c.resourceId,
          periodKey: c.periodKey,
          reason: mode === "percent" ? "below-resolution" : "already-set",
        });
      }
      continue;
    }

    cells.push({
      resourceId: c.resourceId,
      resourceName: resourceLabel(resource),
      periodKey: c.periodKey,
      mode,
      currentValue,
      nextValue,
      hours: c.hours,
      capacityHours,
      clamped,
    });
  }

  return { cells, skipped, truncated };
}

/**
 * Render a stored allocation value with its unit's suffix. `GroundedAllocCell`
 * carries FOUR same-typed `number` fields — `currentValue`/`nextValue` are in
 * the resource's own unit, `hours`/`capacityHours` are always hours — with
 * nothing but prose and the sibling `mode` telling them apart. Takes a
 * `{mode, value}` pair (rather than a whole cell) so it can format EITHER
 * currentValue or nextValue without the caller reconstructing a cell just to
 * read one field — one place decides the suffix instead of every render site
 * remembering to branch on `mode` itself.
 */
export function formatAllocValue(cell: { mode: Resource["utilizationMode"]; value: number }): string {
  return cell.mode === "percent" ? `${cell.value}%` : `${cell.value}h`;
}

export interface AllocApplyResult {
  /** The resource array after the write — some entries replaced, the rest
   *  the SAME references as `resources`. */
  nextResources: Resource[];
  /** Pre-edit images of exactly the resources that changed — one entry per
   *  resource (not per cell) — the undo entry's `edited` payload. */
  editedBefore: Resource[];
}

/**
 * Apply approved, grounded allocation cells to the resource list.
 *
 * SET, NAMED CELLS ONLY: writes exactly the `(resourceId, periodKey)` pairs
 * present in `cells` into that resource's `utilization` map. Every other
 * period on every resource — including a period NOT named on a resource
 * that DOES have some cells applied — keeps its existing value. The
 * rejected alternative — claiming the whole target window and zeroing
 * whatever the proposal didn't mention — is a defect this codebase has
 * already shipped once: `timelog-apply.ts` had period-ownership semantics
 * that silently zeroed hand-entered `actualHours`, and needed an itemized
 * confirm dialog to become safe again. `Resource.utilization` holds
 * hand-entered planning figures too, so the same discipline applies here —
 * never claim a period this call was not explicitly told to touch.
 *
 * A resource that ends up unchanged — no cells name it, or every cell that
 * does already matches its stored value (an explicit `nextValue: 0` against
 * an already-zero/absent period counts as "matches", nothing to write) — is
 * returned BY REFERENCE, the exact same object as in `resources`, and is
 * NOT added to `editedBefore`. Turso's dirty-table save detects a changed
 * workspace section by REFERENCE EQUALITY (see the `Workspace` type's
 * immutability contract in `workspace.ts`); handing back a freshly spread
 * copy for a resource nothing actually changed would mark the resources
 * table dirty for no reason on every apply.
 *
 * A cell naming a resourceId absent from `resources` is silently ignored —
 * `groundAllocationCells` has already refused any id that doesn't name a
 * live resource, so this is defense in depth, not a path expected to fire.
 *
 * `nowIso` is a parameter, not read from the clock — this module has no
 * side effects — and is stamped onto `localModifiedAt` for every resource
 * that DID change (never for one returned by reference).
 */
export function applyAllocationCells(
  resources: readonly Resource[],
  cells: readonly GroundedAllocCell[],
  nowIso: string,
): AllocApplyResult {
  const cellsByResource = new Map<number, GroundedAllocCell[]>();
  for (const c of cells) {
    const existing = cellsByResource.get(c.resourceId);
    if (existing) existing.push(c);
    else cellsByResource.set(c.resourceId, [c]);
  }

  const editedBefore: Resource[] = [];
  const nextResources = resources.map((r) => {
    const own = cellsByResource.get(r.id);
    if (!own) return r;

    const utilization = { ...r.utilization };
    let changed = false;
    for (const c of own) {
      if ((utilization[c.periodKey] ?? 0) !== c.nextValue) {
        utilization[c.periodKey] = c.nextValue;
        changed = true;
      }
    }
    if (!changed) return r;

    editedBefore.push(r);
    return { ...r, utilization, localModifiedAt: nowIso };
  });

  return { nextResources, editedBefore };
}

/** Bound on how many allocation cells the read tool will emit, chosen because
 *  `chat-api.ts`'s `stringifyResult` pretty-prints tool results
 *  (`JSON.stringify(value, null, 2)`) into the CONVERSATION HISTORY, where —
 *  unlike a one-shot forced call — it is replayed on every subsequent turn.
 *  At 120 resources on a weekly plan a 500-cell cap
 *  measured ~50.9KB compact but ~96KB / ≈27.5k tokens once pretty-printed;
 *  200 cuts that worst case to roughly a third while staying useful for
 *  the questions this tool exists to answer. */
export const ALLOC_TOOL_MAX_CELLS = 200;

export interface AllocationsSnapshotCell {
  periodKey: string;
  /** The stored value, in this resource's own unit. */
  value: number;
  unit: Resource["utilizationMode"];
  /** What that value means in hours, so the model can answer in hours. */
  hours: number;
  capacityHours: number;
}

export interface AllocationsSnapshotResource {
  id: number;
  name: string;
  roleId: number | null;
  unit: Resource["utilizationMode"];
  /** Only the NON-ZERO periods for this resource — see `buildAllocationsSnapshot`. */
  cells: AllocationsSnapshotCell[];
  /**
   * True when this resource had non-zero load that was NOT emitted into
   * `cells` because the global `ALLOC_TOOL_MAX_CELLS` cap was already spent
   * — true whether SOME or ALL of its load was dropped. This is what makes
   * a truncated resource distinguishable from an idle one: `cells: []` with
   * `truncated: false` means this resource genuinely has no planned load;
   * `truncated: true` means its load is UNKNOWN (some or all of it is
   * missing), NOT zero — the model must hedge ("I couldn't read all of
   * their load") rather than assert "no planned load" for such a resource.
   */
  truncated: boolean;
}

export interface AllocationsSnapshot {
  planStartDate: string;
  planEndDate: string;
  granularity: ResourcePlan["granularity"];
  periods: string[];
  resources: AllocationsSnapshotResource[];
  /** True when the cell cap was hit and some cells were omitted SOMEWHERE in
   *  the snapshot — a summary flag. Check each resource's own `truncated`
   *  to find out which one(s). */
  truncated: boolean;
  /** Present ONLY when the call asked for a scope (§12) — an unscoped call's
   *  output carries no `scope` key at all, so it is exactly what it was before
   *  the filters existed. Echoes what was APPLIED, which is what lets the model
   *  tell "no load in this scope" from "my filter was dropped". */
  scope?: AllocationsScopeEcho;
}

/** The raw, UNTRUSTED scope off a `list_allocations` tool call. Every field is
 *  `unknown` on purpose: `resolveAllocationsScope` is the only place that
 *  validates it, and it needs the plan's granularity to read a period bound. */
export interface AllocationsScopeInput {
  resourceIds?: unknown;
  periodFrom?: unknown;
  periodTo?: unknown;
}

/** Longest `resourceIds` list the tool will read. A longer one is dropped whole
 *  and named in `ignored` — it is not a scope any narrow question needs, and
 *  reading it would only cost time. */
export const ALLOC_SCOPE_MAX_RESOURCE_IDS = 1000;
/** How many ids each echo list repeats back. The cell cap bounds the grid, but
 *  the echo sits outside it, so it needs a bound of its own; the overflow is
 *  reported as a count (`*NotEchoed`), never silently cut. */
export const ALLOC_SCOPE_ECHO_MAX_IDS = 50;

export interface AllocationsScopeEcho {
  /** The resource filter applied, deduplicated, in the order given — the first
   *  `ALLOC_SCOPE_ECHO_MAX_IDS` of it; `resourceIdsNotEchoed` counts the rest. */
  resourceIds?: number[];
  resourceIdsNotEchoed?: number;
  /** Entries of `resourceIds` dropped as malformed (not an integer id) while
   *  others survived. The filter applies to the survivors only. */
  droppedResourceIdCount?: number;
  /** The bounds applied, as period keys of the plan's granularity — a date the
   *  model passed is reported as the period it falls in. */
  periodFrom?: string;
  periodTo?: string;
  /** Requested ids that name no resource in the directory. They stay in the
   *  filter (so they match nothing) and are reported rather than silently
   *  widening the answer to everyone. Capped like `resourceIds`. */
  unknownResourceIds?: number[];
  unknownResourceIdsNotEchoed?: number;
  /** Names of parameters dropped as malformed. A dropped parameter does NOT
   *  filter, so the answer is wider than asked for along that axis. */
  ignored?: string[];
}

export interface AllocationsSnapshotArgs {
  resources: readonly Resource[];
  plan: ResourcePlan;
  absences: readonly Absence[];
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
  /** Optional §12 scope. Absent → the whole grid, byte-for-byte as before. */
  scope?: AllocationsScopeInput;
}

/**
 * Picks the three scope fields off a raw tool input, or `undefined` when none
 * of them is present — the `undefined` is what keeps an argument-less call on
 * the unscoped path, with no `scope` echo in its output.
 */
export function pickAllocationsScope(input: Record<string, unknown>): AllocationsScopeInput | undefined {
  const { resourceIds, periodFrom, periodTo } = input;
  if (resourceIds === undefined && periodFrom === undefined && periodTo === undefined) return undefined;
  return { resourceIds, periodFrom, periodTo };
}

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEK_KEY_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A period bound as a period key of `granularity`, or null when it is not one.
 * Accepts a key of the plan's OWN granularity, or a real YYYY-MM-DD date, which
 * is read as the period containing it. A key of the OTHER granularity is
 * rejected rather than guessed at: a month bound on a weekly plan has no single
 * week it means. Keys of one granularity sort chronologically as strings
 * (zero-padded, ISO week-year first), which is what the range filter relies on.
 */
function periodBound(raw: unknown, granularity: ResourcePlan["granularity"]): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if ((granularity === "month" ? MONTH_KEY_RE : WEEK_KEY_RE).test(s)) return s;
  if (!ISO_DATE_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  // Round-trip, so an impossible date (2026-02-30) is malformed, not rolled over.
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return periodKeyForDate(s, granularity);
}

interface ResolvedAllocationsScope {
  resourceIds: ReadonlySet<number> | null;
  periodFrom: string | null;
  periodTo: string | null;
  echo: AllocationsScopeEcho;
}

const DECIMAL_ID_RE = /^-?\d+$/;

/**
 * One resource id, parsed STRICTLY: a safe integer given as a number, or as a
 * string of decimal digits (optional leading minus, surrounding blanks
 * trimmed). `Number()` alone would also read "0x10" as 16, "1e0" as 1 and ""
 * as 0 — each a real-looking id the model never meant. `-0` (number or "-0")
 * is read as id 0: no normalisation is needed here, because the `Set` the
 * caller builds stores -0 as +0 (SameValueZero), and the echo is read off it.
 */
function parseResourceId(v: unknown): number | null {
  let n = Number.NaN;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && DECIMAL_ID_RE.test(v.trim())) n = Number(v.trim());
  return Number.isSafeInteger(n) ? n : null;
}

/** The first `ALLOC_SCOPE_ECHO_MAX_IDS` of `ids` into `echo[key]`, and the
 *  count of the rest into `echo[overflowKey]`. */
function echoIds(
  echo: AllocationsScopeEcho,
  key: "resourceIds" | "unknownResourceIds",
  overflowKey: "resourceIdsNotEchoed" | "unknownResourceIdsNotEchoed",
  ids: readonly number[],
): void {
  echo[key] = ids.slice(0, ALLOC_SCOPE_ECHO_MAX_IDS);
  if (ids.length > ALLOC_SCOPE_ECHO_MAX_IDS) echo[overflowKey] = ids.length - ALLOC_SCOPE_ECHO_MAX_IDS;
}

/**
 * The resource half of the scope. Returns the filter, or null for "no
 * filter" — which is what a dropped parameter means, so every null path but
 * an absent one is named in `ignored`. An EMPTY array is dropped too: read as
 * a filter it would match nothing, read as no filter it would silently widen
 * to everyone; naming it is the only reading that cannot mislead.
 */
function resolveResourceIds(
  raw: unknown,
  resources: readonly Resource[],
  echo: AllocationsScopeEcho,
  ignored: string[],
): Set<number> | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length > ALLOC_SCOPE_MAX_RESOURCE_IDS) {
    ignored.push("resourceIds");
    return null;
  }
  const ids: number[] = [];
  for (const v of raw) {
    const id = parseResourceId(v);
    if (id !== null) ids.push(id);
  }
  // An empty list lands here too, with nothing usable in it.
  if (ids.length === 0) {
    ignored.push("resourceIds");
    return null;
  }
  if (ids.length < raw.length) echo.droppedResourceIdCount = raw.length - ids.length;
  const filter = new Set(ids);
  const applied = [...filter];
  echoIds(echo, "resourceIds", "resourceIdsNotEchoed", applied);
  const known = new Set(resources.map((r) => r.id));
  const unknown = applied.filter((id) => !known.has(id));
  if (unknown.length > 0) echoIds(echo, "unknownResourceIds", "unknownResourceIdsNotEchoed", unknown);
  return filter;
}

/**
 * Validates an untrusted scope. Coerce-or-drop like `search_history`: a
 * malformed parameter never throws, it is dropped. UNLIKE `search_history`,
 * which drops silently, a dropped parameter here is NAMED in `echo.ignored`
 * (and dropped list entries are counted), so the model can tell a narrowed
 * answer from a widened one. A reversed range is honoured as given and
 * matches no period, as a reversed `search_history` range matches no event —
 * never silently swapped.
 */
function resolveAllocationsScope(
  scope: AllocationsScopeInput,
  resources: readonly Resource[],
  granularity: ResourcePlan["granularity"],
): ResolvedAllocationsScope {
  const echo: AllocationsScopeEcho = {};
  const ignored: string[] = [];

  const resourceIds = resolveResourceIds(scope.resourceIds, resources, echo, ignored);

  const bound = (name: "periodFrom" | "periodTo"): string | null => {
    if (scope[name] === undefined) return null;
    const key = periodBound(scope[name], granularity);
    if (key === null) ignored.push(name);
    else echo[name] = key;
    return key;
  };
  const periodFrom = bound("periodFrom");
  const periodTo = bound("periodTo");

  if (ignored.length > 0) echo.ignored = ignored;
  return { resourceIds, periodFrom, periodTo, echo };
}

/**
 * Read-only digest of the planning grid for the `list_allocations` chat tool.
 * Unlike `buildAllocContext` (which feeds the MODEL a proposal digest and
 * truncates the RESOURCE list for token budget), this feeds an ANSWER back to
 * the model, so every resource is listed — a resource with no non-zero cells
 * still needs to be nameable ("does X have any planned load?" → "no"). What's
 * bounded instead is the CELL count (`ALLOC_TOOL_MAX_CELLS`), since a resource
 * with a fully populated grid can contribute many cells on its own.
 *
 * `emitted` is a single counter spent in `resources` array order, so once the
 * cap is hit every LATER resource's remaining non-zero periods are dropped —
 * including ones with genuine load. That resource's OWN `truncated` flag (see
 * `AllocationsSnapshotResource`) is what keeps it distinguishable from one
 * that is genuinely idle; the top-level `truncated` is only a "something,
 * somewhere was omitted" summary and cannot tell the two apart on its own.
 *
 * Only NON-ZERO cells are emitted — a full resources × periods grid would
 * dominate the transcript with zeros. `hours`/`capacityHours` use
 * `availableCapacityHours` (see its doc comment) — NEVER `periodCapacityHours`,
 * which multiplies by the resource's OWN stored utilization and would answer
 * "hours already allocated" instead of "hours available".
 *
 * With a `scope` (§12), "every resource" and "every period" mean every one IN
 * SCOPE: `resources` and `periods` are both narrowed, so an empty `cells` with
 * `truncated: false` means "no load in this scope", and the `scope` echo says
 * what that scope was.
 */
export function buildAllocationsSnapshot(args: AllocationsSnapshotArgs): AllocationsSnapshot {
  const { resources, plan, absences, workdayHours, holidaySet } = args;
  const allPeriods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);

  // ★ The scope filters BEFORE the cell cap is spent (§12). That is the whole
  //   point: a narrow question must not queue behind every other resource's
  //   cells and come back `truncated` — it gets the full cap to itself.
  const scope = args.scope ? resolveAllocationsScope(args.scope, resources, plan.granularity) : null;
  const periods = scope
    ? allPeriods.filter(
        (p) =>
          (scope.periodFrom === null || p.key >= scope.periodFrom) &&
          (scope.periodTo === null || p.key <= scope.periodTo),
      )
    : allPeriods;
  const scopedResources = scope?.resourceIds ? resources.filter((r) => scope.resourceIds?.has(r.id)) : resources;

  let emitted = 0;
  let truncated = false;

  const snapshotResources: AllocationsSnapshotResource[] = scopedResources.map((r) => {
    const resourceAbsences = absencesForResource(absences, r);
    const cells: AllocationsSnapshotCell[] = [];
    let resourceTruncated = false;
    for (const period of periods) {
      const value = r.utilization[period.key] ?? 0;
      if (value === 0) continue;
      if (emitted >= ALLOC_TOOL_MAX_CELLS) {
        truncated = true;
        resourceTruncated = true;
        continue;
      }
      const capacityHours = availableCapacityHours(r, period, resourceAbsences, workdayHours, holidaySet);
      const hours = r.utilizationMode === "percent" ? Math.round((value / 100) * capacityHours) : value;
      cells.push({ periodKey: period.key, value, unit: r.utilizationMode, hours, capacityHours });
      emitted++;
    }
    return {
      id: r.id,
      name: resourceLabel(r),
      roleId: r.roleId,
      unit: r.utilizationMode,
      cells,
      truncated: resourceTruncated,
    };
  });

  return {
    planStartDate: plan.startDate,
    planEndDate: plan.endDate,
    granularity: plan.granularity,
    periods: periods.map((p) => p.key),
    resources: snapshotResources,
    truncated,
    ...(scope ? { scope: scope.echo } : {}),
  };
}

/**
 * The `getAllocationsSnapshot` getter `use-chat-dispatcher-wiring.ts` hands the
 * chat dispatcher: live render-scope inputs bound, the tool call's scope forwarded.
 * Extracted so the scope hop is pinned by a unit test — inlined in the
 * orchestrator, dropping `scope` there type-checked and passed every test
 * while turning every scoped call back into the full dump (§12). Build it
 * per render, un-memoized, exactly as the inline arrow was.
 */
export function makeAllocationsSnapshotGetter(
  inputs: Omit<AllocationsSnapshotArgs, "scope">,
): (scope?: AllocationsScopeInput) => AllocationsSnapshot {
  return (scope) => buildAllocationsSnapshot({ ...inputs, scope });
}
