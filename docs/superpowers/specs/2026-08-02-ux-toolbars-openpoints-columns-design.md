# UX: Planning/RACI toolbar order + Open Points column geometry

Date: 2026-08-02
Status: approved (design)
Scope: UI-only. No persisted `Workspace` field, no backend write path, no i18n string, no golden fixture.

## Problem

Three unrelated surface defects, batched because they are all toolbar/table geometry:

1. **Planning toolbar** — the "Hide externals" toggle sits at the end of the left control
   group, separated from the Outlook sync block by an `ml-auto` spacer. The Workload
   header already renders the two adjacent; Planning is the odd one out.
2. **RACI toolbar** — "Suggest RACI" sits in the trailing group beside Print/Reset, so the
   AI action reads as a trailing utility rather than the pane's primary action. Planning's
   `aiPlanButton` leads its row; RACI should match.
3. **Open Points table** — narrow utility columns (leading gutter, select, health dot,
   relations, actions) render visibly wider than they need, wasting horizontal space at
   both edges of the table.

## Root cause (item 3)

`tasks-section.tsx` renders the table as:

```
style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}
```

Under `table-layout: fixed`, when the table's used width exceeds the sum of the declared
`<col>` widths, Blink distributes the leftover **equally across every column** — not in
proportion to declared width. A 36px utility column therefore gains the same ~7–13px a
200px content column gains, which is a ~35% inflation on the narrow ones and invisible on
the wide ones.

Measured against the reported screenshot: gutter + `sel` + `status` render ≈138px against
100px declared (28 + 36 + 36), i.e. ≈12.7px added per column across 16 visible columns.

A second, independent cause: `useColumnResize` writes the **entire** width map (all 18
keys) to localStorage on any drag, and reads it back as `{...defaults, ...persisted}`.
Once a user has dragged any column even once, every default is permanently masked — so
changing `DEFAULT_COL_WIDTHS` is a no-op for them.

## Design

### T1 — Planning: move the hide-external toggle next to the Outlook block

`src/app/resources-panel-toolbar.tsx` — in `PlanningToolbar`, move `{hideExternalToggle}`
off the end of the left control group and into the trailing `ml-auto` div, ahead of
`{headerActions}`:

```jsx
<div className="ml-auto flex items-center gap-2">
  {hideExternalToggle}
  {headerActions}
</div>
```

This reproduces exactly what `renderWorkloadHeader` (`resources-panel.tsx`) already does,
so the two views stop diverging. `headerActions` itself is unchanged — it stays shared by
planning / workload / calendar, and its internal order (Outlook import → `CalendarSyncControls`
→ Print → reset-columns → reset-size) still satisfies the toolbar-order convention:
integration block before the contiguous trailing Print · reset-columns · reset-size group.

No prop signature change. `hideExternalToggle` is already a `ReactNode` prop.

**Test:** assert DOM order in the planning view — the "Hide externals" toggle precedes the
calendar-sync enable checkbox.

★ **Test trap:** `CalendarSyncControls` returns `null` unless
`m365Configured && !isPopout && onToggleCalendar`. A fixture missing any of the three
renders no anchor element, and an order assertion that queries for it passes vacuously.
Seed all three, and verify the assertion FAILS against the unmoved code before calling it
real.

### T2 — RACI: Suggest RACI leads, person filter to its right

`src/app/raci-panel.tsx` — move `{suggest.button}` out of the trailing
`flex shrink-0 items-center gap-2` group and make it the first child of the leading
`flex flex-1 flex-wrap items-center gap-2` group, ahead of the `ClearableSearchInput`.
`PrintButton` and `ResetSizeButton` stay in the trailing group, in that order.

Rationale: this matches `PlanningToolbar`, where the AI action (`aiPlanButton`) is rendered
first in the control row, and it keeps the trailing group contiguous as the convention
requires.

★ `suggest.button` is `null` when AI is off or in a popout. It is the first child of a flex
row, so a null renders nothing and the filter input simply becomes first — no layout shim
needed, no placeholder.

★ RACI is **not** in the axe `A11Y_VIEWS` list (Stakeholders is; the RACI matrix is a
separate view). Accessible names are unchanged by a reorder, but eye-verify focus order.

### T3 — Open Points column geometry

Three coordinated changes.

**T3a — `useColumnResize` persists only user-dragged keys**

`src/app/use-column-resize.ts`:

- Persist `{ v: 2, widths: { …only keys the user actually dragged… } }` instead of the full
  merged map. A key enters `widths` when `startColResize` commits a drag for it.
- Read: a `{v:2, widths}` payload is honoured; a v1 bare object is still read as before
  (all keys treated as user-set) so no other table loses its saved widths.
