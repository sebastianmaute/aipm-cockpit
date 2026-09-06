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
  sanitizeEmailList,
  sanitizeIdList,
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
  toNumber,
} from "../sanitize-core";
import {
  acceptsCostAmount,
  acceptsRiskScale,
  acceptsScheduleDays,
  sanitizeMilestoneTaskIds,
} from "../sanitize-records";
import { roleLabel } from "../resource-foundation";
import { str } from "./str";

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

export interface LinkField {
  /** The workspace array holding the referenced rows. */
  readonly wsKey: keyof Workspace;
  /** `"list"` for an id array, `"id"` for a single FK (`resource.roleId`). */
  readonly kind: "list" | "id";
  /** The referenced row's display name.
   *
   *  ★★★ IT TAKES THE WORKSPACE, and that is not ceremony — `Role` HAS NO
   *   `name` FIELD. A role's label is `disciplineId` + `gradeId` resolved
   *   against two OTHER workspace arrays (`roleLabel`), so a single-row
   *   accessor renders `""` for every role, which on this card is
   *   indistinguishable from the link having been dropped. `version-diff.ts`
   *   widened its `roles` `nameOf` for exactly this reason. The caller pays
   *   nothing: it must already hold the workspace to resolve `ws[wsKey]`. */
  readonly titleOf: (row: Record<string, unknown>, ws: Workspace) => string;
  /** The APPLY path's own id rule for this field. */
  readonly sanitize: (v: unknown) => number[];
}

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
  /** Groups of fields the WRITER requires only JOINTLY — at least one member
   *  non-empty. `sanitizeResource`'s gate is `if (!firstName && !lastName)
   *  return null`, a whole-row OR evaluated after the merge, where
   *  `requiredNonEmpty` is a per-field partition. Judging a member alone is
   *  §384: the preview called a mononym rename's `lastName` rejected while the
   *  write accepted the row and stored "". A member of a group is EXEMPT from
   *  `requiredNonEmpty` — `describeEntityCalls` checks group membership FIRST,
   *  so the exemption holds by construction rather than by this entity's
   *  `requiredNonEmpty` happening to be empty. */
  requiredNonEmptyGroups: ReadonlyArray<ReadonlySet<string>>;
  /** Fields validated as YYYY-MM-DD when non-empty (invalid → sanitizer drops/blanks). */
  dateFields: ReadonlySet<string>;
  /** Numeric fields → the WRITER's own acceptance predicate, applied to the RAW
   *  model value.
   *
   *  ★★★ RAW, NOT THE RENDERED STRING, AND THAT IS THE WHOLE CHANGE. The old
   *  `intRangeFields` tuple was checked against `Number(after)`, and `after` has
   *  already been through `numberPreview` — so `true` arrived as `"1"` and the
   *  boolean-ness the writer needed to refuse was gone (§395). A predicate over
   *  the raw value is the only shape that can see it.
   *
   *  ★★ The predicate is IMPORTED from `sanitize-records.ts`, never re-spelled
   *  here. That is §405's rule reaching the preview: one function, consulted by
   *  the card and by the write. */
  numericFields: Record<string, (v: unknown) => boolean>;
  /** Fields whose model value must be a STRING to be previewable at all. A
   *  non-string is REFUSED rather than projected, because the writer's
   *  `sanitizeRichText` drops the key and the merge-site guard now keeps the
   *  stored value — so projecting one would promise a change that will not
   *  happen (§398).
   *
   *  ★★ IT REFUSES THE RENDERED-CLEAR SHAPES TOO (`null`, `[]`), and that is
   *  the opposite of `dateFields`, where the preview discloses those AS a clear
   *  and `acceptsPatchDate` carves them out on the writer side to match. The
   *  two sides agree either way; what differs is WHICH way. Do not import the
   *  date rule's carve-out here — it would put the card back to promising a
   *  clear the milestone guard declines.
   *
   *  ★★ Scoped to `milestone.description` today because that is what §398
   *  filed — NOT because the other six are safe. They are not: every one of
   *  them loses the stored value on a non-string, by THREE different
   *  mechanisms, which is why widening this set is not a one-line change.
   *    • `raid.description` / `raid.mitigation` /
   *      `change.impactDescription` / `change.resolutionNotes` — the same
   *      drop-key shape as milestone (`if (x) item.x = x`). A merge-site guard
   *      entry in `RAID_FIELD_GUARDS` / `CHANGE_FIELD_GUARDS` would fit.
   *    • `change.description` — assigned UNCONDITIONALLY in the `ChangeItem`
   *      literal, so a non-string stores `""` rather than omitting the key.
   *      Same loss, different shape, and invisible to an `if (x)` grep.
   *    • `task.description` — no guard table exists at all. Its writer is
   *      `buildTaskCleanPatch` (`chat-task-patch.ts`), which assigns whenever
   *      the key is present, so it needs a different fix from the other two.
   *  ★ Whichever is done, the guard must nest OUTSIDE `withAiRichFields` at the
   *  call site or it cannot fire — see `use-register-tools.ts`. A separate
   *  register entry; do not widen this set on the strength of the field merely
   *  being rich.
   *
   *  ★★★ AND A SET LIKE THIS CANNOT CLOSE THE WHOLE CLASS, which is the part to
   *  read before treating `stringOnlyFields` as the pattern to copy. It asks
   *  `typeof v === "string"`, so it is blind to a STRING the allow-list reduces
   *  to empty (`"<p><script>x</script></p>"`): the card previews it verbatim
   *  and the write clears the stored text. Measured over all seven
   *  `RICH_FIELDS` members — `sanitizeAiRichText` returns "" for that input, and
   *  raid's two plus change's `impactDescription`/`resolutionNotes` then drop
   *  the key, `change.description` stores "", and `task.description` reaches
   *  the merge as "". Every one promises a change the write does not make.
   *  Pre-existing, filed separately, and NOT closable here: the preview would
   *  have to model the allow-list, which needs a DOM — the very reason a rich
   *  field has no `fieldSanitizers` entry. Characterized in
   *  `sanitize-milestone-patch.test.ts`. */
  stringOnlyFields: Set<string>;
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
   *   ran `resource.isExternal`, the only BOOLEAN field any `diffFields`
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
   *   numeric and array fields are absent too — `describeEntityCalls` guards
   *   each of those with a rule of its own, against the same sanitizer.
   *
   *  ★ `plan.sanitizer-parity.test.ts` is the differential gate on all of it:
   *   every entity × every `diffField` × a hostile probe set, preview against
   *   the real sanitizer. */
  fieldSanitizers: Record<string, (v: unknown) => string>;
  /** Relationship and FK inputs the update tool accepts, which `diffFields`
   *  deliberately excludes (its contract is scalar/enum/date/number only).
   *
   *  ★★★ SUPPLYING ONE REPLACES THE STORED LIST — every dispatcher merges by
   *   object spread, so `linkedTaskIds: [7]` drops the other links. Nothing
   *   reconstructs them: there is no reciprocal field on the referenced row, the
   *   derived index is computed FROM this array, and the activity-log entry
   *   carries no field diff. The undo stack's before-image is the only surviving
   *   copy and it is session-scoped. Disclosure before approval is the whole
   *   mitigation.
   *
   *  ★★★ THE TWO SETS MUST STAY DISJOINT FROM `diffFields`, and the reason is a
   *   write, not a render: `use-inline-entity-edit.ts` puts every `diffFields`
   *   member's rendered value BACK as the patch value, so a link field named in
   *   both would write a title STRING into an id array and wipe it. Pinned by
   *   "declares no link field that is also a diffField".
   *
   *  `sanitize` must be the WRITER'S OWN function, never a copy of its rule —
   *  raid and change use `sanitizeIdList` (parses a delimited string, dedupes),
   *  milestone uses `sanitizeMilestoneTaskIds` (array-only, no dedupe), and
   *  `resource.roleId` coerces with `toNumber`, which rejects the array shapes
   *  bare `Number` would accept. */
  linkFields: Record<string, LinkField>;
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
    // ★★ `lastUpdateDate` is LAST because the loop emits diffs in this order and
    //  the existing expectations read positionally. It is a real declared input
    //  (`TaskInput.lastUpdateDate`, written by `buildTaskCleanPatch`) that NO
    //  writer stamps implicitly on an inline edit, so an explicit change is
    //  signal rather than noise.
    diffFields: ["taskName", "assignee", "assigneeEmail", "dueDate", "status", "priority", "description", "blockers", "group", "labels", "lastUpdateDate"],
    requiredNonEmpty: new Set(["taskName", "dueDate"]),
    requiredNonEmptyGroups: [],
    // ★★ THE TWO TASK DATES ARE NOT SYMMETRIC ON A BLANK, and only `dueDate`'s
    //  half is closed here. `buildTaskCleanPatch` THROWS on an unparseable
    //  `dueDate` and `requiredNonEmpty` rejects the blank ahead of it; for
    //  `lastUpdateDate` it merely DROPS the key (`if (d) cleanPatch.lastUpdateDate = d`), and
    //  a dropped key on a PATCH merged over the stored task leaves the field
    //  UNCHANGED — where the full-record sanitizers behind raid/change/milestone
    //  clear theirs. So `lastUpdateDate: ""` still previews a clear the write
    //  will not make. Recorded, not fixed: closing it needs a "blank is a no-op"
    //  mechanism this descriptor does not have, and `requiredNonEmpty` is the
    //  wrong one (it means "the writer throws", which is not what happens).
    dateFields: new Set(["dueDate", "lastUpdateDate"]),
    numericFields: {},
    stringOnlyFields: new Set(),
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
    // ★ `taskFields` declares no id-list input — a task's relationships
    //  (`resourceId`, `dependencies`) are not writable by `update_task`.
    linkFields: {},
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
    requiredNonEmptyGroups: [],
    dateFields: new Set(["raisedDate", "targetDate", "closedDate"]),
    // ★ `acceptsRiskScale` ignores its `category` argument — the [1,5] scale is
    //  the same for every RAID category — so any member closes the signature.
    numericFields: { probability: (v) => acceptsRiskScale(v, "R"), impact: (v) => acceptsRiskScale(v, "R") },
    stringOnlyFields: new Set(),
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
    linkFields: {
      linkedTaskIds: { wsKey: "tasks", kind: "list", titleOf: (r) => str(r.taskName), sanitize: sanitizeIdList },
      causedByRaidIds: { wsKey: "raid", kind: "list", titleOf: (r) => str(r.title), sanitize: sanitizeIdList },
      stakeholderIds: { wsKey: "stakeholders", kind: "list", titleOf: (r) => str(r.name), sanitize: sanitizeIdList },
    },
    titleOf: (i) => String(i.title ?? ""),
  },
  change: {
    entity: "change", updateTool: "update_change", deleteTool: "delete_change", createTool: "create_change", wsKey: "changes",
    diffFields: ["title", "description", "type", "status", "impact", "impactDescription", "scheduleImpactDays", "costImpact", "requestedBy", "raisedDate", "decisionBy", "decisionDate", "resolutionNotes"],
    requiredNonEmpty: new Set(["title"]),
    requiredNonEmptyGroups: [],
    dateFields: new Set(["raisedDate", "decisionDate"]),
    numericFields: { scheduleImpactDays: acceptsScheduleDays, costImpact: acceptsCostAmount },
    stringOnlyFields: new Set(),
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
    // ★ `linkedRaidIds` here, `causedByRaidIds` on raid — the same referenced
    //  array under two different input names. The tool's spelling wins.
    linkFields: {
      linkedTaskIds: { wsKey: "tasks", kind: "list", titleOf: (r) => str(r.taskName), sanitize: sanitizeIdList },
      linkedRaidIds: { wsKey: "raid", kind: "list", titleOf: (r) => str(r.title), sanitize: sanitizeIdList },
      stakeholderIds: { wsKey: "stakeholders", kind: "list", titleOf: (r) => str(r.name), sanitize: sanitizeIdList },
    },
    titleOf: (i) => String(i.title ?? ""),
  },
  milestone: {
    entity: "milestone", updateTool: "update_milestone", deleteTool: "delete_milestone", createTool: "create_milestone", wsKey: "milestones",
    diffFields: ["name", "date", "description", "achievedDate"],
    requiredNonEmpty: new Set(["name", "date"]),
    requiredNonEmptyGroups: [],
    dateFields: new Set(["date", "achievedDate"]),
    numericFields: {},
    // ★★ THE ONLY POPULATED SET ACROSS THESE SIX, and it is half of a pair —
    //  `MILESTONE_FIELD_GUARDS.description` (sanitize-records.ts) is the other.
    //  Removing either re-opens §398 in the direction the surviving half points.
    stringOnlyFields: new Set(["description"]),
    enumFields: {},
    emailFormatFields: new Set(),
    arrayFields: new Set(),
    numberFields: new Set(),
    // Mirrors `sanitizeMilestone` (sanitize-records.ts) — `name` is the only
    // non-date, non-rich field it has.
    fieldSanitizers: { name: text(BUDGET_NAME_MAX) },
    // ★★ NOT `sanitizeIdList`. The milestone writer has its own rule: array
    //  only (a delimited string yields `[]`, where raid/change parse one) and NO
    //  dedupe. Substituting the raid/change function would preview links this
    //  write drops — `sanitize-records.ts` exports it to prevent exactly that.
    linkFields: {
      linkedTaskIds: { wsKey: "tasks", kind: "list", titleOf: (r) => str(r.taskName), sanitize: sanitizeMilestoneTaskIds },
    },
    titleOf: (i) => String(i.name ?? ""),
  },
  stakeholder: {
    entity: "stakeholder", updateTool: "update_stakeholder", deleteTool: "delete_stakeholder", createTool: "create_stakeholder", wsKey: "stakeholders",
    diffFields: ["name", "organization", "title", "email", "category", "influence", "interest", "notes"],
    requiredNonEmpty: new Set(["name"]),
    requiredNonEmptyGroups: [],
    dateFields: new Set(),
    numericFields: {},
    stringOnlyFields: new Set(),
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
    // ★ `Stakeholder.raci` IS a relationship, but `stakeholderFields` does not
    //  declare it — `update_stakeholder` cannot write it, so there is nothing
    //  here to disclose.
    linkFields: {},
    titleOf: (i) => String(i.name ?? ""),
  },
  resource: {
    entity: "resource", updateTool: "update_resource", deleteTool: "delete_resource", createTool: "create_resource", wsKey: "resources",
    // Derived from `ResourceInput` (chat-tools.ts) ∩ what `sanitizeResource`
    // stores VERBATIM. Four writable inputs are deliberately absent:
    //   • `roleId` — an FK, excluded by the same rule as Task.resourceId.
    //   • `name` — a WRITE ALIAS the dispatcher splits into first/last; it is
    //     not a stored field, so `before` would read empty for every resource.
    //     Diffing the parts is the honest form. ★ `describeEntityCalls` projects
    //     an alias-only rename onto the parts before diffing (via the
    //     dispatcher's own `splitName`), so such a rename previews correctly —
    //     see 372.
    //   • `birthday` — stored, but absent from `ResourceInput`: the tool cannot
    //     write it, so a diff here could never be applied.
    // ★★★ `emails` IS THE ONE ARRAY-VALUED MEMBER HERE, and it is deliberately
    //  NOT in `arrayFields`. Its entry below renders the list as the joined
    //  string `FieldDiff.raw` carries, and `coerce` (use-inline-entity-edit.ts)
    //  passes a non-`arrayFields` value through UNTOUCHED — so the string
    //  reaches `sanitizeEmailList`'s OWN delimited-string branch (it splits on
    //  `[;,]`), which is the writer parsing its own format. Adding it to
    //  `arrayFields` would instead split it in `coerce` on "," alone: a SECOND
    //  parser for a format the writer already owns, i.e. the restatement the
    //  `fieldSanitizers` docstring forbids.
    diffFields: ["firstName", "lastName", "title", "email", "department", "company", "location", "businessPhone", "isExternal", "notes", "emails"],
    // ★★★ THE ONLY GROUP ACROSS THESE SIX DESCRIPTORS today (grep
    // `requiredNonEmptyGroups: [` — every other entry is `[]`), and the reason
    // `requiredNonEmptyGroups` exists. `sanitizeResource`'s gate is
    // `if (!firstName && !lastName) return null` — an OR over the row the
    // dispatcher has already MERGED, not a per-field rule. Marking both parts
    // `requiredNonEmpty` was the previous shape and it over-rejected: a mononym
    // rename ("Cher Bono" -> "Cher") previewed `lastName` as REJECTED while the
    // write accepted the row and stored `""`. That is not the safe direction it
    // was written as — the two REPLAYING consumers (`chat-proposal-apply.ts`,
    // `use-insight-recommendations.ts`) resend the ORIGINAL tool input and never
    // read the plan, so they perform the write the card said would not happen
    // (§384). Blanking BOTH is still rejected, by the group rule.
    requiredNonEmpty: new Set<string>([]),
    requiredNonEmptyGroups: [new Set(["firstName", "lastName"])],
    // `birthday` is the only date-shaped Resource field and it is NOT writable
    // (see above) — and it is "MM-DD", which sanitizeIsoDate would reject anyway.
    dateFields: new Set(),
    numericFields: {},
    stringOnlyFields: new Set(),
    enumFields: {},
    emailFormatFields: new Set(),
    arrayFields: new Set(),
    numberFields: new Set(),
    // Mirrors `sanitizeResource` (sanitize-entities.ts), which uses FIVE
    // different helpers across these ten fields — four for the nine text ones,
    // plus a predicate for the tenth:
    //   • firstName/lastName → `sanitizeAssignee` (trim + ASSIGNEE_MAX 200)
    //   • email              → `sanitizeEmail`    (trim + EMAIL_MAX 320)
    //   • the five optional single-line fields → `optText` (trim, NO cap)
    //   • notes              → `optMultiline`     (CRLF→LF, trim, NO cap)
    //   • isExternal         → `isExternalFlag`   (the predicate below)
    // ★★★ `isExternal` — the only BOOLEAN field in any entity's `diffFields`,
    //  which is NOT the same as the only non-string one: four NUMERIC fields
    //  (`raid.probability`/`impact`, `change.scheduleImpactDays`/`costImpact`)
    //  are held by `numberFields` and one ARRAY field (`task.labels`) by
    //  `arrayFields` — three mechanisms, not one — goes through
    //  `sanitizeResource`'s OWN predicate. A text
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
      // ★★★ `undefined` FOR THE PRIMARY IS A NARROWING, NOT A CHOICE. A
      //  `fieldSanitizers` entry is handed the FIELD's value and nothing else,
      //  so it cannot see the row's `email` — while `sanitizeResource` calls
      //  `sanitizeEmailList(input.emails, email)` with the MERGED row's primary
      //  and drops an extra equal to it. The dedupe, the trim, the per-address
      //  cap and the 10-address list cap are all the writer's own and agree; an
      //  incoming extra that EQUALS the primary is the one case where the
      //  preview shows an address the write will not store (and, at the list
      //  cap, shifts which address is the tenth). Widening the signature to
      //  take the row would touch every entry in every entity, so the
      //  divergence is recorded here and in `sanitizeEmailList`'s docstring
      //  rather than papered over with a local re-implementation.
      // ★ Joined with ", " like every other list this module renders (`str`,
      //  `resolveLinkTitles`); the writer's `[;,]` split accepts it back.
      emails: (v) => sanitizeEmailList(v, undefined).join(", "),
    },
    // ★★★ `roleId` IS writable — it is listed as absent from `diffFields` above
    //  under "an FK, excluded by the same rule as Task.resourceId", and that
    //  exclusion is right: an FK must never round-trip through `FieldDiff.raw`.
    //  It still has to be DISCLOSED, which is what this member is for.
    //  ★★ `titleOf` reads NEITHER a `name` (Role has none) NOR `i.title` (that
    //   is the JOB title on a Resource, a different entity entirely) — the label
    //   is discipline + grade, resolved against the workspace.
    //  ★★ `toNumber`, not `Number`: they disagree on `[5]`, which bare `Number`
    //   coerces to 5 while `sanitizeResource` rejects it to a null FK.
    linkFields: {
      roleId: {
        wsKey: "roles",
        kind: "id",
        titleOf: (r, ws) =>
          roleLabel({ disciplineId: toNumber(r.disciplineId), gradeId: toNumber(r.gradeId) }, ws.disciplines, ws.grades),
        sanitize: (v) => {
          const n = toNumber(v);
          return Number.isFinite(n) && n > 0 ? [n] : [];
        },
      },
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
