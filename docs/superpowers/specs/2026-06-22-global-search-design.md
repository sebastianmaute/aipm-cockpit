# Global Cross-Entity Search (#13) — Design

**Date:** 2026-06-22
**Status:** Approved
**Release:** 0.128.0 "Harrison"

## Goal

A top-bar search box that queries tasks / RAID / changes / milestones / stakeholders at
once. Selecting a result deep-links to the item via `requestOpen(view, id)` — which opens
the item's editor AND scrolls + flashes its row/card (the #10–#12 infra). Always visible in
the top bar (both shells), absent in popouts.

## Background (from code map)

- Per-panel search is ad-hoc substring (`[fields].join(" ").toLowerCase().includes(q)`); NO
  fuzzy lib in `package.json`. Stay consistent — substring only.
- `useWorkspace()` (`workspace-context.tsx`) exposes `tasks, raid, changes, milestones,
  stakeholders` (readonly arrays). Available at the top-bar render scope in `task-manager.tsx`
  (inside `WorkspaceProvider`/`WorkspaceTabProvider`).
- Top-bar controls wire into BOTH headers: modern `ModernShell topBarMenus` slot + classic
  `AppHeader trailing` prop; a module-level connected wrapper instantiates the hooks (mirror
  `DisplayTzSwitcherConnected`, `task-manager.tsx:156`). Popout (`isPopout`/`legacyTree`)
  renders no header.
- `requestOpen(view, id)` (`workspace-tab-context.tsx`) sets activeTab + `pendingOpen` + hash;
  each entity panel self-opens its editor and (now) flashes the row via `useDeepLinkRowFlash`.
  `AppView` literals: `open-points` (tasks), `raid`, `changes`, `milestones`, `stakeholders`.
- a11y combobox primitives exist: `combobox-shared.tsx` — `useCombobox` (`open/highlight/
  rootRef/inputRef/moveHighlight`, ↑/↓ wrap, outside-click close) + `ComboboxOptions`
  (`role="listbox"`/`role="option"`/`aria-selected`). The top bar is in ALL 12 axe views, so
  the control must be fully labeled + keyboard-operable.
- i18n EN `i18n.ts` + DE `i18n.de.ts`, key parity tsc-enforced; DE via node utf8 write (CRLF
  anchors, real umlauts); `t(lang, key)`.

## Architecture

### 1. Pure engine `src/app/global-search.ts` (i18n-free, testable)

```ts
export type SearchResultType = "task" | "raid" | "change" | "milestone" | "stakeholder";
export interface SearchResult {
  type: SearchResultType;
  id: number;
  view: AppView;            // "open-points" | "raid" | "changes" | "milestones" | "stakeholders"
  title: string;            // primary label (taskName / title / name)
  subtitle: string;         // secondary context (assignee / owner / requestedBy / organization / "")
}
export const SEARCH_MIN_QUERY = 2;
export const SEARCH_MAX_RESULTS = 20;
export const SEARCH_MAX_PER_TYPE = 8;
export function searchWorkspace(ws: {
  tasks: readonly Task[]; raid: readonly RaidItem[]; changes: readonly ChangeItem[];
  milestones: readonly Milestone[]; stakeholders: readonly Stakeholder[];
}, query: string): SearchResult[];
```

Behavior:
- `query.trim()` shorter than `SEARCH_MIN_QUERY` → `[]`.
- Per entity, match `q = query.trim().toLowerCase()` against a TITLE field and a set of BODY
  fields (substring). Searchable fields (verify exact names against `types.ts`):
  - Task: title=`taskName`; body=`assignee, assigneeEmail, notes, blockers, group, labels(join), jiraKey`
  - RAID: title=`title`; body=`description, mitigation, owner, ownerEmail, category`
  - Change: title=`title`; body=`description, requestedBy, type`
  - Milestone: title=`name`; body=`description`
  - Stakeholder: title=`name`; body=`organization, title, email, category`