- Return a new `sizedCols: ReadonlySet<TId>` — the keys the user has explicitly sized.
- `resetColWidths` clears `sizedCols` along with the stored payload.

`useColumnManager()` (`use-column-manager.ts`) takes **no arguments** — it calls
`useColumnResize<string>("open-points", DEFAULT_COL_WIDTHS)` internally. So it must
re-export `sizedCols` in its own return object for `tasks-section` to reach it, and the
tableId change below is a literal edit inside that call, not a new parameter.

Every existing consumer ignores `sizedCols` and sees identical widths, because defaults
still fill every unsized key. The behavioural win is that a future `DEFAULT_COL_WIDTHS`
change now actually reaches users who dragged one unrelated column.

**T3b — Open Points adopts a flex column**

`src/app/tasks-section.tsx`:

- Change the hardcoded tableId inside `useColumnManager` from `"open-points"` to
  `"open-points-v2"`. The existing
  `aipm-cockpit:col-widths:open-points` blob holds all 18 keys and would mask every new
  default; bumping the key discards it. Precedent: the documented `useResizable`
  storage-key bump rule for the same class of defect. Users keep the "reset columns"
  button; only stale widths are lost, and only for this one table.
- Table style becomes:

  ```jsx
  style={{ tableLayout: "fixed", width: "100%", minWidth: `${tableMinWidth}px` }}
  ```

  where `tableMinWidth` = 28 (the leading gutter `w-7`) + the sum of the declared widths of
  every **visible** column, with `taskName` counted at a `TASK_NAME_MIN = 200` floor.
  Derived from `ALL_TASK_COLS.filter(c => !hiddenCols.has(c))` and `colWidths`, in a
  `useMemo` whose deps are hoisted scalars (a `Set`/object member in a dep array is a fatal
  `--max-warnings=0` warning).
- The `taskName` `<col>` emits **no** `width` unless `sizedCols.has("taskName")`. It is then
  the only auto-width column, so under fixed layout it receives 100% of the leftover
  instead of the leftover being split 16 ways.

  ★ **Why not keep `width: "max-content"`.** With an auto column present, `max-content`
  resolves against that column's longest unwrapped content — the longest task title — so
  the table would grow past the viewport and the pane would scroll horizontally at all
  times. The computed `minWidth` reproduces the intended overflow floor deterministically,
  from numbers we already hold, with no DOM measurement (jsdom reports every rect as 0, so
  a measurement-based approach would be untestable here).

- Declared width changes in `DEFAULT_COL_WIDTHS` (`use-column-manager.ts`):

  | column | before | after | why |
  |---|---|---|---|
  | `status` | 36 | 28 | holds a single ~10px RAG dot |
  | `actions` | 36 | 32 | holds one `⋮` icon button |
  | `depRelations` | 120 | 96 | renders `—` or a short chip + pencil |
  | `sel` | 36 | 36 | unchanged — 16px checkbox + tight padding needs it |

- The leading `w-7` gutter `<col>` + `<th>` are **kept**. Removing them (and overlaying the
  hover ✨ cell) was considered and rejected as out of scope for this slice; the existing
  code comment about a missing `<col>` shifting every width to its left neighbour stays
  accurate.
- `colSpan={visibleColumnCount + 1}` is unchanged (the gutter still exists).

**T3c — Tests**

- `taskName`'s `<col>` carries no inline width by default; still none after hiding several
  columns.
- A persisted `taskName` width (i.e. `sizedCols` contains it) IS emitted as an inline width.
- `tableMinWidth` drops by exactly the declared width of a column when that column is hidden.
- `useColumnResize`: a v2 payload round-trips only dragged keys; a v1 payload still reads;
  `resetColWidths` empties `sizedCols`.

★ jsdom has no layout engine — every rect is 0. Assert the **emitted style attributes and
the computed number**, never a rendered pixel width.

★ Open Points IS in the axe `A11Y_VIEWS` gate. No control is added, removed or relabelled
here, so no new accessible-name work — but re-run
`npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"` because the view
is scanned and the table markup changed.

## Out of scope

- Removing the leading gutter column / folding the health dot into the ID cell (the
  rejected option B).
- The `Math.max(40, …)` drag floor in `startColResize`, which means a 28px column can never
  be dragged back below 40px. Pre-existing, unchanged, noted so it is not mistaken for a
  regression introduced here.
- Any change to the Kanban board, which does not use the column model.

## Verification

- `npx tsc --noEmit`
- `npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"` — never through a pipe.
- `npx eslint --max-warnings=0 src/app; echo "EXIT=$?"` — no pipe.
- `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"` and `-g "Resources"`.
- Eye-verify: Planning row, RACI row, Open Points table at ~1920px and at ~1280px.
