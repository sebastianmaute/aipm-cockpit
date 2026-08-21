# UI batch — undo history, AI cancel, budget people rows, dependency direction

**Date:** 2026-08-07
**Status:** approved design, not yet planned
**Baseline:** `main` @ `4dd13660`, app 0.220.0 "Kuttner"

Twelve requested UI changes, cut into three slices. Each slice is its own branch and its
own release. Slice 1 runs first because it establishes the button-conversion pattern and
the inventory that slice 2's settings sweep then follows; the slices are otherwise
file-disjoint and could be reordered.

| Slice | Contents |
|---|---|
| **S1 — primitives & polish** | Gantt weekday labels · milestone achieved toggle · Insights + budget-bucket buttons → shared `Button` · repo-wide hand-rolled-element + glyph→heroicon inventory + open-followups entry |
| **S2 — settings & tooltips** | AI-assistant sub-rail (Operating guides · Views · Scheduled jobs) · Views as a plain list · "This project" → "Overrides" · app-wide tooltip audit + approved additions |
| **S3 — four features** | Undo/redo multi-step dropdown · AI-trigger cancel · budget bucket people rows · dependency search + successor toggle |

Conventions below follow `AGENTS.md`: **★** non-obvious, **★★** has caused a bug.

---

## Slice 1 — primitives & polish

### 1.1 Gantt weekday labels

Day columns are `DAY_WIDTH_PX = 28` and today show only `fmtDay(d)` — the day-of-month
number (`gantt-engine.ts:337`, rendered at `gantt-chrome.tsx:307`).

Add a pure `fmtWeekdayShort(d, lang)` to `gantt-engine.ts` using
`Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" })`.

★ `timeZone: "UTC"` is load-bearing. Every date in this module is UTC-built and read
with `getUTCDay()` / `getUTCDate()`; formatting without the option uses the host zone and
shifts the label by one day for any user west of Greenwich. A test must pin one date under
a non-UTC `TZ`.

The day cell becomes two lines: the number at `text-[10px]`, the weekday beneath at
`text-[9px] text-muted-foreground`. `HEADER_ROW_HEIGHT_PX` and `HEADER_HEIGHT_PX` both grow
to fit; every chart offset derives from those constants, so both must move together.

- Gantt is in `A11Y_VIEWS`, so the axe gate covers the new text's contrast.
- The visual-regression specs (`npm run e2e:visual`) need re-baselining in the same commit.
- ★ jsdom has no layout — no unit test can prove the two lines fit 28px. Verify in Chromium.

### 1.2 Milestone achieved toggle

Two sites replace a bare `<input type="checkbox">` with the shared `ToggleButton`:

- `milestones-panel.tsx:505` (table row)
- `milestone-edit-modal.tsx:233` (modal field)

Label pinned to `milestoneAchieved` ("Achieved"), `pressed` = `!!achievedDate`. The
primitive's built-in check marker is the status indicator; the panel's existing Status
column (`✓ achieved` / `⚠ at-risk` / planned) is unchanged.

★★ The panel row needs a row-**unique** accessible name — `` `${t(lang,"milestoneAchieved")} – ${m.name}` ``.
Milestones is axe-scanned, and N identical "Achieved" names is a WCAG 2.4.6 failure that
the gate passes whenever the e2e seed renders a single row.

The modal's `linkedTasks` checkboxes stay checkboxes — a multi-select list of tasks is not
a binary toggle.

### 1.3 Insights and budget-bucket buttons

Target look is the Open Points "Hide finished" chip. That control is a `ToggleButton`, but
these are one-shot actions with no on/off state, so they use the shared `Button` primitive's
matching bordered variant instead: `variant="secondary" size="xs"`
(`border border-line bg-surface text-foreground hover:bg-surface-muted`, plus the shared
`INTERACTIVE` focus/motion atom).

★ Not `ToggleButton`: it announces `aria-pressed`, which is false on a control that performs
an action rather than holding a state (WCAG 4.1.2).

Converted:

- `insights-panel.tsx` — the four `variant="ghost"` buttons (Open · Acknowledge · Act · Dismiss)
  become `variant="secondary"`. Their existing row-unique `aria-label`s stay.
- `budget-panel.tsx` — four hand-rolled `<button>`s: `budgetEditBucket`, `budgetClose`/`budgetReopen`,
  `budgetRemoveBucket`, and the FX-refresh button (which keeps its `ArrowPathIcon` and its
  `animate-spin` while loading).

