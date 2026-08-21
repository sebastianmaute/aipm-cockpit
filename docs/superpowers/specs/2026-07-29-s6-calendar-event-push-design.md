# S6 — Outlook push for calendar events

_Opened 2026-07-29 against 0.208.0 "Yolen". Slice S6 of the 8-slice UX batch roadmap
(`2026-07-27-ux-batch-roadmap-design.md`); order C→D→F→A→E→**S6**→S7→B. Target release
**0.209.0 "Bodard"** (spare codename: Samatar — both verified absent from `CHANGELOG.md`)._

Supersedes the S6 section of the archived `specs/2026-07-26-r5-calendar-overhaul-design.md`
(inside `_archive-slice-docs-2026-07-27.zip`) where the two disagree. Disagreements are marked
**[supersedes]** and each says why.

---

## 0. Grounding against 0.208.0

Verified in code, not assumed:

| Fact | State |
|---|---|
| `graph-recurrence.ts` · `use-event-calendar-push.ts` · `calendar-event-pull.ts` · `use-event-calendar-pull.ts` | all four **missing** — wiring is 100% greenfield |
| `CalendarEntityType` (`settings-types.ts:493`) | `"task" \| "raid" \| "change" \| "absence"` — no `"event"` |
| `GraphEvent` (`outlook-calendar-write.ts:22`) | `isAllDay: true` and `timeZone: "UTC"` are **literal** types — a timed event is inexpressible |
| `CalendarEvent` model | `startTime` · `durationMinutes` · `attendeeResourceIds` · `sendInvitations` · `outlookEventId` all shipped in S3, persisted across the six write paths. **No migration owed, no golden regen.** |
| `calendar-event-modal.tsx:29` | explicit comment *"NO attendees field: attendeeResourceIds/sendInvitations stay on the model"* — the invitation UI is **greenfield**, not a tweak. The archived spec's §4.3 assumed the editor already had it |
| `task-manager.tsx` | **2973 lines against a 2974 baseline** (`docs/baselines/file-sizes.json`) — effectively frozen. Push wiring cannot go there |
| `use-calendar-integrations.ts` | 400 lines, in `vitest.config.ts` `coverage.exclude`, already hosts all four entities' push/pull blocks — this is the home |
| Sizes | `calendar-event-modal.tsx` 462 · `resources-panel.tsx` 680 · `calendar-series-list.tsx` 204 · `outlook-calendar-write.ts` 256 — all under the 800 cap, `resources-panel` the tightest |
| `Resource` (`types.ts:534`) | `email?: string` plus `emails?: string[]` |
| Axe | Resources **is** in `A11Y_VIEWS`, its **Calendar sub-tab is not** (the directory is the default sub-tab). Settings **is** scanned |

---

## 1. Scope

**In.** `"event"` as a fifth `CalendarEntityType` · `GraphEvent` widened to timed events ·
one-directional recurrence translation · one **seriesMaster** per series under the type-scoped
category `AIPM:<pid>:event` · **exception replay** (`move` → PATCH instance, `skip` → DELETE
instance) · attendee picker + `sendInvitations` toggle + pre-enable confirm · settings sync row ·
manual push button on Resources → Calendar · auto-push that **freezes** invitation series.

**Out.** Pull (S7) · parsing Graph recurrence back into our rule · per-attendee response status ·
non-default calendars. The four shipped push entities gain **no behaviour change** — §3's `freeze`
widening is inert for them (they pass no predicate), which a regression test pins.

**[supersedes]** The archived spec calls `graph-recurrence.ts` bidirectional. S6 builds the
**to-Graph direction only**: S7 pulls by mapping *instances* to exceptions and never re-reads the
master's rule, so the inverse has no caller. Building it now is speculative generality.

---

## 2. Decisions taken (2026-07-29)

| Question | Decision |
|---|---|
| How much invitation UI lands in S6? | **Full** — attendee picker, `sendInvitations` toggle, confirm naming recipients and unreachable attendees. Honours the 2026-07-27 roadmap decision |
| Background auto-push for events? | **Yes, but invitation series are frozen** — a third party is never mailed without a click |
| In-app delete of a series? | **Deletes in Outlook, which cancels invitations.** Correct: an attendee whose meeting was deleted should be told. The existing delete confirm is worded to say so when the series has invitations on |
| New push hook or reuse the shared one? | **Reuse** `useEntityCalendarPush` and widen `planEntityReconcile` with an optional `freeze` predicate |
| Do local exceptions reach Outlook? | **Yes** — replayed onto the master's instances after create/update |

