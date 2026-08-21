# R5 follow-ups batch — design (0.202.1)

_Written 2026-07-26, on `main` at 0.202.0 "Beukes" (merge `4a93088f`)._

Scope: items **1, 3, 7, 9, 10** of `docs/superpowers/r5-calendar-followups.md`. Items 2 (lane
cross-window stickiness), 4 (`use-resource-planner.ts` split vs exemption), 5 (band-chip roving),
6 (series-list sorting) and 8 (`RaidCausedByField` dedup) stay deferred and keep their entries in
that doc.

Release: **0.202.1**, a patch. No new milestone codename, no `versionHighlight*` key — this batch
finishes R5 rather than adding to it.

Every claim below was checked against the code at that commit; the verified line numbers are cited
so a later reader can tell a real finding from a restated assumption.

---

## 1. Calendar-event activity log + undo

`use-calendar-events.ts` is the only per-entity CRUD hook in the app that neither logs nor captures
undo (its own header comment, lines 15-18, says so and calls it a deliberate follow-up). Closing it
takes three coordinated pieces.

### 1.1 Three new `ActivityKind` members

Added to the union at `activity-log.ts:12`:

| kind | translation key |
| --- | --- |
| `calendarEvent.created` | `activityCalendarEventCreated` |
| `calendarEvent.updated` | `activityCalendarEventUpdated` |
| `calendarEvent.deleted` | `activityCalendarEventDeleted` |

The `calendarEvent.` prefix matches the type name and stays clear of the existing
`calendar.autoPulled` (a different family — Outlook pull, not user CRUD). `activityGroupOf`
(`:219`) has no branch for it, so it falls through to `"general"` — the same bucket absence, shift,
milestone and change already land in. That is correct, not an omission; the Activity panel's group
filter has no per-entity granularity.

`ACTIVITY_KIND_TO_KEY` (`:161`) is an exhaustive `Record<ActivityKind, TranslationKey>`, so tsc
fails until all three are mapped. `ACTIVITY_KINDS` (`:211`) derives from that Record's keys, so the
persisted-entry validator picks them up with no further edit.

Strings — EN noun "Meeting", DE noun **"Termin"**, matching the already-shipped
`calendarMeetings: "Meetings"` / `"Termine"` (`i18n.ts:1531`, `i18n.de.ts:1525`). Shape mirrors the
absence family (`i18n.ts:1511-1513`): `#{0}` = id, `{1}` = title.

```
activityCalendarEventCreated: "Meeting #{0} created: {1}"
activityCalendarEventUpdated: "Meeting #{0} updated: {1}"
activityCalendarEventDeleted: "Meeting #{0} deleted: {1}"
```
```
activityCalendarEventCreated: "Termin #{0} erstellt: {1}"
activityCalendarEventUpdated: "Termin #{0} aktualisiert: {1}"
activityCalendarEventDeleted: "Termin #{0} gelöscht: {1}"
```

The DE strings carry `ö`, so they are written via the node-utf8 path, never the Edit tool, and
grep-verified afterwards (`i18n.de.ts` is CRLF — a replacement anchored on `\n` silently no-ops).

### 1.2 `CALENDAR_EVENT_UNDO_GROUPS`

Added to `undo/field-groups.ts` beside the five existing per-entity constants:

```ts
/** De-recurring an event clears its exceptions (sanitizeCalendarEvent), and the
 *  rule's `until` is cross-validated against startDate — so all three revert as
 *  one unit or an undo lands on a row the next load re-strips. */
export const CALENDAR_EVENT_UNDO_GROUPS: readonly FieldGroup<CalendarEvent>[] = [
  ["startDate", "recurrence", "exceptions"],
];
```

Both couplings are real, and each on its own justifies the group:

- **`recurrence` ⟺ `exceptions`.** `sanitizeCalendarEvent` (`calendar-event.ts:173`) emits
  `exceptions: recurrence ? sanitizeExceptions(raw.exceptions) : undefined`. Split into two undo
  entries, reverting the rule restores a recurring series with every skip and move gone — the exact
  silent loss item 1 flags, merely made two keystrokes long instead of permanent.
- **`startDate` joins them.** `sanitizeRecurrence(raw.recurrence, startDate)` (`:154`) enforces
  `until >= startDate`. Concretely: prev `{startDate: 2026-01-01, recurrence: {daily, until:
  2026-06-01}}`, user moves the start to `2026-12-01`, the sanitizer drops the now-impossible
  `until`. Both fields changed, so split entries let undo #1 restore `until: 2026-06-01` while
  `startDate` is still `2026-12-01` — an invariant-violating row that persists, and that the next
  load's sanitizer strips again. The undo appears to work and then doesn't.