The bucket drag handle in `budget-panel.tsx` stays hand-rolled — it is a drag affordance with
its own keyboard reorder handling, not a button.

### 1.4 Repo-wide hand-rolled UI and glyph inventory

Measured 2026-08-07: **345** `<button` occurrences across **152** non-test `.tsx` files under
`src/app` (reproduce with
`grep -rho "<button" src/app --include=*.tsx --exclude="*.test.tsx" | wc -l`
and `grep -rl "<button" src/app --include=*.tsx | grep -v "\.test\.tsx" | wc -l`).
Densest files: `task-row.tsx` (11), `resource-directory.tsx` (10), `raid-panel-rows.tsx` (10),
`change-panel.tsx` (8).

A blanket migration is out of scope — many are correctly hand-rolled (drag handles, sortable
table headers, chips, popover triggers) and the densest files are axe-scanned table surfaces.

The audit is **not** limited to buttons. It covers all of `src/app` in two parts:

**Part 1 — hand-rolled elements.** Any markup reimplementing a shared primitive:
`<button>`, `<input>` / `<select>` / `<textarea>` outside `form-controls.tsx`, hand-rolled
modals, popovers, badges, cards, empty states, tooltips and tables. Measured against the
primitive set — `button` · `icon-button` · `toggle-button` · `form-controls` · `modal` ·
`modal-header` · `edit-modal-chrome` · `popover-panel` · `combobox-shared` · `badge` ·
`banner` · `card` · `dot` · `drag-handle` · `empty-state` · `add-first-item-button` ·
`info-tooltip` · `data-table` · `report-table` · `pane-toolbar` · `clearable-search-input` ·
`filter-multiselect`. Tags: *convertible* / *IconButton candidate* / *correctly hand-rolled* /
*converted*.

**Part 2 — glyph → heroicon candidates.** Literal Unicode glyphs used as icons where a
heroicon exists. Measured 2026-08-07 on non-comment lines: `✕` 47 · `×` 75 · `•` 21 ·
`✓` 17 · `▲` 17 · `▼` 17 · `↑` 12 · `⚠` 9 · `⋮` 9 · `↓` 9 · `▸` 4 · `▾` 3 · `🗒` 2.
Tags: *replace* / *keep — semantic text* / *keep — not an icon*.

★★ A glyph is only *replace* if no test reads it. Sortable headers deliberately keep
`↑`/`↓` in `textContent` and existing assertions read it (`report-table.test.tsx`,
`calendar-series-list.test.tsx` are the known cases) — swapping those for an SVG breaks
tests and deletes a cue that was doing real work.

★★ Most `×` hits are multiplication in prose or code, not a close glyph. Separating those
is the bulk of the manual triage.

★ A glyph inside an accessible name is not decorative. Heroicons default `aria-hidden`, so
replacing a name-bearing glyph silently removes it from the a11y tree — and can create a
WCAG 2.4.6 duplicate if it was what distinguished two controls.

Deliverable: `docs/handrolled-ui-inventory.md`, one line of reason per row including the
*keep* rows, plus a new numbered entry in `docs/open-followups.md` pointing at it so the
remainder is a ratchet rather than a rediscovery.

★ The inventory's counts must carry their reproduce commands — an unattached count in this
repo's docs is the single most-rotted kind of claim.

★ Audit only. Nothing outside §1.3's panes is changed in this slice; producing the list and
acting on it are separate jobs.

---

## Slice 2 — settings & tooltips

### 2.1 AI-assistant sub-rail

`settings-view.tsx` holds a flat `RAIL` of 16 `{ id, labelKey }` entries. It becomes two
levels: entries gain an optional `parent?: SectionId`. Under `ai`:

- `aiGuides` — Operating guides
- `aiViews` — Views
- `scheduledJobs` — moved down from top level

Children render indented and only while their parent is the expanded branch; selecting a
child selects it directly. `SectionId` grows by two ids (`aiGuides`, `aiViews`);
`scheduledJobs` already exists and only changes position.

★ `requestSection` deep-links keep working unchanged — a child id is just another
`SectionId`, so the existing nonce/consume protocol is untouched.

### 2.2 Content moves out of `ai-section.tsx`

`settings-sections/ai-section.tsx` is **782** lines against the 800-line ratchet, and the
gate counts `wc -l` **+1**, so real headroom is 17 lines. The move is what buys room back:

- Operating guides block (from ~line 601) → `settings-sections/ai-guides-section.tsx`
- `AiViewScopeDisclosure` mount → `settings-sections/ai-views-section.tsx`

### 2.3 Views as a plain list

`settings-sections/ai-view-scope-disclosure.tsx` drops `ToggleButton`, the `open` Set, and
the `panelId` / `aria-controls` plumbing. Each view renders as an `<li>` with its nav label
as a heading and `purpose` / `reading` / `toolHints` always visible, plus the existing
`aiViewScopeDigest` line where `VIEW_AI_DIGEST[view]` is set.

Section heading becomes a new `aiViewsTitle` — EN "Views", DE "Ansichten". `aiViewScopeIntro`
stays as the intro paragraph. The old `aiViewScopeTitle` string is no longer rendered by this
component; remove it only if nothing else references it, and in the same commit as the change.

Accepted trade: 17 views expanded is a long scroll rather than a click. That was the ask.

### 2.4 Rename "This project" → "Overrides"

`i18n.ts:3327` `settingsProjectOverrides` — EN "This project" → "Overrides"; DE →
"Überschreibungen".

★★ `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts there (and curls double quotes).
Patch via a node utf8 write whose anchor matches `\r\n`, then re-verify the bytes. The
`i18n-encoding` test bans ASCII substitutions, so "Ueberschreibungen" is a failing gate, not
a workaround.

### 2.5 Buttons and hover in the AI section

`ai-section.tsx` holds 7 hand-rolled `<button>`s — the ones reported as having no mouseover.
They convert to the shared `Button`, which supplies `hover:bg-surface-muted` and the
`INTERACTIVE` focus/motion atom.

### 2.6 Tooltip audit

App-wide sweep of every icon-only button and every control whose visible label does not name
the consequence of pressing it.

Delivered first as a proposal table — *control · file · surface · proposed EN text* — appended
to this spec. Nothing is implemented until the rows are approved; approved rows then get EN+DE
strings plus a `title` (or an `InfoTooltip` beside the control where it already has a visible
label).

★ `title` is hover-only: no keyboard focus, unreachable on touch. It is a mouse and
screen-reader disclosure, never the fix for a control that lacks an accessible name — that
needs `aria-label` or a `<label>`.

---

## Slice 3 — the four features

### 3.1 Undo / redo multi-step dropdown

Today the caret previews only the label of the next entry (`undo/undo-control.tsx`). It becomes
an MS-Office style history: clicking entry *n* undoes entries 1..*n* in order, newest first.
Redo is symmetric.

**Engine.** `undo/undo-stack.ts` gains a pure `takeThrough(stack, id)` → `{ entries, rest }`,
`entries` ordered newest-first, `rest` the remainder. Returns `null` when the id is absent.

**Hook.** `useUndoStack` gains `undoThrough(id)` and `redoThrough(id)`. Each runs every entry's
runner **synchronously in LIFO order**, collects the returned inverse runners, then commits
**one** `setStack`, **one** `setRedoStack`, one toast, and one activity-log entry carrying the
summed count.

★★ This cannot be a loop over the existing `undo()`. `stackRef` is refreshed by an effect, so N
calls in one tick all read the same stale stack and undo the top entry N times. The runners must
be executed against a locally-threaded list, and the state committed once at the end.

★ A through-undo of a strict prefix leaves the redo stack coherent, so it pushes redo entries
normally — unlike the existing out-of-order `undoById`, which clears redo. `undoById` stays as
it is; it backs the toast "Undo" action and is not replaced.

**UI.** The `PopoverPanel` body becomes a `listbox`:

- Every entry on the stack (cap is `UNDO_CAP = 25`), scroll-capped at roughly 10 rows.
- Hovering or focusing row *n* highlights rows 1..*n*; a footer reads "Undo N actions".
- Arrow keys move the active option, Enter commits, Escape closes. One tab stop via
  `aria-activedescendant`.

★★ The top bar is axe-scanned in every view, and `buildUndoLabel` can legitimately produce two
identical labels (two edits to the same named row). Each option's accessible name appends its
stack position so names stay unique — a WCAG 2.4.6 duplicate the gate would otherwise pass.

★ The highlight-through band is a visual grouping, not a selection: `aria-selected` belongs to
the active option only, and the footer count is the text that actually tells a screen-reader
user how many entries the Enter will revert.

### 3.2 Cancellable AI triggers

All the AI trigger hooks already hold an `AbortController` and already treat `AbortError` as a
user-initiated stop rather than an error (`use-raci-suggest.tsx:131`, `use-alloc-plan.tsx:86`,
`use-tasks-dedup.tsx:82`). The missing piece is only the affordance.

New `ai-trigger-button.tsx`: while the feature is busy, the trigger's visible label **and**
accessible name both become "Stop" with a stop icon, and clicking aborts.

★ The label must flip with the action, not stay "Asking Claude…". A control whose visible text
names something other than what a click does is WCAG 2.5.3 (F96) — the same trap
`use-raci-suggest.tsx` already documents for its own thinking label.

Wired into: `use-raci-suggest`, `use-alloc-plan`, `use-tasks-dedup`, `inline-ai-edit-popover`,
the insight-recommendation runner (`use-insight-recommend-runner`), and the Analyze-with-AI
trigger in `use-ai-orchestration`.

★ Each of those six catch paths must be **read** to confirm it classifies `AbortError` as a stop
and returns to idle without a toast. RACI does. The others are unverified — check, do not assume.

### 3.3 Budget bucket people rows

Each role line in a bucket expands to the people behind it, showing their Timelog bookings
against their planned capacity. Collapsed by default.

**Data already exists.** `BucketAllocation.resourceIds` gives the planned members;
`ActualsByBucket[bucketId][periodKey].byResource` (`timelog-actuals.ts`) gives booked hours per
resource per period. Planned capacity comes from the same source the planning table uses
(`resource-capacity.ts`).

**Engine.** New pure, i18n-free `budget-bucket-people.ts`:

```
buildBucketPeopleRows({ allocation, resources, actualsByPeriod, plannedByResourcePeriod, periods })
  -> readonly PersonRow[]