**[supersedes]** The archived spec mandates a new `use-event-calendar-push.ts` because a series
"reconciles seriesMasters, not per-item dates". Grounding shows the reconcile *shape* fits
unchanged: `CalendarEvent` satisfies `HasEventLink`, and one series is one `outlookEventId`. A new
hook would be ~110 lines ≈85% identical to the existing one, and the jscpd baseline already lists
`use-entity-calendar-push` / `use-outlook-calendar-push` / `use-milestone-calendar-pull` as clone
pairs — a third near-copy would very likely trip the blocking `dup:check` gate. Reuse also inherits
the module-scoped in-flight lock, the 404-on-PATCH self-heal, the popout guard and the `setItems`
write-back for free.

---

## 3. The freeze predicate

### 3.1 Why a filter is not enough

★★★ **`planEntityReconcile` is list-based: `items` IS the desired full state.**

```ts
const del = existing.map((e) => e.id).filter((id) => !keptIds.has(id));
```

Every category-tagged Outlook event whose id is absent from `items` is **deleted**. So the naive
reading of "auto never pushes invitation series" — hand the auto instance
`items.filter(e => !e.sendInvitations)` — makes every background sync **DELETE the invitation
series in Outlook, mailing a cancellation to every attendee**. That is precisely the outcome the
decision exists to prevent. The predicate must mean *hold, don't touch*, never *omit*.

### 3.2 Contract

```ts
export function planEntityReconcile<T extends HasEventLink>(
  items: readonly T[],
  existing: readonly ExistingEvent[],
  freeze?: (item: T) => boolean,
): GenericReconcilePlan<T>
```

For an item where `freeze(item)` is true:

1. it is **not** in `create`;
2. it is **not** in `update`;
3. **its `outlookEventId` IS added to `keptIds`** — this is the load-bearing clause, and it is what
   holds the event out of `delete`.

`freeze` omitted ⇒ every code path is byte-identical to today, so the four shipped entities are
untouched. Pinned by a regression test.

`useEntityCalendarPush`'s `Args<T>` gains the same optional `freeze?: (item: T) => boolean` and
forwards it verbatim to `planEntityReconcile`. Nothing else in the hook changes: the create /
update / delete loops already iterate whatever the plan hands them, so a frozen item simply never
appears in any of the three.

### 3.3 Wiring

In `use-calendar-integrations.ts`, mirroring the absence block:

```ts
const eventSync = calendarSyncFor(settings, "event");
const calendarEventEnabled  = eventSync.enabled && m365Enabled && !isPopout;
const eventAutoSyncActive   = eventSync.auto    && m365Enabled && !isPopout;

// manual — pushes everything the user clicked for
useEntityCalendarPush<CalendarEvent>({ items: pushableEvents, entityType: "event", … });

// background — invitation series are held, never touched, never deleted
useEntityCalendarPush<CalendarEvent>({
  items: pushableEvents, entityType: "event",
  freeze: (e) => e.sendInvitations === true,
  interactive: false, enabled: eventAutoSyncActive, …
});
useCalendarAutoSync({ active: eventAutoSyncActive, contentKey: eventAutoSyncKey,
                      push: autoPushEvent, staggerMs: AUTO_SYNC_STAGGER_STEP_MS * 4 });
```

`pushableEvents` = every series (a series always has a `startDate`).

`eventAutoSyncKey` covers
`id|title|startDate|startTime|durationMinutes|location|notes|JSON(recurrence)|JSON(exceptions)|JSON(attendeeResourceIds)|sendInvitations`
and **excludes `outlookEventId`** — that is the push's own output, and including it fires one
redundant round after every push.

★ `toGraphEvent` sits in the hook's `useCallback` dep array, so the curried builder (it closes over
the timezone and the resource list) must be `useMemo`/`useCallback`-stable or `pushToOutlook`'s
identity churns every render.

★ Residual, accepted and documented rather than engineered around: a **manual** push PATCHes every
linked series, and Graph may mail an update even where nothing materially changed. A manual push is
an explicit click; the auto path is the one that had to be made safe.

---

## 4. Pure modules

Three new files. All are genuinely unit-testable, so all stay **coverage-gated** — no
`vitest.config.ts` `exclude` entry. (The exclude convention is a fallback for UI glue, not a
default; slice C established this.)

### 4.1 `graph-recurrence.ts`

`toGraphRecurrence(rule, startDate)` → `{ pattern, range }`.

| Ours | Graph `recurrencePattern` |
|---|---|
| `daily` + interval | `{ type: "daily", interval }` |
| `weekly` + interval (+ `byDay`) | `{ type: "weekly", interval, daysOfWeek }` — absent `byDay` ⇒ `startDate`'s weekday |
| `monthly` + `byMonthDay` | `{ type: "absoluteMonthly", interval, dayOfMonth }` |
| `monthly` + `byDay {ordinal, day}` | `{ type: "relativeMonthly", interval, daysOfWeek: [day], index }`, index ∈ first/second/third/fourth/last |

