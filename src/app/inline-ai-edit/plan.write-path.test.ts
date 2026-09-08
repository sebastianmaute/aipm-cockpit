// src/app/inline-ai-edit/plan.write-path.test.ts
//
// ★★★ THE DIFFERENTIAL AGAINST THE **REAL WRITE PATH**, not against a
// sanitizer. Every case previews with `describeEntityCalls` — the production
// path behind the chat review card and `insights/recommend-plan.ts` — and then
// REPLAYS the same tool input through `runTool` on a live `useChatDispatcher`
// mounted over `TestProviders`, reading the answer back out of the workspace
// the dispatcher actually wrote. Nothing about the write is mocked or
// re-implemented here: no fake dispatcher, no hand-rolled patch merge, no copy
// of a sanitizer rule. That is the whole value of the file — a differential
// against a MOCK of the write path would be worthless, because the mock would
// be written from the same reading of the code the preview already encodes.
//
// It exists for the structural limits `plan.sanitizer-parity.test.ts`
// records about itself, each of which is invisible to a sanitizer-level sweep:
//  (1) a DISPATCHER-level derivation. `updateResource` re-derives
//      `splitName(patch.name)` and spreads it over the patch; no sanitizer sees
//      that, because by the time `sanitizeResource` runs the parts are already
//      in the object.
//  (2) a JOINT guard. That sweep overrides exactly ONE key per probe, so
//      `requiredNonEmptyGroups` / `sanitizeResource`'s `!firstName && !lastName`
//      OR-gate is never exercised jointly.
//  (3) a WRITE ALIAS. `name` is absent from the resource descriptor's
//      `diffFields` (correctly — it is not a stored field), so no probe there
//      ever sets it and the alias is unexercised on either side.
//  (4) a MERGE-SITE GUARD. `updateRaid` filters the model's patch through
//      `dropUnacceptedRaidFields` before handing it to `sanitizeRaidItem`, and
//      `updateChange` does the same with `dropUnacceptedChangeFields`, so a
//      value the sanitizer alone would coerce, drop or reset to a default is
//      never merged at all. A sanitizer-level sweep reads the sanitizer, so it
//      is blind to whether the WRITER actually calls the guard — that wiring is
//      pinned here and nowhere else. ★ On CHANGE it is a guard PAIR: `status` is
//      excluded from the patch table and handled after the sanitizer by
//      `applyModelChangeStatus`, so both halves are cased below. ★★ The same
//      guard shape reaches ABSENCE (`dropUnacceptedAbsenceFields`) and
//      CALENDAR EVENT (`dropUnacceptedCalendarEventFields`), and on the latter
//      it stands in front of `sendInvitations` — the one write here that mails
//      people. Each register's `sanitize-*-patch.test.ts` calls its helper
//      directly, so all of them stay green with the call site deleted; the
//      wiring is pinned here.
// Plus the relationship arrays, which replace rather than merge.
//
// THE CONTRACT, in two directions, both asserted per case:
//  • every field the write CHANGED must appear as a preview line (an `updates`
//    diff or a `links` diff) — "the card discloses what apply stores";
//  • no field the preview REJECTED may have changed in the stored row — "a
//    refusal in the card is a refusal in the write". §384 is the instance: a
//    mononym rename previewed `lastName` as rejected while the write stored
//    `""`, and the two REPLAYING consumers (`chat-proposal-apply.ts`,
//    `use-insight-recommendations.ts`) resend the original input and never read
//    the plan, so the refusal was decorative.
//
// ★★ THE REJECTED DIRECTION IS ASSERTED GENERALLY, not as a §384 spot check on
// the literal string `lastName=`. `Rejected.detail` is `${field}=${value}` or
// `${a}+${b}=empty` for a group, so the field names parse out of it and the
// property becomes "nothing the preview called rejected may appear as a change
// in the stored row" — which covers a field this file has not thought of.
//
// ★★ WHAT THIS FILE STILL CANNOT SEE. It replays whole tool inputs through the
// real dispatcher, so it is only ever as wide as `CASES`; it is a spot
// differential, NOT the enumerating sweep `plan.sanitizer-parity.test.ts` runs
// over every entity × every `diffField`. The two are complements: that one is
// exhaustive and shallow, this one is narrow and deep. Add a case here when a
// defect turns on the DISPATCHER doing something the sanitizer cannot show.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../../test/chat-dispatcher-fixture";
import { entityToken, type TokenEntity } from "../ai-entity-token";
import { TOKEN_ROW_SOURCE } from "../chat-proposal-apply";
import { runTool } from "../chat-tools";
import { resetMintState } from "../id-mint-session";
import { type TestSeed } from "../test-providers";
import { type Absence, type ChangeItem, DEFAULT_TASK_STATUS, type Milestone, type RaidItem, type Resource, type Stakeholder, type Task } from "../types";
import { type CalendarEvent } from "../calendar-event";
import { useChatDispatcher } from "../use-chat-dispatcher";
import { useWorkspace } from "../workspace-context";
import { emptyWorkspace, type Workspace } from "../workspace";
import { INLINE_DESCRIPTORS, type InlineEntity } from "./entity-descriptor";
import { describeEntityCalls, RICH_FIELDS, type EditPlan } from "./plan";

/** A minimal VALID `Task`, mirroring `chat-proposal-apply.test.tsx`'s rule:
 *  every non-optional field of the type and nothing more, so a write is refused
 *  by the code under test rather than by a sanitizer rejecting a lazy fixture. */
function seedTask(id: number, taskName: string): Task {
  return {
    id,
    taskName,
    assignee: "M. Jordan",
    assigneeEmail: "",
    dueDate: "2026-09-30",
    lastUpdateDate: "2026-05-19",
    priority: "Medium",
    status: DEFAULT_TASK_STATUS,
    blockers: "",
    description: "",
  };
}

const LINKED_TASKS: Task[] = [seedTask(1, "First"), seedTask(2, "Second"), seedTask(3, "Third")];

/** ★★★ THE FIELD NO PREVIEW CAN DISCLOSE, seeded on all four registers that
 *  carry it. `knowledgeLinks` is neither a `diffField` nor a `linkField` on raid,
 *  change, milestone or stakeholder, yet every one of those four sanitizers reads
 *  it off the patch (`sanitizeKnowledgeLinks(input.knowledgeLinks ?? …)`) and
 *  stores it only `if (dl.length)` — so a model patch carrying garbage WIPES the
 *  stored links behind a card that says nothing. `sanitize-records.ts` records
 *  that as reachable and deliberately unguarded ("Same shape on raid's
 *  `ownerResourceId`"), i.e. a KNOWN product decision, not a fixture problem.
 *
 *  ★★ It is seeded NON-EMPTY for the same reason every other value here is off
 *  its fallback: the sparse `if (dl.length)` store means an absent key and a
 *  refused write are the same shape, so an unseeded row scores agreement against
 *  the very wipe this axis exists to expose.
 *
 *  ★ `url` must be `isSafeHttpUrl`-clean and `name` non-blank, or
 *  `sanitizeKnowledgeLinks` drops the entry and the seed silently becomes the
 *  empty array it was written to avoid. */
const KNOWLEDGE_LINKS = [
  { id: "kl-1", name: "Vendor SLA", url: "https://example.com/sla", kind: "file" as const },
];

/** ★★★ EVERY VALUE OFF ITS FALLBACK, AND EVERY `diffFields` MEMBER PRESENT —
 *  the same rule as the `seedGuarded*` helpers below, applied to the one entity
 *  that lacked one. `seedTask` is deliberately unchanged: the `CASES` above read
 *  its exact values positionally, and it is also `LINKED_TASKS`, so widening it
 *  would rewrite unrelated expectations.
 *
 *  The sweep cannot use it. `seedTask` sits ON the sanitizer's fallbacks
 *  (`status` is `DEFAULT_TASK_STATUS`, `priority` is "Medium", and
 *  `blockers`/`description`/`assigneeEmail` are all ""), so a REFUSED probe on
 *  any of those reads back as the value already stored and the sweep scores
 *  agreement — `docs/open-followups.md` §394's shape, and exactly what
 *  `seedGuardedStakeholder` was written to escape.
 *
 *  ★★ `group` and `labels` are the sharper half: both are in the task
 *  descriptor's `diffFields` and `seedTask` sets NEITHER, so a refused probe
 *  there compares `undefined` against `undefined` and agrees. An absent field
 *  and a correctly-refused one are indistinguishable unless the seed holds a
 *  value to preserve.
 *
 *  ★ `status` is "In Progress" rather than "Done" on purpose — "Done" carries
 *  the `status` ⟺ `completedDate` invariant (`docs/AGENTS/task-status.md`), and
 *  a seed that violated it would make every finding on this entity arguable. */
function seedGuardedTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Guarded task",
    assignee: "M. Jordan",
    assigneeEmail: "m.Jordan@example.com",
    dueDate: "2026-09-30",
    lastUpdateDate: "2026-05-19",
    priority: "High",
    status: "In Progress",
    blockers: "Waiting on the vendor contract",
    description: "<p>Original description.</p>",
    group: "Workstream A",
    labels: ["alpha", "beta"],
    ...over,
  };
}

