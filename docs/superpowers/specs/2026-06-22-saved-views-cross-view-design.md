# Saved Views — Cross-View Phase Design

**Date:** 2026-06-22
**Status:** Approved
**Feature:** Extend the tasks-only "saved views" (v0.130.0 SP1) to four more list panels.

## Goal

Give the RAID, Milestones, Changes, and Stakeholders panels the same save / apply / delete
preset control that the tasks ("Open Points") view already has, by lifting each panel's
render-local filter and sort state into a generic filter context.

## Background

SP1 (v0.130.0) shipped saved views for the tasks view only:
- `saved-views.ts` — pure store at `lop-app:saved-views`, `SavedViewPayload` (tasks filter
  fields + sortKey/sortDir + hiddenCols), `MAX_SAVED_VIEWS=30`, id=max+1, cap drops oldest.
- `use-saved-views.ts` — hook with functional-updater mutators + a persist `useEffect`.
- `saved-views-control.tsx` — select + Save + Delete in the tasks toolbar, reading/writing
  the tasks `filters-context`.

The other list panels hold their filter/sort state in render-local `useState`, so it cannot
be captured by a shared control. This phase lifts that state into a generic context.

### Current per-panel state (inventory)

| Panel | Search | Filters | Sort | Notes |
|-------|--------|---------|------|-------|
| RAID (`raid-panel.tsx`) | yes | category / severity / status | `{key,dir} \| null` (null = default order) | parent-owned `filterTaskId` backlink |
| Milestones (`milestones-panel.tsx`) | yes | status | `{key:"date",dir:"asc"}` (never null) | uses `useSortableFilter` |
| Changes (`change-panel.tsx`) | yes | type / status | `{key,dir} \| null` | |
| Stakeholders (`stakeholders-panel.tsx`) | yes | — | `{key,dir} \| null` | |

All four already persist column widths (`useColumnResize`) and pane size (`useResizable`)
independently. None has a hidden-columns feature.

## Architecture

A new generic filter context, a new view-tagged store, a new hook, and a new control.
The shipped tasks path is left entirely unchanged (no migration, no shared store).

### `panel-filters-context.tsx` (new)

```ts
type PanelSort = { key: string; dir: SortDir } | null;

interface PanelFiltersState {
  search: string;
  filters: Record<string, string>; // e.g. { category: "All", severity: "All", status: "All" }
  sort: PanelSort;
}

interface PanelFiltersValue extends PanelFiltersState {
  setSearch: (s: string) => void;
  setFilter: (key: string, value: string) => void;
  setSort: (sort: PanelSort) => void;
  applyState: (state: PanelFiltersState) => void; // apply a preset wholesale
  reset: () => void;                               // back to defaults
}
```

- `PanelFiltersProvider({ defaults, children })` seeds state from `defaults` and exposes the
  value. `usePanelFilters()` is the consumer hook (throws outside a provider).
- Provider lifetime equals the panel mount lifetime — identical to today's `useState`, so the
  "filters reset on unmount/navigation" behavior is unchanged. Saved views are the only
  persistence mechanism.
- `sort.key` is a plain string in the generic state; each panel narrows it to its own sort-key
  union at the `compareX` call site.

### `panel-views.ts` (new, pure, i18n-free)

```ts
type PanelViewKind = "raid" | "milestones" | "changes" | "stakeholders";

interface PanelView {
  id: number;
  name: string;
  view: PanelViewKind;
  state: PanelFiltersState;
}

const PANEL_VIEWS_KEY = "lop-app:panel-views"; // NEW key — tasks' lop-app:saved-views untouched
const MAX_PANEL_VIEWS = 30;                    // per view
```

- `loadPanelViews(): PanelView[]` — validated load, bad JSON → `[]`, drops malformed entries.
- `panelViewsFor(list, view)` — filter to one view.
- `addPanelView(list, view, name, state)` — id = max+1 across the whole list; appends; if that
  view now exceeds `MAX_PANEL_VIEWS`, drops the oldest entry **of that view**.
- `removePanelView(list, id)`.
- `savePanelViews(list)` — write-through; swallow quota/serialization errors.

Validation accepts an entry only when `id` is finite, `name` is a string, `view` is one of the
four kinds, and `state` has a string `search`, an object `filters` of string→string, and a
`sort` that is either `null` or `{ key: string; dir: "asc"|"desc" }`.

