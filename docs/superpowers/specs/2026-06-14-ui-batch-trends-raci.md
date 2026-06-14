# UI Batch: Trends tables · Action-chip tooltips+open · Manage-Roles tooltips/height · RACI redesign — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorming complete)
**Branch:** `feat-ui-batch-trends-raci`

## Goal
A 5-part UI batch from the user, all independent:
A. Trends tables → tasks-style (rounded, clipped header) + **resizable columns**.
B. Action chips → **why-tooltip** + clicking **opens the entry editor** (where one exists).
C. Manage-Roles header tooltips → **not all-caps** + **escape the table-border clip**.
D. Manage-Roles pane → **height fits content, capped at viewport**.
E. RACI chip picker → **collapsed-to-selected → expand-all popover** interaction.

## A — Trends resizable columns + tasks-style
`trends-panel.tsx` has two `<table className={INNER_TABLE_CLASS}>` with `<thead className={TABLE_HEAD_CLASS}>` inside a `VIEW_PANE_CLASS` (`rounded-xl border bg-surface`).
- **Rounded match:** tasks use `VIEW_PANE_RESIZABLE_CLASS` (rounded-xl + `overflow-hidden` + `resize`). Give the trends pane the same rounded + `overflow-hidden` so the dark `TABLE_HEAD_CLASS` corners clip to the rounded pane (the visual "rounded corners like tasks"). Keep trends' existing layout; do NOT force the resizable box if it conflicts — the ask is the rounded look + resizable COLUMNS.
- **Resizable columns:** mirror the tasks pattern — `useColumnResize` (see `tasks-section.tsx` / `resources-panel.tsx`) + `ColumnResizeHandle` (from `task-manager-ui.tsx`) per `<th>`, with a `colWidths` state and `style={{ width }}`. Apply to BOTH trends tables (each gets its own width map). Reset-widths control optional (match the Resources pattern if cheap).

## B — Action-chip why-tooltip + open-the-entry
**B1 — tooltip:** in `action-chips.tsx`, add `title={t(lang, action.why.key, ...(action.why.params ?? []))}` to each chip `<button>` (native tooltip explaining *why* the action is flagged). (The chips already render `action.title`; `why` is the explanation.)
**B2 — clicking opens the entry:** chips already call `onOpen(action)` → `requestOpen(cta.view, Number(cta.id))`. Only `raid-panel.tsx` consumes `pendingOpen` to open its editor today. Add the SAME pattern (a `useWorkspaceTab().pendingOpen` effect that opens the edit modal for the matching `id`, then `clearPendingOpen()`; guard against reopening the already-open editor — mirror `raid-panel.tsx:255`) to:
- `tasks` (view `open-points`, taskId) → open the **task edit modal** (`openEditModal`). The tasks editor lives in task-manager (`openEditModal`); wire the effect where the task list/editor is owned (task-manager or tasks-section — read to place it so `pendingOpen.view === "open-points"` opens the task by id).
- `changes` (changeId) → change edit modal (`change-panel.tsx`).
- `milestones` (mId) → milestone edit modal (`milestones-panel.tsx`).
- `stakeholders` (stakeholderId) → stakeholder edit modal (`stakeholders-panel.tsx`).
Each effect: `if (pendingOpen?.view !== "<view>") return; open the entity by id if found & not already editing; clearPendingOpen()`. Reuse the `// eslint-disable-next-line react-hooks/set-state-in-effect` comment as raid-panel does.
**Navigate-only (no editor — confirmed):** `budget` (id 0) → budget view; `schedule` (id 0) → dashboard; `workload` (resourceId) → Workload view. These already navigate via `requestOpen`; leave as-is (no editor).

## C — Manage-Roles header tooltips: case + clip
`roles-editor.tsx` puts `<InfoTooltip>` inside dark-header `<th>` cells (`TABLE_HEAD_CLASS` = `uppercase`). Two `InfoTooltip` (`info-tooltip.tsx`) fixes (global — benefits every header tooltip):
- **Case:** the bubble inherits `text-transform: uppercase` from the `th`. Add `normal-case` to the bubble `<span>` (the `z-50 … bg-surface …` popover) so the explanation reads in normal case.
- **Clip:** the bubble is `absolute` and gets clipped by an `overflow-hidden` ancestor (the rounded pane / a scroll container) — "behind the table layer / cut by the border". Fix by rendering the bubble through a **portal** to `document.body`, positioned from the trigger's `getBoundingClientRect()` (show on hover/focus via local state; hide on leave/blur/Escape/scroll). Keep the `i` trigger inline; only the bubble portals out. This removes the clip everywhere without dropping the pane's rounded `overflow-hidden`. Preserve the existing a11y (role=button trigger, aria-label, focus behaviour).

