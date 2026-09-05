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
import {
  BUDGET_NAME_MAX,
  isExternalFlag,
  optMultiline,
  optText,
} from "../sanitize-entities";
import {
  TASK_NAME_MAX,
  TEXTAREA_MAX,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeEmail,
  sanitizeGroup,
  sanitizeTaskName,
  sanitizeText,
} from "../sanitize-core";

/** `sanitizeText` bound to one cap, as the apply-path sanitizers call it.
 *  Written as a factory so a `fieldSanitizers` entry can never carry a cap
 *  without the function that consumes it. */
const text = (max: number) => (v: unknown): string => sanitizeText(v, max);
/** The resource optional-text path. `undefined` there means "key dropped",
 *  which on an update spread over the stored row clears the field — the same
 *  outcome `""` denotes everywhere else in a preview. */
const optionalText = (v: unknown): string => optText(v) ?? "";
const optionalMultiline = (v: unknown): string => optMultiline(v) ?? "";

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
  /** Fields whose apply path REJECTS a malformed address outright, rather than
   *  storing whatever the length cap left.
   *
   *  ★★★ NOT EVERY EMAIL FIELD — this is per-FIELD, not per-shape, and reading
   *   it as "the email fields" gets it wrong in both directions.
   *   `buildTaskCleanPatch` THROWS "assigneeEmail is invalid" when
   *   `isValidEmail` fails, and a throw there fails the WHOLE patch, so every
   *   other field in the same edit is lost with it. `sanitizeRaidItem` runs the
   *   same `sanitizeEmail` over `ownerEmail` and simply stores the result with
   *   no format guard at all, so rejecting there would be the preview inventing
   *   a rule apply does not have.
   *
   *  ★ Found by `plan.sanitizer-parity.test.ts`, which had to carry this pair
   *   as an enumerated exception until the guard existed. */
  emailFormatFields: ReadonlySet<string>;
  /** Fields sent to Apply as a comma-split string[] (task labels). */
  arrayFields: ReadonlySet<string>;
  /** Fields coerced to Number on Apply. */
  numberFields: ReadonlySet<string>;
  /** A field → the EXACT normalisation the APPLY path performs on it, rendered
   *  as the string the preview shows. `""` means "the sanitizer's result is
   *  dropped", which on an update spread over the stored row CLEARS the field.
   *  `describeEntityCalls` runs BOTH the stored `before` and the incoming
   *  `after` through the same entry, so the two sides are always compared in
   *  the same normal form.
   *
   *  ★★★ DELEGATE, NEVER RESTATE. Each entry calls the real function — not a
   *   copy of its cap, and not a copy of its ALGORITHM. §373's first cut did
   *   both: it read caps from the exported constants (right) and then
   *   reimplemented the clipping as `trimmed.slice(0, cap)` (wrong), so a value
   *   ending on an astral character at the boundary previewed one UTF-16 code
   *   unit longer than `clipText`'s surrogate back-off stores. `clipText` is
   *   not even exported, which is the signal that a preview must call the
   *   field's own sanitizer rather than reproduce it.
   *
   *  ★★★ AN ABSENT FIELD IS PREVIEWED VERBATIM (`str`), and that default is the
   *   load-bearing half. The inverse — "everything not a number is text" —
   *   ran `resource.isExternal`, the one non-string field any `diffFields`
   *   names, through a text sanitizer that blanks a non-string to `""`; since
   *   `FieldDiff.raw` feeds the write patch in `use-inline-entity-edit.ts`,
   *   that DROPPED the flag on apply, not merely in the card.
   *
   *  ★★ VERBATIM IS NOT ENOUGH FOR THAT FIELD EITHER, which is why it has an
   *   entry rather than being left out. `isExternal` is stored PRESENT-OR-
   *   ABSENT (`sanitizeResource` sets the key only when the flag is true), so
   *   an internal resource carries no key: `str(undefined)` is `""`, an
   *   incoming `false` reads as a change, and a no-op renders a spurious diff.
   *   Both sides go through `isExternalFlag` — the predicate `sanitizeResource`
   *   itself calls — so `false` vs absent compares equal.
   *
   *  ★★ THE SANITIZERS ARE NOT UNIFORM — read the field's own, do not pattern-
   *   match on its name. `sanitizeText` trims then clips; `sanitizeMultiline`
   *   clips WITHOUT trimming; `optText`/`optMultiline` (the resource optional
   *   path) trim with NO cap, and `optMultiline` also normalises CRLF. Three
   *   different caps are in play for fields all called "a name", and
   *   `stakeholder.email` is capped at BUDGET_NAME_MAX (200), not EMAIL_MAX.
   *
   *  ★ Rich HTML fields (`RICH_FIELDS` in plan.ts) are deliberately absent:
   *   their apply-path sanitizer is `sanitizeAiRichText`, which needs a DOM,
   *   and their preview is a plain-text PROJECTION of the value rather than the
   *   value itself. `descriptor-drift.test.ts` owns that pair. Enum, date,
   *   int-range and array fields are absent too — `describeEntityCalls` guards
   *   each of those with a rule of its own, against the same sanitizer.
   *
   *  ★ `plan.sanitizer-parity.test.ts` is the differential gate on all of it:
   *   every entity × every `diffField` × a hostile probe set, preview against
   *   the real sanitizer. */
  fieldSanitizers: Record<string, (v: unknown) => string>;
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
    // ★ The ONLY member across all six entities: `buildTaskCleanPatch` throws
    //   on a malformed address, and the throw fails the whole patch.
    emailFormatFields: new Set(["assigneeEmail"]),
    arrayFields: new Set(["labels"]),
    numberFields: new Set(),
    // Mirrors `buildTaskCleanPatch` (chat-task-patch.ts) field for field.
    // ★ `blockers` is the ONE multiline member here — `sanitizeBlockers` is
    //   `sanitizeMultiline(_, TEXTAREA_MAX)`, which does NOT trim.
    fieldSanitizers: {
      taskName: sanitizeTaskName,
      assignee: sanitizeAssignee,
      assigneeEmail: sanitizeEmail,
      blockers: sanitizeBlockers,
      group: sanitizeGroup,
    },
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
    emailFormatFields: new Set(),
    arrayFields: new Set(),
    numberFields: new Set(["probability", "impact"]),
    // Mirrors `sanitizeRaidItem` (sanitize-records.ts). ★ `title` is capped at
    // TASK_NAME_MAX (500) here and at BUDGET_NAME_MAX (200) on `change` and
    // `milestone` — same field name, different cap, which is why this map is
    // per-entity.
    fieldSanitizers: {
      title: text(TASK_NAME_MAX),
      owner: text(BUDGET_NAME_MAX),
      ownerEmail: sanitizeEmail,
    },
    titleOf: (i) => String(i.title ?? ""),
  },
  change: {
    entity: "change", updateTool: "update_change", deleteTool: "delete_change", createTool: "create_change", wsKey: "changes",
    diffFields: ["title", "description", "type", "status", "impact", "impactDescription", "scheduleImpactDays", "costImpact", "requestedBy", "raisedDate", "decisionBy", "decisionDate", "resolutionNotes"],
    requiredNonEmpty: new Set(["title"]),
    dateFields: new Set(["raisedDate", "decisionDate"]),
    intRangeFields: { scheduleImpactDays: [0, Infinity], costImpact: [0, Infinity] },
    enumFields: { type: constSet(CHANGE_TYPES), status: constSet(CHANGE_STATUSES), impact: constSet(CHANGE_IMPACT_LEVELS) },
    emailFormatFields: new Set(),
    arrayFields: new Set(),
    numberFields: new Set(["scheduleImpactDays", "costImpact"]),
    // Mirrors `sanitizeChangeItem` (sanitize-records.ts).
    fieldSanitizers: {
      title: text(BUDGET_NAME_MAX),
      requestedBy: text(BUDGET_NAME_MAX),
      decisionBy: text(BUDGET_NAME_MAX),
    },
    titleOf: (i) => String(i.title ?? ""),
  },
  milestone: {
    entity: "milestone", updateTool: "update_milestone", deleteTool: "delete_milestone", createTool: "create_milestone", wsKey: "milestones",
    diffFields: ["name", "date", "description", "achievedDate"],
    requiredNonEmpty: new Set(["name", "date"]),
    dateFields: new Set(["date", "achievedDate"]),
    intRangeFields: {},
    enumFields: {},
    emailFormatFields: new Set(),
    arrayFields: new Set(),
    numberFields: new Set(),
    // Mirrors `sanitizeMilestone` (sanitize-records.ts) — `name` is the only
    // non-date, non-rich field it has.
    fieldSanitizers: { name: text(BUDGET_NAME_MAX) },
    titleOf: (i) => String(i.name ?? ""),
  },
  stakeholder: {
    entity: "stakeholder", updateTool: "update_stakeholder", deleteTool: "delete_stakeholder", createTool: "create_stakeholder", wsKey: "stakeholders",
    diffFields: ["name", "organization", "title", "email", "category", "influence", "interest", "notes"],
    requiredNonEmpty: new Set(["name"]),
    dateFields: new Set(),
    intRangeFields: {},
    enumFields: { category: constSet(STAKEHOLDER_CATEGORIES), influence: constSet(INFLUENCE_INTEREST_LEVELS), interest: constSet(INFLUENCE_INTEREST_LEVELS) },
    emailFormatFields: new Set(),
    arrayFields: new Set(),
    numberFields: new Set(),
    // Mirrors `sanitizeStakeholder` (sanitize-records.ts). ★★ `notes` is
    // `sanitizeText(_, TEXTAREA_MAX)` — TRIMMED, despite being a textarea and
    // despite `Task.blockers` (the same shape) using `sanitizeMultiline`. Read
    // the field's own sanitizer; the name does not tell you which family it is
    // in. ★ `email` is BUDGET_NAME_MAX (200), NOT EMAIL_MAX.
    fieldSanitizers: {
      name: text(BUDGET_NAME_MAX),
      organization: text(BUDGET_NAME_MAX),
      title: text(BUDGET_NAME_MAX),
      email: text(BUDGET_NAME_MAX),
      notes: text(TEXTAREA_MAX),
    },
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
    //     Diffing the parts is the honest form. ★ `describeEntityCalls` projects
    //     an alias-only rename onto the parts before diffing (via the
    //     dispatcher's own `splitName`), so such a rename previews correctly —
    //     see 372.
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
    emailFormatFields: new Set(),
    arrayFields: new Set(),
    numberFields: new Set(),
    // Mirrors `sanitizeResource` (sanitize-entities.ts), which uses THREE
    // different helpers across these ten fields:
    //   • firstName/lastName → `sanitizeAssignee` (trim + ASSIGNEE_MAX 200)
    //   • email              → `sanitizeEmail`    (trim + EMAIL_MAX 320)
    //   • the five optional single-line fields → `optText` (trim, NO cap)
    //   • notes              → `optMultiline`     (CRLF→LF, trim, NO cap)
    // ★★★ `isExternal` — the only non-string field in any entity's
    //  `diffFields` — goes through `sanitizeResource`'s OWN predicate. A text
    //  sanitizer here blanks it to `""`, which drops the flag on apply
    //  (`FieldDiff.raw` is the write patch's value); leaving it out entirely
    //  previews `str(v)` verbatim, which is right for `true` but renders a
    //  spurious diff for a no-op `false`, because the flag is stored
    //  present-or-absent and `str(undefined)` is `""`, not `"false"`.
    fieldSanitizers: {
      firstName: sanitizeAssignee,
      lastName: sanitizeAssignee,
      email: sanitizeEmail,
      title: optionalText,
      department: optionalText,
      company: optionalText,
      location: optionalText,
      businessPhone: optionalText,
      notes: optionalMultiline,
      isExternal: (v) => String(isExternalFlag(v)),
    },
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
