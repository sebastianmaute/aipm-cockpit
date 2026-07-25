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
import { generatePeriods, periodCapacityHours, absencesForResource } from "../resource-capacity";

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

/** Compact, token-bounded digest of resources + their per-period capacity and
 *  current load (both in HOURS regardless of the resource's stored unit). Sent
 *  as the (volatile) user message — never in the cached system block. */
export function buildAllocContext(args: AllocContextArgs): string {
  const { resources, roles, disciplines, grades, plan, absences, workdayHours, holidaySet } = args;
  const periods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
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
      const capacity = Math.round(periodCapacityHours(r, period, resourceAbsences, workdayHours, holidaySet));
      const stored = r.utilization[period.key] ?? 0;
      const current = r.utilizationMode === "percent" ? Math.round((stored / 100) * capacity) : stored;
      return `${period.key}=${current}/${capacity}`;
    });
    lines.push(
      `#${r.id} ${resourceLabel(r)} [${r.utilizationMode}] role=${role}${external} :: ${cells.join(" ")}`,
    );
  }
  if (resources.length > ALLOC_CONTEXT_MAX_RESOURCES) {
    lines.push(`…(${resources.length - ALLOC_CONTEXT_MAX_RESOURCES} more resources truncated)`);
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
    "Respect the shown per-period capacity unless the user explicitly asks to overload a resource.",
    "When asked to spread work across a role, split it across the resources holding that role, preferring whoever has spare capacity (current well below capacity).",
    "If you cannot honor the request without inventing a resource or period, return an empty `cells` array rather than guessing.",
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

/** Parse the untrusted model tool input into raw cells (shape only — ids/keys
 *  are grounded later). Returns null only when the overall shape is unusable
 *  (no `cells` array); individual malformed cells are dropped, not fatal.
 *  Stops at MAX_ALLOC_CELLS. */
export function parseAllocationProposal(input: unknown): RawAllocCell[] | null {
  if (!input || typeof input !== "object") return null;
  const cells = (input as { cells?: unknown }).cells;
  if (!Array.isArray(cells)) return null;
  const out: RawAllocCell[] = [];
  for (const raw of cells) {
    if (out.length >= MAX_ALLOC_CELLS) break;
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
  return out;
}