Cost of over-grouping: a pure `startDate` move also rewrites two unchanged values. Harmless — they
are written back identical.

`CalendarEvent` must be added to `field-groups.ts`'s type import. It lives in `calendar-event.ts`,
not `../types`, so that is a second import line, not an addition to the existing one.

### 1.3 Wiring

`UseCalendarEventsArgs` gains four optional fields, copied from `UseChangeLogArgs`
(`use-change-log.ts:25-39`) — the convention this hook was extracted to follow:

```ts
logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
logActivityChanges?: (kind: ActivityKind, changes: readonly FieldChange[], ...args: (string | number)[]) => void;
capture?: UndoStackApi["capture"];
captureFieldEdit?: UndoStackApi["captureFieldEdit"];
```

Optional, so `use-calendar-events.test.tsx`'s existing render sites keep working unchanged.

`handleSaveCalendarEvent` — after the existing `setCalendarEvents` updater, and only on a genuine
update (`!create` and a `previous` row was found):

```ts
captureFieldChanges(args.captureFieldEdit, {
  setter: setCalendarEvents, kind: "calendarEvent.updated", id,
  prev: previous, next: sanitized, groups: CALENDAR_EVENT_UNDO_GROUPS,
  stampField: "localModifiedAt", name: sanitized.title,
});
args.logActivityChanges
  ? args.logActivityChanges("calendarEvent.updated", diffFields(previous, sanitized), id, sanitized.title)
  : args.logActivity?.("calendarEvent.updated", id, sanitized.title);
```

On create: `args.logActivity?.("calendarEvent.created", id, sanitized.title)`.

★ The `previous` row is read from the pre-update `events` array the handler already computed at
line 65, **not** from inside the functional updater. `capture` and `logActivity` both need the
before-image as a value, and reading it inside the updater would make the capture a side effect of
a React state computation.

★ `useChangeLog`'s vanished-row guard (`use-change-log.ts:53-58`, a toast when a concurrent writer
deleted the row mid-edit) is deliberately **not** copied. It needs `showToast` + `lang`, which this
hook does not take, and the map-replace no-op it guards is pre-existing behaviour this batch is not
chartered to change. Noted here so the divergence reads as a decision.

`handleDeleteCalendarEvent`:

```ts
const doomed = (calendarEvents ?? []).find((e) => e.id === id);
if (doomed) args.capture?.({ setter: setCalendarEvents, kind: "calendarEvent.deleted", removed: [doomed], fromArray: calendarEvents ?? [], name: doomed.title });
setCalendarEvents((prev) => (prev ?? []).filter((e) => e.id !== id));
if (doomed) args.logActivity?.("calendarEvent.deleted", id, doomed.title);
```

The stale block comment at `use-calendar-events.ts:15-18` and the inline one at `:84-86` both get
replaced — they currently assert the wiring does not exist.

### 1.4 ★ The file-size ratchet constrains the call site

`use-resource-planner.ts` is **1037** lines against a **1038** baseline. Any net line added fails
`npm run size:check`, and re-baselining upward again is precisely what follow-up item 4 objects to.

So line 392 is replaced one-for-one:

```ts
const calendarEventsApi = useCalendarEvents({ today, logActivity: args.logActivity, logActivityChanges: args.logActivityChanges, capture: args.capture, captureFieldEdit: args.captureFieldEdit });
```

Net **zero** lines. The repo has no max-line-length rule (`use-resource-planner.ts:381` is ~150
chars), so a long line is idiomatic here rather than a workaround.

All four values already exist on `UseResourcePlannerArgs` — `logActivity` (`:67`),
`logActivityChanges` (`:68`), `capture` (`:77`), `captureFieldEdit` (`:82`) — so nothing new
threads down from `task-manager.tsx`. This is why the whole item costs one line outside the hook.

