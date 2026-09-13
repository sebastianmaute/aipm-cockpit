// src/test/inline-sweep-fixtures.ts
//
// The seeded rows and the sweep axis shared by the two inline-AI-edit write-path
// suites: `plan.write-path.test.ts` (narrow and deep — 17 hand-written cases,
// each naming a specific defect) and `plan.write-path-sweep.test.ts` (broad and
// mechanical — names nothing, enumerates everything). They were one file until
// it approached the 1600-line size ratchet; the fixtures moved here rather than
// being duplicated, because two copies of a seed drift and a drifted seed is the
// exact failure mode most of the docstrings below exist to prevent.
//
// ★★★ THE DOCSTRINGS ARE THE POINT OF THIS FILE, not the values. Nearly every
// one of them records a measurement about a SANITIZER's fallback — which value
// is distinguishable from a refusal and which is not — and a seed edited without
// reading them turns a live assertion vacuous while every gate stays green. Do
// not trim them, and do not "tidy" a seeded value onto something more natural
// without checking what the docstring says the natural value would hide.
//
// ★ It lives under `src/test/` for two reasons, both mechanical: the directory
// is coverage-excluded (`vitest.config.ts` `coverage.exclude`, "src/test/**"),
// so fixtures cannot drag a floor around, and it does not match vitest's
// `include` glob (`src/**/*.{test,spec}.{ts,tsx}`), so it registers no tests of
// its own. Same convention as `chat-dispatcher-fixture.tsx` and
// `workspace-records.ts` beside it.
import { type TokenEntity } from "../app/ai-entity-token";
import { type CalendarEvent } from "../app/calendar-event";
import { TOKEN_ROW_SOURCE } from "../app/chat-proposal-apply";
import { INLINE_DESCRIPTORS, type InlineEntity } from "../app/inline-ai-edit/entity-descriptor";
import { type EditPlan, RICH_FIELDS } from "../app/inline-ai-edit/plan";
import { type TestSeed } from "../app/test-providers";
import { type Absence, type ChangeItem, DEFAULT_TASK_STATUS, type Milestone, type RaidItem, type Resource, type Stakeholder, type Task } from "../app/types";
import { type useWorkspace } from "../app/workspace-context";
import { emptyWorkspace, type Workspace } from "../app/workspace";

/** A minimal VALID `Task`, mirroring `chat-proposal-apply.test.tsx`'s rule:
 *  every non-optional field of the type and nothing more, so a write is refused
 *  by the code under test rather than by a sanitizer rejecting a lazy fixture. */
