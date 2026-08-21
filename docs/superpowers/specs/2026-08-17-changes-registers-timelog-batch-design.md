# Changes register, task row, chat sidebar, Timelog re-apply — design

**Date:** 2026-08-17
**Slice:** one batch, one version bump (six items)
**Branch:** `feat/changes-registers-timelog-batch`

> Every code symbol named here was verified against the tree at branch point
> (`origin/main` = 0.243.0 "Aaronovitch"). Claims carry the command that
> reproduces them. Deliberately **no `path:LINE` citations** — a line number
> rots on the next insertion and cannot be re-verified at a glance.

---

## Goal

Six independent user-reported items, batched into one slice:

| # | Item | Size |
|---|---|---|
| 1 | Changes register: change status inline, like Open Points | S |
| 2 | Changes register: note log, like Open Points / RAID | **L** |
| 3 | Open Points table: surface "Send inquiry" as a row button, like RAID | S |
| 4 | AI Assistant: drag-resize the chat thread sidebar | S |
| 5 | Timelog: re-fetch + re-apply after bucket staffing changes | M |
| 6 | Timelog: gate the Time bookings page behind "Configure Timelog" | S |

Item 2 is a persisted-schema change and carries the slice's risk. It gets its
own commits and its own review pass so it is not reviewed as a footnote to five
UI changes.

---

## Item 1 — Changes: inline status select

### What exists

`applyChangeStatus(item, status, today)` already lives in `use-change-log.ts`,
pure and exported. It is the sole writer of the `decisionDate` invariant:
auto-fills the date the first time an item leaves the pending set, and deletes
it if the item returns to pending. `change-panel.tsx` currently renders the
status as static text via its local `statusLabel`.

`task-status-select.tsx` is the template — a shared inline `<select>` used by
both the table row and the Kanban card, holding the row-unique accessible name
in one place.

### Design

New `change-status-select.tsx`, mirroring `TaskStatusSelect`:

- options from `CHANGE_STATUSES`, labels from the existing `statusLabel`
  (moved out of `change-panel.tsx` into the new module so both consumers share
  one labeller)
- `aria-label={`${t(lang, "changeFieldStatus")} – ${item.title}`}` — row-unique
- `FOCUS_RING` + `TRANSITION`, matching every other inline control

`use-change-log.ts` gains `onStatusChange(id, next)`:

- functional setter (`setChanges(prev => …)`) — the bulk-edit "N saves in one
  tick" rule
- routes through `applyChangeStatus`, never writing `status` directly
- `captureFieldEdit` for undo, matching the modal save path

The row cell in `change-panel.tsx` replaces its static label with the select.

No new undo work is needed: `CHANGE_UNDO_GROUPS` is already
`[["status", "decisionDate"]]`, so the pair is captured as one entry and a
single undo restores both fields together. Verified with
`sed -n '80,86p' src/app/undo/field-groups.ts`.

### Consequences to accept

Changing status inline now writes a **second field** (`decisionDate`) as a side
effect. This is correct and identical to what the modal already does — but a
one-click control mutating a date the user cannot see is worth stating. The
modal renders `decisionDate` read-only, so the value is discoverable there.

### Testing

- `applyChangeStatus` already has coverage; extend for the inline entry point.
- **A unit test rendering ≥2 change rows**, asserting the two selects carry
  different accessible names. The axe gate provably cannot catch a duplicate
  accessible name at any seed size (measured against axe-core 4.12.1: of its
  105 rules, the 69 carrying the four tags `e2e/a11y.spec.ts` requests, none
  flags two controls sharing a name). A unit test is the only possible
  detector.
- Changes **is** in `A11Y_VIEWS`, so run the scan before pushing.

---

## Item 2 — Changes: note log

### What exists