- ID match: if `q` is all digits, a result whose `id === Number(q)` is included and ranked top.
- Ranking (stable sort, no `Math.random`): (0) exact id match, (1) title-field hit, (2) body-only
  hit; within a tier preserve entity order. Apply `SEARCH_MAX_PER_TYPE` per type, then global
  `SEARCH_MAX_RESULTS` after merging (so one entity can't flood). `subtitle` = a short context
  string per type (may be `""`).
- Pure: no `Date`/`Math.random`/i18n; takes the workspace slices + query only.

### 2. Presentational `src/app/global-search-box.tsx`

Prop-driven + i18n via `lang`. Uses `useCombobox` from `combobox-shared.tsx`.
- Controlled `query` state; `results = useMemo(() => searchWorkspace(ws, query), [ws*, query])`
  — hoist the `ws` arrays to scalar locals or pass them as explicit props so the memo deps are
  scalars (avoid the exhaustive-deps complex-expression ban: depend on `tasks`, `raid`, … refs).
- Input: `role="combobox"`, `aria-label={t(lang,"searchLabel")}`, `placeholder={t(lang,"searchPlaceholder")}`,
  `aria-expanded`, `aria-controls={listId}`, `aria-autocomplete="list"`.
- Dropdown (`open && results.length`): `<ul role="listbox" id={listId}>` of `role="option"`
  rows; each row a button with accessible name = `${typeLabel} – ${title}` (row-unique), showing
  title + subtitle + a small type badge (text, palette token only — no off-palette).
- `open && query.trim().length >= SEARCH_MIN && results.length === 0` → a NON-option
  "no results" line (`t(lang,"searchNoResults")`, not `role="option"`).
- Keyboard: ↑/↓ move highlight (useCombobox), Enter selects highlighted, Escape + outside-click
  + select close and clear. On select → `onSelect(result)` → `requestOpen(result.view, result.id)`
  then clear `query` + close.
- The connected wrapper `GlobalSearchConnected({lang})` (module-level, mirrors
  `DisplayTzSwitcherConnected`) calls `useWorkspace()` + `useWorkspaceTab()` and renders the box,
  passing the workspace slices + an `onSelect` that calls `requestOpen`.

### 3. Wiring in `task-manager.tsx`

Render `<GlobalSearchConnected lang={lang} />` in BOTH header sites: the modern
`topBarMenus` cluster and the classic `AppHeader trailing` slot (mirror how the display-tz
switcher / Ask-Claude are placed). Not in the popout `legacyTree` (no header there).

## Error handling / edge cases

- Empty / `< SEARCH_MIN_QUERY` query → dropdown closed, no list.
- No matches → "no results" line (informational, not selectable).
- Result target later deleted/filtered → `requestOpen` still opens the editor (existing graceful
  behavior); the flash no-ops if the row isn't in the DOM.
- Numeric query matches `#id` exactly AND any text field containing the digits (id-exact ranked first).
- Popout: control not rendered (no header). `requestOpen` writes the hash only when not popout
  (existing).
- Large workspace: caps bound the result set; `searchWorkspace` is O(n) substring over in-memory
  arrays (no debounce needed; if perf ever matters, memoization already bounds re-compute to query/data change).

## Testing

- `global-search.test.ts`: title vs body hit ranking; per-field match for each entity; numeric
  id-exact match ranked first; `SEARCH_MIN_QUERY` (1-char → []); `SEARCH_MAX_PER_TYPE` +
  `SEARCH_MAX_RESULTS` caps; empty query → []; case-insensitivity; `view` literal correct per type.
- `global-search-box.test.tsx`: typing ≥2 chars renders a `listbox` with `option`s carrying
  row-unique accessible names; ArrowDown+Enter and a click each call `onSelect` with the right
  `{view,id}`; Escape closes + clears; `< 2` chars / no-match shows no options ("no results" line
  present on no-match). Mock `useWorkspace`/`useWorkspaceTab` or pass props directly.
- Gates: `npx tsc --noEmit`, `npm run lint` (--max-warnings=0), `npm run test:run`, `npm run build`.
- a11y: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` and `-g "Settings"`
  (top-bar control re-scanned every view) — green before push.

## Release

- `version.ts` → APP_VERSION `0.128.0`, APP_MILESTONE `"Harrison"` (Harry Harrison), APP_BUILD_DATE;
  append `"versionHighlightGlobalSearch"` to `APP_HIGHLIGHT_KEYS` (headline feature).
- i18n EN + DE: `searchLabel`, `searchPlaceholder`, `searchNoResults`, `searchResultTask`,
  `searchResultRaid`, `searchResultChange`, `searchResultMilestone`, `searchResultStakeholder`,
  `versionHighlightGlobalSearch` (DE via node utf8 write, real umlauts e.g. "Änderung", "Meilenstein").
- `CHANGELOG.md`; README badge; `package.json`.
- AGENTS.md: pointer — pure `global-search.ts` engine + `global-search-box.tsx` + the dual-header
  `GlobalSearchConnected` wrapper; result select routes through `requestOpen` (→ deep-link + flash);
  top-bar control is axe-scanned in every view (combobox a11y).

## Out of scope (v1)

Fuzzy matching; global keyboard shortcut to focus (`/`, ⌘K); searching documents / resources /
budget / activity; search history / recent; highlighting matched substrings in results.
