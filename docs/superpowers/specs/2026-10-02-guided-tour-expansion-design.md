# Guided tour expansion — design

**Date:** 2026-10-02
**Status:** approved in conversation, awaiting written-spec review

## Goal

Extend the guided tour so it teaches how to work in the app (undo and redo,
bulk edit, search, table controls, saved views, the board) and reaches the
modules no tour covers today (resources, budget, changes, documents), while
keeping every step "show and tell": a spotlight or a centred card that
explains, never a step that waits for the user to act or changes data.

## What exists today

`src/app/app-tour.ts` held six tours before this work (getting started, RAID, reporting,
planning, stakeholders, AI). Four steps are spotlights on a `data-tour-id`
anchor (sidebar tasks and actions, Ask Claude, the project switcher); the rest
are centred cards. `tour-overlay.tsx` falls back to a centred card when a
spotlight's anchor is not in the DOM. `visibleSteps` drops steps whose `view`
belongs to a disabled feature module. Tours run in the modern layout only.

Reproduce the current counts rather than trusting prose:
`grep -c "kind: \"" src/app/app-tour.ts` (steps) and
`git grep -n "data-tour-id" -- "src/app/*.tsx" ":!*.test.*"` (anchor sites).

## Decisions

1. **Show and tell only.** No new step kind, no event listeners, no step that
   switches a view mode, selects rows or writes settings or data. `TourStep` is
   unchanged.
2. **One engine change: a storage-aware filter.** `trends`, `history` and
   `portfolio-health` are Turso-only (`TURSO_ONLY_VIEWS`) and the sidebar
   prunes them in file mode, but `visibleSteps` does not, so a step there would
   navigate to a dead view.
3. **Content stays in `app-tour.ts`.** No per-tour files; the file stays well
   under the size limit.
4. **Anchors only on always-mounted controls.** A step about a control that
   appears only after an action (the bulk bar, inline edit, the badges) is a
   centred card that says where the control is and how to reveal it.
5. **Existing step ids and tour ids do not change**, so a tour already marked
   done keeps its badge.

## Engine change

- New pure helper in `nav-config.ts`:
  `isViewReachable(view: AppView, features: readonly FeatureModuleId[], storageKind?: StorageKind): boolean`
  — true when the view's module is enabled and (`storageKind === "turso"` or the
  view is not in `TURSO_ONLY_VIEWS`) and, for a child view in `NAV_GROUPS`, its
  parent item is reachable too. `filterNavGroups` uses it for its own
  predicate, so the sidebar and the tour cannot disagree.
- `visibleSteps(steps, features, storageKind?)` keeps a step when it has no
  `view` or `isViewReachable(step.view, features, storageKind)`.
- `useTour` takes `storageKind?: StorageKind`; its only caller, `task-manager.tsx`,
  passes `settings.storageConfig.kind`. The catalog's step counts use the same
  filter.
- A tour with zero visible steps is not offered in the catalog. If the current
  code already hides it, a test pins that; if not, the hide is added here.

## New anchors

Added to `TOUR_ANCHORS` and placed as `data-tour-id`:

| Anchor key | Element | Present when |
|---|---|---|
| `undo` | the `dataTourId` prop on `UndoControl`'s root element, passed as `TOUR_ANCHORS.undo` from `task-manager.tsx` | once the undo stack has an entry (`UndoControl` renders nothing on an empty stack, so the anchor is absent, which the overlay treats like a zero-size one) |
| `globalSearch` | the search box (`global-search-box.tsx`) | always |
| `tasksViewMode` | the Table / Board / Swimlane control (`tasks-section.tsx`) | on Open Points |
| `selectAll` | the "select all visible" header checkbox | table mode only |
| `savedViews` | the saved-views control on Open Points | on Open Points |
| `navResources`, `navBudget`, `navChanges`, `navDocuments` | sidebar entries, via the existing `NAV_TOUR_ID` map | the module is enabled and the entry is rendered |

A missing anchor (board mode for `selectAll`, a collapsed sidebar parent for a
child entry) falls back to the centred card. On the collapsed rail the
Resources entry is a parent with children, rendered by `CollapsedNavFlyout`,
which forwards the same `NAV_TOUR_ID` anchor to its trigger button, so
`res-directory` spotlights that button there too. Tours are modern-only, so a top-bar anchor is wired in the
`ModernShell` slot only.

## Steps

S = spotlight (anchor), M = centred card. "→" is the step's `view`.

**Getting started** — the twelve existing steps, plus
`more-tours` (M, → help): more tours live under Help → Tours.

**Working faster** (new tour `working-faster`):

| id | kind | → | content |
|---|---|---|---|
| wf-undo | S `undo` | open-points | the undo control appears after your first change; Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes; the control's history list; the shortcuts are ignored while typing in a field |
| wf-undo-limits | M | open-points | note and blocker entries save immediately and cannot be undone |
| wf-search | S `globalSearch` | open-points | Ctrl+K searches the whole project |
| wf-select | S `selectAll` | open-points | tick rows, or all visible rows, to open the bulk bar |
| wf-bulk | M | open-points | bulk edit applies only the fields you tick; one undo reverts the whole change |
| wf-inline | M | open-points | click a cell to edit; Enter saves, Escape cancels |
| wf-table | M | open-points | sort, drag a column edge to resize, the filter field, and the reset-columns and reset-size buttons at the toolbar's end |
| wf-views | S `savedViews` | open-points | save a filter and sort as a named view |
| wf-board | S `tasksViewMode` | open-points | Table, Board and Swimlane; drag a card to change its status |
| wf-logs | M | open-points | the note and blocker badges show a count and open a dated log window |