function seedRaid(over: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 10,
    category: "R",
    title: "R",
    status: "Open",
    raisedDate: "2026-05-01",
    linkedTaskIds: [1, 2, 3],
    causedByRaidIds: [],
    stakeholderIds: [],
    ...over,
  };
}

/** A RAID row whose every merge-site-guarded field carries a NON-DEFAULT value,
 *  so a reset-to-default is observable rather than indistinguishable from a
 *  preserved value: `category: "A"` is not `RAID_CATEGORIES[0]` and
 *  `status: "Validated"` is not `ASSUMPTION_STATUSES[0]`. A base row missing any
 *  of them would make the cases below pass for the wrong reason — a field that
 *  was already absent cannot be observed being cleared.
 *
 *  ★★ The four FREE-TEXT fields carry values for the SWEEP's sake, and the rule
 *  is the same one stated the other way round: `sanitizeRaidItem` stores each of
 *  them SPARSELY (`if (owner) item.owner = owner`), so their fallback is an
 *  ABSENT key — and a probe refused on a field the seed left absent compares
 *  `undefined` against `undefined` and scores agreement.
 *
 *  ★★ THE TWO EMPTY LINK LISTS `seedRaid` LEAVES BEHIND ARE FILLED HERE, and
 *  the reason is the CLEAR direction. `sanitizeIdList` runs unconditionally, so
 *  a refused list stores `[]` — which against an already-empty seed is the value
 *  already stored, and the sweep scores agreement. An ACCEPT is distinguishable
 *  from an empty seed (the list becomes non-empty); a refused CLEAR is not.
 *  ★ The ids point at rows the SWEEP's own seed supplies (raid #11, stakeholder
 *  #40); in the `CASES` entries that share this helper they are deliberately
 *  dangling, which is inert — no case's input touches a link field, so no
 *  preview line ever resolves them.
 *
 *  ★★ `ownerResourceId` is the OTHER unguarded-and-undisclosable field, named as
 *  such beside `knowledgeLinks` in `sanitize-records.ts`. It is stored
 *  `if (ownerResourceId !== undefined)`, so an absent seed is once again the
 *  refusal's own shape. */
function seedGuardedRaid(): RaidItem {
  return seedRaid({
    category: "A",
    status: "Validated",
    causedByRaidIds: [11],
    stakeholderIds: [40],
    ownerResourceId: 4,
    knowledgeLinks: KNOWLEDGE_LINKS,
    severity: "High",
    probability: 3,
    impact: 4,
    targetDate: "2026-06-30",
    closedDate: "2026-07-31",
    description: "<p>The vendor SLA may slip past the cutover weekend.</p>",
    mitigation: "<p>Weekly checkpoint with the vendor delivery lead.</p>",
    owner: "K. Fischer",
    ownerEmail: "k.fischer@example.com",
  });
}

/** A CHANGE row whose every merge-site-guarded field carries a NON-DEFAULT
 *  value, for the reason `seedGuardedRaid` gives: `type: "Scope"` is not
 *  `sanitizeChangeItem`'s hardcoded "Other" fallback, and `impact`,
 *  `decisionDate`, `scheduleImpactDays` and `costImpact` are all populated, so a
 *  cleared key is observable. `status: "Approved"` is likewise not the "Proposed"
 *  fallback — that half is `applyModelChangeStatus`'s and is pinned here as the
 *  boundary between the two guards.
 *
 *  ★★ `description` is the SHARPEST of the free-text fields and the reason it is
 *  no longer `""`. `sanitizeChangeItem` writes it UNCONDITIONALLY
 *  (`description: sanitizeRichText(...)`, not the sparse `if (x)` shape the
 *  other four take), so its fallback is a literal `""` — a refused probe
 *  against a `""` seed reads back as the value already stored and the sweep
 *  scores agreement. The other four fall back to an ABSENT key, which is the
 *  same hole one shape over. */
function seedGuardedChange(over: Partial<ChangeItem> = {}): ChangeItem {
  return {
    id: 20,
    title: "Move the cutover window",
    description: "<p>Shift the cutover to the following weekend.</p>",
    impactDescription: "<p>Two extra days of vendor standby.</p>",
    requestedBy: "L. Braun",
    decisionBy: "S. Neumann",
    resolutionNotes: "<p>Approved at the March steering committee.</p>",
    type: "Scope",
    status: "Approved",
    impact: "High",
    scheduleImpactDays: 12,
    costImpact: 4500,
    raisedDate: "2026-01-02",
    decisionDate: "2026-03-04",
    // ★★ NON-EMPTY for the clear-direction reason `seedGuardedRaid` states: a
    //  refused list stores `[]`, which against an empty seed is indistinguishable
    //  from the value already there.
    linkedTaskIds: [1],
    linkedRaidIds: [10],
    stakeholderIds: [40],
    knowledgeLinks: KNOWLEDGE_LINKS,
    ...over,
  };
}

/** ★ `achievedDate` is POPULATED on purpose. The parity sweep's `MILE_BASE`
 *  leaves it blank, which is exactly why this member of the class was invisible
 *  there: a clear of an empty field reads as agreement.
 *  ★ `description` is populated for the same reason, one field over — it is the
 *  milestone descriptor's only other optional member, stored sparsely, so an
 *  absent seed makes a refusal on it indistinguishable from a stored refusal. */
function seedGuardedMilestone(over: Partial<Milestone> = {}): Milestone {
  return {
    id: 30,
    name: "GA",
    date: "2026-06-01",
    achievedDate: "2026-05-20",
    description: "<p>Feature-complete and signed off by the sponsor.</p>",
    // ★★ NON-EMPTY for the clear-direction reason `seedGuardedRaid` states.
    //  `sanitizeMilestoneTaskIds` is assigned unconditionally, so a refused
    //  value stores `[]` — against an empty seed that is the stored value.
    linkedTaskIds: [1],
    knowledgeLinks: KNOWLEDGE_LINKS,
    ...over,
  };
}

/** ★★★ EVERY ENUM OFF ITS FALLBACK, and that is the entire point. This entity's
 *  defect survived four earlier tasks because the parity sweep's `STK_BASE`
 *  holds exactly the values `sanitizeStakeholder` resets to — so a refused value
 *  read back as the value already stored and the sweep saw agreement. "Sponsor"
 *  is not the "Other" fallback and "High"/"Low" are not "Medium".
 *  ★★ The four free-text members are here for the SWEEP, and `notes` is the one
 *  worth reading twice: it is `sanitizeText`, NOT the multiline or rich shape
 *  three neighbouring "notes" fields take (`sanitizeAbsenceNote` is
 *  `sanitizeMultiline`, `Resource.notes` is `optMultiline`, and the change
 *  register's `resolutionNotes` is rich HTML), so it is seeded as plain text. */
function seedGuardedStakeholder(over: Partial<Stakeholder> = {}): Stakeholder {
  return {
    id: 40,
    name: "Ada Lovelace",
    category: "Sponsor",
    influence: "High",
    interest: "Low",
    organization: "Contoso AG",
    title: "Head of Operations",
    email: "ada.lovelace@contoso.example",
    notes: "Prefers a written summary the day before each steering call.",
    // ★★ `raci` was `{}` — `coerceRaciMap`'s own fallback for every unrecognised
    //  input, and it is assigned UNCONDITIONALLY, so an empty seed makes a wipe
    //  read back as the value already stored. Keys are milestone ids
    //  (`RACI_KEY_RE` is `/^\d+$/`) and values members of `RACI_ROLES`; #30 is
    //  the milestone this file seeds elsewhere.
    raci: { "30": "A" as const },
    knowledgeLinks: KNOWLEDGE_LINKS,
    ...over,
  };
}

/** An ABSENCE whose merge-site-guarded fields carry NON-DEFAULT values, for the
 *  reason `seedGuardedRaid` gives. `type: "vacation"` is not `sanitizeAbsence`'s
 *  hardcoded `"other"` fallback and `note` is populated, so a reset and a
 *  cleared key are both observable — against a row already holding `"other"` and
 *  no note, a refused value reads back as the value already stored and the case
 *  would pass for the wrong reason.
 *  ★ `assigneeEmail` is populated for the SWEEP's sake — `sanitizeAbsence`
 *  resolves it to `undefined` for anything non-string, so an absent seed makes
 *  a refusal on it indistinguishable from a stored one. It repeats the task
 *  seed's address deliberately: both rows name the same person, M. Jordan. */
