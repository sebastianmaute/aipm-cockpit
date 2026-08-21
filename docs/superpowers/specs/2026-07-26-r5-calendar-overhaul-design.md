# R5 — Calendar overhaul (general datebox model)

**Date:** 2026-07-26
**Roadmap:** Release 5 of `2026-07-24-multi-surface-feature-roadmap-design.md` (reqs 2, 3, 4, 5).
**Releases:** slices S1–S5 ship as **0.202.0**; slices S6–S7 ship as **0.203.0**.

---

## 0. Grounding corrections to the roadmap spec

The roadmap's R5 section was written from AGENTS.md. Five statements in it are wrong or
incomplete against the real code. They are corrected here and this document supersedes it.

| Roadmap claim | Reality | Consequence |
|---|---|---|
| 5.1 needs a "new pure `iso-week` helper" | `isoWeekParts` already exists at `resource-capacity.ts:26`, module-private. Its consumer `periodKeyForDate` carries an explicit "these two code paths CANNOT drift" contract. | **Export the existing function.** A second ISO-week implementation is exactly the drift that comment forbids. |
| 5.2 acceptance "no invalid range can be saved" | Already true. `absence-edit-modal.tsx:75` rejects `end < start` with a field error, and `sanitizeAbsence` (`sanitize-entities.ts:84`) *swaps* reversed dates on every inbound path. | The real gap is **UX**: an error where a clamp is expected. Validation stays as the backstop. |
| 5.4 "new `CalendarEntityType` member" (stated as a note) | The union is `"task" \| "raid" \| "change" \| "absence"` (`settings-types.ts:491`) and drives `CALENDAR_ENTITY_TYPES`, the settings sync rows, and `sanitizeOutlookCalendar`. | Adding `"event"` is a real multi-site edit, not a footnote. It lands in **S6**, not S3. |
| 5.4 "optional Outlook push via the existing type-scoped write-back engine" | `useEntityCalendarPush` is **1 entity : 1 event** — it keys `plan.create/update` by `item.id` and writes back a single `outlookEventId`. A recurring series is 1 : N. | The generic push hook **cannot be reused as-is**. Resolved by pushing a Graph-native recurring event (§4). |
| (unstated) | `GraphEvent` (`outlook-calendar-write.ts:15`) hardcodes `isAllDay: true` and `timeZone: "UTC"` as **literal types**. | A timed event cannot be expressed. The shared interface must widen, touching all five existing `*ToGraphEvent` builders and their tests. **S6.** |

Additional facts the design relies on:

