// src/app/inline-ai-edit/entity-descriptor.ts
//
// Pure, i18n-free. Per-entity configuration for the inline "Ask Claude" editor:
// which fields an update tool can write, and the apply-preview guards that keep
// a previewed diff from diverging from what the dispatcher's sanitizeX would
// actually persist (invalid enum/date/range values are COERCED or DROPPED by the
// sanitizers, so we must reject them in the preview instead of showing a diff
// Apply won't make). See docs plan for the pinned sanitizer behavior.
import {
  ABSENCE_TYPES,
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
  sanitizeAbsenceNote,
  sanitizeIdList,
  sanitizeLoadedResourceEmails,
} from "../sanitize-entities";
import {
  TASK_NAME_MAX,
  TEXTAREA_MAX,
  fkIdOrUndefined,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeLoadedEmail,
  sanitizeGroup,
  sanitizeTaskName,
  sanitizeText,
  toNumber,
} from "../sanitize-core";
import {
  acceptsEventDate,
  acceptsEventDuration,
  carriedRecurrenceDatesOf,
  isSendInvitationsFlag,
  normalizeEventStartTime,
  sanitizeAttendees,
  sanitizeEventLocation,
  sanitizeEventNotes,
  sanitizeEventTitle,
} from "../calendar-event";
import { recurrenceText } from "../calendar-recurrence-text";
import {
  acceptsCostAmount,
  acceptsRiskScale,
  acceptsScheduleDays,
  sanitizeLoadedStakeholderEmail,
  sanitizeMilestoneTaskIds,
} from "../sanitize-records";
import { ABSENCE_FIELD_GUARDS, CALENDAR_EVENT_FIELD_GUARDS } from "../sanitize-allowlist-guards";
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