function seedGuardedAbsence(over: Partial<Absence> = {}): Absence {
  return {
    id: 50,
    assignee: "M. Jordan",
    startDate: "2026-07-06",
    endDate: "2026-07-17",
    type: "vacation",
    note: "Booked with the team",
    assigneeEmail: "m.Jordan@example.com",
    // ★★ THE FIELD `rawTypeGuards` ADDED TO THE AXIS. `resourceId` is an FK, so
    //  it is a `linkFields` member and absent from `diffFields` — and it is also
    //  in `ABSENCE_FIELD_GUARDS`, which on this entity IS the accepted surface.
    //  `sanitizeAbsence` assigns `fkIdOrUndefined(raw.resourceId)`
    //  unconditionally, so its fallback is `undefined` and an unseeded row makes
    //  a refused unlink indistinguishable from a stored one.
    resourceId: 4,
    ...over,
  };
}

/** A MEETING whose two guarded fields are both off their fallback:
 *  `durationMinutes: 90` is not `sanitizeCalendarEvent`'s 60-minute
 *  `intInRange` default, and `sendInvitations: true` is the PRESENT state of a
 *  flag stored present-only-when-true. The flag matters most — it is the one
 *  write in the app that leaves the building, and a row that did not already
 *  invite could not show the clear.
 *
 *  ★★ `recurrence` is the third, and it is a STRUCTURED value rather than a
 *  scalar: `sanitizeRecurrence` returns `undefined` for anything that is not an
 *  object with a recognised `freq`, so the whole field's fallback is an absent
 *  key and an unseeded row cannot show a refusal. `interval: 2` is off its own
 *  `intInRange(..., 1)` default for the same reason `durationMinutes` is 90, and
 *  "WE" is the weekday `startDate` actually falls on. */
function seedGuardedCalendarEvent(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 60,
    title: "Steering committee",
    startDate: "2026-07-08",
    startTime: "14:00",
    durationMinutes: 90,
    location: "Room 1",
    notes: "Agenda in the shared drive",
    sendInvitations: true,
    recurrence: { freq: "weekly", interval: 2, byDay: ["WE"] },
    // ★★ The `linkFields` member, and the clear direction again:
    //  `sanitizeAttendees(v) ?? []` means a refused list stores nothing, which
    //  against an unseeded row is what is already there. Resource #4 is the row
    //  `seedResource` mints.
    attendeeResourceIds: [4],
    ...over,
  };
}

/** ★★ EVERY OPTIONAL `diffField` POPULATED, for the SWEEP. `sanitizeResource`
 *  stores all nine sparsely (`if (title) resource.title = title`), so an
 *  unseeded one makes a refused probe compare `undefined` against `undefined`.
 *
 *  ★★★ `isExternal` is the one that cannot be seeded `false`, and it is the only
 *  BOOLEAN any `diffFields` names. It is stored PRESENT-ONLY-WHEN-TRUE
 *  (`if (isExternalFlag(input.isExternal)) resource.isExternal = true`), so
 *  `false` and "refused" are the SAME stored shape — an absent key — and the
 *  sweep could not tell them apart. `true` is the only distinguishable state,
 *  exactly as `sendInvitations` is on the meeting seed.
 *
 *  ★ `emails` must not contain the primary: `sanitizeEmailList` drops any entry
 *  case-insensitively equal to it, so seeding `email` twice would store a list
 *  the seed does not hold and the sweep's read-back would start from a value no
 *  one wrote. */
function seedResource(over: Partial<Resource> = {}): Resource {
  return {
    id: 4,
    firstName: "Cher",
    lastName: "Bono",
    // ★★★ THE THREE THAT WERE SEEDED ON THEIR OWN FALLBACKS. All three are
    //  assigned UNCONDITIONALLY by `sanitizeResource`, so a refused probe rebuilds
    //  exactly the value the seed already held and the sweep scores agreement:
    //  `roleId` fell back to `null` (`Number.isFinite && > 0 ? n : null`),
    //  `utilizationMode` to `"percent"` (`s === "hours" ? "hours" : "percent"`)
    //  and `utilization` to `{}` (`coercePeriodMap` of anything unrecognised).
    //  ★ Keys must match `PERIOD_KEY_RE` (`YYYY-MM` or `YYYY-Wnn`) and values are
    //   clamped to [0, 1000] in "hours" mode, so 120 survives verbatim.
    //  ★★ `roleId: 3` is deliberately DANGLING and cannot be otherwise:
    //   `TestSeed` has no `roles` slice, so nothing here can seed the row it
    //   points at. Inert for this axis — `sanitizeResource` never checks
    //   existence, and the preview resolves an unknown role to `#3` only when a
    //   patch actually touches the field.
    roleId: 3,
    utilizationMode: "hours",
    utilization: { "2026-07": 120 },
    // ★★ Three more off their fallbacks, all stored SPARSELY — so for each of
    //  them an unseeded row and a refused write are the same absent key.
    //  ★★★ `active` is the `isExternal` shape INVERTED and the inversion is the
    //   whole point: `sanitizeResource` writes it only for a literal `false`
    //   (`input.active === false || input.active === "false"`), so `false` — the
    //   soft-archived state — is the ONLY distinguishable value. Seeding `true`
    //   would store nothing and be indistinguishable from a refusal, exactly as
    //   `isExternal: false` would be.
    birthday: "1984-03-17",
    absenceOverride: { "2026-08": 40 },
    active: false,
    title: "Delivery Lead",
    email: "cher.bono@example.com",
    emails: ["c.bono@partner.example"],
    department: "Programme Delivery",
    company: "Contoso AG",
    location: "Munich",
    businessPhone: "+49 89 123456",
    isExternal: true,
    notes: "Works Tuesday to Friday.",
    ...over,
  };
}

/** The workspace slices this file writes to, and the key each case reads back
 *  through. Deliberately narrow — a case needing another slice adds it here so
 *  the read-back stays a lookup rather than a per-case cast. */
type WsKey = "tasks" | "raid" | "resources" | "changes" | "milestones" | "stakeholders" | "absences" | "calendarEvents";

interface WriteCase {
  name: string;
  /** The chat write tool, exactly as the model would emit it. */
  tool: string;
  entity: InlineEntity;
  /** The `entityToken` kind — how the REPLAYING consumers stamp the token
   *  (`chat-proposal-apply.ts` calls `entityToken(source.kind, current)`). */
  kind: TokenEntity;
  wsKey: WsKey;
  id: number;
  seed: TestSeed;
  /** The model's tool input, WITHOUT `expectedToken`: production previews the
   *  model's own input and stamps the token only on the replay. */
  input: Record<string, unknown>;
  expectStored: Record<string, unknown>;
}