```

`PersonRow` = `{ resourceId, name, hasPlanLine, booked: Record<string, number>,
planned: Record<string, number | null>, bookedTotal, plannedTotal }`.

Membership is the union of:

1. `allocation.resourceIds` — the planned people, `hasPlanLine: true`.
2. Anyone with bookings on this bucket whose `Resource.roleId` equals this allocation's
   `roleId` — `hasPlanLine: false`, `planned` all `null`.

Sort: plan-line members first, alphabetical; then the no-plan-line members, alphabetical.

★ Explicit, accepted gap: a booking whose resource resolves to **no** role line in this bucket
(null `roleId`, or a role with no allocation here) appears under no person row. Those hours
remain in the existing `unattributed` total, which is where they are today — they are not
dropped, but they are not surfaced per-person either. Recorded as a known limit, not a defect.

**Presentation.** New `budget-panel-people-rows.tsx` — `budget-panel.tsx` is at 718 lines against
the 800 ratchet, so the rows must not land there. Each period cell renders
`booked / planned` — booked at `text-foreground`, the separator and the planned figure at
`text-muted-foreground`, and `—` for planned when `hasPlanLine` is false. Read-only: these cells
are never editable and carry no cell border, so they cannot be confused with the editable budget
cells above.

★★ Booked must **not** be tinted. Small tinted text on these surfaces is the documented AA trap
in this repo (`--rag-amber-text` failed AA as small text on dark and mockup schemes), and the
booked/planned distinction is carried by position and the `/` separator, not by colour — so
nothing rides colour alone here either (WCAG 1.4.1).

★ Child rows live in a `<tbody hidden>` keyed `bucketId:roleId`, not in conditionally-rendered
`<tr>`s. The disclosure's `aria-controls` must reference an id that stays in the DOM while
collapsed, and a `<tbody>` keeps the child cells in the same column grid as the role row.

★ The three pinned leading columns (`DOT_COL_PX`, role, Total) are unaffected — only the period
columns widen, and their pinning arithmetic reads the role column's live width, not a period
width.

Disclosure state is a `Set<string>` of `bucketId:roleId` held in `budget-panel.tsx`, collapsed
by default, not persisted across sessions. The trigger is a `ToggleButton variant="disclosure"`
on the role label with a row-unique `ariaLabel` naming the role.

### 3.4 Dependency search and successor linking

`dependencies-editor.tsx` (210 lines) today renders a type `<Select>`, a task `<Select>` filtered
to eligible predecessors, and an Add button.

**Direction toggle.** A `ToggleButton` labelled "Successor" — pressed means the next Add links a
successor. ★ The label names what `pressed` enables and never flips, per the primitive's
contract.

**Searchable picker.** The task `<Select>` becomes a filterable combobox built on the existing
`combobox-shared.tsx` (`useCombobox`, `ComboboxChevron`, `ComboboxOptions`).

**Matching.** New pure `task-search-match.ts` — `matchTaskQuery(query, task)`:

- Case-insensitive substring over `taskName` by default.
- `*` acts as a glob (`api*test`), anchored nowhere; other regex metacharacters are escaped.
- A leading `#` or an all-digits query matches the task **id**.
- Empty query matches everything.