## D — Manage-Roles height: fit content, cap viewport
`roles-editor`/`RolesPanel` renders in the `manage-roles` slot using `CENTERED_HALF_PANE_CLASS` (`h-[50%] max-h-full min-h-[360px] … resize`). Replace the fixed `h-[50%]` with **content height capped at the viewport**: e.g. a class like `mx-auto flex w-[50%] min-w-[420px] max-h-[calc(100vh-<chrome>)] flex-col overflow-hidden rounded-xl border border-line bg-surface p-6` — height grows with the rate-card rows but never exceeds the viewport (then the table body scrolls). Add a new shared constant (e.g. `CENTERED_FIT_PANE_CLASS` in `view-styles.ts`) if reused; otherwise inline. Verify it still works in both classic + modern (the manage-roles view renders via WorkspaceSection). Keep the centered half-width + the resize affordance if feasible.

## E — RACI chip picker redesign
`raci-chip-picker.tsx` `RaciChipPicker({ value, onChange, ariaPrefix, lang })` currently renders ALL 4 chips (R/A/C/I) always, active one highlighted, click toggles. New interaction:
- **Collapsed (default):** render ONLY the currently-selected chip (the `value`'s chip), or a neutral "set RACI" placeholder chip when `value === ""`. Clicking it **expands**.
- **Expanded (popover):** show all 4 role chips (R/A/C/I) **plus a `✕` clear chip**. Local `open` state.
  - Click a role chip → `onChange(role)` + close.
  - Click `✕` → `onChange("")` + close.
  - Click the currently-selected role again → (optional) no-op or toggle off; keep simple: selecting any role sets it + closes.
- **Close triggers:** selecting a chip, clicking the `✕`, OR clicking OUTSIDE the expanded picker (outside-click listener) → collapse. Escape also closes.
- a11y: the collapsed trigger is a `<button aria-haspopup>` with `aria-expanded`; the expanded set is a small popover (plain buttons, each `stopPropagation`; mirror the SP3 ActionRow snooze-menu disclosure pattern — NOT a half-built `role=menu`). Keep `RaciLegend` unchanged. Keep the existing chip colors (post-0.79.2 AA palette).
- The picker sits inside a RACI matrix table cell (per-milestone × stakeholder). The expanded popover must not be clipped — if the matrix cell/pane clips it, use the same portal/escape approach as C, or `position: absolute z-50` with the cell allowing overflow. Verify it isn't cut off (same class of bug as C).

## Version & testing
- **Version:** **0.81.0** (next codename) — user-visible UI batch. CHANGELOG + a `versionHighlight…` key.
- **Testing:** `raci-chip-picker.test.tsx` (collapsed shows only selected; click expands; pick role → onChange+close; ✕ → onChange("")+close; outside-click closes). `action-chips.test.tsx` (+ why-title present; existing pass). `info-tooltip.test.tsx` (normal-case; bubble renders text). trends resize + the 4 pendingOpen wirings: extend existing panel tests or add focused ones; manual-verify the deep-link opens. tsc/eslint/full vitest + e2e/a11y (12-view) green; the new popovers must not introduce nested-interactive (a11y gate guards).

## Out of scope
- Reworking the RAID deep-link (already works).
- Workload/budget/schedule editors (navigate-only by decision).
- Broad table-style changes beyond Trends.

## File summary
**New:** none required (maybe `view-styles` constant; `info-tooltip` portal stays in-file).
**Modified:** `trends-panel.tsx`, `action-chips.tsx`, task-manager/tasks + `change-panel.tsx` + `milestones-panel.tsx` + `stakeholders-panel.tsx` (pendingOpen effects), `info-tooltip.tsx`, `view-styles.ts` + the manage-roles render, `raci-chip-picker.tsx`, `i18n.ts`/`i18n.de.ts`, `version.ts`, `CHANGELOG.md` (+ tests).