const CASES: WriteCase[] = [
  {
    // (1) + (2) + (3) at once, and §384's exact shape. `name` is a WRITE ALIAS
    // the dispatcher splits; the split makes `lastName` empty, which is legal
    // only because `firstName` survives — the JOINT guard.
    name: "mononym rename clears the surname",
    tool: "update_resource",
    entity: "resource",
    kind: "resource",
    wsKey: "resources",
    id: 4,
    seed: { resources: [seedResource()] },
    input: { id: 4, name: "Cher" },
    expectStored: { firstName: "Cher", lastName: "" },
  },
  {
    // A relationship array REPLACES — every dispatcher merges by object spread
    // and nothing reconstructs the dropped ids. The preview's job is to say so
    // before the user approves.
    name: "a link list REPLACES rather than merges",
    tool: "update_raid_item",
    entity: "raid",
    kind: "raid",
    wsKey: "raid",
    id: 10,
    seed: { raid: [seedRaid()], tasks: LINKED_TASKS },
    input: { id: 10, linkedTaskIds: [2] },
    expectStored: { linkedTaskIds: [2] },
  },
  {
    // ★★★ THE SINGLE-FK CASE, and the one a sanitizer-level sweep structurally
    // cannot reach: `roleId` is not in the resource descriptor's `diffFields`
    // (it is an FK, held in `linkFields`), so no `fieldSanitizers` probe ever
    // touches it. An id ARRAY is the trap — `sanitizeResource` coerces with
    // `toNumber`, which is NaN for an array (bare `Number` would accept `[3]`
    // as 3), so the write REMOVES the role rather than setting it. The preview
    // must disclose a removal, not a change to role #3.
    // ★★★ THE MERGE-SITE GUARD, and the shape §384 has in the RAID register:
    // `sanitizeRaidItem` REBUILDS a whole record, so a value it refuses is not
    // left alone — `severity`/`probability`/`impact` lose their key outright.
    // The preview refuses these three and shows the row as unchanged, so before
    // `dropUnacceptedRaidFields` the card promised "unchanged" while the replay
    // wiped all three. Driven through the REAL dispatcher, which is the only
    // place the guard and the sanitizer meet.
    name: "a refused severity and out-of-range scores leave the stored values alone",
    tool: "update_raid_item",
    entity: "raid",
    kind: "raid",
    wsKey: "raid",
    id: 10,
    seed: { raid: [seedGuardedRaid()], tasks: LINKED_TASKS },
    input: { id: 10, severity: "Sehr hoch", probability: 9, impact: 0 },
    expectStored: { severity: "High", probability: 3, impact: 4 },
  },
  {
    // ★★ THE COUPLED PAIR. `statusSetForCategory` is keyed off the category the
    // sanitizer's own fallback just chose, so an unrecognised category used to
    // reset to "R" AND drag the stored assumption status "Validated" to the
    // risk default "Open" — two fields wiped by one refused value, and `status`
    // is not even mentioned in the tool input, so no preview line could have
    // disclosed it.
    name: "a refused category leaves the coupled status alone",
    tool: "update_raid_item",
    entity: "raid",
    kind: "raid",
    wsKey: "raid",
    id: 10,
    seed: { raid: [seedGuardedRaid()], tasks: LINKED_TASKS },
    input: { id: 10, category: "Z" },
    expectStored: { category: "A", status: "Validated" },
  },
  {
    // `raisedDate` is written UNCONDITIONALLY by the sanitizer
    // (`raisedDate: sanitizeIsoDate(o.raisedDate)`), so an unparseable value
    // blanked it to ""; `targetDate`/`closedDate` lost their key instead. Three
    // shapes, one guard.
    name: "unparseable dates leave the stored dates alone",
    tool: "update_raid_item",
    entity: "raid",
    kind: "raid",
    wsKey: "raid",
    id: 10,
    seed: { raid: [seedGuardedRaid()], tasks: LINKED_TASKS },
    input: { id: 10, raisedDate: "02/01/2026", targetDate: "not a date", closedDate: "2026/07/31" },
    expectStored: { raisedDate: "2026-05-01", targetDate: "2026-06-30", closedDate: "2026-07-31" },
  },
  {
    // ★★★ THE OTHER DIRECTION, and the reason the guard carves `""` out rather
    // than demanding a parseable date: the preview's date rule is `after !== ""
    // && sanitizeIsoDate(after) !== after`, so an empty string is ACCEPTED and
    // DISCLOSED as a clear. A guard that refused it would make the card promise
    // a clear the write declined — the same disagreement, pointing the other
    // way. `expectStored` is `undefined` rather than `""` because the sanitizer
    // stores `targetDate` sparsely (`if (targetDate) item.targetDate = …`).
    name: "an explicitly empty date still clears the stored one",
    tool: "update_raid_item",
    entity: "raid",
    kind: "raid",
    wsKey: "raid",
    id: 10,
    seed: { raid: [seedGuardedRaid()], tasks: LINKED_TASKS },
    input: { id: 10, targetDate: "" },
    expectStored: { targetDate: undefined },
  },
  {
    // ★★★ THE SAME MERGE-SITE GUARD, ONE REGISTER OVER — `updateChange` runs
    // `dropUnacceptedChangeFields` before `sanitizeChangeItem`. `type` is the
    // RESET shape (the sanitizer's fallback is the hardcoded "Other", so a
    // refused value destroyed a stored "Scope") and `impact` the DROP shape (an
    // optional key with no fallback). The preview refuses both and shows the row
    // as unchanged. Driven through the REAL dispatcher, which is the only place
    // the guard, the sanitizer and `applyModelChangeStatus` meet.
    name: "a refused type and impact leave the stored values alone",
    tool: "update_change",
    entity: "change",
    kind: "change",
    wsKey: "changes",
    id: 20,
    seed: { changes: [seedGuardedChange()] },
    input: { id: 20, type: "Umfang", impact: "Sehr hoch" },
    expectStored: { type: "Scope", impact: "High" },
  },
  {
    // ★★ THE WIRING, not the helper. `sanitize-milestone-patch.test.ts` calls
    // `dropUnacceptedMilestoneFields` directly, so it stays green if the call
    // site in `updateMilestone` is deleted. Only a replay through the real
    // dispatcher sees that, which is what this file is for.
    // ★ The parity sweep cannot reach this case at all: its `MILE_BASE` leaves
    // `achievedDate` blank, so the clear this used to perform landed on an
    // already-empty field and read as agreement.
    name: "a refused achievedDate leaves the stored sign-off date alone",
    tool: "update_milestone",
    entity: "milestone",
    kind: "milestone",
    wsKey: "milestones",
    id: 30,
    seed: { milestones: [seedGuardedMilestone()] },
    input: { id: 30, achievedDate: "20/05/2026" },
    expectStored: { achievedDate: "2026-05-20" },
  },
  {
    // ★★★ THE WIRING for the fourth guard -- the one no gate reported.
    // sanitizeStakeholder RESETS an unrecognised category to "Other" rather
    // than dropping the key, so a stored "Sponsor" is silently demoted behind
    // a card that shows nothing about category. Invisible to the parity sweep,
    // whose STK_BASE fixture already holds the fallback it resets to.
    // ★ sanitize-stakeholder-patch.test.ts calls the helper directly, so it
    // stays green if the call site in updateStakeholder is deleted; only a
    // replay through the real dispatcher catches that.
    name: "a refused stakeholder category leaves the stored one alone",
    tool: "update_stakeholder",
    entity: "stakeholder",
    kind: "stakeholder",
    wsKey: "stakeholders",
    id: 40,
    seed: { stakeholders: [seedGuardedStakeholder()] },
    input: { id: 40, category: "Kategorie", influence: "Sehr hoch" },
    expectStored: { category: "Sponsor", influence: "High" },
  },
  {
    // ★★★ THE SANITIZER'S FALLBACK LEG — the case a fix-round review built to
    // prove the first attempt at it was only half done. sanitizeResource
    // splits `name` when BOTH parts are empty, which happens exactly when the
    // dispatcher does NOT split, because an explicit part was supplied as a
    // string. Suppressing the preview's rejection without PROJECTING the split
    // left the card showing `lastName: Bono -> ""` while the write stored
    // "Something", with the firstName change absent from the card entirely.
    // Against that shape this case reds on "firstName changed with no preview
    // line" — the branch's own differential catching its own half-fix.
    name: "a name alias rescues a rename the parts alone would refuse",
    tool: "update_resource",
    entity: "resource",
    kind: "resource",
    wsKey: "resources",
    id: 4,
    seed: { resources: [seedResource({ firstName: "", lastName: "Bono" })] },
    input: { id: 4, lastName: "", name: "Cher Something" },
    expectStored: { firstName: "Cher", lastName: "Something" },
  },
  {
    // `raisedDate` is written UNCONDITIONALLY by the sanitizer
    // (`raisedDate: sanitizeIsoDate(o.raisedDate)`), so an unparseable value
    // blanked it to ""; `decisionDate` lost its key instead. ★★ The second half
    // is the one no fixture in the parity sweep can reach — `CHANGE_BASE` leaves
    // `decisionDate` blank, so the field it clears was already empty there.
    name: "unparseable change dates leave the stored dates alone",
    tool: "update_change",
    entity: "change",
    kind: "change",
    wsKey: "changes",
    id: 20,
    seed: { changes: [seedGuardedChange()] },
    input: { id: 20, raisedDate: "02/01/2026", decisionDate: "not a date" },
    expectStored: { raisedDate: "2026-01-02", decisionDate: "2026-03-04" },
  },
  {
    // The optional NUMBERS, which no exception entry ever named because
    // `CHANGE_BASE` carries neither: `toNumber("soon")` is NaN and -1 fails the
    // `>= 0` gate, so both keys were dropped and both stored amounts lost.
    name: "refused change amounts leave the stored numbers alone",
    tool: "update_change",
    entity: "change",
    kind: "change",
    wsKey: "changes",
    id: 20,
    seed: { changes: [seedGuardedChange()] },
    input: { id: 20, scheduleImpactDays: "soon", costImpact: -1 },
    expectStored: { scheduleImpactDays: 12, costImpact: 4500 },
  },
  {
    // ★★★ THE OTHER DIRECTION, and the reason the guard carves `""` out rather
    // than demanding a parseable date — see the raid case above. `expectStored`
    // is `undefined` rather than `""` because the sanitizer stores
    // `decisionDate` sparsely (`if (decDate) item.decisionDate = …`).
    name: "an explicitly empty change date still clears the stored one",
    tool: "update_change",
    entity: "change",
    kind: "change",
    wsKey: "changes",
    id: 20,
    seed: { changes: [seedGuardedChange()] },
    input: { id: 20, decisionDate: "" },
    expectStored: { decisionDate: undefined },
  },
  {
    // ★★★ THE BOUNDARY BETWEEN THE TWO CHANGE GUARDS, and the reason `status` is
    // absent from `CHANGE_FIELD_GUARDS`. An unrecognised status is NOT dropped
    // from the patch — `applyModelChangeStatus` gates on the model's RAW value
    // and restores the stored "Approved" itself, where the sanitizer alone would
    // have demoted it to "Proposed". Dropping the key here would take that raw
    // value away, so this case would still pass while a RECOGNISED status
    // silently stopped transitioning. That half is pinned in
    // `sanitize-change-patch.test.ts`.
    name: "an unrecognised status is left to applyModelChangeStatus",
    tool: "update_change",
    entity: "change",
    kind: "change",
    wsKey: "changes",
    id: 20,
    seed: { changes: [seedGuardedChange()] },
    input: { id: 20, status: "Genehmigt", title: "Renamed in the same edit" },
    expectStored: { status: "Approved", title: "Renamed in the same edit" },
  },
  {
    // ★★★ THE SAME MERGE-SITE GUARD ON THE ABSENCE REGISTER —
    // `updateAbsence` runs `dropUnacceptedAbsenceFields` before
    // `sanitizeAbsence`. `type` is the RESET shape (`sanitizeAbsenceType`
    // returns the hardcoded "other" for anything unrecognised, so a refused
    // value DESTROYS a stored "vacation") and `note` the COERCE shape (a
    // non-string becomes "" and the sparse `|| undefined` then drops the key
    // outright). The preview refuses both and shows the row as unchanged, so
    // without the guard the card promised "unchanged" while the replay demoted
    // the type and erased the note.
    // ★ `sanitize-absence-patch.test.ts` calls the helper DIRECTLY, so it stays
    // green if the call site in `updateAbsence` is deleted; only a replay
    // through the real dispatcher sees the wiring.
    name: "a refused absence type and a non-string note leave the stored values alone",
    tool: "update_absence",
    entity: "absence",
    kind: "absence",
    wsKey: "absences",
    id: 50,
    seed: { absences: [seedGuardedAbsence()] },
    // ★ `endDate` is the co-supplied field the write DOES store, and it is not
    //  decoration: without one, every field in `expectStored` is unchanged, so
    //  the `shown || unchanged` leg is carried by `unchanged` and only the
    //  stored-value leg can ever fire. It is also the blast-radius assertion —
    //  a guard that dropped the whole patch on meeting a refused key would take
    //  this legitimate edit with it. Same pairing as the change-status case.
    input: { id: 50, type: "Urlaub", note: 7, endDate: "2026-07-24" },
    expectStored: { type: "vacation", note: "Booked with the team", endDate: "2026-07-24" },
  },
  {
    // ★★★ THE FIELD WHOSE WRITE LEAVES THE BUILDING. `updateCalendarEvent` runs
    // `dropUnacceptedCalendarEventFields`, and this case drives BOTH shapes that
    // guard exists for at once:
    //  • `durationMinutes: 3` — `sanitizeCalendarEvent` CLAMPS rather than
    //    refuses (`intInRange` substitutes the 60-minute default), so an
    //    out-of-range value silently demoted a stored 90-minute meeting to 60.
    //    A bare `typeof number` guard could not have delivered that, which is
    //    why the table holds the writer's own `acceptsEventDuration`.
    //  • `sendInvitations: "yes"` — stored present-only-when-true, so a
    //    non-boolean would have taken `isSendInvitationsFlag` to false and
    //    dropped the key: invitations turned OFF by a value the card refused.
    //    That is the one direction a user must never be misled in.
    // The preview rejects both, so the row must come back untouched. Only a
    // replay through the real dispatcher can see that — `sanitize-calendar-
    // event-patch.test.ts` calls the helper directly and stays green with the
    // call site deleted, and the parity sweep reads the SANITIZER, so neither
    // can tell whether the WRITER invokes the guard at all.
    name: "a clamped duration and a non-boolean invite flag leave the stored values alone",
    tool: "update_calendar_event",
    entity: "calendarEvent",
    kind: "calendarEvent",
    wsKey: "calendarEvents",
    id: 60,
    seed: { calendarEvents: [seedGuardedCalendarEvent()] },
    // ★ `title` is the co-supplied field the write DOES store — see the absence
    //  case above for why a case of pure refusals cannot reach the
    //  `shown || unchanged` leg, and why the blast radius needs asserting.
    // ★★ `startTime: "25:00"` is the THIRD shape and the one that makes the
    //  `shown` leg load-bearing rather than carried by `unchanged`. The guard
    //  admits it — `CALENDAR_EVENT_FIELD_GUARDS.startTime` is a bare
    //  `typeof v === "string"` — and `normalizeEventStartTime` then RESETS it to
    //  09:00, so the write stores neither the model's value nor the stored one.
    //  A field the write changed to a third value MUST carry a preview line.
    input: { id: 60, durationMinutes: 3, sendInvitations: "yes", startTime: "25:00", title: "Steering committee (moved)" },
    expectStored: { durationMinutes: 90, sendInvitations: true, startTime: "09:00", title: "Steering committee (moved)" },
  },
  {
    name: "an id ARRAY on a single-FK link REMOVES the role",
    tool: "update_resource",
    entity: "resource",
    kind: "resource",
    wsKey: "resources",
    id: 4,
    seed: { resources: [seedResource({ roleId: 2 })] },
    input: { id: 4, roleId: [3] },
    expectStored: { roleId: null },
  },
];

