# Gantt view controls + task lifecycle batch — design

Date: 2026-08-03
Status: approved (design), not yet planned

Thirteen reported items, grouped into three independent workstreams. Each item is
listed with its investigated root cause so the plan does not re-derive them.

## Scope

| # | Report | Section |
|---|---|---|
| 1 | Cannot save a task after changing status To Do → Done | 2 |
| 2 | Task edit modal reset-resize icon differs from the main windows | 3 |
| 3 | Gantt: toggle holidays and absences | 1 |
| 4 | Gantt: no status checkbox ticked shows everything | 1 |
| 5 | Gantt: include milestones in the status filter | 1 |
| 6 | Gantt: visualise relations between tasks | 1 |
| 7 | Open Points "Clear all" colour differs from "Reset to clean slate" | 3 |
| 8 | Settings: "I am this resource" moves Appearance → General | 3 |
| 9 | Open Points bulk edit has no scrollbar when it exceeds the window | 3 |
| 10 | Select-all picks up finished tasks that are hidden | 3 |
| 11 | Cancelled does not close a task | 2 |
| 12 | Gantt: dotted vertical grid toggle | 1 |
| 13 | Gantt: Cancelled tasks should count as completed in the filter | 1 + 2 |

## Investigated root causes

- **1** — `task-validation.ts:44` rejects `dueDate < today` with `errorPastDate`,
  and `use-task-submit.ts` gates Save on `hasTaskErrors`. This blocks editing
  **any** task whose due date has passed; the status change is incidental.
- **2** — `modal-header.tsx:84` renders `ArrowPathIcon`; every main-window reset
  control renders `ResetSizeIcon` (`task-manager-ui.tsx:72`).
- **3** — Gantt renders per-row absence bands (`gantt-rows.tsx:194`) but has **no
  holiday rendering at all** and takes no `holidaySet` prop.
- **4** — `gantt.tsx:272` treats an empty `statuses` array as "no filter, show
  all". The reporter wants the opposite.
- **6** — `GanttDependencyLayer` already draws SVG arrows (`gantt.tsx:657`); the
  reporter does not see them, and also wants a toggle.
- **7** — the Clear-all control is `IconButton variant="bordered"` (neutral);
  the clean-slate button is `border-ui-pink/50 bg-surface text-ui-pink-strong
  hover:bg-ui-pink/10` (`general-section.tsx:81`).
- **9** — `bulk-edit-modal.tsx:52` is a plain in-flow `div` with no max-height and
  no overflow.
- **10** — `use-bulk-operations.ts:100` derives `visibleIds` from
  `filteredSortedTasks`, which is upstream of both the hide-finished filter and
  the RAG health filter that produce `visibleRows` (`tasks-section.tsx:368`).
- **11/13** — Cancelled leaves `completedDate` empty by design. Consumers that
  mean "closed" read `completedDate` truthiness, so a cancelled task still reads
  as open.

---

## Section 1 — Gantt view controls

### 1.1 Prefs

`GanttPrefs` (`gantt-engine.ts`) gains a version marker and five booleans.

| Pref | Default | Notes |
|---|---|---|
| `statuses` | all three values | **semantics flip**: empty now means "show nothing" |
| `showHolidays` | `true` | new rendering |
| `showAbsences` | `true` | preserves current always-on behaviour |
| `showDependencies` | `true` | arrows exist today |
| `showMilestones` | `true` | independent of the status filter |
| `showGrid` | `false` | opt-in visual |

The persisted blob gains `v: 2`. `loadPrefs` migrates a legacy blob (no `v`):

- `statuses: []` → all three values. Under the old semantics that meant "show
  everything"; carrying it forward verbatim would open the chart empty.
- a **non-empty** legacy `statuses` list passes through unchanged — it means the
  same thing under both semantics.
- absent booleans take the defaults above.

`resetFilters` sets `statuses` to all three values, never `[]`.

### 1.2 Status buckets

One pure helper in `gantt-engine.ts`:

```
taskStatusBuckets(task, bar, today) -> Set<GanttStatus>
```

- `completed` when `isTaskFinished(task)` — this is where **item 13** lands, so
  Cancelled is completed for the Gantt filter.
- `overdue` when `!isTaskFinished(task) && bar.end < today`.
- `open` when `!isTaskFinished(task)`.

The filter in `gantt.tsx` becomes `prefs.statuses.some((s) => buckets.has(s))`
with **no `length > 0` escape** — that removal is the whole of item 4.

### 1.3 Milestones in the filter

`milestoneStatusBucket(milestone, today)`:

- achieved → `completed`
- not achieved and due date in the past → `overdue`
- otherwise → `open`

Milestones are filtered before `buildGanttRows`. `showMilestones` gates milestone
rows entirely and is orthogonal to the status filter.

### 1.4 Empty-selection state

With zero statuses ticked the chart renders an explicit "no status selected"
message rather than an empty grid. A dead-end state has to say why it is empty;
this is the counterpart to the semantics flip, not an optional nicety.

### 1.5 Holidays and absences

`GanttPanel` gains a `holidaySet` prop (task-manager already computes one for the
other panes). A new `GanttNonWorkingLayer` in `gantt-chrome.tsx` paints
full-height shaded columns behind the rows for holidays, gated on
`showHolidays`. Existing per-row absence bands are gated on `showAbsences`.
Palette tokens only — no raw colours, no gradients.

### 1.6 Grid

Vertical dotted lines are drawn at the **same tick positions `GanttHeader` uses
for its date labels**, so a line always sits under a label — that alignment is
the stated purpose ("visual cues on date of a column"). Implemented as
positioned elements carrying `border-l border-dashed border-line`. A
`repeating-linear-gradient` is deliberately not used: the palette guard bans
gradients.