| Ours | Graph `recurrenceRange` |
|---|---|
| `until` | `{ type: "endDate", startDate, endDate }` |
| `count` | `{ type: "numbered", startDate, numberOfOccurrences }` |
| neither | `{ type: "noEnd", startDate }` |

`range.startDate` is always the event's `startDate`, which Graph requires to match the master's
`start` date. `sanitizeCalendarEvent` already guarantees at most one range terminator (`until` wins
over `count`), so the two-terminator case is unreachable here.

### 4.2 `calendar-event-attendees.ts`

```ts
resolveAttendees(ids, resources)
  → { reachable: { address: string; name: string }[];
      unreachable: { name: string }[];
      dangling: number[] }
```

**One source of truth for the confirm dialog and the push**, so what the user was told and what
actually gets mailed cannot diverge. `unreachable` = resolved resource with no `email`;
`dangling` = an id with no resource (deleted after the fact — kept per the model contract, never
silently dropped).

### 4.3 `calendar-event-graph.ts`

`eventToGraphEvent(event, projectId, { timeZone, attendees })`:

- `isAllDay: false`; `start.dateTime` = `${startDate}T${startTime}:00`, `timeZone` as passed
- `end` = naive wall-clock start + `durationMinutes`, **handling date rollover past midnight**
- `categories: [categoryFor(projectId, "event")]`
- `recurrence` from `toGraphRecurrence` when `event.recurrence` is present, else omitted
- `attendees` populated **only** when `sendInvitations === true`; omitted entirely otherwise, which
  makes the push a personal calendar entry identical in blast radius to every other entity

★ Naive wall-clock arithmetic across a DST boundary is deliberate: it is what Outlook itself does
for a fixed-duration meeting. `timeZone` is `resolveTimezone(settings.timezone,
project?.operatingTimezone)` — the app's effective zone, both inputs already in
`CalendarIntegrationDeps`. Never UTC.

`exceptionPlan(event, instances)` → `{ patch: {instanceId, start, end}[]; delete: string[] }`.

★★★ **Instance identity is `originalStart`, not `start`.** Graph returns a moved occurrence at its
*new* time while `originalStart` retains where the rule put it. Matching on `start` means the second
push treats a moved occurrence as the occurrence that originally lived on that date and moves the
wrong one. Unmodified instances carry no `originalStart` → fall back to `start`.

★★ A `move` whose instance already sits at the target is **skipped, not re-PATCHed**. With
invitations on, a redundant PATCH mails every attendee again.

★ A `skip` whose instance is absent is already cancelled → no-op, not an error.

The instance fetch window is derived **from the exceptions themselves** (min exception date → max
move target, padded), not from an arbitrary horizon or the UI's calendar window. A series with no
exceptions costs **zero** extra Graph calls.

---

## 5. Invitation UI

`calendar-event-modal.tsx` is 462 lines; the attendee block lands in its own presentational,
props-only `calendar-event-attendees-field.tsx`, which keeps the modal focused and the ratchet
clear.