**Successor writes.** Dependencies are stored as predecessors on the owning task, so a successor
link is a write to a **different** task. Those links are **staged in the draft** and applied on
Save:

- The draft carries `successorLinks: { taskId: number; type: DependencyType }[]` alongside the
  existing predecessor `dependencies`.
- Cancel discards them, exactly like every other field in the modal.
- `use-task-submit.ts` applies them after the task is saved and its id is known — including the
  create path, where the id is minted at save — as one functional `setTasks(prev => …)`.
- A bulk undo capture over the touched target tasks is taken **before** that write, so the
  whole save is one undo entry.

★★ The cycle guard runs **reversed** for successors: adding successor `S` means `S` gains a
dependency on this task, so the check is `wouldCreateDependencyCycle(S.id, myId, taskById)`, not
the predecessor form. A test must seed the collision explicitly — a fixture with no existing
chain passes whichever direction the check runs, so the naive test cannot tell a correct guard
from a reversed one.

★ Chips render both directions with the successor ones visually distinguished (arrow direction
plus a direction word, never colour alone). Removing a successor chip stages the removal; it is
applied on Save on the same path.

---

## Cross-cutting requirements

**i18n.** Every new string lands in both `i18n.ts` (EN) and `i18n.de.ts` (DE) — tsc enforces key
parity. DE uses real umlauts; `i18n.de.ts` is CRLF and must be patched via a node utf8 write.
Interpolated strings use 0-based positional placeholders.

**Accessibility.** Newly touched axe-scanned surfaces: the top bar (undo listbox, every view),
Gantt, Milestones, Insights, Budget, Settings. Every new control needs an accessible name and
keyboard operability, and every per-row control needs a row-unique name. Verify with
`npx playwright test e2e/a11y.spec.ts --project=chromium -g "<View>"` before pushing — the unit
suite never runs Playwright, so an axe regression fails only in CI.

★★ After any `globals.css` `@theme` edit or large class rename, run axe against a **fresh**
server on an isolated port, never the reused long-running dev server.

**Coverage.** New pure `.ts` engines (`budget-bucket-people.ts`, `task-search-match.ts`, the
`takeThrough` addition) are coverage-gated and must carry their own tests. New `.tsx` render glue
is excluded by the existing `coverage.exclude` globs.

**Gates per slice.** `npx tsc --noEmit` · `npx eslint --max-warnings=0 src/app` ·
`npm run test:run` · `npm run test:shuffle` · `npm run size:check` · `npm run dup:check` ·
`npm run docs:symbols:check` · targeted axe. Slice 1 additionally re-baselines the
visual-regression specs.

★★★ Never read a gate's exit code through a pipe — redirect to a file, echo `$?` unpiped, then
read the file.

**Release.** Each slice bumps `src/app/version.ts` (APP_VERSION, APP_BUILD_DATE, milestone), adds
a `CHANGELOG.md` entry, appends any new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` with EN+DE
strings, and updates the five ungated version sites: `package.json`, both `package-lock.json`
occurrences, the README shields badge (version **and** codename), and the generated header on all
five `docs/CODEMAPS/*.md`.

**open-followups.md.** Slice 1 adds the hand-rolled-UI/glyph inventory entry. ★★ Numbering collides across
parallel branches — whoever merges second renumbers; git flags the conflict.

---

## Out of scope

- Migrating any hand-rolled element, or replacing any glyph with a heroicon, beyond the
  panes listed in 1.3 and 2.5. §1.4's inventory is the deliverable; acting on it is a
  tracked follow-up.
- Surfacing per-person bookings that resolve to no role line in a bucket (3.3).
- Any change to `undoById`, the toast Undo action, or the undo capture contracts.
- Persisting the budget people-row disclosure state across sessions.