### 1.7 Dependency arrows

Two parts:

1. Investigate why the existing arrows are not visible to the reporter. The
   layer's render conditions and its interaction with `showCriticalPath` are the
   first suspects; the plan must confirm the actual cause before changing
   anything.
2. Gate the layer on the new `showDependencies` pref.

### 1.8 Toolbar

A new `GanttViewMenu` (in `gantt-chrome.tsx`) renders one "View" button opening a
`PopoverPanel` containing all display toggles: critical path, baseline,
dependencies, holidays, absences, grid, milestones, plus the milestone-placement
control. The three existing flat toggles move in.

Placement follows the repo's toolbar-order rule: the View button sits **before**
the trailing Print · reset-columns · reset-size group, which stays contiguous.
Asserted with the shared `src/test/toolbar-order.ts` helper (`contiguous: true`
for the trailing group), not a hand-rolled DOM walk.

---

## Section 2 — Task lifecycle

### 2.1 Past due date blocks saving (item 1)

`validateTaskForm(form, today, isNew)` applies the `errorPastDate` rule **only
when creating**. Editing an existing task is never blocked by a due date that has
since gone stale. Every caller passes the flag: the submit handler
(`use-task-submit.ts`, which knows `editingId`), the inline per-field display
(`task-form-fields.tsx`), and the Save-disabled gate.

New tasks still cannot be given a past due date, so the guard the rule exists for
is intact.

### 2.2 Cancelled counts as closed (item 11)

No `completedDate` is written for a cancelled task. The
`status === "Done" ⟺ completedDate set` invariant and `applyStatusChange` are
untouched. Instead, every read of `completedDate` truthiness across `src/app` is
swept and classified individually:

- the site means **"closed / no longer active"** → switch to `isTaskFinished`
- the site means **"delivered"** (completion percentage, EVM, burn-down,
  earned value) → stays Done-only

The plan produces that call-site table from a real grep before any edit. Guessing
the list here would be a claim about code neither the reporter nor this document
has enumerated. The Gantt filter (§1.2) is one known member of the first group.

---

## Section 3 — Open Points and Settings

### 3.1 Reset-size icon (item 2)

`modal-header.tsx` renders `ResetSizeIcon` instead of `ArrowPathIcon`. If
importing it from `task-manager-ui.tsx` would create a cycle (a primitive
importing an orchestrator-level module), the icon moves to a leaf module first
and both sides import that.

### 3.2 Clear-all colour (item 7)

A new `IconButton` variant — `dangerBordered`:
`border border-ui-pink/50 bg-surface text-ui-pink-strong hover:bg-ui-pink/10`.
Open Points' Clear-all uses it. A variant rather than a one-off `className`,
because the repo's rule is to reach for the primitive; a second destructive
toolbar control will want the same recipe.

### 3.3 "I am this resource" moves to General (item 8)

The `selfResourceId` `<select>` (`appearance-section.tsx:176-201`) moves to
`GeneralSection`. The `resources` prop is threaded to `GeneralSection` at its
`settings-view` call site and dropped from `AppearanceSection` if nothing else
there uses it. Settings → General is axe-scanned, so the moved control keeps its
`<label htmlFor>` and `aria-label`.

### 3.4 Bulk-edit scrolling (item 9)

The field list in `bulk-edit-modal.tsx` gets `max-h-[60vh] overflow-y-auto`; the
Apply/Cancel row becomes a sticky footer so it cannot scroll out of reach. The
panel stays inline above the table.

### 3.5 Select-all respects hidden rows (item 10)

`useBulkOperations` receives the ids of the rows actually rendered — `visibleRows`
in `tasks-section.tsx`, i.e. after **both** the hide-finished toggle and the RAG
health filter — instead of deriving them from `filteredSortedTasks`. This drives
`visibleIds`, `allVisibleSelected`, and `toggleSelectAllVisible` together, so the
header checkbox's checked state and its action cannot disagree.

Additionally, bulk **apply** intersects the selection with the rendered rows. A
task selected while visible and then hidden by a filter change must not be
silently edited by a later bulk operation. This is a deliberate second guard, not
a duplicate of the first: the first fixes what gets selected, the second fixes
what a stale selection can reach.

No effect-driven pruning of `selectedIds` — `react-hooks/set-state-in-effect` is
fatal in this repo.

---

## Verification

- Pure unit tests for `taskStatusBuckets`, `milestoneStatusBucket`, and the
  `loadPrefs` v1 → v2 migration (both the `[]` case and the non-empty pass-through).
- A test for the Gantt empty-selection message.
- Toolbar order asserted via `src/test/toolbar-order.ts`.
- Select-all: fixture must contain a finished task **and** a health-filtered task,
  or the assertion passes whichever source the hook reads.
- Bulk apply: fixture must select a row and then hide it, or the second guard is
  untested.
- Past-date: separate create and edit cases; an edit-only fixture would pass
  against the unfixed code if the due date happens to be in the future.
- axe re-run for Gantt, Open Points and Settings — all three are in `A11Y_VIEWS`.

## Release

User-visible feature work, so a version bump is required: `0.213.0` with a fresh
codename (codenames are unique — check `CHANGELOG.md` before choosing). The bump
touches `src/app/version.ts`, `CHANGELOG.md`, `APP_HIGHLIGHT_KEYS` + EN/DE
strings, `package.json`, both `package-lock.json` occurrences, the README badge
(version and codename), and the five `docs/CODEMAPS/*.md` headers.

## Out of scope

- Changing the `Done ⟺ completedDate` invariant.
- Counting Cancelled work in completion percentage, EVM or burn-down.
- Applying "empty means nothing" to the Gantt priority or assignee filters; only
  the status filter flips.