export function seedTask(id: number, taskName: string): Task {
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

export const LINKED_TASKS: Task[] = [seedTask(1, "First"), seedTask(2, "Second"), seedTask(3, "Third")];

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
 *  empty array it was written to avoid. Each entry is in that function's own
 *  output key order (`id`, `name`, `url`, `kind`), so it round-trips unchanged.
 *
 *  ★★ TWO LINKS, NOT ONE, for Relation A of `plan.offered-surface-sweep.test.ts`.
 *  Its update probe drops one element of the stored list; from a single link
 *  that is `[]`, which the same sparse `if (dl.length)` store turns into an
 *  absent key — so the writer's sanitizer could never hold the probe and the
 *  field was `unmeasured` on all four registers. From two it is a one-link
 *  list every one of them keeps. */
export const KNOWLEDGE_LINKS = [
  { id: "kl-1", name: "Vendor SLA", url: "https://example.com/sla", kind: "file" as const },
  { id: "kl-2", name: "Cutover runbook", url: "https://example.com/runbook", kind: "folder" as const },
];

/** ★★★ EVERY VALUE OFF ITS FALLBACK, AND EVERY `diffFields` MEMBER PRESENT —
 *  the same rule as the `seedGuarded*` helpers below, applied to the one entity
 *  that lacked one. `seedTask` is deliberately unchanged: the `CASES` in
 *  `plan.write-path.test.ts` read its exact values positionally, and it is also
 *  `LINKED_TASKS`, so widening it would rewrite unrelated expectations.
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
 *  ★★ `status` is "Done" TOGETHER WITH `completedDate`, and the pair is the
 *  point: `status === "Done"` ⟺ `completedDate` set is the invariant
 *  (`docs/AGENTS/task-status.md`), and load does NOT repair a split pair, so a
 *  seed carrying only one half would make every finding on this entity
 *  arguable. It was "In Progress" with no `completedDate` until the
 *  offered-surface sweep needed the date seeded (below). "Done" is off the
 *  `DEFAULT_TASK_STATUS` fallback exactly as "In Progress" was, and nothing
 *  that drives this row writes differently for a closed task: `update_task`
 *  gates on `jiraKey` alone (`assertJiraManagedUnchanged`), never on status.
 *
 *  ★★★ THE REST OF THE ROW IS FOR RELATION A OF
 *  `plan.offered-surface-sweep.test.ts`, and each value is a column no tool
 *  schema declares. `probeFor` (`src/test/sweep-probes.ts`) never invents a
 *  value: it changes the seed's own value in kind, or sends it as is, and a
 *  column the seed leaves blank is `dead` — probed by nothing. Every value here
 *  is one `jsonToWorkspace` (the task arm's admission oracle, `migrateTask` +
 *  `sanitizeNoteFields`) holds unchanged, bar `resourceId`: the oracle's
 *  one-row envelope carries no resources, so `migrateWorkspaceV5` backfills one
 *  and restamps the FK, and the sweep ledgers it `unmeasured` for that reason.
 *  None is one `update_task` reacts to: `buildPatch` (`chat-tools-updates.ts`)
 *  whitelists the declared fields, so none of these can move through a patch,
 *  and `createTask` builds its row field by field. `resourceId: 4` and the
 *  `dependencies` predecessor point at rows the SWEEP's task seed supplies.
 *  The estimate minutes, `healthOverride` and `jiraIssueType` values mean
 *  nothing beyond being valid.
 *  ★★ `jiraKey` is the one undeclared column deliberately LEFT BLANK: a
 *   `jiraKey` makes the row Jira-synced, and `assertJiraManagedUnchanged` then
 *   THROWS on every `status` or `assignee` change — which would turn Relation
 *   B's landing probes on both into refusals. `jiraIssueType` and
 *   `lastSyncedAt` are seeded anyway because nothing but `jiraKey` gates on
 *   Jira state; they read as a task once synced and since unlinked.
 *  ★ `noteLog` entries are in `sanitizeNoteLog`'s own output key order (`id`,
 *   `timestamp`, `html`, `text`) and carry `text` equal to the html's
 *   projection, or the round trip reshapes them and the probe is `unmeasured`.
 *   Two of them, so the array probe (drop one element) stays non-empty. */
export function seedGuardedTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Guarded task",
    assignee: "M. Jordan",
    assigneeEmail: "m.Jordan@example.com",
    startDate: "2026-04-06",
    dueDate: "2026-09-30",
    lastUpdateDate: "2026-05-19",
    createdDate: "2026-04-02",
    priority: "High",
    status: "Done",
    completedDate: "2026-05-18",
    blockers: "Waiting on the vendor contract",
    description: "<p>Original description.</p>",
    inquiriesSent: 2,
    group: "Workstream A",
    labels: ["alpha", "beta"],
    dependencies: [{ taskId: 2, type: "FS" }],
    jiraIssueType: "Story",
    lastSyncedAt: "2026-05-17T16:00:00.000Z",
    localModifiedAt: "2026-05-19T09:30:00.000Z",
    healthOverride: "A",
    resourceId: 4,
    originalEstimateMinutes: 960,
    timeSpentMinutes: 600,
    remainingEstimateMinutes: 120,
    knowledgeLinks: KNOWLEDGE_LINKS,
    outlookEventId: "AAMkAGI2NGVhZTVlLTI1OGMtNDI1My1iNWE0LWE0ZDk0ZTk0ZTNjOABGAAAAAAB",
    noteLog: [
      { id: 1, timestamp: "2026-05-12T08:00:00.000Z", html: "<p>Chased the vendor for the signed contract.</p>", text: "Chased the vendor for the signed contract." },
      { id: 2, timestamp: "2026-05-18T15:45:00.000Z", html: "<p>Contract signed; closing this out.</p>", text: "Contract signed; closing this out." },
    ],
    ...over,
  };
}

