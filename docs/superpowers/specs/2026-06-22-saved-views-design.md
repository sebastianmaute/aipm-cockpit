# Saved Views / Filter Presets — SP1 Tasks (#15) — Design

**Date:** 2026-06-22
**Status:** Approved
**Release:** 0.130.0 "Ballard"
**Scope:** Tasks (Open Points) view only. Other views = future phases.

## Goal

Let the user save a named combination of the tasks view's filters + sort + visible columns,
and quick-apply it from the toolbar. Per-device, global (not per-project).

## Background (from code map)

- `filters-context.tsx` `useFilters()` (in-memory, session-only): `search`, `searchDebounced`,
  `priorityFilter` (`Priority|"All"`), `assigneeFilter`, `groupFilter`, `labelFilter`,
  `sortKey` (`SortKey`), `sortDir` (`SortDir`), `raidFilterTaskId`, + setters incl.
  `setSearchImmediate(value)`, `setRaidFilterTaskId`, `resetFilters`.
- Column state: `use-column-manager.ts` persists `hiddenCols` (`Set<string>`, key
  `lop-app:hidden-cols`) + `colWidths` (`lop-app:col-widths`). `hiddenCols`/`setHiddenCols` are
  threaded into `tasks-section.tsx` as props.
- Per-device store model: `landing-state.ts` / `search-recents.ts` — single `lop-app:*` key,
  defensive parse + type guard, SSR-safe, swallow quota, cleared by `clearAppConfig`'s
  `lop-app:` sweep, OUT of exports/Turso.
- Toolbar: `tasks-section.tsx:~257` flex row (column-config button, count, hide-finished, view
  toggle). The Open Points view IS in the axe `A11Y_VIEWS` 12-view gate (per AGENTS.md) — new
  controls need accessible names; a single-control design avoids the row-unique-label landmine.

## What a preset captures (`SavedViewPayload`)

```ts
interface SavedViewPayload {
  search: string;
  priorityFilter: Priority | "All";
  assigneeFilter: string;
  groupFilter: string;
  labelFilter: string;
  sortKey: SortKey;
  sortDir: SortDir;
  hiddenCols: string[];   // serialized Set
}
```
Excludes: `colWidths`, `hideFinishedTasks`, `tasksViewMode` (device/layout prefs), `raidFilterTaskId`
(transient — cleared on apply), `searchDebounced` (derived).

## Architecture

### 1. Pure store `src/app/saved-views.ts`

```ts
export const SAVED_VIEWS_KEY = "lop-app:saved-views";
export const MAX_SAVED_VIEWS = 30;
export interface SavedView { id: number; name: string; payload: SavedViewPayload; }
export function loadSavedViews(): SavedView[];                              // validate, [] on absent/malformed
export function addSavedView(list, name, payload): SavedView[];            // id = max(existing)+1 (min 1); cap; append
export function removeSavedView(list, id): SavedView[];
export function renameSavedView(list, id, name): SavedView[];
export function saveSavedViews(list): void;                                 // localStorage write, swallow
```
- Pure (the mutators take + return arrays; `id` from `Math.max(0, ...ids)+1`, NO `Date.now`/`Math.random`).
- `loadSavedViews`: try/catch JSON.parse; array-guard; validate each entry (`id` finite number,
  `name` string, `payload` object whose fields are the right primitive types, `hiddenCols` a
  string[]; coerce/drop bad). SSR-safe (`typeof window`). `[]` on any throw. Cap to `MAX_SAVED_VIEWS`.
- A shared validator guards `priorityFilter`/`sortKey`/`sortDir` loosely (string checks; the apply
  step is defensive — an unknown value simply filters to nothing, never throws).

### 2. Hook `src/app/use-saved-views.ts`

```ts
export function useSavedViews(): {
  views: SavedView[];
  addView: (name: string, payload: SavedViewPayload) => void;
  removeView: (id: number) => void;
  renameView: (id: number, name: string) => void;
};
```
- `const [views, setViews] = useState(() => loadSavedViews());`
- Each mutator uses a functional updater: `setViews(prev => addSavedView(prev, name, payload))` etc.
- Persist via `useEffect(() => { saveSavedViews(views); }, [views])` (the #14 lesson — no stale
  closure, no setState-in-effect since saveSavedViews is localStorage).

### 3. Control `src/app/saved-views-control.tsx`