### `use-panel-views.ts` (new)

`usePanelViews(view: PanelViewKind)` returns:
- `views: PanelView[]` — only entries for `view`.
- `addView(name, state)` / `removeView(id)` — functional-updater mutators over the full list,
  persisted by a `useEffect([list])` (mirrors `use-saved-views.ts`).

### `panel-views-control.tsx` (new)

Generic select + Save + Delete, scoped by a `view` prop. Reads/writes `usePanelFilters()`:
- select onChange → `applyState(view.state)` (plus, for RAID, clear the task backlink — see below).
- Save → captures the live `PanelFiltersState` via context, `addView(name, state)`.
- Delete → `removeView(selectedId)`; stale-selection guard identical to the tasks control
  (a preset evicted by the cap renders the placeholder and disables Delete).
- Reuses the existing `savedViews*` i18n keys — no new strings. Single labeled controls, so no
  row-unique-label concern (same a11y shape as the tasks control).

### Per-panel refactor (×4)

Each panel splits into an outer wrapper and an inner body:

```tsx
export function RaidPanel(props: RaidPanelProps) {
  return (
    <PanelFiltersProvider defaults={RAID_FILTER_DEFAULTS}>
      <RaidPanelBody {...props} />
    </PanelFiltersProvider>
  );
}
```

`RaidPanelBody` consumes `usePanelFilters()` in place of the removed `useState` for
search/filters/sort, and mounts `<PanelViewsControl view="raid" lang={lang} />` in the existing
filter toolbar row. The filter/sort derivation (`visible`/`filtered` memo) reads context values;
sort toggles call `setSort`.

Per-panel defaults:

```ts
const RAID_FILTER_DEFAULTS = { search: "", filters: { category: "All", severity: "All", status: "All" }, sort: null };
const MILESTONE_FILTER_DEFAULTS = { search: "", filters: { status: "all" }, sort: { key: "date", dir: "asc" } };
const CHANGE_FILTER_DEFAULTS = { search: "", filters: { type: "All", status: "All" }, sort: null };
const STAKEHOLDER_FILTER_DEFAULTS = { search: "", filters: {}, sort: null };
```

RAID: applying a preset also calls `onClearTaskFilter()` so a transient task backlink does not
silently constrain the applied preset (mirrors the tasks control clearing `raidFilterTaskId`).

## Out of scope (deliberate)

- **Column widths / pane size** — already persisted independently; presets never touch them.
- **Reports** — three independent sort states across three tables; its own future slice.
- **Tasks** — bespoke `filters-context` + `saved-views` path unchanged; no shared store.
- **`filterTaskId`** — transient cross-view drill-in, not a preset field.

## Persistence boundary

`lop-app:panel-views` is a per-device localStorage store. It is OUT of exports / Turso, has no
backend write paths, and is cleared by `clearAppConfig`'s `lop-app:*` sweep. This mirrors the
SP1 saved-views boundary exactly.

## Edge cases

- A preset whose filter value no longer matches any data (e.g. a saved owner filter) yields an
  empty list — graceful, identical to tasks SP1.
- A preset selected then evicted by the cap → placeholder + disabled Delete (stale-selection
  guard).
- Presets are global (per device), not per project — applying one whose filter is irrelevant to
  the current project just yields an empty/unfiltered result.

## Testing

- `panel-views.test.ts` — load/validate/add/cap-per-view/remove/scoping; bad-JSON → `[]`.
- `panel-filters-context.test.tsx` — defaults, setFilter, setSort, applyState, reset.
- `panel-views-control.test.tsx` — Save captures state, select applies, Delete, stale guard.
- Per-panel tests — filtering and sort still work through the context; the control renders.
- a11y — RAID and Milestones are in the axe `A11Y_VIEWS` 12-view gate; verify the new control's
  labels with `npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"` (and
  `-g "Milestones"`) before pushing. Changes and Stakeholders are not axe-scanned (eye-verify).
- `npx tsc --noEmit` after any test edit (test-only type errors pass build + vitest but fail CI).

## Release

Bump `src/app/version.ts` (APP_VERSION + APP_BUILD_DATE; 0.131.x stays "Aldiss"), add a
`CHANGELOG.md` entry, add a `versionHighlightSavedViewsPanels` key to `APP_HIGHLIGHT_KEYS` with
EN + DE strings, bump README badge + `package.json`, and add an AGENTS.md pointer.