- The calendar already supports month / week / custom windows (`calendar-window.ts`); `resource-calendar.tsx` is 405 lines, is a `role="grid"` with 2-D roving via `data-cell="${row}-${col}"`, and has **no drag anywhere**.
- `ENTITY_SPECS` (`turso-schema.ts:59`) is a single registry whose entries drive CSV columns, Turso single-tenant DDL/insert/load, and Turso multi-tenant DDL/insert/load. `TABLE_NAMES` is *derived* from it.
- The Calendar sub-tab is **not** in `A11Y_VIEWS` (Resources' default sub-tab is the directory), so nothing here is covered by the axe gate.

---

## 1. Scope

| # | Slice | Release | Deps |
|---|---|---|---|
| **S1** | Grid chrome (weekday + ISO-week headers) and range clamp | 0.202.0 | — |
| **S2** | Drag / resize / reassign absences | 0.202.0 | — |
| **S3** | `CalendarEvent` entity + persistence | 0.202.0 | — |
| **S4** | Recurrence expansion engine | 0.202.0 | S3 |
| **S5** | Meetings band + series list + editor | 0.202.0 | S2, S3, S4 |
| **S6** | Outlook push for events | 0.203.0 | S3–S5 |
| **S7** | Outlook pull + exception reconciliation | 0.203.0 | S6 |

S1, S2 and S3 are mutually independent and can run in parallel from the start.

**Out of scope:** all-day or multi-day events (an event is a timed meeting inside one day);
room/resource booking; free-busy lookup; attendee accept/decline state; importing an existing
Outlook series into the app (the existing `outlook-calendar-import-modal` is untouched).

---

## 2. Data model

New pure, i18n-free module `src/app/calendar-event.ts`:

```ts
export interface CalendarEvent {
  id: number;
  title: string;
  /** First occurrence, YYYY-MM-DD. */
  startDate: string;
  /** Local wall-clock start in the project's effective timezone, "HH:mm" (24h). */
  startTime: string;
  durationMinutes: number;
  location?: string;
  notes?: string;
  /** Absent ⇒ a single, non-recurring occurrence on startDate. */
  recurrence?: RecurrenceRule;
  exceptions?: EventException[];
  attendeeResourceIds?: number[];
  /** Default false. Gates Graph `attendees` — see §4.3. */
  sendInvitations?: boolean;
  localModifiedAt?: string;
  /** Graph seriesMaster id (S6). */
  outlookEventId?: string;
}

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type RecurrenceRule =
  | { freq: "daily";  interval: number; until?: string; count?: number }
  | { freq: "weekly"; interval: number; byDay?: Weekday[]; until?: string; count?: number }
  | { freq: "monthly"; interval: number;
      /** Day-of-month form. Mutually exclusive with byDay. */
      byMonthDay?: number;
      /** Nth-weekday form, e.g. {ordinal: 2, day: "TU"} = 2nd Tuesday; -1 = last. */
      byDay?: { ordinal: 1 | 2 | 3 | 4 | -1; day: Weekday };
      until?: string; count?: number };

export type EventException =
  | { date: string; kind: "skip" }
  | { date: string; kind: "move"; toDate: string; toTime?: string };
```

Invariants, all enforced by `sanitizeCalendarEvent` (never throws, returns `null` when
unrecoverable — mirrors `sanitizeAbsence`):

- `id` finite and `> 0`, `title` non-empty after trim, else `null`.
- `startDate` a valid ISO date, else `null`. `startTime` matches `/^([01]\d|2[0-3]):[0-5]\d$/`, else defaults `"09:00"`.
- `durationMinutes` an integer in `[5, 1440]`, else `60`.
- `interval` an integer in `[1, 52]`, else `1`.
- `until` a valid ISO date `>= startDate`, else dropped. `count` an integer in `[1, 500]`, else dropped. If **both** are present, `until` wins and `count` is dropped — one range terminator only.
- Monthly with both `byMonthDay` and `byDay`: `byDay` wins, `byMonthDay` dropped. Monthly with neither: `byMonthDay` defaults to `startDate`'s day-of-month.
- `byDay` (weekly) deduped, ordered MO→SU, empty array dropped (⇒ plain weekly on `startDate`'s weekday).
- `exceptions` deduped by `date` (last wins), each `date` a valid ISO date, capped at 500 entries, sorted ascending. A `move` whose `toDate` is invalid degrades to `skip` — never to a silent no-op, because an occurrence the user moved must not quietly reappear on its original date.
- `attendeeResourceIds` deduped positive integers, capped at 100. Dangling ids (resource deleted) are **kept** — same stance as every other FK in the app, which the UI renders as unresolved rather than silently dropping.
- `sendInvitations` is `raw.sendInvitations === true` — anything else is false.

**Golden-fixture note.** Unlike the "byte-stable when empty" blob fields (`insights`,
`knowledgeItems`), this is a row entity: its CSV section header and Markdown table are emitted
unconditionally. Golden fixtures regenerate **once**, in S3.

---

## 3. Persistence (S3)

One `ENTITY_SPECS` entry covers CSV, Turso single-tenant and Turso multi-tenant, because DDL,
insert and load all derive from `spec.columns`:

```ts
spec<CalendarEvent>({
  table: "calendar_events",
  wsKey: "calendarEvents",
  columns: EVENTS_CSV_COLUMNS,
  get: (w) => w.calendarEvents,
  toRow: eventFieldToString as unknown as (e: CalendarEvent, col: string) => string,
  fromObj: sanitizeCalendarEvent,
})
```

`EVENTS_CSV_COLUMNS` (in `csv-codecs-core.ts`, beside `ABSENCES_CSV_COLUMNS`):

```
id, title, startDate, startTime, durationMinutes, location, notes,
recurrence, exceptions, attendeeResourceIds, sendInvitations,
localModifiedAt, outlookEventId
```

`recurrence`, `exceptions` and `attendeeResourceIds` persist as **JSON-in-cell**, encoded by
`encodeRecurrence` / `decodeRecurrence` / `encodeExceptions` / `decodeExceptions` in
`calendar-event.ts` — the `encodeNoteLog` / `decodeNoteLog` precedent. Absent fields encode to
`""` and decode back to `undefined`, so a plain non-recurring event has no JSON in its row.

The six write paths:

| Path | Work |
|---|---|
| CSV | `EVENTS_CSV_COLUMNS` + `eventFieldToString` + `buildCalendarEventFromObj` (`csv-codecs-core.ts`); `# CALENDAR EVENTS` section in the encoder assembler and `csv-codecs-decode.ts` |
| Markdown | `EVENTS_MD_COLUMNS` + table encoder (`markdown-codecs-core.ts`) + decode arm (`markdown-codecs-decode.ts`) |
| Turso single | free via `ENTITY_SPECS` |
| Turso tenant | free via `ENTITY_SPECS` |
| JSON | `Workspace.calendarEvents` in `workspace.ts` (type at line 71) + `sanitizeCalendarEvent` applied in `jsonToWorkspace` |
| IndexedDB | `calendarEvents` KV slot in `browser-backend.ts` |

App-level wiring mirrors `knowledgeItems` exactly, because that is the field that actually
autosaves: value + setter through `workspace-context`, set on load in **both**
`use-storage-backend.applyWorkspace` and `task-manager`'s restore effect, and — critically —
included in the three `backend.save({…})` literals, in `currentWorkspace()`, and **in the
autosave-effect deps array**. Omitting the last one is the silent-data-loss failure this
codebase has already shipped twice.

Two consequences of joining `ENTITY_SPECS`:

1. `TABLE_NAMES` gains `calendar_events` automatically, which is correct — this *is* workspace
   data, so the per-table DELETE on save must cover it.
2. `rowsToWorkspace` requires `results.length >= TABLE_NAMES.length`. An existing Turso DB gains
   a table; `SCHEMA_DDL`'s `CREATE TABLE IF NOT EXISTS` runs on load and covers it. `turso-migrate`
   needs no special case (it PRAGMA-diffs columns of tables that exist).

Guarded by a new row in `entity-persistence-registry.test.ts` and a
`calendar-events-persistence.test.ts` source-scan asserting the save literals and deps array
mention `calendarEvents`.

---

## 4. Outlook sync (S6–S7, 0.203.0)

### 4.1 One seriesMaster per series

A series pushes as **one** Graph event carrying a native `recurrence`, not N independent events.
This keeps `outlookEventId` single-valued (so §3's column list is final and S3 does not depend on
this decision landing), and it is the only shape that puts one real recurring meeting in an
invitee's calendar instead of N separate invitations.

New pure `graph-recurrence.ts`, translating both directions:

| Ours | Graph `recurrencePattern` |
|---|---|
| `daily` + interval | `{ type: "daily", interval }` |
| `weekly` + interval (+ `byDay`) | `{ type: "weekly", interval, daysOfWeek: [...] }` — absent `byDay` ⇒ `startDate`'s weekday |
| `monthly` + `byMonthDay` | `{ type: "absoluteMonthly", interval, dayOfMonth }` |
| `monthly` + `byDay {ordinal, day}` | `{ type: "relativeMonthly", interval, daysOfWeek: [day], index }` where index ∈ first/second/third/fourth/last |

| Ours | Graph `recurrenceRange` |
|---|---|
| `until` | `{ type: "endDate", startDate, endDate }` |
| `count` | `{ type: "numbered", startDate, numberOfOccurrences }` |
| neither | `{ type: "noEnd", startDate }` |

### 4.2 `GraphEvent` widening

```ts
export interface GraphEvent {
  subject: string;
  isAllDay: boolean;                          // was: true
  start: { dateTime: string; timeZone: string };  // was: "UTC"
  end:   { dateTime: string; timeZone: string };
  categories: string[];
  body: { contentType: "Text"; content: string };
  showAs?: "free" | "tentative" | "busy" | "oof" | "workingElsewhere";
  attendees?: { emailAddress: { address: string; name?: string }; type: "required" }[];
  recurrence?: { pattern: GraphRecurrencePattern; range: GraphRecurrenceRange };
}
```

The five existing builders keep passing `isAllDay: true` and `timeZone: "UTC"` and are otherwise
untouched; only the type widens. Their tests assert exact objects and continue to pass.

`eventToGraphEvent` uses the project's **effective timezone** (`resolveTimezone(settings.timezone,
project?.operatingTimezone)` — the value the app already computes for `todayISO`), not UTC. Start
is `${startDate}T${startTime}:00`, end is start + `durationMinutes` in the same zone.

Category is type-scoped: `categoryFor(projectId, "event")` = `AIPM:<pid>:event`. `categoryFor`
already takes an optional `entityType` (`outlook-calendar-write.ts:12`), so distinct type-scoped
strings mean a milestone or committee push can never cross-delete an event (OData `$filter` is
exact-equality).

### 4.3 Invitations are opt-in and confirmed

`sendInvitations` defaults **false**. When false, `eventToGraphEvent` omits `attendees` entirely
and the push writes a personal calendar entry — identical in blast radius to every existing
entity push.

When a user turns it on, the editor shows a confirm naming the resolved recipient count and the
addresses; only after that does the field persist as `true`. Attendees with no email on their
`Resource` are listed as unreachable in that confirm rather than silently skipped. This is the
only place in the app that emails third parties, and a push must never be the first time the
user learns it will.

Resources deleted after the fact leave dangling `attendeeResourceIds`; those resolve to nothing
at push time and are reported in the push result toast, not silently dropped.

### 4.4 Pull (S7)

Pull reads `/events/{seriesMasterId}/instances?startDateTime=…&endDateTime=…` over the current
calendar window and maps each instance back:

- instance moved ⇒ upsert a `move` exception for its original date;
- instance cancelled ⇒ upsert a `skip` exception;
- instance unchanged ⇒ drop any exception that no longer differs (convergence — without this the
  same row re-appears as a conflict on every pull).

The existing app-wins baseline model applies per **occurrence**: baseline key is
`${projectId}:event:${seriesMasterId}:${originalDate}`, value the last-agreed
`"YYYY-MM-DD|HH:mm"`. An occurrence whose app-side value moved since the baseline is a
**conflict**, never a silent overwrite — the same rule the four existing pull entities use, and
it reuses `CalendarPullSummaryModal`.

`planCalendarPull`'s `PullEntity`/`PulledEvent` are date-only and single-valued per entity, so
they do **not** fit an occurrence stream. S7 adds a sibling pure module
`calendar-event-pull.ts` rather than widening the shared one — the four shipped entities must not
inherit occurrence semantics they do not have.

Truncation safety carries over: a missing instance is a deletion only when the fetch completed;
a page-capped fetch never prunes.

---

## 5. Slices

### S1 — Grid chrome + range clamp (0.202.0)

Export `isoWeekParts` from `resource-capacity.ts`. `CalendarDay` gains `weekdayLabel` (localised
short weekday via the existing `localeFor(lang)`) and `isoWeek: number`.

The header becomes two rows inside the existing `<thead>`: an ISO-week band whose cells
`colSpan` each run of same-week columns (label `KW 31` / `W31` per locale), then the existing
day row, now showing weekday over day-of-month. Both rows stay `sticky`. The month label keeps
its current behaviour.

Header rows are not part of the roving set (`data-cell` lives on body cells), so `focusCell`
indexing and `onGridKeyDown` are untouched.

New pure `clampRangeEnd(start, end)` in `date-range.ts`: returns `end < start ? start : end`.
`absence-edit-modal.tsx` applies it in the start-date `onChange` — moving start past end pulls
end along silently. The `end < start` submit check stays as a backstop for direct/typed input;
`sanitizeAbsence`'s swap is untouched.

**Accept:** header shows weekday + ISO week, correct across a year boundary (2026-12-28 is
`2026-W53`, 2027-01-01 is `2026-W53`) and across DST; moving an absence start past its end pulls
the end with it; no invalid range reaches storage.

### S2 — Drag / resize / reassign (0.202.0)

Pure `calendar-drag.ts`:

```ts
resolveCalendarDrag({ absence, grabbedDate, dropDate, dropRowKey, currentRowKey, mode, rowResource })
  → { patch: Partial<Absence>, kind: "move" | "reassign" | "resize" } | null
```

- `mode: "move"` — shift `startDate` and `endDate` by `dropDate − grabbedDate`, span preserved.
  `dropRowKey !== currentRowKey` additionally rewrites `assignee`, `assigneeEmail` and
  `resourceId` from the target row's resource, and `kind` becomes `"reassign"`.
- `mode: "resize-start"` — `startDate = dropDate`; past the end, `clampRangeEnd` collapses the
  range to that single day.
- `mode: "resize-end"` — `endDate = dropDate`; before the start, same clamp.
- Returns `null` for a no-op drop (same date, same row), so a stray click writes nothing.

Wiring: `draggable` goes on the existing cell `<button>` when the cell has an absence hit;
`dataTransfer` carries `{absenceId, grabbedDate, mode}`; every day cell is a drop target. Resize
uses 8px hit-zones rendered only on the **first and last** cell of a span. A drag must not read
as a click — the gantt `interactingWithBarRef` pattern (checked synchronously in the click
handler) applies.

Keyboard equivalent is a **pending move mode**, not per-keypress commits:
`Alt+Arrow` on an absence cell enters move mode and nudges a ghost (←/→ date, ↑/↓ person),
`Alt+Shift+←/→` resizes the end, `Enter` commits, `Escape` cancels. Per-keypress commits would
push one undo entry per arrow press and flood the stack.

One drag, or one committed keyboard move, produces exactly **one** composite undo entry — a
reassign writes three fields and must undo as a unit.

The Calendar sub-tab is not axe-scanned, so drag/keyboard a11y is covered by unit tests plus eye
verification, not the gate.

**Accept:** dragging an absence body reschedules it preserving span; dragging across rows
reassigns it; edge-drag resizes; every gesture has a keyboard equivalent; each gesture is one
undo entry; grid roving still yields exactly one tab stop.

### S3 — `CalendarEvent` entity + persistence (0.202.0)

§2 and §3 in full. No UI in this slice — the entity lands, round-trips and is guarded first.

**Accept:** a workspace containing events round-trips byte-stable through JSON, CSV, Markdown,
both Turso schemas and IndexedDB; a malformed event decodes to `null` without throwing; golden
fixtures regenerate with an events section; the persistence-registry test covers the new entity.

### S4 — Recurrence engine (0.202.0)

Pure `recurrence.ts`:

```ts
expandOccurrences(event: CalendarEvent, windowStart: string, windowEnd: string): Occurrence[]
// Occurrence = { date, time, durationMinutes, originalDate, isMoved, eventId }
```

`today` and the window are passed in; the module contains no clock. Exceptions apply **after**
raw expansion: `skip` removes the occurrence, `move` rewrites its date/time while keeping
`originalDate` (which is what the exception and the Outlook baseline are keyed by). A `move`
whose target falls outside the window still renders, because the user put it there.

Bounded by `MAX_OCCURRENCES = 1000` per expansion; a window that would exceed it truncates and
reports it, so a "renders nothing after March" bug can never look like an empty series.

Monthly `byMonthDay` skips months lacking that day (no 31st in February — skip, never clamp to
the 28th, which would silently invent an occurrence). Monthly `byDay` with `ordinal: -1` means
the last such weekday in the month; `ordinal: 4` and a 5-weekday month are different dates and
both are tested.

**Accept:** every rule form expands correctly; `count` and `until` terminate identically to
Outlook; exceptions skip and move; expansion is pure and deterministic; property tests cover
5th-weekday months, month-end, year boundaries and DST.

### S5 — Band + series list + editor (0.202.0)

Meeting lanes render as extra `<tbody>` rows in the **same** `<table>` as the person rows — that
is what keeps the columns aligned. Pure `packOccurrenceLanes(occurrences)` greedily assigns
lanes so same-day meetings stack rather than collide. Band cells carry their own data attribute
and are **not** in the `data-cell` roving set.

Each occurrence chip shows `HH:mm Title`, is a real `<button>` with a row-unique accessible name
(`${title} – ${date} ${time}`), opens the series editor on click, and is draggable. What a drag
writes depends on whether the event recurs: a **recurring** series gets a `move` exception for
that occurrence only, while a **non-recurring** event (no `recurrence`) has its `startDate`
rewritten directly — an exception on a one-occurrence event would be a second source of truth
for the same date.

Series list: a `<details>` under the grid listing **all** series regardless of window — title,
human-readable rule, next occurrence, attendee count, edit and delete. This is how a series
entirely outside the current window stays reachable.

Editor modal follows the six-modal convention (`EditModalShell` + `useDraftState` +
`ModalEditFooter`), reuses S1's clamp for the `until` field, and includes the §4.3 invitation
confirm. "+ Add meeting" sits in the calendar toolbar, left of the trailing
Print · reset-columns · reset-size group.

**Preemptive split.** `resource-calendar.tsx` is 405 lines and both S2 and S5 land in it. It
splits on the gantt convention before approaching the 800-line ratchet: `resource-calendar.tsx`
(orchestrator) + `resource-calendar-rows.tsx` + `resource-calendar-band.tsx`, with drag and
recurrence pure and outside. Both presentational files take data and handlers as props.

**Accept:** a recurring series renders its occurrences in the band; overlapping meetings stack;
editing the series updates **every** occurrence, past and future — there is deliberately no
"this and following" split, because every occurrence is derived from the one stored rule;
dragging one occurrence of a recurring series moves only that one; out-of-window series are
reachable from the list; the editor cannot save an invalid rule.

### S6 — Outlook push (0.203.0)

§4.1–4.3. Adds `"event"` to `CalendarEntityType` and `CALENDAR_ENTITY_TYPES`, a settings sync row
via the existing `CalendarSyncEntityRow` helper, a `calendarSyncEntityEvent` i18n key, and
`sanitizeOutlookCalendar` coverage. Push is a new `use-event-calendar-push.ts` — it reconciles
seriesMasters, not per-item dates, so it does not reuse `useEntityCalendarPush`; it does reuse
that hook's module-scoped in-flight lock pattern (`${projectId}:event`) and its 404-on-PATCH
self-heal (clear the stale link, re-create next push).

**Accept:** a series pushes as one recurring Outlook event under `AIPM:<pid>:event`; a milestone
or committee push never touches it; invitations go out only with explicit opt-in and confirm;
a 404 self-heals; popouts push nothing.

### S7 — Outlook pull + exception reconcile (0.203.0)

§4.4. New pure `calendar-event-pull.ts` + `use-event-calendar-pull.ts`, reusing
`CalendarPullSummaryModal`. Background auto-pull participates on the same
`settings.outlookCalendar.event.auto` flag as the other four entities.

**Accept:** an occurrence moved in Outlook becomes a `move` exception; a cancelled one becomes
`skip`; an occurrence reverted in Outlook clears its exception; a conflicting move surfaces in
the summary modal instead of overwriting; a truncated fetch never prunes.

---

## 6. Testing and gates

- **Pure engines** — `recurrence.ts`, `calendar-drag.ts`, `graph-recurrence.ts`,
  `calendar-event-pull.ts` and `sanitizeCalendarEvent` are i18n-free, clock-free and unit-tested
  directly. Property tests (`recurrence.property.test.ts`) cover the expansion edge cases in S4.
- **Golden fixtures** regenerate exactly once, in S3, from the serializers. The sample workspace
  gains two events — one plain weekly, one monthly nth-weekday with a `skip` exception — so the
  fixtures exercise both encodings. `-big`/`-huge` regenerate from the master via
  `scripts/generate-sample-workspace.ts`.
- **Persistence guards** — one new row in `entity-persistence-registry.test.ts`; a
  `calendar-events-persistence.test.ts` source-scan pinning the `backend.save` literals,
  `currentWorkspace()` and the autosave deps array.
- **Ratchets** — `size:check` is pre-empted by the S5 split rather than re-baselined;
  `dup:check` matters most in S6/S7, where the pull hook is a near-sibling of the existing one
  (share the lock and baseline helpers, keep the divergent occurrence logic separate).
- **a11y** — Calendar is not in `A11Y_VIEWS`, so band chips, drag affordances and the keyboard
  move mode are unit-tested for accessible names and keyboard reachability, then eye-verified.
  Settings → Integrations **is** axe-scanned, so S6's new sync row needs a labelled control.
- **Palette** — occurrence chips and the week band use sanctioned tokens only; the band is
  chrome (`bg-surface-muted`, `border-line`), and no RAG semantics attach to meetings.

## 7. Risks

1. **S7 has no precedent in the repo.** Every shipped pull maps one date onto one entity;
   mapping a Graph occurrence stream onto an exception model is new logic. It is last, behind a
   stable entity, and gets its own pure module rather than widening the shared one.
2. **S6 emails third parties.** Mitigated by default-off, an explicit confirm naming recipients,
   and never inferring intent from a push.
3. **`GraphEvent` widening touches five shipped builders.** Type-only widening; their exact-object
   tests are the regression net.
4. **Drag over a `role="grid"`.** The roving model is load-bearing for keyboard users. Drag is
   additive on the existing cell button; the pending-move mode is the keyboard path; a
   drag-vs-click guard prevents a drag from opening the absence editor.
