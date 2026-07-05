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

export type InlineEntity = "task" | "raid" | "change" | "milestone" | "stakeholder";

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
const raidStatusResolver: EnumResolver = (item) => {
  const raw = item.category;
  const cat: RaidCategory = typeof raw === "string" && (RAID_CATEGORIES as string[]).includes(raw)
    ? (raw as RaidCategory) : "R";
  return raidStatusSet(cat);
};

export const INLINE_DESCRIPTORS: Record<InlineEntity, EntityDescriptor> = {
  task: {
    entity: "task", updateTool: "update_task", deleteTool: "delete_task", createTool: "create_task", wsKey: "tasks",
    diffFields: ["taskName", "assignee", "assigneeEmail", "dueDate", "status", "priority", "notes", "blockers", "group", "labels"],
    requiredNonEmpty: new Set(["taskName"]),
    dateFields: new Set(["dueDate"]),
    intRangeFields: {},
    enumFields: { status: constSet(TASK_STATUSES), priority: constSet(PRIORITIES) },
    arrayFields: new Set(["labels"]),
    numberFields: new Set(),
    titleOf: (i) => String(i.taskName ?? ""),
  },
  raid: {
    entity: "raid", updateTool: "update_raid_item", deleteTool: "delete_raid_item", createTool: "create_raid_item", wsKey: "raid",
    diffFields: ["category", "title", "status", "description", "mitigation", "owner", "ownerEmail", "severity", "probability", "impact", "raisedDate", "targetDate", "closedDate"],
    requiredNonEmpty: new Set(["title"]),
    dateFields: new Set(["raisedDate", "targetDate", "closedDate"]),
    intRangeFields: { probability: [1, 5], impact: [1, 5] },
    enumFields: { category: constSet(RAID_CATEGORIES), severity: constSet(RAID_SEVERITIES), status: raidStatusResolver },
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
};

/** The valid value-set for an enum field given the (patched) item. Returns an
 *  empty set for a non-enum field. */
export function validSetFor(entity: InlineEntity, field: string, patchedItem: Record<string, unknown>): ReadonlySet<string> {
  const resolver = INLINE_DESCRIPTORS[entity].enumFields[field];
  return resolver ? resolver(patchedItem) : new Set<string>();
}
