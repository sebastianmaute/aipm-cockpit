# UI Polish Batch (0.13.0 "Bradbury") — Design

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.13.0-ui-polish-batch`

## Goal

Deliver a batch of 16 UI polish items, bug fixes, and two small features across the
existing lop-app surfaces (resources, roles & rates, budget, tasks, modals, voice),
without regressing the 0.12.0 budget planner or other shipped features.

## Scope decisions (cross-cutting)

1. **Drag-and-drop is zero-dependency / hand-rolled.** Native pointer events for the
   draggable modal window; native HTML5 drag (`draggable` + `onDragStart`/`onDragOver`/
   `onDrop`) for bucket list reordering. No new npm dependency. Matches the codebase
   convention (inline SVG + Tailwind, no UI component library).
2. **Shared `ModalHeader` component.** Extract one header (title + drag handle + voice
   mic + close button) and migrate all 6 modals to it. Single change point delivers
   draggability, in-modal voice, and a consistent close affordance.
3. **Task effort stored as canonical minutes.** `originalEstimateMinutes?: number` and
   `timeSpentMinutes?: number` on `Task`. A new `duration.ts` parses `"2w 3d 4h"` →
   minutes and formats minutes → string. Numeric storage = sortable column + clean
   CSV/MD/JSON round-trip.
4. **Effort time basis: Jira-style.** `1w = 5d`, `1d = 8h`, `1h = 60m`. Constants live
   in `duration.ts`.

## Non-goals

- No new DnD library, no animation library.
- Task effort does **not** feed the budget engine (standalone task metadata only).
- No change to the budget CCI math beyond what bucket removal/reorder require.
- No schema-version bump unless a migration is genuinely required (see Theme E).

---

## Theme A — Shared modal infrastructure

**Why first:** Themes B (voice) and the draggable requirement both depend on it.

**A1. `ModalHeader` component.** New `src/app/modal-header.tsx` exporting `ModalHeader`:
- Props: `title: string`, `onClose: () => void`, `lang`, optional `onVoiceCommand` /
  voice props, optional `dragHandleProps` (pointer handlers from the drag hook).
- Renders the existing header markup (sticky, `flex items-center justify-between`,
  `border-b`, title `h2`, close `button` with X SVG) plus a voice mic button between
  title and close.
- The header element itself is the drag handle (receives `dragHandleProps`).
  `onPointerDown` on the close button and the mic button must **stop propagation** so
  clicking them never starts a drag.

**A2. Draggable modal.** New `src/app/use-draggable.ts` hook:
- Returns `{ offset: {x,y}, handleProps, reset }`. `handleProps` = `onPointerDown`
  (+ pointermove/up registered on `window` while dragging, using `setPointerCapture`).
- The `Modal` panel wrapper applies `transform: translate(offsetX, offsetY)` on top of
  its existing flex centering.
- Offset clamps so the header stays within the viewport (cannot be dragged fully
  off-screen).
- `reset()` is called whenever the modal transitions closed→open, so each open starts
  centered.
- Dragging is pointer-based (mouse + touch); no effect on keyboard focus/aria.

**A3. Migrate 6 modals to `ModalHeader`.** `task-form-modal`, `absence-edit-modal`,
`shift-edit-modal`, `resource-edit-modal`, `roles-modal`, `jira-conflicts-modal`.
Each replaces its hand-built `<header>` with `<ModalHeader title=… onClose=… …/>` and
wires the drag offset into its panel wrapper. Existing close behavior and aria labels
preserved.

**A4. Voice mic in modal header.** The mic in `ModalHeader` reuses the existing global
voice command path (`parseCommand` + the app's `handleCommand`). The same handler that
the header `VoiceCommandButton` uses today is threaded down so a command issued inside
any modal executes against global state. The existing task-name dictation
(`InlineMicButton`) is unchanged.

**Acceptance:** All 6 modals draggable by header, clamped on-screen, reset on reopen;
each modal header shows a working voice-command mic; close + dictation still work.

---

## Theme B — Navigation & visual polish

**B1. Tab order.** In `workspace-section.tsx`, move the `budget` `TabButton` so order is
`… resources, budget, activity …`. (`TopTab` union unchanged.)

**B2. Discipline/Grade placeholder.** In `resource-directory.tsx` (lines ~71, ~88) the
first `<option value="">` currently shows the literal "Discipline"/"Grade". Change the
option label to an em dash `—` (kept as the empty-value placeholder). No new i18n key
required (literal `—`).

**B3. Roles & rates divider.** In `roles-modal.tsx`, insert `<hr>` (or a
`border-t border-zinc-200 dark:border-zinc-800` element) between the rate-card table
(ends ~line 102) and the add-combo row (starts ~line 103).

**B4. Resources menu icons.** Add inline-SVG icons before "Manage roles" (gear/settings)
and "Report" (bar-chart or document) buttons in `resources-panel.tsx` (~lines 222–237),
following the existing icon function pattern in `task-manager-ui.tsx` (`h-4 w-4`,
`aria-hidden="true"`, rendered before the label with a small gap).

**B5. ECB refresh button restyle.** In `budget-panel.tsx` (~lines 101–107) replace the
text-only button classes with the Jira-sync button style from `tasks-section.tsx`
(~273–298): `inline-flex items-center gap-1.5 rounded-md border border-AIPM-dark-blue
bg-white px-3 py-1.5 text-sm font-medium text-AIPM-dark-blue shadow-sm
hover:bg-AIPM-light-grey disabled:opacity-50 dark:bg-zinc-900 dark:hover:bg-zinc-800`,
add a circular-refresh SVG with `animate-spin` while `useFxRates().loading`, and disable
the button while loading.

**Acceptance:** Tab order correct; selects show `—` placeholder; divider visible;
both menu items have leading icons; ECB button visually matches Sync-with-Jira and spins
while refreshing.

---

## Theme C — Hover consistency

Reference effect (Directory assignee, `resource-directory.tsx:252-258`):
`hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800` on a button with
`border border-transparent` + `title`.

**C1. Workload assignee** (`resource-workload.tsx:64-76`): replace `hover:underline`-only
with the reference hover classes (keep it a button; keep focus ring).

**C2. Task assignee** (`task-row.tsx:237`): wrap the assignee value in a span/button that
carries the reference hover classes and the existing `title`. Clicking is not required to
do anything new — only the hover effect must match.

**Acceptance:** Hovering an assignee in Workload and in a Task row shows the same border +
background highlight as the Directory.

---

## Theme D — Resources planning

**D1. Rollup tooltips.** Add `title={t(lang, …)}` to the four total headers/cells
(Capacity Days, Internal Cost, External Cost, Margin) in `resources-panel.tsx`
(~lines 299–302 / 347–354). New i18n keys (EN + DE) explaining each metric.

**D2. Utilization field tooltip.** Add `title={t(lang, "resourcesUtilizationHint")}` to
the utilization `<input>` (`resources-panel.tsx:323-327`), sibling to the absence input
that already has `resourcesAbsenceOverrideHint`. New i18n key (EN + DE).

**D3. Weeks-view fix (bug).** Root cause: `resources-panel.tsx:311` calls
`displayCapacityHours(p, periods, r, …, plan.granularity, plan.granularity)` — passing the
display granularity as the canonical granularity, so week view reads non-existent week
keys and shows 0.
- Introduce a **view granularity** separate from the plan's (canonical/entry)
  granularity. `plan.granularity` remains the granularity at which utilization is
  *stored*. The SegmentedControl becomes the **view** toggle (local UI state).
- `periods` are generated from the **view** granularity; `displayCapacityHours` is called
  with `canonicalGranularity = plan.granularity`, `displayGranularity = viewGranularity`.
  The engine then borrows month values into weeks (coarse→fine) or sums weeks into months
  (fine→coarse) — both already implemented.
- When `viewGranularity` is **finer** than the entry granularity (e.g. month-entry,
  week-view), the per-period utilization inputs render **read-only** (display the borrowed
  value), because editing happens at the entry granularity. When view == entry, inputs are
  editable as today.
- Keep it minimal: `plan.granularity` is treated as canonical (entry); view granularity is
  component state defaulting to it, driven by the existing SegmentedControl. No model field
  rename required.

**D4. Roles & rates sorting.** In `roles-modal.tsx`, make the four columns (Discipline,
Grade, Internal, External) sortable via clickable headers with an asc/desc toggle and a
direction indicator (▲/▼). Sorting is local component state; default remains the current
alphabetical-by-label order until a header is clicked. Internal/External sort numerically;
Discipline/Grade sort by their resolved names.

**Acceptance:** Tooltips present on all rollup totals and the utilization input; the weeks
view shows borrowed month values (no longer empty) with read-only week cells under
month-entry; rate-card columns sortable both directions.

---

## Theme E — Budget buckets

**E1. Remove bucket.** Add a trash/remove action per bucket in `budget-panel.tsx`
(with a confirm via the app's existing alert/confirm modal). Handler:
`onChangeBuckets(buckets.filter(b => b.id !== id).map(b => b.successorId === id ? {…b, successorId: null} : b))`.
Removing a bucket drops its allocations and nulls any `successorId` pointing at it, so any
spillover/contribution that depended on it falls to **0** (the engine already defaults
missing spillover to 0 — no engine change needed beyond verifying this).

**E2. Reorder buckets by drag.** Add optional `order?: number` to `BudgetBucket`.
- Display & report iterate buckets sorted by `(a.order ?? a.id) - (b.order ?? b.id)`.
- Native HTML5 drag on each bucket card reorders the list; on drop, reassign `order`
  contiguously (0,1,2,…) and persist via `onChangeBuckets`.
- Persistence: add `order` to `sanitizeBudgetBucket`, the BUDGETS CSV columns
  (`storage.ts`), the Markdown budgets section, and JSON (automatic). Absent `order`
  (older data) falls back to id order — **no schema-version bump needed** because the
  field is optional and back-compatible (consistent with how `budgets`/`fxRates` were
  added as optional in v6).

**Acceptance:** A bucket can be removed (with confirm); reports recompute with its
contributions at 0 and successors un-linked. Buckets can be dragged into a new order that
survives reload and export/import round-trips.

---

## Theme F — Task effort field

**F1. `duration.ts` (TDD first).** New `src/app/duration.ts`:
- `parseDuration(input: string): number | null` — parses `"2w 3d 4h 30m"` (any subset,
  case-insensitive, flexible whitespace) → total minutes. Returns `null` for invalid input
  and for empty (empty string → `null` meaning "unset").
- `formatDuration(minutes: number): string` — minutes → compact `"2w 3d 4h"` (omit zero
  units; `0` → `""`).
- Constants: `MINUTES_PER_HOUR=60`, `HOURS_PER_DAY=8`, `DAYS_PER_WEEK=5`.
- Unit tests cover: each unit, combinations, rounding, invalid strings, empty, round-trip
  parse∘format stability.

**F2. `Task` type.** Add `originalEstimateMinutes?: number` and
`timeSpentMinutes?: number` to `Task` (`types.ts`). Optional, back-compatible.

**F3. Task form fields.** In `task-form-modal.tsx`, add two `<Field>`-wrapped text inputs
("Original estimate", "Time spent") with placeholder/hint `e.g. 2w 3d 4h`. Parse on
change/blur; show inline validation if unparseable; store parsed minutes. New i18n keys
(EN + DE) for labels + hint + invalid message.

**F4. Task table columns.** Add two columns ("Est.", "Spent") to the task table column
system (`task-row.tsx` + the hidden-columns/column-config mechanism). Both **hideable** and
**default hidden** to avoid clutter; both **sortable** (numeric by minutes). Display via
`formatDuration`.

**F5. Persistence.** Extend `sanitizeTask` (`sanitize.ts`) to read/clamp the two numeric
fields; add CSV columns and Markdown fields in `storage.ts`; JSON is automatic. Round-trip
tests for CSV/MD.

**Acceptance:** Effort entered as `w/d/h/m` in the form parses correctly (Jira basis),
persists across reload and all export formats, displays in the two optional columns, and
those columns sort numerically.

---

## Release & delivery

- Single feature branch `feat/0.13.0-ui-polish-batch` off `main`.
- Subagent-driven execution, theme order A → B → C → D → E → F (A is the dependency root;
  the rest are independent and could be reordered).
- `version.ts` → `0.13.0` "Bradbury", build date 2026-05-27; add highlight key(s).
- Update `CHANGELOG.md`, `README.md` (EN+DE help where applicable), and `docs/CODEMAPS/*`.
- Gates per repo convention: `lint` clean, `tsc` 0 errors, `test:coverage` green
  (≥70% scoped floor). New logic (`duration.ts`, bucket remove/reorder, weeks-view
  granularity, sanitizers) must carry unit tests.

## Testing strategy

- **Unit (Vitest):** `duration.ts` (parse/format), bucket removal + successor un-linking +
  reorder ordering, `displayCapacityHours` wiring for the weeks fix (canonical month →
  week-view borrow), sanitizer/storage round-trips for `order` and effort fields.
- **Component/manual:** modal drag + clamp + reset, in-modal voice mic, hover effects,
  ECB button spinner, sortable rate-card headers, tooltips.
- Mechanical/visual items (tab order, divider, icons, placeholder) verified by existing
  component tests + manual check; not all are unit-gated (consistent with the scoped
  coverage config).