★ No *other* file this batch touches is ratchet-constrained, which is worth stating so the
constraint isn't over-applied. `docs/baselines/file-sizes.json` holds exactly six entries
(`chat-panel.tsx` 974, `task-manager.tsx` 2974, `task-row.tsx` 813, `tasks-section.tsx` 1073,
`use-resource-planner.ts` 1038, `workspace-section.tsx` 966) and `use-resource-planner.ts` is the
only one in scope here. Everything else being edited is comfortably under the 800 `LIMIT`
(`calendar-event-modal.tsx` 444, `recurrence.ts` 348, `sanitize-entities.ts` 640,
`gantt-engine.ts` 685, `use-calendar-events.ts` 102, `field-groups.ts` 87), and both i18n
dictionaries are explicitly `EXEMPT` in `scripts/check-file-sizes.mjs:9` — so the new strings
carry no ratchet cost at all.

★ The hook passes `args.*` **directly**, not through the `logActivityRef`/`captureRef` indirection
the planner uses internally (`:132-143`). Those refs exist so the planner's own `useCallback`
handlers can omit the callbacks from their dep arrays; `useCalendarEvents` already depends on the
whole `args` object the way `useChangeLog` does (`use-change-log.ts:82`), so the refs would add
nothing.

### 1.5 The de-recurring warning

Undo makes the exception loss reversible, but not visible. A non-blocking hint in the editor closes
that without interrupting a legal save.

In `calendar-event-modal.tsx`, inside the `isVisible("repeat")` block, directly after the
`SegmentedControl` (`:250-262`) and before the `{repeating && (` branch (`:265`):

```tsx
{!repeating && (draft.exceptions?.length ?? 0) > 0 && (
  <FieldHint>{t(lang, "calendarEventExceptionsDiscarded", draft.exceptions?.length ?? 0)}</FieldHint>
)}
```

`FieldHint` is the existing shared primitive (`field-hint.tsx:25`, props `{children, className, as,
id}`, renders `<p className="text-xs text-muted-foreground">`) — not a hand-rolled `<p>`, and
deliberately not `ModalFieldError` (whose `role="alert"` + pink treatment is for a save that is
*refused*; this one is legal). Its default `as`/`className` need no override here, so the call is
just children.

The gate reads `draft.exceptions`, which is correct: the modal keeps the repeat controls in a
separate `recurrence` state (`:167` derives `repeating` from it), so the draft still carries the
original exceptions right up until submit, where the sanitizer drops them.

```
calendarEventExceptionsDiscarded: "Turning repeat off discards {0} adjusted occurrence(s); undo restores them."
calendarEventExceptionsDiscarded: "Das Ausschalten der Wiederholung verwirft {0} angepasste Termine; Rückgängig stellt sie wieder her."
```

DE carries `ä`/`ü` — same node-utf8 write path as 1.1.

---

## 2. Item 3 — empty `localModifiedAt` in two sanitizers

`sanitize-entities.ts:97-100` (`sanitizeAbsence`) and `:184-187` (`sanitizeShift`) keep the
`typeof raw.localModifiedAt === "string" ? raw.localModifiedAt : undefined` form, which preserves a
literal `""`. Every CSV/MD cell decodes to a real empty string, never `undefined`, so an absence or
shift loaded without a timestamp carries `localModifiedAt: ""`.

Both collapse to the form `calendar-event.ts:176` already uses:

```ts
localModifiedAt: sanitizeText(raw.localModifiedAt, 1024) || undefined,
```

`sanitizeText` is already imported in that file (used two lines below, at `:101`). Four lines become
one, twice — a net **-6** lines, which the size ratchet only ever welcomes.

No serialized-byte impact: both encode back to `""` either way, so the golden fixtures act as the
safety net rather than needing regeneration.

★ `calendar-event.ts:35`'s sibling fields are untouched — only these two sanitizers carry the bug.
The `sanitizeResource`/`sanitizeRole`/`sanitizeNamedRef`/budget-bucket forms (`:315`, `:383`,
`:396`, `:617`) already guard with `&& input.localModifiedAt`, which rejects `""` correctly.

---

## 3. Item 7 — duplicate `addDays`

`gantt-engine.ts:249` is a byte-identical copy of `calendar-window.ts:32` (`DAY_MS` vs
`MS_PER_DAY`, same arithmetic). Under jscpd's 50-token floor, so `dup:check` will never flag it.

`gantt-engine.ts` re-exports instead of redefining:

```ts
import { addDays } from "./calendar-window";
export { addDays };
```

Chosen over moving every caller because the import sites — `gantt-engine.ts:430`, `gantt.tsx:44`,
`gantt-chrome.tsx:16` — all keep importing `addDays` from `gantt-engine`, so no call site and no
test changes. `calendar-window.ts` is a leaf (its only dependency is its own `parseUtc`/`MS_PER_DAY`
and it imports nothing from gantt), so there is no cycle.