/** The live provider state as a `Workspace`, which is what `describeEntityCalls`
 *  takes. Read from `useWorkspace()` rather than rebuilt from the seed on
 *  purpose: a mirror fixture can drift from what the provider holds, and a
 *  preview grounded against a drifted workspace is not the preview production
 *  would render. */
function snapshot(ws: ReturnType<typeof useWorkspace>): Workspace {
  return {
    ...emptyWorkspace(),
    tasks: [...ws.tasks],
    raid: [...ws.raid],
    resources: [...ws.resources],
    roles: [...ws.roles],
    disciplines: [...ws.disciplines],
    grades: [...ws.grades],
    stakeholders: [...ws.stakeholders],
    milestones: [...ws.milestones],
    changes: [...ws.changes],
    absences: [...ws.absences],
    // ★★ THE ABSENT SLICE IS CARRIED THROUGH AS ABSENT. `calendarEvents` is
    // `readonly CalendarEvent[] | undefined` and `undefined` means "the slice
    // is not there", never "there are no meetings" — copying it as `[]` would
    // hand `describeEntityCalls` a workspace claiming a presence the provider
    // does not, which is the very distinction the calendar write path holds.
    calendarEvents: ws.calendarEvents ? [...ws.calendarEvents] : undefined,
  };
}

type Row = Record<string, unknown> & { id: number };

function rowOf(ws: Workspace, c: WriteCase): Row {
  // `| undefined` because `calendarEvents` is an OPTIONAL slice: an unseeded
  // one is absent rather than empty, and `rows?.find` turns that into the same
  // legible fixture error below instead of a bare property-of-undefined throw.
  const rows = ws[c.wsKey] as ReadonlyArray<{ id: number }> | undefined;
  const found = rows?.find((r) => r.id === c.id);
  // A missing row would make every assertion below vacuous in the passing
  // direction, so it is a hard error rather than a skipped case.
  if (!found) throw new Error(`fixture did not seed ${c.wsKey} #${c.id}`);
  return found as Row;
}

/** Preview the model's call, then REPLAY it through the real dispatcher and
 *  read the stored row back.
 *
 *  ★★ `expectedToken` is stamped from the STORED row, exactly as
 *  `chat-proposal-apply.ts` does it — that is the replay path this differential
 *  is about. Without it `requireToken` refuses the call and every read-back
 *  would compare a row against itself: green, and vacuous. */
async function previewAndWrite(c: WriteCase): Promise<{ plan: EditPlan; before: Row; stored: Row }> {
  const { result } = renderHook(
    () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
    { wrapper: dispatcherWrapperWith(c.seed) },
  );

  const wsBefore = snapshot(result.current.ws);
  const before = rowOf(wsBefore, c);

  const plan = describeEntityCalls([{ type: "tool_use", name: c.tool, input: c.input }], {
    descriptor: INLINE_DESCRIPTORS[c.entity],
    item: before,
    ws: wsBefore,
  });

  await act(async () => {
    await runTool(result.current.d, c.tool, {
      ...c.input,
      expectedToken: entityToken(c.kind, before),
    });
  });

  const stored = rowOf(snapshot(result.current.ws), c);
  return { plan, before, stored };
}

/** Every field name a `Rejected` entry blames. `detail` is `${field}=${value}`
 *  for a single field and `${a}+${b}=empty` for a group, so the names are the
 *  `+`-split of everything left of the FIRST `=` (a rejected value may itself
 *  contain one — an email, a date). */