export function seedRaid(over: Partial<RaidItem> = {}): RaidItem {
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
 *  of them would make the cases that use it pass for the wrong reason — a field
 *  that was already absent cannot be observed being cleared.
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
 *  refusal's own shape.
 *
 *  ★★ `inquiriesSent`, `localModifiedAt` and `outlookEventId` are for Relation
 *  A of `plan.offered-surface-sweep.test.ts`, which cannot probe a column the
 *  seed leaves blank (`probeFor` never invents a value). All three are
 *  `TOKEN_EXCLUDED.raid`, so no model patch can move them, and
 *  `sanitizeRaidItem` keeps each as seeded (`inquiriesSent` only when > 0).
 *  ★ `escalations` (§515) is seeded for Relation A too, but it is NOT
 *   `TOKEN_EXCLUDED.raid`: `RAID_FIELD_GUARDS` refuses it on both arms.
 *   TWO entries, in `sanitizeRaidEscalations`' own key order: the array probe
 *   drops one element, and one seeded entry would leave `[]`, which the
 *   sanitizer stores as undefined, so the update arm would read `unmeasured`.
 *  ★ `noteLog` is the undeclared column deliberately NOT seeded:
 *   `sanitizeRaidItem` stores no note log at all (the writer re-applies the
 *   stored one, §49), so no value is one the admission oracle holds. */
export function seedGuardedRaid(): RaidItem {
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
    inquiriesSent: 2,
    escalations: [
      { at: "2026-06-11T07:45:00.000Z", toName: "M. Jordan", toEmail: "m.Jordan@example.com", toResourceId: 2, fromSeverity: "Medium", toSeverity: "High" },
      { at: "2026-06-12T07:00:00.000Z", toEmail: "ops@example.com" },
    ],
    localModifiedAt: "2026-06-12T08:15:00.000Z",
    outlookEventId: "AAMkADk0ZmVkLTE2NzUtNDU3Mi1iMDJlLTMwNzNiNDI3NTc5MgBGAAAAAAB",
  });
}

/** A CHANGE row whose every merge-site-guarded field carries a NON-DEFAULT
 *  value, for the reason `seedGuardedRaid` gives: `type: "Scope"` is not
 *  `sanitizeChangeItem`'s hardcoded "Other" fallback, and `impact`,
 *  `decisionDate`, `scheduleImpactDays` and `costImpact` are all populated, so a
 *  cleared key is observable. `status: "Approved"` is likewise not the "Proposed"
 *  fallback — that half is `applyModelChangeStatus`'s and is pinned in
 *  `plan.write-path.test.ts` as the boundary between the two guards.
 *
 *  ★★ `description` is the SHARPEST of the free-text fields and the reason it is
 *  no longer `""`. `sanitizeChangeItem` writes it UNCONDITIONALLY
 *  (`description: sanitizeRichText(...)`, not the sparse `if (x)` shape the
 *  other four take), so its fallback is a literal `""` — a refused probe
 *  against a `""` seed reads back as the value already stored and the sweep
 *  scores agreement. The other four fall back to an ABSENT key, which is the
 *  same hole one shape over.
 *
 *  ★★ `localModifiedAt` and `outlookEventId` are for Relation A of
 *  `plan.offered-surface-sweep.test.ts`, for `seedGuardedRaid`'s reason: both
 *  are `TOKEN_EXCLUDED.change`, and `sanitizeChangeItem` keeps both as seeded.
 *  ★ `noteLog` stays unseeded for raid's reason — `sanitizeChangeItem` stores
 *   none (`withStoredNoteLog` re-applies the stored log after it). */