`calendar-window.ts:25-31`'s comment, which documents the duplicate as a deferred follow-up, is
rewritten to say gantt now consumes this one.

---

## 4. Item 9 — four small calendar fixes

### 4.1 `monthLabel` has no test

`resource-calendar.tsx:117` got the same `timeZone: "UTC"` fix as `weekdayLabel` (`:115`) but no
coverage. Folded into the existing `America/New_York` block in `resource-calendar.test.tsx` (which
already pins `process.env.TZ`): a window crossing a month boundary must render the UTC month name,
not the previous day's.

### 4.2 Escape during a resize announces "Move cancelled"

`resource-calendar.tsx:173` holds `justCancelled` as a bare boolean, so `:526` can only emit
`calendarMoveModeCancelled` — even though `:525` already distinguishes resize from move for the
mode-on announcement, and a `calendarResizeModeOn` string exists.

`justCancelled` becomes `useState<null | "move" | "resize">(null)`; the Escape branch (`:203-208`)
sets `pendingMove.kind`; `:526-527` picks the matching string. Truthiness at the two read sites is
preserved by `null` being the empty state, so the surrounding conditional shape is unchanged.

One new key:

```
calendarResizeModeCancelled: "Resize cancelled"
calendarResizeModeCancelled: "Größenänderung abgebrochen"
```

DE carries `ö` and `ß` — node-utf8 write.

### 4.3 Truncation banner cell claims to label its row

`resource-calendar-band.tsx:88` uses `role="rowheader"` on the full-width banner `<td>`.
`rowheader` asserts "this cell is the label for its row"; it labels nothing. `gridcell` is accurate.
The per-lane sticky first cell at `:107` keeps `rowheader` — that one genuinely does label its lane.

### 4.4 Narrow banner false-positive

`recurrence.ts:247` sets `truncated` whenever `MAX_ITERATIONS` trips. Generation always starts at
`seriesStart` and runs to `bufferEnd = windowEnd + GENERATION_BUFFER_DAYS` (`:275`), so a series
old enough to burn 20,000 candidates *after* passing `windowEnd` trips the flag while the visible
window is completely covered — the band then says "truncated" with nothing hidden.

A stop in that trailing buffer walk can only ever hide a **moved** occurrence, since an unmoved one
past `windowEnd` is excluded by the window test at `:263` anyway. So:

```ts
if (totalProcessed > MAX_ITERATIONS) {
  // A stop AFTER we walked past wEnd is inside the trailing buffer walk, whose
  // only purpose is finding occurrences MOVED back into the window — an unmoved
  // candidate out there is excluded by the window test below regardless. So it
  // is real truncation only when this event actually carries a move exception.
  if (candidate.getTime() <= wEndMs || hasMoveException) truncated = true;
  return "stop";
}
```

`hasMoveException` is computed once beside `exceptionsByDate` (`:235`), which is already built from
the same bounded list:

```ts
const hasMoveException = (event.exceptions ?? []).some((e) => e.kind === "move");
```

This narrows `truncated` only; it never newly sets it, so `nearestOccurrence`
(`:342-348`) and its documented `occurrence === undefined && truncated` contract get strictly more
accurate. The `MAX_OCCURRENCES` branch (`:265`) is untouched — that one fires on real overflow of
returned results and is the branch that routinely fires for ordinary series.

---

## 5. Item 10 — AGENTS.md's `A11Y_VIEWS` claim

AGENTS.md says the axe gate covers **13** named views and excludes chat/AI-Assistant. Both halves
are wrong: `e2e/a11y.spec.ts:24` lists **16**, and "AI Assistant" is among them.

Actual list: Dashboard · Open Points · Gantt · Resources · Budget · RAID · Settings · Stakeholders ·
Changes · Milestones · Reports · Activity · Time bookings · AI Assistant · Next actions · Insights.
5 schemes × 16 + 5 Kanban-board variants = **85** checks, which is what a passing run reports.

The correction keeps two things prominent, because they are what the count is load-bearing for:

- **Calendar is not in `A11Y_VIEWS`** (Resources defaults to the directory sub-tab). R5 shipped an
  AA contrast failure there — `text-ui-pink` on `bg-surface-muted`, 4.05:1 — that a full 85/85 pass
  said nothing about. Anything styled on the calendar surface needs contrast checked by hand.