The whole note-log model is reusable as-is: `note-log.ts` exports `addNote` /
`editNote` / `deleteNote` (immutable), `sanitizeNoteLog`, `canEditNote`,
`nextNoteId`, and the `encodeNoteLog` / `decodeNoteLog` JSON-in-cell pair the
text backends use. The UI is a single shared floating window (`notes-window.tsx`)
plus `notes-badge-button.tsx` on the row and `note-log-panel.tsx` in the editor.
`use-notes-window.ts` is the deps-object glue hook, today typed for exactly two
entities.

### Design

`ChangeItem` gains `noteLog?: NoteLogEntry[]` in `types.ts`.

**Persistence — the six write paths.**

| Path | Work |
|---|---|
| CSV | add `noteLog` to `CHANGES_CSV_COLUMNS`; `encodeNoteLog` in `changeFieldToString`, `decodeNoteLog` in `buildChangeFromObj` |
| Turso single | derives from `CHANGES_CSV_COLUMNS` — free |
| Turso tenant | derives from `CHANGES_CSV_COLUMNS` — free |
| Markdown | add to `CHANGES_MD_COLUMNS` + the change table codec in `markdown-codecs-core.ts` |
| JSON | **see the landmine below** — not free |
| IndexedDB | `browser-backend.ts` already maps changes through `sanitizeChangeRichFields` — free |

Both text backends mirror what RAID and tasks already do in
`csv-codecs-core.ts`; reproduce the existing pattern with
`grep -n "encodeNoteLog\|decodeNoteLog" src/app/csv-codecs-core.ts`.

Existing Turso DBs self-heal: `turso-migrate.ts` PRAGMA-diffs and issues
`ALTER TABLE … ADD COLUMN` inside the write lock before save.

Goldens regenerate — a legitimate new-column format change, not a masked diff.

**UI.**

- `notes-badge-button.tsx` on the change row (row-unique name), mirroring
  RAID's row badge
- "Notes (N)" button in `change-edit-modal.tsx`
- `use-notes-window.ts` widens from `{tasks, raid}` to `{tasks, raid, changes}`:
  `NotesWindowDeps` gains `changes` + `setChanges`, `notesTarget`'s `kind`
  union gains `"change"`, and the hook returns `openChangeNotes`.
  `notePanelPropsFor` takes the widened kind. The window itself is owned in
  `task-manager.tsx` and gated on `!isPopout`, unchanged.

### Landmine A — JSON load drops the log

`sanitizeRichFields` (the shared body behind all four per-entity normalizers)
already handles `noteLog` unconditionally — it has an
`if (Array.isArray(entity.noteLog))` arm independent of the field list. So
`sanitizeChangeRichFields` picks up the new field **for free**, and its docblock
comment "(no noteLog)" becomes wrong and must be corrected.

That is not the whole story. In `workspace.ts`, the change branch of
`jsonToWorkspace` runs `sanitizeChangeItem` **before** `sanitizeChangeRichFields`.
`sanitizeChangeItem` builds its output from an explicit field list and is
DOM-free by contract, so it cannot carry `noteLog` — the log is already gone by
the time the rich pass runs.

RAID does not have this problem because its JSON branch never calls
`sanitizeRaidItem` at all; it maps through `sanitizeRaidRichFields` alone. Tasks
likewise (`migrateTask` then `sanitizeNoteFields`). Changes and milestones are
the two branches that *do* call their entity sanitizer, so the RAID shape cannot
simply be copied.

**Fix:** re-attach the stored log after `sanitizeChangeItem`, before the rich
pass — the same shape as the dispatcher fix in Landmine C. Do **not** "fix" it
by teaching `sanitizeChangeItem` to pass `noteLog` through: that would leave an
unsanitized array live for every caller that is *not* followed by a rich pass,
and the dispatcher is exactly such a caller.

Reproduce the asymmetry:
`grep -n "sanitizeChangeItem\|sanitizeChangeRichFields\|sanitizeRaidRichFields" src/app/workspace.ts`

### Landmine B — the editor snapshot clobbers the log

`change-panel.tsx` seeds a `useState<ChangeItem | null>` draft with a full-row
snapshot at edit-open, and the save is a full row **replace**. The notes window
is owned above the panel and commits write-through to the live `changes` array
the snapshot never sees. So: open editor → add a note → Save destroys it.

