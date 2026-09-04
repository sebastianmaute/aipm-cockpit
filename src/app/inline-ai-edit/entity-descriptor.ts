// src/app/inline-ai-edit/entity-descriptor.ts
//
// Pure, i18n-free. Per-entity configuration for the inline "Ask Claude" editor:
// which fields an update tool can write, and the apply-preview guards that keep
// a previewed diff from diverging from what the dispatcher's sanitizeX would
// actually persist (invalid enum/date/range values are COERCED or DROPPED by the
// sanitizers, so we must reject them in the preview instead of showing a diff
// Apply won't make). See docs plan for the pinned sanitizer behavior.
import {
  PRIORITIES, TASK_STATUSES,
  RAID_CATEGORIES, RAID_SEVERITIES,
  RISK_STATUSES, ASSUMPTION_STATUSES, ISSUE_STATUSES, DEPENDENCY_STATUSES,
  CHANGE_TYPES, CHANGE_STATUSES,
  STAKEHOLDER_CATEGORIES, INFLUENCE_INTEREST_LEVELS,
  type RaidCategory,
} from "../types";
import { type Workspace } from "../workspace";

export type InlineEntity = "task" | "raid" | "change" | "milestone" | "stakeholder" | "resource";

// Change impact reuses RAID severities plus "Critical" (matches CHANGE_IMPACT_SET
// in sanitize-records.ts). No named const exists, so define it here.
const CHANGE_IMPACT_LEVELS = ["Low", "Medium", "High", "Critical"] as const;

/** A field whose valid value-set may depend on the (patched) item — used for
 *  RAID status, which is category-scoped. Returns the set of strings the
 *  sanitizer would keep verbatim. */
export type EnumResolver = (patchedItem: Record<string, unknown>) => ReadonlySet<string>;

export interface EntityDescriptor {
  entity: InlineEntity;
  updateTool: string;
  deleteTool: string;
  createTool: string;
  wsKey: keyof Workspace;
  /** Exactly the fields the dispatcher's update tool can persist (scalar/enum/
   *  date/number only — relational id-lists + FKs excluded). */
  diffFields: string[];
  /** Required fields whose value must stay non-empty (sanitizer returns null →
   *  dispatcher throws otherwise). */
  requiredNonEmpty: ReadonlySet<string>;
  /** Fields validated as YYYY-MM-DD when non-empty (invalid → sanitizer drops/blanks). */
  dateFields: ReadonlySet<string>;
  /** Integer-range fields [min, max]; use Infinity for an open upper bound. */
  intRangeFields: Record<string, [number, number]>;
  /** Enum fields → the valid-set resolver (constant for most; category-scoped for RAID status). */
  enumFields: Record<string, EnumResolver>;
  /** For an enum field whose valid-set depends on ANOTHER field (RAID status
   *  depends on category): the value the sanitizer resets it to when the current
   *  value falls out of the patched valid-set. Lets the preview surface a
   *  sanitizer-induced reset (e.g. category R→I silently moves status to the
   *  Issue default). Undefined for fields with no such cross-field dependency. */
  enumDefaultFor?: (field: string, patchedItem: Record<string, unknown>) => string | undefined;
  /** Fields sent to Apply as a comma-split string[] (task labels). */
  arrayFields: ReadonlySet<string>;
  /** Fields coerced to Number on Apply. */
  numberFields: ReadonlySet<string>;
  titleOf: (item: Record<string, unknown>) => string;
}

const constSet = (values: readonly string[]): EnumResolver => {
  const set = new Set<string>(values);
  return () => set;
};