Rendered in the tasks toolbar. Calls `useFilters()` + `useSavedViews()`; props
`{ lang, hiddenCols, setHiddenCols }`.
- `<select aria-label={t(lang,"savedViewsApply")}>`: placeholder option (`value=""`,
  `t(lang,"savedViewsPlaceholder")`) + one `<option value={id}>{name}</option>` per view. Track a
  local `selectedId`. `onChange` → set selectedId → **applyView(view)**.
- `applyView(view)`: from `payload` call `setSearchImmediate(search)`, `setPriorityFilter`,
  `setAssigneeFilter`, `setGroupFilter`, `setLabelFilter`, `setSortKey`, `setSortDir`,
  `setRaidFilterTaskId(null)`, `setHiddenCols(new Set(payload.hiddenCols))`.
- "Save current view" `<button>` → toggles an inline labeled `<input aria-label={t(lang,
  "savedViewsName")}>` + Save + Cancel. Save → `addView(name.trim(), capturePayload())` (ignore
  empty name); capturePayload reads the live `useFilters` values + `[...hiddenCols]`. Clear input + close.
- "Delete" `<button aria-label={t(lang,"savedViewsDelete")}>` disabled unless `selectedId` matches a
  view → `removeView(selectedId)` + reset `selectedId`.
- All controls are single (one select, two buttons, one input) — no row-list, so no per-row
  accessible-name collision. Palette tokens only.

### 4. Wire into `tasks-section.tsx`

Render `<SavedViewsControl lang={lang} hiddenCols={hiddenCols} setHiddenCols={setHiddenCols} />` in
the toolbar flex row (after the column-config button). `hiddenCols`/`setHiddenCols` already in scope
(props). No other change.

## Error handling / edge cases

- Apply a preset whose `assigneeFilter`/`groupFilter`/`labelFilter` value isn't present in the current
  project → the filter simply matches nothing (graceful, no throw). Documented (global-preset trade-off).
- Unknown `priorityFilter`/`sortKey`/`sortDir` from a tampered store → load validation coerces or drops;
  apply is defensive.
- Empty name on save → ignored (no view added).
- `loadSavedViews` malformed/absent → `[]`; `saveSavedViews` quota → swallowed.
- Cap at `MAX_SAVED_VIEWS` (append drops nothing silently beyond cap — addSavedView refuses/【trims oldest? choose: refuse add when at cap and surface nothing, OR drop oldest】 — DECISION: when at cap, drop the OLDEST (index 0) to make room, mirroring search-recents' cap behavior).
- `id` from `max+1` is stable across a session; deleting then adding reuses the next max+1 (fine —
  ids are store-internal, not cross-referenced).

## Testing

- `saved-views.test.ts`: addView assigns id=1 then 2…; addView at cap drops oldest; removeView by id;
  renameView; loadSavedViews [] when absent + drops malformed entries + round-trips; payload fields
  validated.
- `saved-views-control.test.tsx`: render inside `FiltersProvider` (or mock `useFilters`) with seeded
  filters → "Save current view" + a name → the store gains a view whose payload matches current
  filters+sort+hiddenCols; selecting a preset in the `<select>` calls the filter setters +
  `setHiddenCols` with the payload; delete removes the selected view; the select + buttons + input
  expose accessible names.
- Gates: `npx tsc --noEmit`, `npm run lint` (--max-warnings=0), `npm run test:run`, `npm run build`,
  axe `-g "Open Points"`.

## Release

- `version.ts` → APP_VERSION `0.130.0`, APP_MILESTONE `"Ballard"` (J.G. Ballard), APP_BUILD_DATE;
  append `"versionHighlightSavedViews"` to `APP_HIGHLIGHT_KEYS`.
- i18n EN+DE: `savedViewsApply`, `savedViewsPlaceholder`, `savedViewsSave`, `savedViewsName`,
  `savedViewsCancel`, `savedViewsDelete`, `versionHighlightSavedViews`. DE via node utf8 write.
- `CHANGELOG.md`; README badge; `package.json`.
- AGENTS.md: pointer — pure `saved-views.ts` (per-device `lop-app:saved-views`, cap 30, id=max+1,
  validated) + `use-saved-views.ts` (functional-updater + persist-effect) + `saved-views-control.tsx`
  (tasks toolbar; `useFilters` apply + `setHiddenCols`; single labeled controls → axe-safe; global
  presets, graceful no-match across projects); OUT of exports/Turso, cleared by `clearAppConfig`.

## Out of scope (SP1)

Saved views for RAID/changes/milestones/stakeholders (future phases — need their per-panel filter
state lifted); per-project keying; `colWidths`/layout in presets; auto-applying a default preset on
load; a full manage/reorder UI (SP1 = apply/save/delete; `renameView` lives in the store for a later
UI).