export type InlineEntity =
  | "task" | "raid" | "change" | "milestone" | "stakeholder" | "resource"
  | "absence" | "calendarEvent";

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
  /** The MERGE-SITE guard table, verbatim: a field whose predicate refuses the
   *  raw model value is REJECTED in the preview rather than projected, because
   *  the write leaves the STORED value alone.
   *
   *  ★★★ ONLY FOR AN **ALLOW-LIST** MERGE SITE, AND THAT IS THE WHOLE
   *   DISTINCTION. `dropUnacceptedAbsenceFields` /
   *   `dropUnacceptedCalendarEventFields` iterate the PATCH and keep only what
   *   their table accepts, so an unguarded or refused field never reaches the
   *   sanitizer at all. `dropUnacceptedRaidFields` (and its change / milestone /
   *   stakeholder siblings) do the opposite — they iterate the TABLE and delete
   *   refused keys, so a field the table does not mention passes through RAW.
   *   That is why `raid.owner` correctly previews the sanitizer's own blanking
   *   of a non-string while `absence.note` must not: same field shape, opposite
   *   merge sites. Pointing this at a deny-list table would make the preview
   *   refuse values the write happily stores.
   *
   *  ★★ IT IS THE WRITER'S OWN TABLE, IMPORTED, never a re-spelling (§405) —
   *   which also means a field ADDED to the writer's guards is modelled here
   *   for free, and one removed stops being refused here in the same commit.
   *
   *  ★ Undefined for the six deny-list entities. Modelling those is a separate
   *   change: `dropUnacceptedRaidFields` takes the stored category as a second
   *   argument, so the shape is not uniform, and turning refusals into preview
   *   rejections there would move their `PREVIEW_REJECTS_APPLY_WRITES` buckets.
   *
   *  ★★ CHECKED AGAINST THE RAW `input[f]`, like `numericFields` and
   *   `stringOnlyFields` and for the same reason: `after` has already been
   *   normalised, so a boolean has become "true" and a number "1" by then. */
  rawTypeGuards?: Readonly<Record<string, (v: unknown) => boolean>>;
  /** This entity's own acceptance test for a `dateFields` member, when its
   *  writer does NOT use `sanitizeIsoDate`.
   *
   *  ★★★ ONE ENTITY NEEDS IT AND IT ONCE DIVERGED IN BOTH DIRECTIONS. The
   *   default is `sanitizeIsoDate(v) === v` — regex, a real calendar date
   *   (§539) and a 1900–2100 year bound — which is exactly what
   *   `sanitizeAbsence` calls, so absence (and every register entity) is
   *   already in parity and must keep the default. Calendar events instead
   *   read a date through one of three readers, one per path (§542): CREATE
   *   requires a real calendar date with NO year bound, LOAD keeps what loaded
   *   before §542, and UPDATE carries a date equal to the stored one and judges
   *   any other as on create. Measured before §542, both ways: `startDate:
   *   "2026-01-32"` previewed as an accepted change and then made the
   *   sanitizer return null, which `updateCalendarEvent` throws on — costing
   *   the whole patch, every other field in the edit with it; and
   *   `"1899-12-31"` previewed as REJECTED and landed. ★ §539 and §542 closed
   *   the overflow direction at the source (a field-range overflow like
   *   `"2026-01-32"`, then a month-specific one like `"2026-02-30"`) — both
   *   rules now refuse both. ONE direction still differs, the year bound, and
   *   it is why this override exists. The card asks the CREATE rule, which is
   *   exact for an update too: the update form differs only by carrying an
   *   UNCHANGED stored date, and the card never judges an unchanged field.
   *
   *  ★★ THE WRITER'S OWN PREDICATE, IMPORTED, never a re-spelling (§405) — same
   *   contract as `numericFields`' `acceptsEventDuration` beside it, and the
   *   reason `acceptsEventDate` is a hoisted `function` in `calendar-event.ts`.
   *
   *  ★ Undefined means "use `sanitizeIsoDate`", which is what seven of the
   *   eight descriptors want. Do not point a new entity here without reading
   *   its sanitizer's actual date call first. */
  acceptsDate?: (v: string) => boolean;
  /** Fields the writer rewrites by a WHOLE-ROW rule, given the merged row.
   *  Returns field → the value that will actually be STORED, for the fields it
   *  corrects, and `{}` (or undefined) when the row needs no correction.
   *
   *  ★★★ IT EXISTS FOR CROSS-FIELD SANITIZER BEHAVIOUR, which `fieldSanitizers`
   *   structurally cannot see — those entries get one field at a time.
   *   `sanitizeAbsence` SWAPS `startDate`/`endDate` when the pair is reversed
   *   rather than rejecting it, so `update_absence({startDate})` past the
   *   stored `endDate` previewed ONE field and wrote TWO, both differently.
   *
   *  ★★★ THE HONEST PROJECTION IS THE SWAP, NOT A REJECTION. The write
   *   SUCCEEDS. The two REPLAYING consumers once resent the original tool
   *   input without reading the plan, so refusing here put "declined" on the
   *   card in front of a write that landed (§384's shape); since §534 they
   *   strip every field `plan.rejected` names, so a refusal would instead DROP
   *   an edit the writer accepts. Disclose, do not
   *   refuse, whenever the writer's rule is a REWRITE rather than a DROP.
   *
   *  ★ Values are the RENDERED strings a `FieldDiff` carries, not raw types —
   *   `describeEntityCalls` puts them straight into `after`/`raw`. */
  crossFieldRewrite?: (merged: Record<string, unknown>) => Record<string, string>;
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
   *   same `sanitizeLoadedEmail` over `ownerEmail` and simply stores the result with
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
   *   the real sanitizer.
   *
   *  ★★ THE ROW IS THE SECOND ARGUMENT, AND IT IS THE MERGED ONE. An entry used
   *   to receive only the field's VALUE, so `sanitizeEmailList(v, undefined)`
   *   ran where `sanitizeResource` calls it with the row's primary address —
   *   the preview kept an extra equal to the primary that the write dropped,
   *   and at the 10-address list cap the two disagreed about WHICH address
   *   landed tenth (§397). MERGED, not stored: the model may be changing the
   *   primary in the same call, and the writer sanitizes against the row its
   *   dispatcher has already merged.
   *  ★ An entry that does not need the row simply declares one parameter —
   *   TypeScript accepts a shorter function here. The entries that spell the
   *   row are `resource.emails` and `calendarEvent.recurrence` (the latter also
   *   the third argument); do not trust that list, reproduce it:
   *   `grep -nE "^\s+[a-zA-Z]+: \(v, ?row" src/app/inline-ai-edit/entity-descriptor.ts`
   *  ★★ THE STORED ROW IS THE THIRD, OPTIONAL ARGUMENT (§605), for a writer
   *   whose rule depends on the value being REPLACED — `calendarEvent.
   *   recurrence`, whose update writer carries a stored `until` and a stored
   *   `startDate` it would refuse on a create. Only `describeEntityCalls`' diff
   *   loop passes it; an entry must read "absent" as "nothing stored", i.e. the
   *   create rule. */
  fieldSanitizers: Record<
    string,
    (v: unknown, row: Record<string, unknown>, stored?: Record<string, unknown>) => string
  >;
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
   *  milestone uses `sanitizeMilestoneTaskIds`, and `resource.roleId` coerces
   *  with `toNumber`, which rejects the array shapes bare `Number` would accept.
   *  ★★ `sanitizeMilestoneTaskIds` now DELEGATES to `sanitizeIdList` (§403);
   *  it was array-only and non-deduping, which is why it is named here
   *  at all. Keep calling it by name rather than collapsing the entry onto
   *  `sanitizeIdList` — a future milestone-specific rule has to land somewhere,
   *  and the whole point of this field is that the descriptor follows the writer
   *  rather than restating what the writer happens to do today. */
  linkFields: Record<string, LinkField>;
  titleOf: (item: Record<string, unknown>) => string;
}

