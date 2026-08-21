# UI Batch v0.38.0 — Resizable panes, Resources nav restructure, report parity

**Date:** 2026-05-31
**Branch:** `ui-polish-batch` (continues the uncommitted modern view-pane parity work)
**Status:** Design — approved decisions captured; pending final user review

## Context

This batch extends the modern shell. The prior (uncommitted) work made every primary
view fill the viewport via `VIEW_PANE_FILL_CLASS`. That fill change is what removed the
working drag-resize from Tasks in the modern layout (the `⠿` corner at
`tasks-section.tsx:536` still renders but is inert, because the `resize` CSS class only
survives on the classic branch). This batch restores and generalizes resize, restructures
the Resources navigation, and brings the RAID and Resource reports up to the Reports
layout and table capabilities.

## Decisions (resolved with the user)

1. **Resize model:** panes fill by default; a bottom-right `⠿` corner drags to a custom
   size (persisted per view via the existing `useResizable` hook); a reset-size button
   restores fill. (Not fixed-size boxes.)
2. **Chat frame:** half of the **content area** (the region inside the sidebar + `p-6`
   inset), centered horizontally, top-anchored, percentage-based so it scales down.
3. **Reports & Budget** convert from grow-with-page (`min-h-full`, parent scrolls) to
   internal-scroll resizable cards.
4. **RAID report & Resource report** are also resizable.
5. **Resources navigation restructure** (see Group D).
6. **Manage Roles** becomes a full view/panel (modal body extracted into a shared panel).
7. **Slug migration:** silent fallback in `slugToView` with explicit remaps
   `address-book → directory`, `resource-report → resources`; any other unknown slug keeps
   the existing `open-points` default.

## Shared infrastructure (built first; reused by the groups)

### S1 — Resize affordance
- Reuse `useResizable(storageKey)` (already drives the Tasks table and Gantt chart): it
  restores a saved `{width,height}` to inline style, persists on corner-drag pointerup,
  and exposes `reset()`.
- `view-styles.ts`: add
  `VIEW_PANE_RESIZABLE_CLASS = VIEW_PANE_FILL_CLASS + " resize min-h-[300px] min-w-[480px]"`.
  (CSS `resize` works with the existing `overflow-hidden`; the inner scroll regions own
  content scrolling.)
- `task-manager-ui.tsx`: extract two reusable bits —
  - `ResizeCornerHint` — the inert `⠿` glyph currently inline in `tasks-section.tsx`.
  - `ResetSizeButton` — icon button (the existing `ResetSizeIcon`), sibling to
    `ResetColWidthsButton`.

### S2 — Report table kit
- Extract Reports' inline table primitives into a new `report-table.tsx`:
  `useSortableFilter`, `TableFilter`, the sort-header button, `compareStrOrNum`, and a
  `ReportCard` wrapper (the `print-root ${VIEW_PANE_CLASS} … p-6` chrome + top-right
  Print/Reset-cols toolbar).
- `reports.tsx` refactors to import these (no visual change — characterization tests must
  still pass).

## Groups

### A. Resizable panes (fix Tasks + add to the rest)
Each pane root adopts `VIEW_PANE_RESIZABLE_CLASS`, a `useResizable("lop-app:<view>-size")`
ref, a `ResizeCornerHint`, and a `ResetSizeButton` in its toolbar.

Storage keys: `chat`, `gantt` (pane-level — the inner-chart `resize` is removed so there
is a single handle), `resources` (the report landing — this *is* the resource report, so
no separate `resource-report` key exists), `budget`, `raid`, `reports`, `activity`,
`directory`, `workload`, `calendar`, `planning`, `manage-roles`, `raid-report`. Tasks'
modern (`fillHeight`) branch regains `resize`; the classic branch is untouched.

### B. Chat — centered half-size
`chat-panel.tsx` root drops `VIEW_PANE_FILL_CLASS` for a centered half-size variant:
`w-1/2 h-1/2 min-w-[420px] min-h-[360px] mx-auto` + the resizable/card chrome. Block flow
anchors it to the top; `mx-auto` centers horizontally; `%` sizing scales down. Still
resizable (Group A); reset returns to 50/50. The `flex-1 overflow-y-auto` message scroller
is unchanged.

### C. Budget header
- Left: a `Buckets (N)` heading mirroring the Tasks count style (new i18n key
  `budgetBucketsCount`).
- Right cluster (Tasks order): `+ Add Bucket`, `Refresh FX`, `Reset column widths`,
  `ResetSizeButton`. (Today: Add Bucket + Reset-cols sit left, Refresh FX right.)

### D. Resources & navigation restructure
New `NAV_GROUPS` shape in `nav-config.ts`:
```
Plan:
  gantt
  resources            ← parent RENDERS the Resource Report (default landing)
    ├ directory        ← renamed from "address-book" (same ResourceDirectory component)
    ├ workload
    ├ calendar
    ├ planning
    └ manage-roles
  budget
Registers:
  raid → raid-report
  reports
System:
  activity · settings
```
- `AppView`: add `directory`, `workload`, `calendar`, `planning`, `manage-roles`; remove
  `resource-report` and `address-book`.