// RAID status set for the patched item's effective category.
function raidStatusSet(cat: RaidCategory): ReadonlySet<string> {
  switch (cat) {
    case "A": return new Set(ASSUMPTION_STATUSES);
    case "I": return new Set(ISSUE_STATUSES);
    case "D": return new Set(DEPENDENCY_STATUSES);
    default:  return new Set(RISK_STATUSES);
  }
}
function raidCategoryOf(item: Record<string, unknown>): RaidCategory {
  const raw = item.category;
  return typeof raw === "string" && (RAID_CATEGORIES as string[]).includes(raw) ? (raw as RaidCategory) : "R";
}
const raidStatusResolver: EnumResolver = (item) => raidStatusSet(raidCategoryOf(item));
// Mirrors sanitize-records.ts statusSetForCategory(...).statuses[0] — the value
// the sanitizer resets an out-of-category RAID status to.
function raidStatusDefault(cat: RaidCategory): string {
  switch (cat) {
    case "A": return ASSUMPTION_STATUSES[0];
    case "I": return ISSUE_STATUSES[0];
    case "D": return DEPENDENCY_STATUSES[0];
    default:  return RISK_STATUSES[0];
  }
}

export const INLINE_DESCRIPTORS: Record<InlineEntity, EntityDescriptor> = {
  task: {
    entity: "task", updateTool: "update_task", deleteTool: "delete_task", createTool: "create_task", wsKey: "tasks",
    diffFields: ["taskName", "assignee", "assigneeEmail", "dueDate", "status", "priority", "description", "blockers", "group", "labels"],
    requiredNonEmpty: new Set(["taskName", "dueDate"]),
    dateFields: new Set(["dueDate"]),
    intRangeFields: {},
    enumFields: { status: constSet(TASK_STATUSES), priority: constSet(PRIORITIES) },
    arrayFields: new Set(["labels"]),
    numberFields: new Set(),
    titleOf: (i) => String(i.taskName ?? ""),
  },
  raid: {
    entity: "raid", updateTool: "update_raid_item", deleteTool: "delete_raid_item", createTool: "create_raid_item", wsKey: "raid",
    // ORDER MATTERS: "category" MUST precede "status" — describeEntityCalls
    // validates the category-scoped status against the incrementally-accepted
    // patch, so a co-changed category must already be applied when status is
    // checked. Pinned by the "co-changed category" test in plan.test.ts.
    diffFields: ["category", "title", "status", "description", "mitigation", "owner", "ownerEmail", "severity", "probability", "impact", "raisedDate", "targetDate", "closedDate"],
    requiredNonEmpty: new Set(["title"]),
    dateFields: new Set(["raisedDate", "targetDate", "closedDate"]),
    intRangeFields: { probability: [1, 5], impact: [1, 5] },
    enumFields: { category: constSet(RAID_CATEGORIES), severity: constSet(RAID_SEVERITIES), status: raidStatusResolver },
    enumDefaultFor: (field, item) => (field === "status" ? raidStatusDefault(raidCategoryOf(item)) : undefined),
    arrayFields: new Set(),
    numberFields: new Set(["probability", "impact"]),
    titleOf: (i) => String(i.title ?? ""),
  },
  change: {
    entity: "change", updateTool: "update_change", deleteTool: "delete_change", createTool: "create_change", wsKey: "changes",
    diffFields: ["title", "description", "type", "status", "impact", "impactDescription", "scheduleImpactDays", "costImpact", "requestedBy", "raisedDate", "decisionBy", "decisionDate", "resolutionNotes"],
    requiredNonEmpty: new Set(["title"]),
    dateFields: new Set(["raisedDate", "decisionDate"]),
    intRangeFields: { scheduleImpactDays: [0, Infinity], costImpact: [0, Infinity] },
    enumFields: { type: constSet(CHANGE_TYPES), status: constSet(CHANGE_STATUSES), impact: constSet(CHANGE_IMPACT_LEVELS) },
    arrayFields: new Set(),
    numberFields: new Set(["scheduleImpactDays", "costImpact"]),
    titleOf: (i) => String(i.title ?? ""),
  },
  milestone: {
    entity: "milestone", updateTool: "update_milestone", deleteTool: "delete_milestone", createTool: "create_milestone", wsKey: "milestones",
    diffFields: ["name", "date", "description", "achievedDate"],
    requiredNonEmpty: new Set(["name", "date"]),
    dateFields: new Set(["date", "achievedDate"]),
    intRangeFields: {},
    enumFields: {},
    arrayFields: new Set(),
    numberFields: new Set(),
    titleOf: (i) => String(i.name ?? ""),
  },
  stakeholder: {
    entity: "stakeholder", updateTool: "update_stakeholder", deleteTool: "delete_stakeholder", createTool: "create_stakeholder", wsKey: "stakeholders",
    diffFields: ["name", "organization", "title", "email", "category", "influence", "interest", "notes"],
    requiredNonEmpty: new Set(["name"]),
    dateFields: new Set(),
    intRangeFields: {},
    enumFields: { category: constSet(STAKEHOLDER_CATEGORIES), influence: constSet(INFLUENCE_INTEREST_LEVELS), interest: constSet(INFLUENCE_INTEREST_LEVELS) },
    arrayFields: new Set(),
    numberFields: new Set(),
    titleOf: (i) => String(i.name ?? ""),
  },
  resource: {
    entity: "resource", updateTool: "update_resource", deleteTool: "delete_resource", createTool: "create_resource", wsKey: "resources",
    // Derived from `ResourceInput` (chat-tools.ts) ∩ what `sanitizeResource`
    // stores VERBATIM. Four writable inputs are deliberately absent:
    //   • `roleId` — an FK, excluded by the same rule as Task.resourceId.
    //   • `emails` — sanitizeEmailList DEDUPES it against the primary `email`
    //     and caps it, so a previewed list routinely diverges from the stored
    //     one. `arrayFields` cannot express that (it means "comma-split on
    //     Apply", which is the task-labels shape, not this one).
    //   • `name` — a WRITE ALIAS the dispatcher splits into first/last; it is
    //     not a stored field, so `before` would read empty for every resource.
    //     Diffing the parts is the honest form. ★ CONSEQUENCE: a rename sent as
    //     `update_resource({name})` alone produces NO diff and previews as an
    //     empty plan.
    //   • `birthday` — stored, but absent from `ResourceInput`: the tool cannot
    //     write it, so a diff here could never be applied.
    diffFields: ["firstName", "lastName", "title", "email", "department", "company", "location", "businessPhone", "isExternal", "notes"],
    // ★★ The sanitizer's REAL rule is "at least ONE of firstName/lastName
    // non-empty" — blanking both returns null and the dispatcher throws
    // "invalid resource update". `requiredNonEmpty` is per-field and cannot
    // express a disjunction, so BOTH are marked. That over-rejects blanking one
    // part while the other stands; over-rejecting is the safe direction here,
    // since the alternative previews a diff whose Apply throws.
    requiredNonEmpty: new Set(["firstName", "lastName"]),
    // `birthday` is the only date-shaped Resource field and it is NOT writable
    // (see above) — and it is "MM-DD", which sanitizeIsoDate would reject anyway.
    dateFields: new Set(),
    intRangeFields: {},
    enumFields: {},
    arrayFields: new Set(),
    numberFields: new Set(),
    // ★ NOT `i.title` — that is the JOB title. The two name parts are the row's
    // identity (`sanitizeResource` rejects a row with neither).
    titleOf: (i) => `${String(i.firstName ?? "")} ${String(i.lastName ?? "")}`.trim(),
  },
};

/** The valid value-set for an enum field given the (patched) item. Returns an
 *  empty set for a non-enum field. */
export function validSetFor(entity: InlineEntity, field: string, patchedItem: Record<string, unknown>): ReadonlySet<string> {
  const resolver = INLINE_DESCRIPTORS[entity].enumFields[field];
  return resolver ? resolver(patchedItem) : new Set<string>();
}

/** The value the sanitizer resets a cross-field-dependent enum to (RAID status
 *  when category changes out from under it). Undefined when the field has no
 *  such dependency. */
export function defaultEnumFor(entity: InlineEntity, field: string, patchedItem: Record<string, unknown>): string | undefined {
  return INLINE_DESCRIPTORS[entity].enumDefaultFor?.(field, patchedItem);
}