export function seedGuardedChange(over: Partial<ChangeItem> = {}): ChangeItem {
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
    localModifiedAt: "2026-03-04T11:20:00.000Z",
    outlookEventId: "AAMkAGVmMDEzMTM4LTZmYWUtNDdkYS05YTFhLWQ1ZTg1ZDI2MzQwMwBGAAAAAAB",
    ...over,
  };
}

/** ★ `achievedDate` is POPULATED on purpose. The parity sweep's `MILE_BASE`
 *  leaves it blank, which is exactly why this member of the class was invisible
 *  there: a clear of an empty field reads as agreement.
 *  ★ `description` is populated for the same reason, one field over — it is the
 *  milestone descriptor's only other optional member, stored sparsely, so an
 *  absent seed makes a refusal on it indistinguishable from a stored refusal.
 *  ★★ `localModifiedAt` and `outlookEventId` are for Relation A of
 *  `plan.offered-surface-sweep.test.ts`, for `seedGuardedRaid`'s reason: both
 *  are `TOKEN_EXCLUDED.milestone`, and `sanitizeMilestone` keeps both as seeded. */
export function seedGuardedMilestone(over: Partial<Milestone> = {}): Milestone {
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
    localModifiedAt: "2026-05-20T17:05:00.000Z",
    outlookEventId: "AAMkAGQ3ZDk4ZTFiLWJiMzYtNGI2Ny04ZjYyLTYwOTg0ZmQ4OGE1NQBGAAAAAAB",
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
export function seedGuardedStakeholder(over: Partial<Stakeholder> = {}): Stakeholder {
  return {
    id: 40,
    // ★★★ SEEDED BECAUSE IT WAS INVISIBLE. `sweptFields` derives its axis from
    //  the descriptor UNION this row's own keys, so a field in neither is never
    //  swept — and `resourceId` was in neither, which is why the sweep read
    //  `Tests 37 passed (37)` while an undisclosed model-writable FK sat behind
    //  it (`sanitize-records.ts` `STAKEHOLDER_FIELD_GUARDS.resourceId` carries
    //  the measurement). It is seeded NON-ZERO on purpose: the store is sparse
    //  (`if (rid > 0)`), so a 0 seed would make the clearing probes read as "no
    //  change" and hide the unlink direction entirely.
    resourceId: 4,
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
    //  the milestone this fixture seeds elsewhere.
    raci: { "30": "A" as const },
    knowledgeLinks: KNOWLEDGE_LINKS,
    // ★★ For Relation A of `plan.offered-surface-sweep.test.ts`, which cannot
    //  probe a blank column: `TOKEN_EXCLUDED.stakeholder`, kept as seeded by
    //  `sanitizeStakeholder`.
    localModifiedAt: "2026-04-28T13:40:00.000Z",
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
export function seedGuardedAbsence(over: Partial<Absence> = {}): Absence {
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
    // ★★ For Relation A of `plan.offered-surface-sweep.test.ts`, which cannot
    //  probe a blank column: both are `TOKEN_EXCLUDED.absence`, dropped from
    //  every model patch by `dropUnacceptedAbsenceFields`, and kept as seeded
    //  by `sanitizeAbsence`.
    localModifiedAt: "2026-06-15T07:50:00.000Z",
    outlookEventId: "AAMkAGFiNmQ0YjEyLWI0ZDgtNDYxZC1hYjA3LTE5MWFlN2E0ZDVhMQBGAAAAAAB",
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
export function seedGuardedCalendarEvent(over: Partial<CalendarEvent> = {}): CalendarEvent {
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
    // ★★ TWO exceptions, so the array probe (drop one element) leaves a
    //  non-empty, still-valid list. Both dates are REAL occurrences of the
    //  seeded recurrence — every second Wednesday from `startDate`, 2026-07-08,
    //  so 07-22 and 08-05 — and the move lands on the Thursday after. Without a
    //  seed, Relation A could only send `exceptions` a value
    //  `sanitizeExceptions` drops for not being an array, whatever the guard
    //  does (§441). `CREATE_BASE` must NOT carry it: its declared-only floor
    //  forbids an undeclared key, and the create arm falls back to this seed.
    //  ★ In `sanitizeExceptions`' own output order (sorted by `date`; keys
    //   `date`, `kind`, `toDate`), so the round trip holds it unchanged.
    exceptions: [
      { date: "2026-07-22", kind: "skip" },
      { date: "2026-08-05", kind: "move", toDate: "2026-08-06" },
    ],
    // ★★ The `linkFields` member, and the clear direction again:
    //  `sanitizeAttendees(v) ?? []` means a refused list stores nothing, which
    //  against an unseeded row is what is already there. Resource #4 is the row
    //  `seedResource` mints.
    attendeeResourceIds: [4],
    // ★★ For Relation A, which cannot probe a blank column: both are
    //  `TOKEN_EXCLUDED.calendarEvent`, dropped from every model patch by
    //  `dropUnacceptedCalendarEventFields`, and kept as seeded by
    //  `sanitizeCalendarEvent`.
    localModifiedAt: "2026-07-01T12:00:00.000Z",
    outlookEventId: "AAMkADBlNDE5NmM1LTcxNjAtNGQ2Yi1iNDNkLTk3MzUyNjI2ZDUwOQBGAAAAAAB",
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
export function seedResource(over: Partial<Resource> = {}): Resource {
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
    //   clamped to [0, 1000] in "hours" mode but to [0, 100] in "percent".
    //  ★★ 80, not the 120 it was, and the clamp is why: Relation A of
    //   `plan.offered-surface-sweep.test.ts` sends this map AS IS on the create
    //   arm, where the control row's mode is the "percent" default — so 120 came
    //   back as 100 and the field was `unmeasured`. 80 survives both clamps, and
    //   so does the update arm's 81.
    //  ★★ `roleId: 3` is deliberately DANGLING and cannot be otherwise:
    //   `TestSeed` has no `roles` slice, so nothing here can seed the row it
    //   points at. Inert for this axis — `sanitizeResource` never checks
    //   existence, and the preview resolves an unknown role to `#3` only when a
    //   patch actually touches the field.
    roleId: 3,
    utilizationMode: "hours",
    utilization: { "2026-07": 80 },
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
    // ★★ For Relation A of `plan.offered-surface-sweep.test.ts`, which cannot
    //  probe a blank column: `TOKEN_EXCLUDED.resource`, kept as seeded by
    //  `sanitizeResource` (any non-empty string).
    localModifiedAt: "2026-06-30T10:00:00.000Z",
    ...over,
  };
}

/** The workspace slices these suites write to, and the key each case reads back
 *  through. Deliberately narrow — a case needing another slice adds it here so
 *  the read-back stays a lookup rather than a per-case cast. */
export type WsKey = "tasks" | "raid" | "resources" | "changes" | "milestones" | "stakeholders" | "absences" | "calendarEvents";

export type Row = Record<string, unknown> & { id: number };

/** The live provider state as a `Workspace`, which is what `describeEntityCalls`
 *  takes. Read from `useWorkspace()` rather than rebuilt from the seed on
 *  purpose: a mirror fixture can drift from what the provider holds, and a
 *  preview grounded against a drifted workspace is not the preview production
 *  would render.
 *
 *  ★★★ IT LIVES HERE BECAUSE THE DRIFT IT WOULD SUFFER AS TWO COPIES IS SILENT
 *  IN THE PASSING DIRECTION, which is the only reason a shared helper is worth
 *  the indirection. It was duplicated in `plan.write-path.test.ts` and
 *  `plan.write-path-sweep.test.ts` — forced at the time, because a test file
 *  importing another test file re-registers that file's `describe`s and every
 *  case runs a second time under the wrong name. This function ENUMERATES the
 *  workspace slices, so a slice added to one copy and not the other leaves the
 *  other suite previewing against a workspace MISSING it. That does not surface
 *  as an error: it surfaces as "the preview disclosed nothing", i.e. as a parity
 *  FINDING — a fabricated defect in production code, produced by a fixture. A
 *  reader would go looking in the write path, which is exactly where it is not.
 *
 *  ★★ THE ABSENT SLICE IS CARRIED THROUGH AS ABSENT. `calendarEvents` is
 *  `readonly CalendarEvent[] | undefined` and `undefined` means "the slice is
 *  not there", never "there are no meetings" — copying it as `[]` would hand
 *  `describeEntityCalls` a workspace claiming a presence the provider does not,
 *  which is the very distinction the calendar write path holds.
 *
 *  ★ A NEW SLICE BELONGS HERE, in this one body. That is the whole point of the
 *  move; do not reintroduce a local copy in either suite. */
export function snapshot(ws: ReturnType<typeof useWorkspace>): Workspace {
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
    calendarEvents: ws.calendarEvents ? [...ws.calendarEvents] : undefined,
  };
}

/** Structural equality by JSON, shared by both write-path suites for the same
 *  reason `snapshot` is: it was a duplicated one-liner, and a one-liner that
 *  drifts is harder to notice than a block that does.
 *
 *  ★ `JSON.stringify` is key-ORDER sensitive (and element-order sensitive for
 *  arrays), which would not be sound in general. Only a key order INSIDE one
 *  field's value matters here: every caller compares a single field, never a
 *  whole row.
 *  ★★ WHAT MAKES IT SOUND IS THE SEEDS, NOT "ONE SANITIZER ON BOTH SIDES". The
 *   update suites compare the provider's `before` row against the writer's
 *   stored one, and the provider holds the seed LITERAL unsanitized — the
 *   `Seeder` in `test-providers.tsx` calls the raw `useState` setters. Every
 *   structured seed value below is therefore written in its sanitizer's own
 *   output order (`recurrence` as `sanitizeRecurrence` builds it, links as
 *   `sanitizeKnowledgeLinks` does, and so on); one that is not would read as
 *   CHANGED on every write that rebuilds the row.
 *  ★★ RELATION A OF `plan.offered-surface-sweep.test.ts` compares a probe the
 *   test built against a value a writer's sanitizer built. For seven entities
 *   that is guarded: `probeFor` admits the probe with this same `same` against
 *   `ADMISSION_ORACLE`'s output (`admitProbe`, `src/test/sweep-probes.ts`),
 *   which IS the writer's sanitizer, so a sanitizer that reorders a field's
 *   keys makes admission fail and the field `unmeasured` — a ledger
 *   disagreement, loud, on both arms (the create arm's probe is this seed's
 *   value as is, admitted against the control row, with the same result).
 *  ★★★ NOT FOR `task`. Its oracle is a `jsonToWorkspace` round trip, which
 *   preserves key order and CASTS every task field bar `description` and
 *   `noteLog`, so it can never report a reorder. Were a task writer to start
 *   storing `knowledgeLinks` or `dependencies` through a normaliser whose key
 *   order differed from the probe's, a real landing would compare UNEQUAL and
 *   read as a pass — silent. What closes it today is only that the task seed
 *   holds both in the order their sanitizers emit (`sanitizeKnowledgeLinks`:
 *   `id`, `name`, `url`, `kind`; `sanitizeDependencies`: `taskId`, `type`),
 *   and every probe keeps that order: the create arm sends the seed as is,
 *   and the update arm's array probe only drops an element. */
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// --- the mechanical sweep's own fixture -------------------------------------

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
 *  failure mode these suites exist to catch elsewhere). `sweepPlumbing` derives
 *  them instead, so a renamed tool or a moved workspace slice reaches the sweep
 *  as a type error or a loud throw rather than as silent agreement. */
export interface SweepEntity {
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
export const SWEEP: SweepEntity[] = [
  // ★ Task #2 is the `dependencies` predecessor and resource #4 the
  //  `resourceId` target `seedGuardedTask` names.
  {
    entity: "task",
    id: 1,
    seed: { tasks: [seedGuardedTask(), seedTask(2, "Sign the vendor contract")], resources: [seedResource()] },
  },
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
export function sweepPlumbing(entity: InlineEntity): { tool: string; kind: TokenEntity; wsKey: WsKey } {
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
 *  HERE DESCRIBED A TEST THESE FILES DO NOT CONTAIN. It read: "the non-vacuity
 *  control: it must be DROPPED on every entity. If it lands, that is a finding."
 *  That is a claim about a WRITE — send this key in a patch, prove the writer
 *  drops it — and nothing here sends anything. The only use is
 *  `expect(fields).not.toContain(JUNK_KEY)` in the axis test in
 *  `plan.write-path-sweep.test.ts`, which cannot fail under any mutation:
 *  `fields` is the union of `diffFields`, `rawTypeGuards`, `linkFields` and the
 *  seeded row's own keys, and this string appears in none of the four by
 *  construction. A comment promising coverage that does not exist is worse than
 *  no comment — it is what stops the next audit from looking.
 *
 *  ★ Left in place rather than deleted because the probe layer is where it earns
 *  its keep: probing this key and asserting the stored row is untouched is a real
 *  non-vacuity control for a sweep whose other probes all target real fields.
 *  Move it there, or delete it — do not restore the claim above without the
 *  test that backs it. */
export const JUNK_KEY = "zzzNotASchemaFieldAnywhere";

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
 *  `expect(fields).not.toContain("id")` assertion in the sweep its meaning — it
 *  can only ever fire on a DESCRIPTOR that declares `id` as a diff field, a link
 *  field or a raw type guard, which would mean the preview claims to disclose
 *  changes to a row's own identity. */
export function sweptFields(entity: InlineEntity, before: Record<string, unknown>): string[] {
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

/** Each entity's swept field axis AS MEASURED on 2026-09-12, and the SET it must
 *  keep covering from now on.
 *
 *  ★★★ RE-MEASURED 2026-09-12 BECAUSE THE RECORD HAD FALLEN BEHIND THE SEEDS,
 *  WHICH IS THE ONE DRIFT THIS TABLE'S SUBSET CHECK CANNOT REPORT. The typed-probe
 *  slice seeded `localModifiedAt` on all eight registers and `outlookEventId` on
 *  six, plus sixteen further columns on `seedGuardedTask` and `exceptions` on the
 *  calendar-event seed — and `sweptFields` unions the seed row's own keys, so all
 *  of it joined the real axis while this table still named the 2026-09-08 sets.
 *  Every one of those fields was swept by `plan.write-path-sweep.test.ts` and
 *  recorded by nothing, so removing the seed key again would have been silent.
 *  ★★ GROWTH BEING FREE is what makes that possible and is still worth keeping:
 *  the assertion is a subset check so ordinary work never reds, but the price is
 *  that only a human re-measurement closes the gap. Re-measure this table in the
 *  same commit that widens a seed, the way this one does.
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
 *  temporary `appendFileSync` to a scratch path inside the `it.each` in
 *  `plan.write-path-sweep.test.ts`, run it, read the file, then remove the line.
 *  NOT with `console.log`: measured 2026-09-08, a log added there printed NOTHING
 *  under `npx vitest run --maxWorkers=1 <that file> -t "recorded axis names"`,
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
 *  impactDescription` and their peers are not listed.
 *
 *  ★★★ `change.decisionDate` IS STILL LISTED WHILE NO LONGER BEING A
 *  `diffFields` MEMBER, AND THAT IS THE UNION DOING ITS JOB, not a stale row.
 *  The field was withdrawn from the change descriptor on 2026-09-09 because it
 *  is DERIVED, but `sweptFields` unions the DECLARED terms with the STORED
 *  keys of the seed — and `seedGuardedChange` sets `decisionDate:
 *  "2026-03-04"` — so it stays on the axis through the stored half and the
 *  sweep goes on probing it. That is the stronger outcome: the sweep now
 *  asserts a field the card never offers also never lands, where before it was
 *  asserting agreement on a field the card offered and the writer refused.
 *  ★★ Measured, not reasoned: this row was left untouched across that
 *  withdrawal and "change sweeps every field its recorded axis names" stayed
 *  green. A withdrawal from `diffFields` only shrinks this axis for a field the
 *  seed does NOT carry — check the seed before assuming an entry must go. */
export const AXIS_FIELDS: Record<InlineEntity, readonly string[]> = {
  task: ["assignee", "assigneeEmail", "blockers", "completedDate", "createdDate", "dependencies", "dueDate", "group", "healthOverride", "inquiriesSent", "jiraIssueType", "knowledgeLinks", "labels", "lastSyncedAt", "lastUpdateDate", "localModifiedAt", "noteLog", "originalEstimateMinutes", "outlookEventId", "priority", "remainingEstimateMinutes", "resourceId", "startDate", "status", "taskName", "timeSpentMinutes"],
  raid: ["category", "causedByRaidIds", "closedDate", "escalations", "impact", "inquiriesSent", "knowledgeLinks", "linkedTaskIds", "localModifiedAt", "outlookEventId", "owner", "ownerEmail", "ownerResourceId", "probability", "raisedDate", "severity", "stakeholderIds", "status", "targetDate", "title"],
  change: ["costImpact", "decisionBy", "decisionDate", "impact", "knowledgeLinks", "linkedRaidIds", "linkedTaskIds", "localModifiedAt", "outlookEventId", "raisedDate", "requestedBy", "scheduleImpactDays", "stakeholderIds", "status", "title", "type"],
  milestone: ["achievedDate", "date", "knowledgeLinks", "linkedTaskIds", "localModifiedAt", "name", "outlookEventId"],
  stakeholder: ["category", "email", "influence", "interest", "knowledgeLinks", "localModifiedAt", "name", "notes", "organization", "raci", "resourceId", "title"],
  resource: ["absenceOverride", "active", "birthday", "businessPhone", "company", "department", "email", "emails", "firstName", "isExternal", "lastName", "localModifiedAt", "location", "notes", "roleId", "title", "utilization", "utilizationMode"],
  absence: ["assignee", "assigneeEmail", "endDate", "localModifiedAt", "note", "outlookEventId", "resourceId", "startDate", "type"],
  calendarEvent: ["attendeeResourceIds", "durationMinutes", "exceptions", "localModifiedAt", "location", "notes", "outlookEventId", "recurrence", "sendInvitations", "startDate", "startTime", "title"],
};

/** Every field name a `Rejected` entry blames.
 *
 *  ★★ SHARED RATHER THAN COPIED, for the same reason `snapshot` is. Both write-
 *  path suites need it, and the parse is format-sensitive: `detail` is
 *  `${field}=${value}` for a single field and `${a}+${b}=empty` for a joint
 *  `requiredNonEmptyGroups` refusal, so the names are the `+`-split of
 *  everything left of the FIRST `=` (a rejected value may itself contain one —
 *  an email, a date). A second copy that missed the group spelling would not
 *  read as "no outcome": it would read as the preview ACCEPTING what it
 *  refused, which is the silent direction and the one this sweep exists to
 *  catch. */
export function rejectedFields(plan: EditPlan): string[] {
  return plan.rejected.flatMap((r) => {
    const eq = r.detail.indexOf("=");
    return eq <= 0 ? [] : r.detail.slice(0, eq).split("+");
  });
}