- **Picker** — `EntityLinkPicker` over resources, mapped to `LinkPickerEntry {id, code, label}`
  with `label` = `${firstName} ${lastName}` and `code` = initials derived inline (there is no
  initials helper in the codebase; the Timelog one is TimeLog's own field, not ours). The caller
  owns the query state and the option filtering, per that primitive's contract. No hand-rolled
  control (see `no-handroll-use-primitives`).
- **Toggle** — a `Checkbox` bound to `sendInvitations`. Turning it **on** opens the confirm;
  turning it **off** is immediate — removing people from a mailing list needs no ceremony.
- **Confirm** — a `Modal` naming the resolved recipient count, the addresses, and every unreachable
  attendee **listed explicitly rather than silently skipped**. `sendInvitations` persists `true`
  only on accept. It opens from a click inside the already-open `EditModalShell`, so open order
  equals nesting order and the dismissal-stack precondition holds (a user gesture, never a
  same-commit mount).
- **The confirm gates the flag, not the list.** Adding a sixth attendee to a series that already
  has invitations on does **not** re-confirm. Deliberate: the chip list sits directly above the
  toggle with every resolved address visible, so a later addition is made in full sight of who it
  is, and the push result toast names the recipient count on every push. Re-confirming on each
  attendee edit would train the user to dismiss the dialog, which is worse than not showing it.
- Dangling ids render as unresolved and are preserved.
- **Delete confirm.** `calendar-event-modal.tsx:152` already gates delete behind
  `useConfirm({ message: t(lang, "calendarEventConfirmDelete") })`. S6 swaps in a second key when
  the series has invitations on and at least one reachable attendee, saying that deleting also
  cancels the meeting in their calendars. No new dialog, no extra click.
- ★ Chip remove buttons take **row-unique** accessible names (`Remove – <name>`). The Calendar
  sub-tab is not axe-scanned, and axe cannot see duplicate names in any case — this is correct by
  construction and eye-verified, never gate-verified.

★★ **Security review is mandatory for this section.** It is the only surface in the app that emails
third parties. Additionally: `logDiag` on push failure carries **counts, never addresses** — the
diagnostics ring is user-exportable and addresses are PII.

---

## 6. Settings and surfaces

- `CalendarEntityType` gains `"event"`; `CALENDAR_ENTITY_TYPES` gains it; `sanitizeOutlookCalendar`
  covers it by iterating that list, so no separate edit.
- Settings → Integrations gains a row via the existing `CalendarSyncEntityRow` helper. **Settings is
  axe-scanned** — the row's controls need labels.
- Resources → Calendar gains the push control through the existing shared `CalendarSyncControls`,
  in `resources-panel.tsx`'s `headerActions`, gated `view === "calendar"`. That pane already renders
  a `CalendarSyncControls` for absences, so the two instances must carry **distinct
  `entityLabelKey`s** or their buttons collide on name.
- New i18n keys (EN + DE): `calendarSyncEntityEvent`, the confirm's title/body/recipient/unreachable
  strings, and the push-result additions. `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts —
  patch via a node utf8 write, then grep-verify.

---

## 7. Error handling

| Case | Behaviour |
|---|---|
| 404 on master PATCH | clear the stale link, re-create next push — inherited from the shared hook |
| 404 on instance PATCH/DELETE | already gone → counted as skipped, **not** failed |
| `skip` whose instance is absent | no-op |
| Unreachable attendees at push time | reported in the result toast, never silently dropped |
| No token, interactive | existing `calendarPushNoAccess` |
| No token, background | silent; `logDiag` only |
| Popout | no Graph call, no state write |
| Partial failure | existing `calendarPushPartial` |

---

## 8. Testing

Unit:

- `graph-recurrence` — 4 patterns × 3 ranges; weekly-without-`byDay` defaulting; both monthly forms
- `resolveAttendees` — reachable / unreachable / dangling
- `eventToGraphEvent` — timezone, `isAllDay: false`, midnight rollover, `attendees` **omitted** when
  the flag is off and **present** when on
- `exceptionPlan` — `originalStart` matching, already-at-target skip, absent-instance no-op
- `planEntityReconcile` freeze — see below
- Regression: the four shipped entities reconcile identically with `freeze` undefined

★★★ **The freeze test asserts the DELETE clause FIRST**: `frozen.outlookEventId` must not appear in
`plan.delete`. That is the clause whose absence cancels real meetings. A test that only checks "not
in `update`" passes with the dangerous bug fully intact. Mutation-verify by deleting the
`keptIds.add` line and **reading which assertion goes red** — a red test is not proof the named
claim was the one that fired.

Component: attendee field renders and edits; the confirm gates persistence (accept → `true`, cancel
→ unchanged); un-toggling raises no confirm.

Gates: `dup:check` (the reuse decision is what buys this) · size ratchet (field extracted;
`resources-panel` at 680 is the tightest) · coverage (three new gated `.ts` modules, no exclude) ·
axe on Settings, eye-verify Calendar · `npx tsc --noEmit` after any test edit.

---

## 9. Release chain

Bump `src/app/version.ts` (APP_VERSION + milestone) to **0.209.0 "Bodard"** · `CHANGELOG.md` entry ·
new `versionHighlight*` key appended to `APP_HIGHLIGHT_KEYS` with EN + DE strings · re-archive
`docs/superpowers/` to `_archive-slice-docs-2026-07-29.zip`, **merging every prior archive
newest-first and asserting the superset property before trusting the result** (a walk-the-tree zip
is a strict subset — see the roadmap's §archive rule).

---

## 10. What S6 leaves for S7

Pull. The app→Outlook direction is faithful after S6 (rule *and* exceptions), so S7's occurrence
pull has a converging baseline instead of a permanent conflict on every dragged occurrence — which
is the reason exception replay was pulled forward into S6 rather than deferred.

S7 remains as the roadmap specifies: a **sibling** pure `calendar-event-pull.ts` with its own
per-occurrence baseline key `${projectId}:event:${seriesMasterId}:${originalDate}`.
`planCalendarPull`'s date-only `PullEntity`/`PulledEvent` must **not** be widened — the four
shipped entities must not inherit occurrence semantics they do not have.