function rejectedFields(plan: EditPlan): string[] {
  return plan.rejected.flatMap((r) => {
    const eq = r.detail.indexOf("=");
    return eq <= 0 ? [] : r.detail.slice(0, eq).split("+");
  });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

beforeEach(() => {
  // The minter is module-scoped; nothing here creates, but resetting keeps this
  // file order-independent under `npm run test:shuffle`.
  resetMintState();
});

describe.each(CASES)("write-path differential — $name", (c) => {
  it("previews every field the dispatcher actually stored", async () => {
    const { plan, before, stored } = await previewAndWrite(c);

    // Anti-vacuity: a refused write (a stale token, a thrown sanitizer) would
    // leave the row untouched and make every comparison below trivially true.
    expect(stored).not.toBe(before);

    for (const [field, value] of Object.entries(c.expectStored)) {
      // ★★ ANTI-VACUITY: the field must EXIST on the seeded row. Without this a
      //  case expecting `undefined` (the cleared-FK and dropped-key shapes)
      //  degrades silently under a rename or a typo — `stored[typo]` is
      //  `undefined`, `same(before[typo], stored[typo])` is true, and the whole
      //  case collapses to the identity guard above while still reporting green.
      //  Raised by a gate audit against exactly the two `undefined` cases here.
      expect(field in before, `${field} is not on the seeded row — the case is vacuous`).toBe(true);
      expect(stored[field], `${field} was not stored as expected`).toEqual(value);
      const shown =
        plan.updates.some((d) => d.field === field) || plan.links.some((d) => d.field === field);
      const unchanged = same(before[field], stored[field]);
      // Either the preview disclosed the change, or there was no change.
      expect(shown || unchanged, `${field} changed with no preview line`).toBe(true);
    }
  });

  it("changes nothing the preview called rejected", async () => {
    const { plan, before, stored } = await previewAndWrite(c);
    for (const field of rejectedFields(plan)) {
      expect(
        same(before[field], stored[field]),
        `${field} was previewed as rejected and then written: ` +
          `${JSON.stringify(before[field])} -> ${JSON.stringify(stored[field])}`,
      ).toBe(true);
    }
  });
});

/** The stored task #1, read the way `rowOf` reads a `CASES` row and for the same
 *  reason: a missing row would make every assertion below vacuous in the passing
 *  direction, so it is a hard error rather than a silent `undefined`. */
function taskRow(ws: Workspace): Task {
  const found = ws.tasks.find((t) => t.id === 1);
  if (!found) throw new Error("fixture did not seed task #1");
  return found;
}

/** ★★★ THE REFUSAL SHAPE `CASES` STRUCTURALLY CANNOT HOLD, which is why this
 *  sits outside it rather than as a tenth entry. Every case above asserts a
 *  write that LANDS — `expect(stored).not.toBe(before)` is its anti-vacuity
 *  guard — so a tool call the dispatcher THROWS on cannot be expressed there:
 *  the row is untouched by construction and that very guard would go red for
 *  the right reason. The property is the same one the file is about, asserted
 *  from the other side: the preview refuses `taskName=empty`, so the REPLAY
 *  must refuse it too rather than storing "".
 *
 *  ★★ AND THE PARITY SWEEP CANNOT SEE THIS AT ALL. `plan.sanitizer-parity.
 *  test.ts` drives `buildTaskCleanPatch` directly; it can prove the FUNCTION
 *  throws, never that the throw survives `buildPatch`'s coercion, the token
 *  check and the dispatcher's merge to leave the stored row alone. That whole
 *  chain is what the replaying consumers (`chat-proposal-apply.ts`,
 *  `use-insight-recommendations.ts`) actually run.
 *
 *  ★★ `taskName: null` rather than `""` on purpose — it is the shape a model
 *  reaches the writer with, and the one that makes this non-exotic. `buildPatch`
 *  (chat-tools-updates.ts) gates on `input.taskName !== undefined` and then
 *  collapses ANY non-string to `""`, so a null buried in a multi-field patch
 *  arrives at `buildTaskCleanPatch` as a blank.
 *
 *  ★ The `priority` half is the blast-radius assertion, not decoration: a throw
 *  costs the WHOLE patch, so the co-supplied field must not land either. A guard
 *  that dropped the bad name and carried on would store the priority under a
 *  card that had promised a rename. */
describe("write-path differential — a preview refusal is a WRITE refusal", () => {
  it("refuses an empty taskName instead of blanking the stored one", async () => {
    const { result } = renderHook(
      () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
      { wrapper: dispatcherWrapperWith({ tasks: [seedTask(1, "First")] }) },
    );

    const wsBefore = snapshot(result.current.ws);
    const before = taskRow(wsBefore);
    const input = { id: 1, taskName: null, priority: "Urgent" };

    const plan = describeEntityCalls([{ type: "tool_use", name: "update_task", input }], {
      descriptor: INLINE_DESCRIPTORS.task,
      item: before,
      ws: wsBefore,
    });
    // Anti-vacuity for the whole test: were the preview to stop rejecting this,
    // the write-side assertions below would be about nothing in particular.
    expect(rejectedFields(plan)).toContain("taskName");

    await act(async () => {
      await expect(
        runTool(result.current.d, "update_task", {
          ...input,
          expectedToken: entityToken("task", before),
        }),
      ).rejects.toThrow(/taskName is required/);
    });

    const stored = taskRow(snapshot(result.current.ws));
    expect(stored.taskName).toBe("First");
    expect(stored.priority).toBe(before.priority);
  });
});

// --- the mechanical sweep ---------------------------------------------------
//
// ★★★ THE SECOND LAYER, DELIBERATELY NOT MERGED WITH `CASES` ABOVE. Each of
// those names a specific defect, and that name is what a red run tells you.
// This sweep names nothing and enumerates everything. Merging them would trade
// a legible failure for a uniform one.
//
// It exists for the gap between the two detectors that already exist:
// `plan.sanitizer-parity.test.ts` is exhaustive and shallow (it compares the
// preview against each field's SANITIZER, so it cannot see a merge-site guard
// it does not compose), and the `CASES` above are narrow and deep. The gap is a
// divergence at a layer the sanitizer cannot show, in a field nobody wrote a
// case for — which is `docs/open-followups.md` §394 and §418.

/** One entity's sweep fixture: the two things no production code declares —
 *  WHICH row to drive, and the workspace to drive it against.
 *
 *  ★★★ `tool`, `wsKey` AND `kind` ARE DELIBERATELY ABSENT, and restoring any of
 *  them is a regression. Each is already declared by production code this file
 *  can read — `INLINE_DESCRIPTORS[entity].updateTool` / `.wsKey`, and
 *  `TOKEN_ROW_SOURCE[tool].kind`, which is the SAME map the replaying consumers
 *  read. The first cut of this table hand-copied all three per row: 24 restated
 *  cells, one of which was already wrong before anything consumed it (the
 *  resource row carried `id: 7` against a seed that mints 4, so that entity's
 *  entire sweep would have reported agreement over a row that was never
 *  written — a fabricated clean across one of eight entities, and exactly the
 *  failure mode this file exists to catch elsewhere). `sweepPlumbing` derives
 *  them instead, so a renamed tool or a moved workspace slice reaches the sweep
 *  as a type error or a loud throw rather than as silent agreement. */
interface SweepEntity {
  entity: InlineEntity;
  /** The id this entity's own seed mints — the one value no production code
   *  knows, and therefore the only one still worth asserting by hand. */
  id: number;
  seed: TestSeed;
}

/** ★★ THE SUPPORTING ROWS ARE PART OF THE FIXTURE, not decoration. Every link
 *  list and FK on a swept row is now seeded NON-EMPTY (see `seedGuardedRaid` for
 *  why the clear direction demands it), and each of those ids is given a row to
 *  point at HERE so the sweep's own workspace resolves what it names. The one
 *  exception is `resource.roleId`, which `TestSeed` has no slice for and which is
 *  documented as deliberately dangling on `seedResource`. */
const SWEEP: SweepEntity[] = [
  { entity: "task", id: 1, seed: { tasks: [seedGuardedTask()] } },
  {
    entity: "raid",
    id: 10,
    seed: {
      raid: [seedGuardedRaid(), seedRaid({ id: 11, title: "Upstream vendor risk" })],
      tasks: LINKED_TASKS,
      stakeholders: [seedGuardedStakeholder()],
      resources: [seedResource()],
    },
  },
  {
    entity: "change",
    id: 20,
    seed: {
      changes: [seedGuardedChange()],
      tasks: LINKED_TASKS,
      raid: [seedRaid()],
      stakeholders: [seedGuardedStakeholder()],
    },
  },
  { entity: "milestone", id: 30, seed: { milestones: [seedGuardedMilestone()], tasks: LINKED_TASKS } },
  {
    entity: "stakeholder",
    id: 40,
    seed: { stakeholders: [seedGuardedStakeholder()], tasks: LINKED_TASKS, milestones: [seedGuardedMilestone()] },
  },
  { entity: "resource", id: 4, seed: { resources: [seedResource()] } },
  { entity: "absence", id: 50, seed: { absences: [seedGuardedAbsence()], resources: [seedResource()] } },
  {
    entity: "calendarEvent",
    id: 60,
    seed: { calendarEvents: [seedGuardedCalendarEvent()], resources: [seedResource()] },
  },
];

/** What the REPLAY needs, read from the same production declarations the
 *  replaying consumers themselves read.
 *
 *  ★★ It THROWS rather than returning a partial answer. A tool with no
 *  `TOKEN_ROW_SOURCE` entry cannot be replayed at all, and a sweep that skipped
 *  such an entity would report the same thing as a sweep that found no
 *  divergence — silence. Absence of a finding has to be distinguishable from
 *  absence of a run. */
function sweepPlumbing(entity: InlineEntity): { tool: string; kind: TokenEntity; wsKey: WsKey } {
  const tool = INLINE_DESCRIPTORS[entity].updateTool;
  const source = TOKEN_ROW_SOURCE[tool];
  if (!source) {
    throw new Error(`sweep: no TOKEN_ROW_SOURCE entry for "${tool}" (entity "${entity}") — it cannot be replayed`);
  }
  return { tool, kind: source.kind, wsKey: INLINE_DESCRIPTORS[entity].wsKey as WsKey };
}

/** A key no schema declares, kept as a PLACEHOLDER for the probe layer.
 *
 *  ★★★ ITS ONE ASSERTION TODAY IS VACUOUS, AND THE DOCSTRING THAT USED TO SIT
 *  HERE DESCRIBED A TEST THIS FILE DOES NOT CONTAIN. It read: "the non-vacuity
 *  control: it must be DROPPED on every entity. If it lands, that is a finding."
 *  That is a claim about a WRITE — send this key in a patch, prove the writer
 *  drops it — and nothing here sends anything. The only use is
 *  `expect(fields).not.toContain(JUNK_KEY)` in the axis test below, which cannot
 *  fail under any mutation: `fields` is the union of `diffFields`,
 *  `rawTypeGuards`, `linkFields` and the seeded row's own keys, and this string
 *  appears in none of the four by construction. A comment promising coverage
 *  that does not exist is worse than no comment — it is what stops the next
 *  audit from looking.
 *
 *  ★ Left in place rather than deleted because the probe layer is where it earns
 *  its keep: probing this key and asserting the stored row is untouched is a real
 *  non-vacuity control for a sweep whose other probes all target real fields.
 *  Move it there, or delete it — do not restore the claim above without the
 *  test that backs it. */
const JUNK_KEY = "zzzNotASchemaFieldAnywhere";

/** The fields swept for one entity: what the preview DECLARES, unioned with
 *  everything the writer can actually MOVE.
 *
 *  ★★★ `Object.keys(storedRow)` IS THE §418 HALF AND IT IS NOT INTERCHANGEABLE
 *  WITH THE DESCRIPTOR. Seven of the eight update tools route through
 *  `patchWithoutId(input, kind)`, whose whole body is `{ ...input }` minus `id`,
 *  `expectedToken` and `TOKEN_EXCLUDED[kind]` — so the accepted surface is the
 *  ROW, not the descriptor, and the code never names the fields for a regex to
 *  find. Only `update_task` has a whitelist (`buildPatch`).
 *
 *  ★★★ `rawTypeGuards` IS A THIRD TERM AND IT IS NOT AN EXCEPTION TO THE
 *  PARAGRAPH BELOW — it is the half that paragraph gets wrong when read as a
 *  blanket rule. The descriptor carries it for `absence` and `calendarEvent`
 *  ONLY (`entity-descriptor.ts`, the `rawTypeGuards: ABSENCE_FIELD_GUARDS` and
 *  `rawTypeGuards: CALENDAR_EVENT_FIELD_GUARDS` members), and on those two the
 *  merge guard is an ALLOW-LIST: `dropUnacceptedAbsenceFields` keeps a field
 *  only when the table has an entry for it and that entry accepts the value, so
 *  the TABLE **is** the writable surface. For the four DROP-KEY entities the
 *  paragraph below is right and the table is merely one layer; for these two it
 *  is the accepted surface itself, and omitting it un-sweeps every guarded field
 *  the seed happens not to carry (`absence.resourceId` is the live instance).
 *
 *  ★★ THE GUARD TABLES WOULD HAVE BEEN THE NATURAL SOURCE FOR THE WHOLE AXIS
 *  AND ARE THE WRONG ONE. Two of the six are exported now, so availability does
 *  not decide it — for raid, change, milestone and stakeholder a guard table is
 *  one LAYER of the merge, and this sweep exists to see divergence at layers a
 *  table cannot show. Sourcing the axis from a table ALONE would narrow the
 *  sweep to the thing it is trying to get underneath. Unioning one in cannot.
 *
 *  ★★ `linkFields` is DISJOINT from `diffFields` by construction — the
 *  descriptor states that invariant on the member itself ("THE TWO SETS MUST
 *  STAY DISJOINT FROM `diffFields`") — so an FK or a relationship array can only
 *  reach this axis through this term or through the stored row. `resource.roleId`
 *  is the worked example: it is writable, it is previewed as a link diff, and no
 *  `diffFields` scan will ever name it.
 *
 *  ★ Rich fields are excluded: they route through `sanitizeRichText` and are
 *  swept by `plan.sanitizer-parity.test.ts`, which owns that comparison.
 *
 *  ★★ `id` is filtered out of the STORED half ONLY, and that asymmetry is
 *  deliberate rather than an oversight: the row always carries an `id` and it
 *  addresses the row rather than being written to it, so filtering it there is
 *  bookkeeping. Leaving the three DECLARED terms unfiltered is what gives the
 *  `expect(fields).not.toContain("id")` assertion below its meaning — it can
 *  only ever fire on a DESCRIPTOR that declares `id` as a diff field, a link
 *  field or a raw type guard, which would mean the preview claims to disclose
 *  changes to a row's own identity. */
function sweptFields(entity: InlineEntity, before: Record<string, unknown>): string[] {
  const d = INLINE_DESCRIPTORS[entity];
  const notRich = (f: string) => !RICH_FIELDS.has(`${entity}.${f}`);
  const declared = [
    ...d.diffFields,
    ...Object.keys(d.rawTypeGuards ?? {}),
    ...Object.keys(d.linkFields),
  ].filter(notRich);
  const stored = Object.keys(before).filter((f) => f !== "id" && notRich(f));
  return [...new Set([...declared, ...stored])];
}

/** Each entity's swept field axis AS MEASURED on 2026-09-08, and the SET it must
 *  keep covering from now on.
 *
 *  ★★★ A SET, NOT A COUNT, AND THE DIFFERENCE IS A SUBSTITUTION. This was
 *  `Record<InlineEntity, number>` holding the eight measured widths, and a count
 *  ratchet is structurally blind to a swap — one field out, one field in, same
 *  number, one field silently un-swept. Measured 2026-09-08 rather than argued:
 *  replacing `birthday: "1984-03-17"` with `localModifiedAt: "…"` in
 *  `seedResource` is one-for-one in the stored-keys term, so `resource` stays at
 *  seventeen fields and the old count ratchet would have been GREEN; the set
 *  assertion goes red with "resource no longer sweeps birthday". It also
 *  documents what each entity actually covers — a reader of a number has to go
 *  and re-derive the members before the number means anything.
 *
 *  ★★★ AND NOT A FLAT FLOOR EITHER, which is what the plan specified (one global
 *  `>= 4`). The narrowest entity is `milestone` at 5, so a flat 4 would be
 *  calibrated for it alone and nearly INERT for the rest — `resource` could lose
 *  thirteen of its seventeen fields with the guard still green. A guard that
 *  cannot fire reads as protection while being none.
 *
 *  ★★ GROWTH IS FREE, which is the property a ratchet has to keep to survive
 *  ordinary work: the assertion is a SUBSET check, so a descriptor or a seed row
 *  gaining a field passes untouched. Only a SHRINKING axis is red — the one
 *  event worth a human look, because a narrowed axis un-sweeps fields in
 *  silence. Remove an entry only alongside the deliberate removal that justifies
 *  it, and never to make a red run green.
 *
 *  ★ `Record<InlineEntity, …>` is load-bearing: a NEW entity fails tsc here
 *  until it is given a recorded set, so it cannot join the sweep unmeasured.
 *
 *  ★★ THE AXIS IS MEASURED OFF THE SEED LITERAL, and the probe layer will not
 *  be. `sweptFields` is handed the row out of `{...emptyWorkspace(), ...seed}` —
 *  no sanitizer has run on it — whereas a probe reads the row back AFTER a write,
 *  i.e. after `sanitizeResource` and friends have rebuilt it. The two agree today
 *  only because every field recorded here is assigned by its sanitizer whenever
 *  the seed holds a distinguishable value (the sparse `if (x)` stores all have a
 *  non-empty seed, which is what the distinguishability test enforces). This
 *  floor rests on that agreement; a sanitizer that started DROPPING a seeded
 *  field would shrink the real read-back axis without moving anything here.
 *
 *  ★ Reproduce the real sets rather than trusting this table. Do it with a
 *  temporary `appendFileSync` to a scratch path inside the `it.each` below, run
 *  it, read the file, then remove the line. NOT with `console.log`: measured
 *  2026-09-08, a log added there printed NOTHING under
 *  `npx vitest run --maxWorkers=1 <this file> -t "recorded axis names"`,
 *  and the cause was never established — so a silent log here reads as a
 *  measurement that ran and found nothing, which is the wrong answer twice.
 *  ★★ An `appendFileSync` reached through a bare `require` does NOT work here
 *  either (the file is ESM under vitest); use `await import("node:fs")` in an
 *  async test. And assert `Test Files 1` on that run — a `-t` filter that matches
 *  nothing exits 0 with an empty scratch file, which is the same observation as a
 *  measurement that ran and found nothing.
 *
 *  ★ Rich fields are absent from every row by construction — `sweptFields`
 *  filters `RICH_FIELDS`, which is why `raid.description`, `change.
 *  impactDescription` and their peers are not listed. */
const AXIS_FIELDS: Record<InlineEntity, readonly string[]> = {
  task: ["assignee", "assigneeEmail", "blockers", "dueDate", "group", "labels", "lastUpdateDate", "priority", "status", "taskName"],
  raid: ["category", "causedByRaidIds", "closedDate", "impact", "knowledgeLinks", "linkedTaskIds", "owner", "ownerEmail", "ownerResourceId", "probability", "raisedDate", "severity", "stakeholderIds", "status", "targetDate", "title"],
  change: ["costImpact", "decisionBy", "decisionDate", "impact", "knowledgeLinks", "linkedRaidIds", "linkedTaskIds", "raisedDate", "requestedBy", "scheduleImpactDays", "stakeholderIds", "status", "title", "type"],
  milestone: ["achievedDate", "date", "knowledgeLinks", "linkedTaskIds", "name"],
  stakeholder: ["category", "email", "influence", "interest", "knowledgeLinks", "name", "notes", "organization", "raci", "title"],
  resource: ["absenceOverride", "active", "birthday", "businessPhone", "company", "department", "email", "emails", "firstName", "isExternal", "lastName", "location", "notes", "roleId", "title", "utilization", "utilizationMode"],
  absence: ["assignee", "assigneeEmail", "endDate", "note", "resourceId", "startDate", "type"],
  calendarEvent: ["attendeeResourceIds", "durationMinutes", "location", "notes", "recurrence", "sendInvitations", "startDate", "startTime", "title"],
};

describe("the sweep's own coverage", () => {
  // ★★ THE ONE MAINTAINED THING IN THE SWEEP, AND ITS GUARD. A new FIELD is
  //  covered the moment it exists, because the axis is derived at runtime. A new
  //  ENTITY is not — nothing would enumerate it — so the table is asserted exact
  //  rather than merely non-empty. `plan.sanitizer-parity.test.ts` uses the same
  //  trick on its own CASES; copying it is deliberate.
  it("has a row for every INLINE_DESCRIPTORS entity, and no others", () => {
    expect(SWEEP.map((s) => s.entity).sort()).toEqual(Object.keys(INLINE_DESCRIPTORS).sort());
  });

  // ★★★ THE GUARD AGAINST A FABRICATED CLEAN, and it is not hypothetical: the
  //  first cut of this table carried `id: 7` for the resource row against a
  //  seed that mints 4. Nothing consumed it yet, so every gate was green. Had
  //  the sweep landed on top of it, that entity would have reported perfect
  //  preview/write agreement over a row the fixture never wrote — the sweep
  //  would have certified itself across one of eight entities.
  //  An id is the ONE column production code cannot supply, so it is the one
  //  that needs a positive observable rather than a derivation.
  it("seeds the row each entity claims to drive", () => {
    const missing = SWEEP.filter((s) => {
      const { wsKey } = sweepPlumbing(s.entity);
      const rows = (s.seed as Record<string, readonly { id: number }[] | undefined>)[wsKey];
      return !rows?.some((r) => r.id === s.id);
    }).map((s) => `${s.entity}#${s.id}`);
    expect(missing).toEqual([]);
    // Anti-vacuity: prove the check above ran over a non-empty set, so a seed
    // shape change that silently emptied SWEEP could not read as agreement.
    expect(SWEEP.length).toBe(Object.keys(INLINE_DESCRIPTORS).length);
  });

  // ★★★ THE GENERAL FORM OF THE SEED HOLE, across all eight entities. A probe
  //  on a field the seed left absent or blank compares the refusal against
  //  nothing and scores AGREEMENT — the sweep would certify the very divergence
  //  it exists to find. `seedGuardedTask` was written because the task row had
  //  this hole in `group` and `labels`; this assertion is what stops the next
  //  entity from acquiring it silently.
  //
  //  ★★★ IT ITERATES THE WHOLE `sweptFields` AXIS, NOT `diffFields`. That is not
  //   a widening at the margin: `diffFields` and `linkFields` are DISJOINT by
  //   construction, so the narrow form could not see a single FK or relationship
  //   array on any entity, nor anything reaching the axis through the §418
  //   stored-row half. Every hole it was silent on fell in exactly those two
  //   classes — the FKs (`resource.roleId` null, `absence.resourceId` absent),
  //   the id lists (`[]` on raid, change, milestone and the meeting's
  //   attendees) and the maps (`stakeholder.raci`, `resource.utilization`, both
  //   `{}`). NO TALLY IS QUOTED: every seed edit moves it. Reproduce by
  //   reverting a seed value and reading the names this test prints.
  //
  //  ★★★ AN EMPTY ARRAY IS A HOLE, AND THE COMMENT THAT SAID OTHERWISE WAS HALF
  //   RIGHT. It read: "a link list that starts empty still distinguishes refused
  //   from stored, because a successful write makes it non-empty." That is true
  //   of the ACCEPT direction and FALSE of the CLEAR direction — every id list
  //   here is assigned UNCONDITIONALLY (`sanitizeIdList`, `sanitizeMilestone-
  //   TaskIds`, `sanitizeAttendees(v) ?? []`), so a REFUSED clear stores `[]`,
  //   which against an empty seed is the value already there. The seeds now
  //   carry non-empty lists instead of the blind spot being recorded.
  //  ★★ `{}` is the same argument for a MAP (`raci`, `utilization`,
  //   `absenceOverride`): `coerceRaciMap`/`coercePeriodMap` return `{}` for
  //   anything unrecognised, so an empty seed is the refusal's own output.
  //
  //  ★★ WHAT THIS CANNOT SEE, and it is not a small residue: an ENUM or a
  //   SCALAR sitting on its sanitizer's fallback is a hole of exactly the same
  //   kind and is indistinguishable from a legitimate value here — nothing in
  //   this loop knows that `"percent"` is `sanitizeUtilizationMode`'s default or
  //   that `"Other"` is `sanitizeStakeholder`'s. Those are held by hand, in each
  //   `seedGuarded*` docstring, and `resource.utilizationMode` was one of them.
  it("seeds a distinguishable value for every swept field", () => {
    const holes: string[] = [];
    for (const s of SWEEP) {
      const { wsKey } = sweepPlumbing(s.entity);
      const rows = (s.seed as Record<string, readonly Record<string, unknown>[] | undefined>)[wsKey];
      const row = rows?.find((r) => r.id === s.id);
      if (!row) continue; // the seeded-row test above owns that failure
      for (const field of sweptFields(s.entity, row)) {
        const v = row[field];
        const empty =
          v === undefined ||
          v === null ||
          v === "" ||
          (Array.isArray(v) && v.length === 0) ||
          (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
        if (empty) holes.push(`${s.entity}.${field}`);
      }
    }
    expect(holes).toEqual([]);
  });

  // Every entity must be REPLAYABLE. `sweepPlumbing` throws on a tool with no
  // TOKEN_ROW_SOURCE entry, so this is the assertion that turns "we never ran
  // it" into a red rather than into silence.
  it("derives replayable plumbing for every entity from production declarations", () => {
    for (const s of SWEEP) {
      const { tool, kind, wsKey } = sweepPlumbing(s.entity);
      expect(tool).toBe(INLINE_DESCRIPTORS[s.entity].updateTool);
      expect(wsKey).toBe(INLINE_DESCRIPTORS[s.entity].wsKey);
      expect(TOKEN_ROW_SOURCE[tool].kind).toBe(kind);
    }
  });

  // ★★ WHAT THIS FORBIDS IS A SWEEP OVER A STARVED AXIS, which passes
  //  everything it does not run. The recorded sets are PER ENTITY so one rich
  //  entity cannot carry a narrowed one, and each names its members rather than
  //  counting them — see `AXIS_FIELDS` for why a count and a flat floor were
  //  both rejected.
  it.each(SWEEP)("$entity sweeps every field its recorded axis names", ({ entity, id, seed }) => {
    // `wsKey` is DERIVED — it is not a field on SweepEntity. See sweepPlumbing.
    const { wsKey } = sweepPlumbing(entity);
    const ws = { ...emptyWorkspace(), ...seed } as unknown as Workspace;
    const rows = ws[wsKey] as ReadonlyArray<{ id: number }> | undefined;
    const before = rows?.find((r) => r.id === id);
    expect(before, `fixture did not seed ${wsKey} #${id}`).toBeDefined();
    const fields = sweptFields(entity, before as unknown as Record<string, unknown>);
    // A SUBSET check, so growth is free and only a shrink is red. Reported as
    // the missing NAMES rather than as two numbers: a count says an axis moved,
    // a name says which field stopped being swept.
    const dropped = AXIS_FIELDS[entity].filter((f) => !fields.includes(f));
    expect(
      dropped,
      `${entity} no longer sweeps ${dropped.join(", ")} — a SHRINKING axis un-sweeps fields silently`,
    ).toEqual([]);
    expect(fields).not.toContain("id");
    expect(fields).not.toContain(JUNK_KEY);
  });
});
