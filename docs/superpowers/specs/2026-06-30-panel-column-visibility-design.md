# Column show/hide saved in panel views — design

**Date:** 2026-06-30
**Status:** Approved design, pending implementation plan
**Area:** RAID · Milestones · Changes · Stakeholders panels + the shared `panel-views` stack

## Goal

Let users show/hide individual table columns in the RAID, Milestones, Changes, and
Stakeholders panels, and persist that choice as part of a saved panel view.

## Scope (locked)

- **All four** generic `panel-views` panels (RAID, Milestones, Changes, Stakeholders).
- Column **show/hide only** — no reordering.
- The tasks view (its own bespoke saved-views + column manager) is **untouched**.
- Hidden columns ride the existing `PanelFiltersState` → already saved/restored by
  panel views. Per-device, out of exports/Turso, cleared by `clearAppConfig`.

## Architecture

One-way: pure `panel-views.ts` state ← `panel-filters-context` ← panels. Reusable
control component shared by the four panels.

### A. Shared state

- **`panel-views.ts`** — `PanelFiltersState` gains `hiddenCols: readonly string[]`
  (default `[]`). `isValidState` accepts an optional `hiddenCols` that is an array of
  strings; **missing → `[]`** (old persisted views stay valid). When present, coerce to
  only string entries (drop non-strings) so a corrupt entry can't crash a panel.
- **`panel-filters-context.tsx`** — provider holds `hiddenCols: Set<string>` +
  `setHiddenCols: Dispatch<SetStateAction<Set<string>>>`. Seeded from
  `defaults.hiddenCols ?? []`. `applyState(s)` does `setHiddenCols(new Set(s.hiddenCols ?? []))`;
  `reset()` clears it; the exposed `state` serializes `hiddenCols: [...set]`. The
  `*_FILTER_DEFAULTS` consts each add `hiddenCols: []`.

### B. Per-panel column registry

Each panel declares a `CONFIGURABLE_COLS: readonly { key: string; labelKey: TranslationKey }[]`
listing its **toggleable data columns** (the existing `*_COL_WIDTHS` keys). The row-select
checkbox column and the trailing actions/edit column are **not** in the list (always on).

- **RAID:** id, category, title, severity, status, owner, targetDate, linkedTasks, causedBy
- **Milestones:** name, date, status, achieved
- **Changes:** id, type, title, impact, status, requestedBy, raisedDate
- **Stakeholders:** name, organization, title, category, influence, interest, resource, email

Each `labelKey` reuses the column's existing header i18n key (no new strings except where a
header currently has none — see i18n note).

### C. Reusable control `column-config-popover.tsx`

Extract the tasks gear-popover pattern into a shared presentational component:

- Props: `{ lang, cols: readonly {key,labelKey}[], hidden: Set<string>, onToggle: (key:string)=>void }`.
- Renders: a gear `<button>` (`aria-label`/`title` = `colConfigTitle`, `aria-expanded`), and
  when open a `role="dialog"` panel (`aria-label` = `colConfigTitle`) with a checklist —
  one `<label><input type=checkbox checked={!hidden.has(key)} …/></label>` per col.
- Dismiss via the shared `usePopoverDismiss` (outside-click + Escape), mirroring other popovers.
- Placed in each panel toolbar next to `<PanelViewsControl>`. Each panel passes
  `onToggle={(key) => setHiddenCols(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })}`.

(The tasks view keeps its own inline copy — not refactored, to avoid scope creep.)

### D. Per-panel th/td guards

In each of the four panels:

- Wrap each toggleable `<th>` and its matching body `<td>` with `!hiddenCols.has(key) &&`.
- Always-on columns (row-select checkbox, actions/edit) render unconditionally.
- Empty-state, no-match, and add-first-item rows compute `colSpan` from the **current visible
  column count**, e.g. `1 /*select*/ + CONFIGURABLE_COLS.filter(c => !hiddenCols.has(c.key)).length + 1 /*actions*/`,
  not a hard-coded number.
- Column resize (`useColumnResize`) is unaffected — a hidden column simply isn't rendered;
  its stored width is harmless.

## i18n

Reuse `colConfigTitle` (exists, used by tasks). Column header label keys already exist for
every listed column (they are rendered as `<th>` text today). If any panel renders a header
without an i18n key (literal/none), add an EN+DE key for that column's `labelKey`. (Verify per
panel during implementation; add keys via the umlaut-safe node write for DE.)

## a11y

- RAID and Milestones are in `A11Y_VIEWS` → the gear button must have an accessible name,
  checkboxes must be labeled, the popover `role="dialog"` + `aria-label`. Mirror the tasks
  control exactly. Changes/Stakeholders eye-verify.
- Verify with `npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"` and `-g "Milestones"`
  before pushing.

## Tests

- **`panel-views.test`:** `isValidState` accepts `hiddenCols` arrays, normalizes missing → `[]`,
  drops non-string entries; a round-trip view preserves `hiddenCols`.
- **`panel-filters-context.test`:** `setHiddenCols`, `applyState` (sets from array), `reset` (clears),
  and `state.hiddenCols` serializes the set to an array.
- **`column-config-popover.test`:** renders a checkbox per col, checked = not hidden, toggling
  fires `onToggle(key)`; gear toggles the dialog.
- **Per panel (at least Stakeholders + RAID):** hiding a column removes its header + its body cells;
  saving a view then re-applying restores the hidden set; the empty-row `colSpan` matches the
  visible column count.
- `npx tsc --noEmit`, `npm run lint`, `npm run test:run`, the two axe greps above.

## Out of scope

Column reordering; the tasks view; non-`panel-views` panels (reports/gantt/etc.); hiding the
always-on select/actions columns.

## Risk / landmines

- **`colSpan` drift:** every empty/no-match/add-first row in all four panels must derive its span
  from the visible count, or a hidden column desyncs the layout.
- **Back-compat:** persisted `lop-app:panel-views` entries predate `hiddenCols`; `isValidState`
  must treat missing as `[]`, never reject.
- **exhaustive-deps:** if a `hiddenCols`-derived value feeds a `useMemo`, hoist `hiddenCols` (or a
  derived scalar) to a local; don't put `set.size`/member expressions in a dep array.
- **DE i18n** (only if a new column label key is needed): patch `i18n.de.ts` via the node utf8
  write (umlaut/CRLF-safe), never the Edit tool.
- **Bulk-edit colSpan:** these panels already have a select column for bulk edit; keep it in the
  visible-count math.
