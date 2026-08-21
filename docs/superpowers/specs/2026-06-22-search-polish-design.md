# Search Polish (#14) — Design

**Date:** 2026-06-22
**Status:** Approved
**Release:** 0.129.0 "Slonczewski"
**Builds on:** #13 global search (0.128.0).

## Goal

Three refinements to the top-bar global search: a keyboard focus shortcut, matched-substring
highlighting in results, and a per-device recent-items list shown on empty focus.

## Current state

`global-search-box.tsx` (read): `GlobalSearchBox` holds `query`, `results = useMemo(searchWorkspace…)`,
`useCombobox(query, results.length)`, renders a combobox input + a `role="listbox"` of
`role="option"` `<li>`s (activedescendant pattern, no nested button) + a no-results `<div>`.
`select(r)` calls `onSelect`, clears query, closes. `GlobalSearchConnected` wires
`useWorkspace`+`useWorkspaceTab` (`onSelect → requestOpen(view,id)`).

## Architecture

### 1. Focus shortcut (in `GlobalSearchBox`)

A `useEffect` registering a document `keydown` listener (cleaned up on unmount):
- `(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"` → `e.preventDefault(); inputRef.current?.focus()`.
- `e.key === "/"` AND the event target / `document.activeElement` is NOT an editable element
  (`INPUT`, `TEXTAREA`, `SELECT`, or `isContentEditable`) → `e.preventDefault(); focus()`. Guard
  prevents hijacking "/" while the user types elsewhere.
- Escape handling stays in the input's `onKeyDown` (already clears+closes); ALSO `inputRef.current?.blur()`.
- The listener only focuses an existing input ref — harmless if (hypothetically) two instances mount;
  in practice only the active layout's header mounts one `GlobalSearchBox`.

### 2. Match highlighting — new pure `src/app/search-highlight.ts`

```ts
export interface HighlightSegment { text: string; match: boolean; }
/** Split text into alternating non-match / match segments for all case-insensitive
 *  occurrences of query.trim(). Empty/whitespace query → single non-match segment. */
export function splitHighlight(text: string, query: string): HighlightSegment[];
```
Pure: no regex-injection risk (use `indexOf` scanning on lowercased copies, NOT a RegExp built from
user input — avoids needing to escape metachars and avoids the `/s` flag tsc trap). Returns
contiguous segments preserving original casing. The box renders `match` segments in a palette-safe
span: `className="rounded-sm bg-AIPM-green/20"` (brand token, no off-palette, no shadow). Applied to
the result `title` and `subtitle` ONLY when querying (recents are not highlighted).

### 3. Recent items — new pure store `src/app/search-recents.ts`

```ts
import type { SearchResult } from "./global-search";
export const RECENTS_KEY = "lop-app:search-recents";
export const MAX_RECENTS = 8;
export function loadRecents(): SearchResult[];               // validates shape, [] on absent/malformed
export function pushRecent(list: readonly SearchResult[], r: SearchResult): SearchResult[]; // dedupe by type+id, newest first, capped
export function saveRecents(list: readonly SearchResult[]): void;  // localStorage write, swallow errors
```
- Per-browser localStorage; NOT a Workspace field → OUT of exports/Turso/recovery; cleared by
  `clearAppConfig`'s `lop-app:*` sweep (key has the `lop-app:` prefix).
- `loadRecents` defensively validates each entry is `{type,id,view,title,subtitle}` with the right
  primitive types + a known `SearchResultType`; drops malformed; never throws.
- `pushRecent` is pure (returns a new array); the box calls `saveRecents` after pushing.

### Box integration (`global-search-box.tsx`)

- `const [recents, setRecents] = useState<SearchResult[]>(() => loadRecents());` (lazy init).
- `recentsToShow` = `useMemo`: filter `recents` to entries whose `{type,id}` still exists in the live
  workspace slices (so stale / other-project recents silently drop). Deps: the five slice refs + `recents`.
- Unified active list: `const showingRecents = isOpen && query.trim().length === 0 && recentsToShow.length > 0;`
  `const items = showingRecents ? recentsToShow : results;`
- `useCombobox(query, items.length)`; keyboard Enter/Arrow + activedescendant operate over `items`.
- `shouldOpen = results.length > 0 || query.trim().length >= SEARCH_MIN_QUERY || (query.trim().length === 0 && recentsToShow.length > 0);`
  Add `onFocus={() => setOpen(true)}` so focusing with an empty query (and recents) opens the list.
- `select(r)`: `onSelect(r)`; `const next = pushRecent(recents, r); setRecents(next); saveRecents(next);`
  then clear query + close.
- Render: when `showingRecents`, a non-option `<div>` "Recent" header (`t(lang,"searchRecent")`) above
  the `<ul>`; options render `items` (no highlight for recents). When querying, options render `results`
  with `splitHighlight` on title + subtitle. The no-results `<div>` shows only when querying
  (`query≥min && results.length===0`), NOT when empty with recents.
- Option ids/aria-activedescendant indexing stays over `items`.

## Error handling / edge cases

- Empty query + no recents (or none live) → list closed on focus (nothing to show).
- Stale recent (deleted/other project) → filtered out of display; if somehow selected, `requestOpen`
  opens nothing (graceful, existing behavior).
- `loadRecents` malformed/absent → `[]`; `saveRecents` quota/error → swallowed (search still works).
- `splitHighlight` empty query → one non-match segment (no `<mark>`); query longer than text or
  no occurrence → single non-match segment.
- `/` shortcut never fires while typing in any editable element.

## Testing

- `search-highlight.test.ts`: single match, multiple occurrences, case-insensitive, no-match → one
  segment, empty query → one non-match segment, query with regex metachars (e.g. `.` `(`) treated
  literally (no throw, literal match).
- `search-recents.test.ts`: push prepends + dedupes by type+id, cap at `MAX_RECENTS`, `loadRecents`
  returns [] on absent + drops malformed entries, round-trip save/load (jsdom localStorage).
- `global-search-box.test.tsx` additions: ⌘K (metaKey+k) focuses the input; "/" focuses when body is
  active but NOT when a text input is focused; with recents seeded + empty query + focus, the recents
  listbox shows under a "Recent" header and selecting one calls `onSelect`; typing renders `<mark>` on
  the matched substring in a result. (Seed localStorage / pass recents via the store; stub as needed.)
- Gates: `npx tsc --noEmit`, `npm run lint` (--max-warnings=0), `npm run test:run`, `npm run build`,
  axe `-g "Dashboard"` + `-g "Settings"`.

## Release

- `version.ts` → APP_VERSION `0.129.0`, APP_MILESTONE `"Slonczewski"` (Joan Slonczewski), APP_BUILD_DATE;
  NO new `APP_HIGHLIGHT_KEYS` entry (refinement of #13's `versionHighlightGlobalSearch`).
- i18n EN+DE: `searchRecent` ("Recent" / "Zuletzt"). DE via node utf8 write.
- `CHANGELOG.md`; README badge; `package.json`.
- AGENTS.md: extend the global-search pointer — focus shortcut (⌘K / guarded "/"), `search-highlight.ts`
  (`splitHighlight`, palette `bg-AIPM-green/20`), `search-recents.ts` (per-device `lop-app:search-recents`,
  cap 8, live-filtered display, out of exports/Turso, cleared by `clearAppConfig`).

## Out of scope

Per-project recents keying (global store + live-filter instead); removing individual recents; fuzzy
matching; persisting the recents across devices.