/** A `Resource` row's display name. ★ NOT `i.title` — that is the JOB title.
 *  Hoisted so the resource descriptor's own `titleOf` and the two link fields
 *  that POINT at a resource (`absence.resourceId`, `calendarEvent.
 *  attendeeResourceIds`) render a person the same way; three spellings of
 *  "first last" is three chances to drift. */
const resourceRowTitle = (r: Record<string, unknown>): string =>
  `${String(r.firstName ?? "")} ${String(r.lastName ?? "")}`.trim();

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
    // ★★ THE TWO TASK DATES ARE STILL NOT SYMMETRIC ON A BLANK, but both halves
    //  are closed now and the asymmetry is deliberate. `dueDate` is user intent:
    //  `buildTaskCleanPatch` THROWS on an unparseable one and `requiredNonEmpty`
    //  rejects the blank ahead of it, so the card refuses what the writer
    //  refuses. `lastUpdateDate` has THREE outcomes instead — a BLANK is an
    //  intended CLEAR and is stored as "", a MALFORMED value is dropped (the
    //  stored value survives the merge), a VALID date is stored.
    //  ★★ THE FIX WENT WRITER-SIDE, NOT HERE, and that direction is the point.
    //  This comment used to record the divergence as "not fixed": the writer
    //  merely dropped the key, and a dropped key on a PATCH merged over the
    //  stored task leaves the field UNCHANGED — where the full-record sanitizers
    //  behind raid/change/milestone clear theirs. Rather than teach this
    //  descriptor a "blank is a no-op" mechanism so the card could stop
    //  promising a clear, `buildTaskCleanPatch` was aligned with the registers
    //  so the card's promise became true (§396). `requiredNonEmpty` was and
    //  remains the wrong lever for it — it means "the writer throws".
    dateFields: new Set(["dueDate", "lastUpdateDate"]),
    numericFields: {},
    stringOnlyFields: new Set(),
    enumFields: { status: constSet(TASK_STATUSES), priority: constSet(PRIORITIES) },
    // ★ Every email field's writer throws through `refuseEmailWrite`, and a throw
    //   fails the whole patch, so the card refuses the field first.
    emailFormatFields: new Set(["assigneeEmail"]),
    arrayFields: new Set(["labels"]),
    numberFields: new Set(),
    // Mirrors `buildTaskCleanPatch` (chat-task-patch.ts) field for field.
    // ★ `blockers` is the ONE multiline member here — `sanitizeBlockers` is
    //   `sanitizeMultiline(_, TEXTAREA_MAX)`, which does NOT trim.
    fieldSanitizers: {
      taskName: sanitizeTaskName,
      assignee: sanitizeAssignee,
      // ★ M1: every AI email write stores the `Name <addr>`-unwrapped value, so the card shows it.
      assigneeEmail: sanitizeLoadedEmail,
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
    emailFormatFields: new Set(["ownerEmail"]),
    arrayFields: new Set(),
    numberFields: new Set(["probability", "impact"]),
    // Mirrors `sanitizeRaidItem` (sanitize-records.ts). ★ `title` is capped at
    // TASK_NAME_MAX (500) here and at BUDGET_NAME_MAX (200) on `change` and
    // `milestone` — same field name, different cap, which is why this map is
    // per-entity.
    fieldSanitizers: {
      title: text(TASK_NAME_MAX),
      owner: text(BUDGET_NAME_MAX),
      ownerEmail: sanitizeLoadedEmail, // M1: unwrap-then-cap, as `sanitizeRaidItem` stores
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
    // ★★★ `decisionDate` IS ABSENT FROM BOTH LISTS BELOW ON PURPOSE, and it is
    //  the last half of the same withdrawal as its absence from `changeFields`
    //  (`chat-tool-defs.ts`) and its refusing `CHANGE_FIELD_GUARDS` row
    //  (`sanitize-records.ts`): the field is DERIVED — `applyChangeStatus` owns
    //  the `status`/`decisionDate` pair for every TRANSITION in the app, and the
    //  change modal renders it read-only — so the model supplies its VALUE on NO
    //  surface. ★★ THIS ABSENCE IS NOT WHAT MAKES THAT TRUE, and reading it that
    //  way is how the last hole survived: a descriptor governs the PREVIEW, and
    //  TWO guards govern the WRITE — `CHANGE_FIELD_GUARDS.decisionDate`
    //  (`() => false`, on BOTH `dropUnacceptedChangeFields` call sites) and
    //  `SEED_OFFERED_KEYS` (`ai-project-proposal.ts`) filtering the
    //  `propose_project` seed, which until 2026-09-09 passed a model-authored
    //  `decisionDate` straight into `sanitizeChangeItem`.
    //  ★★★ A THIRD, `changeFields` NOT OFFERING IT, IS AN AUTHORING GUARD AND NOT
    //  A WRITE GUARD — an earlier revision counted it as one of "three separate
    //  guards [that] govern the WRITE", which `chat-tool-defs.ts` denies at that
    //  very schema, in as many words: NEITHER strip helper has a whitelist, so an
    //  UNDECLARED key still lands on either path. Schema absence decides what the
    //  model is OFFERED; it stops nothing that arrives anyway. Keep the two
    //  claims apart — merging them is what makes an absence read as protection.
    //  ★ TEMPLATE IMPORT still accepts one, and that does not falsify the claim:
    //  it is a user-supplied blob, not a model surface. The one tool that writes
    //  `Settings` is `update_settings`, and `computeSettingsPatch`
    //  (`chat-settings-patch.ts`) is a hard allowlist of six fields that cannot
    //  reach `templates`; nothing in the dispatchers names it either. Reproduce,
    //  with `use-templates.ts` as the positive control that the grep works:
    //  grep -c templates src/app/chat-settings-patch.ts src/app/chat-tools.ts src/app/use-templates.ts
    //  ★ What the model CAN still do is choose `status` and have
    //  `applyChangeStatus` stamp the clock's date. That is derivation, not
    //  authoring — do not "correct" this to "the model cannot cause a write".
    //  ★ The qualifier is load-bearing: the Outlook two-way pull writes
    //  `decisionDate` alone (`withDate`, `use-calendar-integrations`) with no
    //  transition, so unqualified "owns the field" is false. It is the
    //  TRANSITION that is exclusive. Leaving it here was
    //  not cosmetic. The preview's date guard is `after !== "" && …`, so an
    //  EMPTY STRING sailed straight through it and the inline-edit card
    //  disclosed a clear the writer refuses; `plan.write-path-sweep.test.ts`
    //  reported exactly that, as `change.decisionDate on the empty string`.
    //  ★★ `dateFields` ALONE IS NOT LOAD-BEARING and a mutant reverting only
    //  that half cannot go red: the date guard runs INSIDE `for (const f of
    //  d.diffFields)` (`plan.ts`), so a `dateFields` member outside
    //  `diffFields` is unreachable. It is withdrawn for consistency, so the
    //  next reader does not restore `diffFields` to "complete the pair".
    diffFields: ["title", "description", "type", "status", "impact", "impactDescription", "scheduleImpactDays", "costImpact", "requestedBy", "raisedDate", "decisionBy", "resolutionNotes"],
    requiredNonEmpty: new Set(["title"]),
    requiredNonEmptyGroups: [],
    dateFields: new Set(["raisedDate"]),
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
    // ★★ `sanitizeMilestoneTaskIds` DELEGATES to `sanitizeIdList` — the two
    //  agreed since §403 aligned them (`sanitize-records.ts`: the body is
    //  `return sanitizeIdList(v);`). Before that the milestone rule was
    //  array-only and non-deduping, so a delimited `"1;2"` linked two tasks on
    //  a raid item and NOTHING on a milestone.
    //  ★★ Reached through the milestone's OWN function anyway, never through
    //  `sanitizeIdList` directly: the preview's job is to show what THIS
    //  field's writer stores, so a later milestone-specific rule lands here
    //  automatically instead of silently diverging from the card. That is also
    //  why `sanitize-records.ts` keeps it as a named export rather than
    //  collapsing the call sites.
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
    emailFormatFields: new Set(["email"]),
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
      // ★ M1: `sanitizeStakeholder`'s own reader — unwrap `Name <addr>` THEN cap at 200.
      email: sanitizeLoadedStakeholderEmail,
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
    //  NOT in `arrayFields`. Its entry below renders the list as a joined
    //  string for the card only (`FieldDiff.before`/`after`/`raw`). The inline
    //  WRITE replays the model's ORIGINAL value instead, carried as
    //  `FieldDiff.rawInput` (open-followups §422), so an array reaches the
    //  writer as an array and a string as the string the model sent — the same
    //  value chat Apply replays. Adding `emails` to `arrayFields` would split
    //  the joined string in `coerce` on "," alone: a SECOND parser for a format
    //  the writer already owns, i.e. the restatement the `fieldSanitizers`
    //  docstring forbids, and it would tear the very address at issue.
    //  ★★ Which values are refused is ONE rule, `findTornEmail`
    //  (`sanitize-core.ts`): `describeEntityCalls` refuses the FIELD and the
    //  dispatcher refuses the call for exactly the same inputs.
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
    // `use-insight-recommendations.ts`) then resent the ORIGINAL tool input and
    // never read the plan, so they performed the write the card said would not
    // happen (§384); since §534 they strip the rejected field, so the same
    // over-rejection would DROP a legal rename. Blanking BOTH is still
    // rejected, by the group rule.
    requiredNonEmpty: new Set<string>([]),
    requiredNonEmptyGroups: [new Set(["firstName", "lastName"])],
    // `birthday` is the only date-shaped Resource field and it is NOT writable
    // (see above) — and it is "MM-DD", which sanitizeIsoDate would reject anyway.
    dateFields: new Set(),
    numericFields: {},
    stringOnlyFields: new Set(),
    enumFields: {},
    emailFormatFields: new Set(["email"]),
    arrayFields: new Set(),
    numberFields: new Set(),
    // Mirrors `sanitizeResource` (sanitize-entities.ts), which uses FIVE
    // different helpers across these ten fields — four for the nine text ones,
    // plus a predicate for the tenth:
    //   • firstName/lastName → `sanitizeAssignee` (trim + ASSIGNEE_MAX 200)
    //   • email              → `sanitizeLoadedEmail` (unwrap `Name <addr>`, trim + EMAIL_MAX 320)
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
      email: sanitizeLoadedEmail,
      title: optionalText,
      department: optionalText,
      company: optionalText,
      location: optionalText,
      businessPhone: optionalText,
      notes: optionalMultiline,
      isExternal: (v) => String(isExternalFlag(v)),
      // ★★★ THE ONLY ENTRY IN ANY ENTITY THAT READS THE ROW, and it is why the
      //  second parameter exists (§397). It used to pass `undefined` for the
      //  primary and could not do otherwise — the entry saw the FIELD's value
      //  alone — while `sanitizeResource` calls
      //  `sanitizeEmailList(input.emails, email)` with the MERGED row's primary
      //  and drops an extra equal to it. The dedupe, the trim, the per-address
      //  cap and the 10-address list cap were always the writer's own and
      //  agreed; an extra EQUAL to the primary was the one case where the card
      //  promised an address the write would not store, and at the list cap it
      //  shifted which address landed tenth.
      // ★★ `row`, NOT the stored resource: `update_resource` may change `email`
      //  in the same call, and the writer sanitizes against the row its
      //  dispatcher has already merged. Pinned by "sanitizes the extras against
      //  a primary changed in the same call" (plan.test.ts).
      // ★ Joined with ", " like every other list this module renders (`str`,
      //  `resolveLinkTitles`); the writer's `[;,]` split accepts it back.
      // ★★ THE PRIMARY GOES THROUGH THE WRITER'S OWN READER FIRST — the raw
      //  `row.email` is NOT the value the writer de-dupes against. It trims and
      //  clips to `EMAIL_MAX`, and the list dedupe compares on an EXACT
      //  `primary.toLowerCase()`, so `{ email: "  Bob@X.com  ", emails:
      //  ["bob@x.com"] }` dropped the extra in the write and KEPT it in the
      //  preview. Same divergence for an over-`EMAIL_MAX` primary.
      // ★★★ M1: that reader is now `sanitizeLoadedResourceEmails` WHOLE — the
      //  exact pair `sanitizeResource` stores, `Name <addr>` members and primary
      //  unwrapped. Calling `sanitizeEmailList` alone showed "Two <two@x.com>"
      //  while the write stored "two@x.com".
      emails: (v, row) => sanitizeLoadedResourceEmails(row.email, v).emails.join(", "),
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
    titleOf: resourceRowTitle,
  },
  absence: {
    entity: "absence", updateTool: "update_absence", deleteTool: "delete_absence", createTool: "create_absence", wsKey: "absences",
    // Derived from `ABSENCE_FIELD_GUARDS` (sanitize-allowlist-guards.ts) — the set the
    // MERGE SITE lets through — minus `resourceId`, which is an FK and is
    // disclosed through `linkFields` by the same rule as `resource.roleId`.
    diffFields: ["assignee", "assigneeEmail", "startDate", "endDate", "type", "note"],
    // All three make `sanitizeAbsence` return null, which `updateAbsence`
    // surfaces as a thrown "invalid absence update" — so the throw costs the
    // WHOLE patch, the same shape `task.dueDate` carries.
    requiredNonEmpty: new Set(["assignee", "startDate", "endDate"]),
    requiredNonEmptyGroups: [],
    dateFields: new Set(["startDate", "endDate"]),
    numericFields: {},
    stringOnlyFields: new Set(),
    // The writer's own allow-list, imported rather than modelled — see
    // `rawTypeGuards`. It is what makes a refused `type` preview as a rejection
    // instead of as the `"other"` demotion `sanitizeAbsence` would apply.
    rawTypeGuards: ABSENCE_FIELD_GUARDS,
    enumFields: { type: constSet(ABSENCE_TYPES) },
    // ★ THE SAME RULE AS `task.assigneeEmail` (§461). `createAbsence` and
    //  `updateAbsence` (`use-register-tools.ts`) throw "assigneeEmail is
    //  invalid" for a non-blank address `isValidEmail` rejects, so the preview
    //  rejects it first and the rest of the patch can still apply. The
    //  load-path `sanitizeAbsence` still has no format guard and must not
    //  gain one — that would drop stored data.
    emailFormatFields: new Set(["assigneeEmail"]),
    arrayFields: new Set(),
    numberFields: new Set(),
    // Mirrors `sanitizeAbsence` (sanitize-entities.ts) field for field.
    // ★★ `note` is `sanitizeAbsenceNote` — `sanitizeMultiline(_, TEXTAREA_MAX)`,
    //  which does NOT trim — while `stakeholder.notes` at the SAME cap is
    //  `sanitizeText`, which does. Called by name rather than re-spelled as
    //  `text(TEXTAREA_MAX)`, which would be the wrong family AND a restated cap.
    fieldSanitizers: {
      assignee: sanitizeAssignee,
      assigneeEmail: sanitizeLoadedEmail,
      note: sanitizeAbsenceNote,
    },
    // ★★★ THE WHOLE-ROW RULE `fieldSanitizers` CANNOT EXPRESS. `sanitizeAbsence`
    //  SWAPS the pair when `endDate < startDate` instead of rejecting it, so
    //  `update_absence({startDate})` past the stored `endDate` previewed the new
    //  start and stored it as the new END — ONE field shown, TWO written, both
    //  differently. This was a stated-not-modelled gap for a release; a per-field
    //  entry sees one field at a time, so `crossFieldRewrite` is what closes it.
    //  ★★ IT DISCLOSES THE SWAP RATHER THAN REFUSING THE WRITE — see the member's
    //   own docstring for why a rejection would be the WORSE answer here.
    //  ★★ THE STRICT `<` MIRRORS THE WRITER, BUT IT IS AN EQUIVALENT-MUTANT
    //   BOUNDARY, NOT A LIVE ONE, and an earlier version of this comment claimed
    //   otherwise ("strict so a same-day absence is not swapped for no reason").
    //   Measured: a loose `<=` swaps an EQUAL pair to `{start: X, end: X}` — the
    //   same two values — so nothing downstream can tell the spellings apart, and
    //   the mutant survives the suite by being equivalent rather than untested.
    //   Keep the `<` for fidelity to `sanitizeAbsence`; do not add a test for it.
    //   Both values are already the merged row's, which is what the writer
    //   sanitizes. A non-string on either side cannot reach here: both fields are
    //   `requiredNonEmpty` AND in `ABSENCE_FIELD_GUARDS`, so `str()` is enough.
    //  ★ The probe sweep in `plan.sanitizer-parity.test.ts` still cannot reach
    //   this — its date probes are all malformed, so the date guard refuses them
    //   before any swap could happen. The cases in `plan.test.ts` are the cover.
    crossFieldRewrite: (merged): Record<string, string> => {
      const start = str(merged.startDate);
      const end = str(merged.endDate);
      if (!start || !end || end >= start) return {};
      return { startDate: end, endDate: start };
    },
    linkFields: {
      // ★★ `resourceId: null` is the model's UNLINK and `fkIdOrUndefined`
      //  normalises it to `undefined`, which renders here as the empty list —
      //  the clear, disclosed. The `typeof` leg ahead of it is the MERGE-SITE
      //  guard (`ABSENCE_FIELD_GUARDS.resourceId`), which is STRICTER than
      //  `fkIdOrUndefined` alone: a STRING id is refused there even though
      //  `toNumber("5")` is a real number.
      //  ★ THE ONE SHAPE THIS MISRENDERS is that refusal — a string id previews
      //  as "cleared" while the write leaves the link alone, because
      //  `pushLinkDiffs` has no way to spell "unchanged". Overstating a clear
      //  is the safe direction (the user refuses, or approves a no-op); the
      //  alternative — omitting the field — makes every legitimate link and
      //  unlink invisible on a card whose whole job is disclosure.
      resourceId: {
        wsKey: "resources",
        kind: "id",
        titleOf: resourceRowTitle,
        sanitize: (v) => {
          if (typeof v !== "number" && v !== null) return [];
          const n = fkIdOrUndefined(v);
          return n === undefined ? [] : [n];
        },
      },
    },
    titleOf: (i) => String(i.assignee ?? ""),
  },
  calendarEvent: {
    entity: "calendarEvent", updateTool: "update_calendar_event", deleteTool: "delete_calendar_event", createTool: "create_calendar_event", wsKey: "calendarEvents",
    // Derived from `CALENDAR_EVENT_FIELD_GUARDS` (sanitize-allowlist-guards.ts) minus
    // `attendeeResourceIds`, an id LIST and therefore a `linkFields` member.
    // ★ `exceptions` is absent from the guard table itself and so cannot be
    //  written by the model at all — nothing to disclose.
    diffFields: ["title", "startDate", "startTime", "durationMinutes", "location", "notes", "sendInvitations", "recurrence"],
    // `sanitizeCalendarEvent` returns null without either, and
    // `updateCalendarEvent` turns that into a throw that costs the whole patch.
    requiredNonEmpty: new Set(["title", "startDate"]),
    requiredNonEmptyGroups: [],
    dateFields: new Set(["startDate"]),
    // See `acceptsDate`. ★★ THE ONE ENTITY THAT NEEDS IT: this entity's write
    // rule is a real calendar date with NO year bound (§542), NOT the
    // `sanitizeIsoDate` (regex + calendar check + 1900–2100) the preview
    // defaults to — and the two still disagree on the year bound.
    acceptsDate: acceptsEventDate,
    // ★★ AN ACCEPTANCE PREDICATE OVER THE RAW VALUE, and the reason it is not
    //  merely a range: the writer CLAMPS rather than refuses — `intInRange`
    //  substitutes the 60-minute default for anything outside [5,1440] — so a
    //  card that accepted `3` would show a duration the write silently replaces.
    //  Imported from `calendar-event.ts`, which composes it from the real
    //  `intInRange`, rather than re-spelled here (§405).
    numericFields: { durationMinutes: acceptsEventDuration },
    stringOnlyFields: new Set(),
    // See `rawTypeGuards`. ★★ On this entity it is what keeps a non-boolean
    // `sendInvitations` from previewing as "on → off" against a write that
    // leaves the flag ON — the one misdirection this card must never make.
    rawTypeGuards: CALENDAR_EVENT_FIELD_GUARDS,
    enumFields: {},
    emailFormatFields: new Set(),
    arrayFields: new Set(),
    numberFields: new Set(["durationMinutes"]),
    // Mirrors `sanitizeCalendarEvent` (calendar-event.ts) field for field, by
    // calling the very functions it calls — the caps (200 / 200 / 2000) and the
    // HH:MM regex are private to that module precisely so there is one spelling.
    fieldSanitizers: {
      title: sanitizeEventTitle,
      location: sanitizeEventLocation,
      notes: sanitizeEventNotes,
      // ★★ NOT a `dateFields`-style refusal: an unparseable time is RESET to
      //  09:00 rather than dropped, so the honest preview is the reset itself.
      startTime: normalizeEventStartTime,
      // ★★★ THE `isExternal` SHAPE ON THE FIELD THAT MAILS PEOPLE. The flag is
      //  stored present-or-absent (`sendInvitations: undefined` when not true),
      //  so `str(undefined)` is "" and an incoming `false` would render as a
      //  change on a row that already sends nothing. Both sides go through the
      //  writer's own predicate, so a no-op compares equal.
      sendInvitations: (v) => String(isSendInvitationsFlag(v)),
      // ★★★ THE ROW IS WHAT MAKES THIS EXACT. `recurrenceText` resolves the
      //  `until >= startDate` rejection and the `byMonthDay` fallback ONLY when
      //  it is given the event's own start; without it, it deliberately OMITS
      //  what it cannot know, so passing the rule alone silently degrades the
      //  card to a shorter, vaguer line and nothing fails. The row here is the
      //  MERGED one, which is what the writer sanitizes against — a model may
      //  be moving `startDate` in the same call, and `sanitizeRecurrence` reads
      //  the NEW start.
      // ★★ `stored` IS WHAT MAKES THE CARRIED DATES EXACT (§605). The update
      //  writer keeps an `until` and a `startDate` equal to the STORED ones even
      //  when they are calendar-invalid, and `row` cannot say which those were —
      //  the model's `recurrence` replaced the stored one in the merge.
      //  `carriedRecurrenceDatesOf` is the writer's own derivation of both sets.
      recurrence: (v, row, stored) =>
        recurrenceText(
          v,
          typeof row.startDate === "string" ? row.startDate : undefined,
          stored ? carriedRecurrenceDatesOf(stored) : undefined,
        ),
    },
    linkFields: {
      // ★ `sanitizeAttendees` is the writer's own — it dedupes, caps at 100 and
      //  KEEPS dangling ids (which `resolveLinkTitles` renders as `#<id>`).
      //  `?? []` only renders its "no attendees" answer as the empty list.
      attendeeResourceIds: {
        wsKey: "resources",
        kind: "list",
        titleOf: resourceRowTitle,
        sanitize: (v) => sanitizeAttendees(v) ?? [],
      },
    },
    titleOf: (i) => String(i.title ?? ""),
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
