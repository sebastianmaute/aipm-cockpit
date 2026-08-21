# Effort Progress Bar + UI Polish (0.13.1) — Design

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.13.1-effort-progress-polish`

## Goal

Five UI refinements following 0.13.0: an effort progress bar + field reflow in the task
edit modal, move the task-pane row hover from assignee to the id/name cells, and align two
budget buttons with existing styles.

## Items

### 1. Effort progress bar (task edit modal)

A horizontal bar in the task form showing time-spent consumption of the original estimate,
filling left→right. Reads the **live** form values (`originalEstimateMinutes`,
`timeSpentMinutes`) so it updates as the user edits the two effort fields.

- New pure helper `effortProgress(estimateMin?, spentMin?)` returning
  `{ hasEstimate: boolean; pct: number; over: boolean }` where:
  - `hasEstimate = (estimateMin ?? 0) > 0`
  - `pct = hasEstimate ? (spentMin ?? 0) / estimateMin : 0` (0..∞, not clamped)
  - `over = hasEstimate && pct > 1`
  Lives in `src/app/duration.ts` (alongside parse/format) and is unit-tested.
- New `EffortProgressBar` component (in `task-form-modal.tsx`) renders col-span-2 below the
  two effort fields:
  - **No estimate** (`!hasEstimate`): a greyed, disabled-looking empty track (0% fill) with a
    muted hint `taskEffortNoEstimate`.
  - **Spent ≤ estimate**: fill width `pct×100%` (capped at 100% visually) in the accent
    colour (`bg-AIPM-dark-blue`); label shows `formatDuration(spent) / formatDuration(estimate) · NN%`.
  - **Over** (`spent > estimate`): fill 100% in red (`bg-AIPM-pink`); label shows the real
    percent (e.g. `120%`).
  - Accessibility: outer element `role="progressbar"`, `aria-valuemin={0}`, `aria-valuemax={100}`,
    `aria-valuenow={min(round(pct×100),100)}`, `aria-label={t(lang,"taskEffortProgressLabel")}`.
- The bar's fill width uses `Math.min(pct, 1) * 100`%. The label percent uses
  `Math.round(pct × 100)` (may exceed 100 when over).

### 2. Task form field reflow (task edit modal)

The form is a `sm:grid-cols-2` auto-flow grid. Reorder the cells so the visual rows become:
`… Start Date | Due Date`, then **`Last Update Date | Group`**, then
**`Original estimate | Time spent`**, then **`EffortProgressBar` (col-span-2)**, then
`Labels …`. Concretely: move the `Group` `<Field>` to immediately after `Last Update Date`,
keep the two `EffortField`s together after Group, and place `EffortProgressBar` (col-span-2)
right after them. No field is removed; only order changes.

### 3. Task-row hover: move from assignee to id + name (task pane)

The directory-assignee highlight hover is
`rounded-md border border-transparent px-2 py-0.5 hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800`.

- **ID cell button** (`task-row.tsx`, the `#id` edit button): replace its current
  `hover:text-AIPM-dark-blue hover:underline` with the highlight hover (keep `cursor-pointer`,
  `font-mono`, `onClick={() => onEdit(task)}`, and the existing title/aria-label).
- **Task-name cell button**: replace its `hover:text-AIPM-dark-blue hover:underline` with the
  highlight hover (keep `cursor-pointer text-left font-medium`, onClick, title).
- **Assignee cell**: revert to plain text — render `{task.assignee || "—"}` directly inside the
  `<Td>` (keep the `Td` `title`), removing the highlight `<span>` added in 0.13.0.

### 4. Budget "Add bucket" button → match "Add task" (budget panel)

Restyle the budget Add-bucket button to exactly match the task-pane Add-task button
(`tasks-section.tsx`):
`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90`,
rendering `+ {t(lang,"budgetAddBucket")}` (prefix the label with `+ `).

### 5. Budget close/remove buttons → resource-assignee hover (budget panel)

Both the close/reopen and remove buttons currently use `text-xs text-zinc-500 hover:text-…`.
Give both the directory/resource-assignee highlight hover:
`rounded-md border border-transparent px-2 py-0.5 text-xs hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800`,
keeping their `text-zinc-500` base text and existing onClick/labels. The remove button keeps
its `window.confirm` guard.

## i18n (EN + DE)

- `taskEffortProgressLabel` — progressbar aria-label, e.g. EN "Time spent vs. original estimate".
- `taskEffortNoEstimate` — muted hint, e.g. EN "No estimate set".

## Non-goals

- No change to how effort is stored, parsed, or persisted (0.13.0 already covers that).
- No new drag/library; no change to the column system or column prefs.
- The bar is display-only (not editable).

## Testing

- **Unit (Vitest):** `effortProgress` — no estimate → `{hasEstimate:false, pct:0, over:false}`;
  partial (spent<estimate) → correct `pct`, `over:false`; exactly equal → `pct:1, over:false`;
  overrun → `pct>1, over:true`; spent unset with estimate set → `pct:0`.
- **Component (Testing Library):** `EffortProgressBar` renders the disabled/no-estimate state
  when estimate unset; renders an over-budget (red, ≥100%) state when spent>estimate; exposes
  `role="progressbar"` with the right `aria-valuenow`.
- Mechanical items (reflow, hover swap, button restyles) verified by tsc/lint + existing tests;
  the assignee-revert must not break any task-row test that asserts assignee text.

## Release

Small follow-up → **0.13.1** (patch). Bump `version.ts`, add a CHANGELOG `0.13.1` entry, and
update `docs/CODEMAPS/*` for `effortProgress`/`EffortProgressBar`. Gates: lint 0, tsc 0,
`test:coverage` green (≥70%).