- `LABEL_KEYS`: `directory` → new `resourcesViewDirectory`-style key labelled "Directory";
  add labels for workload/calendar/planning/manage-roles (reuse existing
  `resourcesView*` / `resourcesManageRoles` keys where possible).
- `slugToView`: explicit remaps `address-book → directory`, `resource-report → resources`;
  otherwise keep the `open-points` fallback.

**Routing approach (chosen):** keep `resources-panel.tsx` as host. Remove its internal
`SegmentedControl` and `view` state; instead the **active nav view** selects the subview
(prop-driven). `workspace-section.tsx` maps:
- `resources` → `ResourcesReportPanel` (the report; resizable),
- `directory` → `ResourceDirectory`,
- `workload` / `calendar` / `planning` → the corresponding `resources-panel` subview,
- `manage-roles` → a new `RolesPanel`.

This dissolves the `address-book` standalone (it *is* the Directory now) and avoids a full
file split (YAGNI) while removing the in-view toggle.

**Directory toolbar** (`resource-directory.tsx`): remove **Open Address Book** + **Open
Report** buttons; **Add Absence** sits next to **Add Resource**; **Reset column widths** is
the right-most button. (Add Absence becomes Directory-scoped; the report is reachable as
the Resources landing, roles via the Manage Roles sub-item.)

**Manage Roles panel:** extract the body of `roles-modal.tsx` into a shared
`roles-editor.tsx` consumed by both the existing `RolesModal` (classic) and a new
`RolesPanel` (modern view, card + resize chrome). No behavior change to the editor itself.

### E. Gantt toolbar
Move `+ Add Task` from the far right (`ml-auto`) to the **first** position, before the
search input.

### F. RAID toolbar
Remove **Open raid report**. Move `+ Add raid item` from the far right to the **first**
position, before the search input.

### G. Report parity (RAID report + Resource report)
`raid-report-panel.tsx` and `resources-report.tsx` adopt the Reports layout via the S2
`ReportCard`: summary-tile grid, sectioned tables, top-right Print + Reset-column-widths.
Their tables become **sortable + filterable + column-resizable** using the shared kit. RAID
report keeps its Summary/Full toggle. Both panes are resizable (Group A).

## Components & boundaries

- `view-styles.ts` — add `VIEW_PANE_RESIZABLE_CLASS`.
- `task-manager-ui.tsx` — add `ResizeCornerHint`, `ResetSizeButton`.
- `report-table.tsx` *(new)* — shared sort/filter/resize table kit + `ReportCard`.
- `roles-editor.tsx` *(new)* — extracted roles editor body.
- `roles-panel.tsx` *(new)* — modern Manage Roles view.
- `nav-config.ts`, `sidebar-nav.tsx` — new tree + labels + slug remaps.
- `workspace-section.tsx` — route the new views; apply resize classes/keys per pane.
- Per-pane edits: `tasks-section.tsx`, `chat-panel.tsx`, `gantt.tsx`, `raid-panel.tsx`,
  `budget-panel.tsx`, `activity-log-panel.tsx`, `resources-panel.tsx`,
  `resource-directory.tsx`, `reports.tsx`, `raid-report-panel.tsx`, `resources-report.tsx`.
- i18n: `i18n.ts` (EN) + `i18n.de.ts` (DE) — `budgetBucketsCount`, a "Directory" label,
  and any new labels. Verify `i18n.de.ts` after editing (Edit tool curly-quote hazard).

## Testing (TDD — RED → GREEN)

Source-contract / sweep tests:
- Each resizable pane root references `VIEW_PANE_RESIZABLE_CLASS` (or `resize` + a
  `lop-app:*-size` key); `tasks-section` modern branch regains `resize`.
- `reports.tsx`, `raid-report-panel.tsx`, `resources-report.tsx` import from
  `report-table.tsx`.
- Removed buttons absent: Resources Open Report / Open Address Book; RAID Open report.

Behavioral (RTL):
- Chat root uses the half-size class, not `VIEW_PANE_FILL_CLASS`.
- Gantt & RAID DOM order: add-button precedes the search input.
- Budget renders the `Buckets (N)` heading.
- Nav: `resources` renders the report; children directory/workload/calendar/planning/
  manage-roles navigate to their panels; no `resource-report` / `address-book` items.
- `slugToView("address-book") === "directory"`, `slugToView("resource-report") === "resources"`.
- RAID & Resource report tables expose sort buttons, a filter input, and resize handles.
- Existing Reports characterization tests still pass after the S2 extraction.

## Versioning
- `version.ts`: bump to `0.38.0`.
- `CHANGELOG.md`: new entry (groups A–G).
- Commit on the `ui-polish-batch` branch. Push/merge only on explicit user request.

## Out of scope
- No changes to the classic (non-modern) layout beyond what's required to keep its tests
  green (Tasks classic resize branch stays as-is).
- No data-model changes; persisted column-width / plan state untouched.