This is the RAID §48 shape exactly, and **the task fix would make it worse
here.** Tasks fix it by omitting `noteLog` from the payload, which works only
because the task save merges. A change save replaces, so a payload without
`noteLog` *erases* it outright.

**Fix (RAID's):** in `use-change-log.ts`, build the saved row taking `noteLog`
from the **stored** row (`previous`), never from the payload.

It must land on the `withStamp` value, not inside `setChanges`. `CHANGE_UNDO_GROUPS`
is non-empty (unlike `RAID_UNDO_GROUPS`, which is `[]`), so changes are grouped
rather than emitting one capture per changed key — but a stale `noteLog` in the
diffed row still becomes undoable/redoable state, and `NEVER_CAPTURE` covers
only `{id, localModifiedAt}`.

### Landmine C — AI edits wipe the log

`use-chat-dispatcher.ts` `updateChange` sanitizes a **stored** row. Once
`sanitizeChangeItem` is the thing that drops `noteLog`, every AI edit to a
change silently erases its notes — and AI writes have no undo. This is the RAID
§49 defect, one entity over.

**Fix:** re-apply the stored log after sanitizing, mirroring what `updateRaid`
already does.

Sweep for other callers **on the bare name**, not on `sanitizeChangeItem(`: a
sanitizer passed by reference into a `.map` or a `buildList` callback does not
match a call-shaped grep. This exact trap under-counted the RAID sweep.

```
grep -rn "sanitizeChangeItem" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```

### Testing

- `entity-persistence-registry.test.ts` row for change `noteLog` — and count to
  six by hand rather than trusting the file's name; it exercises different
  widths per slice.
- Round-trip tests per backend, including the JSON path specifically (the one
  that would have shipped broken).
- A test that saves a change from the editor **while a note was added
  mid-edit** — the collision must be seeded explicitly, since a save against an
  untouched log passes either way.
- A test that an AI `update_change` preserves an existing log.
- Golden fixtures regenerate.

---

## Item 3 — Promote "Send inquiry" to a row button

### What exists

Task rows **already have** Send inquiry — inside the `⋮` overflow menu in
`task-row.tsx`, gated on `showSendInquiry` (`!isTaskClosed(task)`). The handler
chain is complete: `use-task-row-handlers.ts` → `tasks-section.tsx` →
`task-row.tsx`. A comment in `task-row.tsx` states that all row verbs live in
the overflow menu by design.

RAID renders the same verb as a visible inline button with a row-unique name,
gated on `isRaidActiveForReview`.

### Design

Render the inline button in the task row's action cell beside `⋮`, mirroring
`raid-panel-rows.tsx`: same gate, same row-unique name
(`${t(lang, "sendInquiry")} – ${task.taskName}`), same handler.

**Remove it from the `⋮` menu.** Keeping both would place two controls with an
identical accessible name in a single row — the WCAG 2.4.6 defect the axe gate
cannot see. One verb, one control.

Update the "all row verbs live in `⋮`" comment, which this change contradicts.
No AGENTS.md bullet asserts that convention (verified:
`grep -n "overflow menu" AGENTS.md` returns nothing), so no doc correction is
owed there.

### Scope decision

Table row only. The Kanban card is **out of scope** — it renders outside
`RowContextProvider`, so any control it hosts must take props rather than
context, and widening this item to the board doubles its surface for no stated
need.

### Testing

- Row-unique name assertion across ≥2 rows.
- The button is absent for a closed task (`isTaskClosed`).
- The button is absent when `onSendInquiry` is not threaded (popout).
- Open Points **is** in `A11Y_VIEWS` — run the scan.

---

## Item 4 — Drag-resize the chat thread sidebar

### What exists

`chat-thread-sidebar.tsx` is a 62-line pure presentational leaf with a hardcoded
`w-56`. `useResizable(storageKey)` is the established primitive — native CSS
`resize` plus a corner-drag watcher that persists `{width, height}` to
localStorage and returns `reset()`. It already backs the change, projects, RACI,
stakeholders, timelog and documents panes.

### Design

- sidebar container gets `resize-x overflow-auto` plus min/max width classes so
  the drag is bounded and the class-based default still applies before first use
- `useResizable("aipm-cockpit:chat-sidebar-size")`
- a `ResetSizeButton` so the size is recoverable

No hand-rolled drag handler. The primitive covers this.

### Known risks

**The inner scroll may break.** The sidebar is a flex column whose thread list
relies on `min-h-0 flex-1` to scroll. Adding `overflow-auto` to the parent can
take that scroll over. jsdom has no layout, so **no unit test can see this** —
it must be verified in a real browser.

**Not keyboard-operable.** Native CSS resize offers no keyboard affordance. This
is true of all existing panes using the primitive, so the change is consistent
rather than newly deficient — but it is a gap, and it is recorded here rather
than discovered later.

**Never scanned.** The sidebar mounts only under Turso, and `e2e/seed.ts` seeds
file mode, so the axe gate renders this surface in no run. Unit tests are the
only automated coverage this will ever have.

### Testing

- Unit: the storage key is read on mount and `reset()` clears it.
- Manual, in a browser: drag the edge, reload, confirm the width persists;
  confirm the thread list still scrolls independently.

---

## Item 5 — Timelog re-fetch and re-apply

### What was actually reported

Bookings were fetched and applied. Resources were then added to a budget bucket.
The Apply button was **disabled** — "no new time bookings to apply".

### What the code says

Apply does **not** consume the overlay. `applyActualsToBuckets` recomputes from
scratch, and `buildApplyPlan` re-routes every bucket against **live** budgets on
every render; the Apply button is gated on `applyDiff.length === 0`. The
aggregates survive a remount — `useTimelogSync` seeds its state from a
per-project localStorage cache.

So a disabled Apply after fixing the bucket means the overlay held **no hours
for those people at all**. Three candidate causes, needing three different fixes:

1. their bookings were never fetched (the fetch is scoped to the *ticked*
   people, to stay under the rate limit)
2. the person is not linked to a TimeLog user, so they never reach `byResource`
3. the hours landed in `unattributed` because no project→bucket link exists

**Task 1 of this item is a repro against the user's data, not code.** Writing a
fix before knowing which of the three it is would be a guess.

### Design

Two parts, both requested.

**(a) "Refresh & re-apply" action** on the Timelog toolbar. Re-pulls the same
window (`fetchWindow()` — project start date, or 90 days back, through today),
then opens the **existing** confirm dialog with the fresh diff.

This deliberately adds no new write path to money figures. All of it is reused:
the frozen `pendingApply` overlay snapshot, the frozen `pendingBudgets`
baseline, and the stale-baseline refusal that aborts with `timelogApplyStale`
when `ws.budgets` drifted between confirm-open and Apply.

The action's guard must mirror its button's `disabled` predicate **exactly**,
and belongs in `timelog-guards.ts` beside `canRefreshBookings` /
`canLoadManagedProjects`. That file records four separate instances of a
handler guard drifting from its button's predicate; a fifth is not wanted.

**(b) Passive notice on the Budget panel.** This is where the user was standing
when the problem was invisible.

The actuals cache is per-project localStorage, so the Budget panel can read it
directly and run `buildApplyPlan` against live buckets — a pure computation, no
network, and **no lifting of `useTimelogSync` out of the Timelog panel**. When
the plan is non-empty it renders a line: *N buckets have booked hours not yet
applied* → deep-link to Time bookings.

Read-only. The notice never writes; applying stays behind the confirm dialog.

### Testing

- Repro first; record the root cause in the plan before writing item 5 code.
- `timelog-guards.ts`: the new predicate, plus the existing pattern of asserting
  handler and button agree.
- Budget notice: non-empty plan renders the line; empty plan renders nothing;
  a **missing or malformed cache renders nothing and does not throw**.
- The confirm dialog's existing itemisation is unchanged — assert that.

---

## Item 6 — Gate the Time bookings page

### What exists

`isMisconfigured` is `!cfg.enabled || !cfg.host || !cfg.apiToken`. Today the
panel renders in full with a one-line `timelogEnable` hint and the network
actions disabled.

The AI Assistant pattern to mirror: `chat-panel.tsx` renders a
`chatConfigureAi` button in its empty state when the key is missing and an
`onConfigureAi` deep-link is threaded.

### The constraint that shapes this

`canClearAllFetched` in `timelog-guards.ts` **deliberately** omits
`isMisconfigured`, and its docblock says why: the cache is local data the user
already has, broken credentials are exactly when someone wants to clear stale
bookings, and gating it would trap them with data they can neither refresh nor
remove. Every other action reaches the network; this one only forgets.

Hiding the page outright would re-create precisely that trap.

### Design

When `isMisconfigured`:

- replace the panel body with a "Configure Timelog" empty state — explanatory
  line plus a button deep-linking to Settings → Timelog, mirroring the AI
  Assistant's shape
- **escape hatch:** if a cached fetch exists (`fetchedAt` set), the empty state
  additionally states that cached bookings are present and renders Clear-all

The guard's own type does not carry `isMisconfigured`, so adding it there would
be a typecheck error rather than a silent behaviour change. That property is
preserved — this item does not touch `TimelogClearState`.

New EN/DE i18n pair for the empty-state copy. DE must use real umlauts; patch
`i18n.de.ts` via a node UTF-8 write, matching `\r\n`, never the Edit tool.

### Testing

- Misconfigured + no cache → empty state, Configure button, no Clear-all.
- Misconfigured + cache present → empty state **and** a working Clear-all.
- Configured → panel renders as today (byte-identical assertions where cheap).
- Time bookings **is** in `A11Y_VIEWS`; the new empty state is scanned, so the
  button needs an accessible name.

---

## Cross-cutting

**Version bump — eight sites, none gated.** `src/app/version.ts` (`APP_VERSION`,
`APP_BUILD_DATE`, `APP_MILESTONE`), `CHANGELOG.md`, `package.json`,
`package-lock.json` (**two** occurrences — root `version` and `packages[""]`),
the README shields badge (version **and** codename), and the generated header on
all five `docs/CODEMAPS/*.md`. Any new `versionHighlight*` key goes in EN, DE
**and** `APP_HIGHLIGHT_KEYS`.

`ai-recall-b2b-actor-waldrop` is also unmerged and also claims the next version.
Whichever branch lands second renumbers across all eight sites and re-derives
its open-followups numbers.

**Gates.** Full local battery before pushing: `npx tsc --noEmit` (after every
test edit), `npm run test:run`, `npm run test:shuffle`, `npm run lint` via
`npx eslint --max-warnings=0 src/app` (the npm script has no `--max-warnings`
and exits 0 on warnings), `npm run size:check`, `npm run dup:check`,
`npm run docs:symbols:check`, `npm run docs:claims:check`.

Never read a gate's exit code through a pipe — redirect, check unpiped, then
read the file.

**axe.** Changes, Open Points and Time bookings are all in `A11Y_VIEWS`. Run
`npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "…"`
against a warm server. `--workers=1` is mandatory when matching more than one
view: CI runs axe serially and local runs it at CPU count, and over-subscription
produces `Test timeout` failures that name no rule and are not violations.

**Manual verification owed** (no test in the repo can cover these):

- item 4: sidebar drag persists, and the thread list still scrolls
- item 5: the repro, before any code

---

## Out of scope

- Kanban card "Send inquiry" (item 3 is table-only)
- Note logs on milestones or stakeholders
- Keyboard-operable pane resizing (a pre-existing gap across all eight panes
  using `useResizable`; fixing it belongs in the primitive, not here)
- Any change to `TimelogClearState` or to which actions `isMisconfigured` gates
- Root-causing `unattributed` bookings beyond what item 5's repro establishes