**Resources** (new tour `resources`): res-directory (S `navResources`, →
directory), res-workload (M, → workload: overload, reassigning overdue work),
res-calendar (M, → calendar: absences; arrow keys move through the grid),
res-planning (M, → planning: allocation and the AI plan), res-roles (M, →
manage-roles).

**Budget & changes** (new tour `budget-changes`): bud-plan (S `navBudget`, →
budget: plan against actuals), bud-evm (M, → budget-report: earned value),
chg-log (S `navChanges`, → changes: log, impact, decision), chg-report (M, →
change-report), chg-link (M, → changes: how an approved change affects the
plan — wording set by what the code does).

**Documents** (new tour `documents`): doc-ai (S `navDocuments`, → documents:
AI drafts from project data), doc-editor (M, → documents: block editor and
export), doc-versions (M, → documents: versions and restore).

**Help yourself** (new tour `help-yourself`): help-icon (M, → open-points:
the view hint banner's Learn more link and the `?` button in dialogs — Open
Points has no panel `?` button, so this step has no anchor), help-search (M, → help), help-escape (M: Escape closes the
top-most popup or panel), help-popout (M: what can open in its own window —
wording set by what the code supports; the step is dropped if the answer is
"only the chat", since the AI tour then covers it).

**AI** (existing, +2): ai-inline (M, → open-points: the "Ask Claude" button on
a row), ai-dictation (M, → settings: set a dictation hotkey, then dictate into
any field).

**Planning** (existing): `plan-gantt` changes its `view` from `milestones` to
`gantt`; new `plan-gantt-view` (M, → gantt: dependencies and the View menu).

**Stakeholders** (existing, +2): stake-raci-view (M, → raci), stake-map (M, →
stakeholder-map).

**Reporting** (existing, +5): report-insights (M, → insights),
report-learning (M, → learning-insights), report-activity (M, → activity),
report-trends (M, → trends), report-history (M, → history). The last two are
dropped outside Turso by the storage filter.

New tour ids, step ids and translation keys follow the existing naming
(`tour<Name>Title` / `tour<Name>Desc`, `tourStep<Name>Title` /
`tourStep<Name>Body`).

## Wording rules

- Body at most two sentences, about 35 words, like the existing steps.
- Name a control by its visible label ("Ask Claude", "Board").
- Shortcuts written "Ctrl+Z", with "(⌘ on Mac)" once per tour.
- Every factual claim (a key, a field set, "cannot be undone", what popout
  supports) is checked against the code before the text is written. The plan
  carries one claim-check row per step.
- German text uses real umlauts and is edited only by a node UTF-8 script with
  `\r\n` anchors, never the Edit tool.

## Testing

Each test names the mutant that must turn it red.

| Test | File | Pins | Mutant |
|---|---|---|---|
| storage filter | `app-tour.test.ts` | trends/history steps kept for `"turso"`, dropped for `"local-json"` and `undefined`; a step with no `view` always kept | drop the storage condition |
| sidebar parity | `nav-config.test.ts` | for every view in `NAV_GROUPS` × {turso, local-json, undefined} × {all modules, none}, `isViewReachable` equals membership in `filterNavGroups` (children included, so the parent rule is covered). A view outside the nav (e.g. `learning-insights`) gets only the module rule, and a view in no module is core, so it is reachable | invert the Turso check in one of the two |
| anchors resolve | `app-tour.test.ts` | every step `anchorId` is a `TOUR_ANCHORS` value and every value is used by a step | rename an anchor on one side |
| anchors placed | component tests for global-search-box, tasks-section, sidebar-nav; `undo-control.test.tsx` (anchor present with entries, absent when empty) plus a source check for `dataTourId={TOUR_ANCHORS.undo}` in `task-manager.tsx` | the element carries its `data-tour-id` | delete the attribute |
| hook threads storage | `use-tour.test.tsx` | the reporting tour's `steps.length` and its catalog `stepCount` differ between turso and file | ignore `storageKind` |
| empty tour hidden | `use-tour.test.tsx` | a tour whose steps are all filtered out is absent from the catalog | remove the hide |
| done state kept | `app-tour.test.ts` | the six existing tour ids and their step ids are still present | rename an existing id |

Key existence and EN/DE parity are enforced by tsc; umlauts by the
`i18n-encoding` test. The tour overlay is not axe-scanned, so each new tour is
eye-checked once on the demo project in file mode and on Turso after merge.

Local verification is single-file vitest probes (`--maxWorkers=1`) only; the
eight CI checks are the gate.

## Docs

- `docs/AGENTS/features.md`, "Guided tour + demo": replace the step and anchor
  counts with the reproduce commands above, document `isViewReachable` and the
  storage filter, and state the conditional-anchor fallback rule.
- `help-content.ts`: update if it describes the tours.
- No version bump or CHANGELOG entry; those belong to a release.

## Out of scope

- Steps that wait for a user action, and steps that prepare state.
- Classic and popout layouts.
- Portfolio-health and timelog steps.