- Projects and Knowledge genuinely are still excluded.

Docs-only. No code, no gate change.

---

## 6. Testing

Written before the fix in each case, and each one has a specific way it could pass vacuously — noted
where so it gets checked by watching it fail first.

**`use-calendar-events.test.tsx`**
- create logs `calendarEvent.created` with id + title; delete logs `calendarEvent.deleted` and calls
  `capture` with the doomed row in `removed`.
- update calls `captureFieldEdit` and `logActivityChanges`; a caller wiring only `logActivity` still
  records the update (the `useChangeLog` back-compat arm).
- ★ **the load-bearing one:** a recurring event with two exceptions, saved with `recurrence`
  removed, then undone, comes back with **both** exceptions in **one** undo step. This is the item's
  actual point, so it is asserted end-to-end rather than by inspecting the group constant.

**`undo/field-groups.test.ts`** — `CALENDAR_EVENT_UNDO_GROUPS` emits ONE entry when only
`startDate` changed, and one entry (not two) when `recurrence` and `exceptions` both changed.

**`sanitize.test.ts`** (or the absence/shift sanitizer file) — `sanitizeAbsence({..., localModifiedAt:
""})` no longer yields `""`; same for `sanitizeShift`. The assertion is
`expect(result.localModifiedAt).toBeUndefined()`, and it is discriminating precisely because the
fixture passes an explicit `""`: old code returns that `""`, which is not `undefined`, so the test
fails against it.

★ **Corrected during implementation.** This section originally demanded
`expect("localModifiedAt" in result).toBe(false)` on the theory that `toBeUndefined()` would be
vacuous. That was wrong twice over: an object-literal `x: undefined` still *creates* the key, so the
`in` assertion cannot pass even with the fix applied (it forced a needless reshape of the production
object before this was caught); and the vacuity concern only applies to a fixture that omits the
field, which ours does not. Item 3 was missed to date because existing fixtures always populate the
field — but that is an argument for the fixture passing `""` explicitly, not for a stricter assertion.

**`recurrence.test.ts`** — both 4.4 branches: a stop before `windowEnd` still reports `truncated`;
a stop in the buffer walk on an event with no move exceptions reports `false`; the same event WITH a
move exception reports `true`.

**`resource-calendar.test.tsx`** — `monthLabel` under `America/New_York` (4.1); Escape from a resize
announces the resize string, Escape from a move still announces the move string (4.2).

**`resource-calendar-band.test.tsx`** — the truncation banner cell resolves `role="gridcell"` (4.3).

**Gates:** `npx tsc --noEmit` (EN/DE key parity — three new activity keys, two new UI keys),
`npm run test:run`, `npm run lint` (`--max-warnings=0`), `npm run size:check` (the constraint in
1.4), `npm run dup:check`, and axe on a **fresh** `PORT=3100` server for the 4.3 role change —
Resources is in `A11Y_VIEWS`, but the band lives on the Calendar sub-tab which is not, so the run
confirms no regression rather than proving the band correct. The band change is eye-verified.

---

## 7. Release chores

- `src/app/version.ts` — `APP_VERSION` → `"0.202.1"`, `APP_BUILD_DATE` → build date.
  `APP_MILESTONE` stays `"Beukes"`; no new codename on a patch, so no `versionHighlight*` key and
  no `APP_HIGHLIGHT_KEYS` edit.
- `CHANGELOG.md` — a 0.202.1 entry: meetings now appear in the activity log and support undo/redo,
  the de-recurring hint, and the four calendar fixes. The two sanitizer one-liners and the `addDays`
  consolidation are internal; they get one line between them, not three.
- `AGENTS.md` — the `A11Y_VIEWS` correction (§5), plus a line on the `use-calendar-events.ts` hook
  now carrying activity/undo like every sibling (its "no wiring yet" state is currently documented
  as deliberate).
- `docs/superpowers/r5-calendar-followups.md` — items 1, 3, 7, 9 and 10 struck, with the remaining
  five renumbered or left in place and the header note updated. Items 2, 4, 5, 6, 8 stay.

## 8. Out of scope

Items 2, 4, 5, 6, 8, and the still-owed R4 `optimize_wbs` (roadmap 4.3b) are untouched. Item 4 in
particular is *made harder to ignore* by this batch, not addressed: 1.4 deliberately spends a long
line to avoid re-baselining `use-resource-planner.ts` a second time, which leaves the 30%-over-ceiling
problem exactly where item 4 describes it.
