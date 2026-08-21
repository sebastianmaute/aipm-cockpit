# Search Polish (#14) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Add a focus shortcut, match highlighting, and per-device recent items to the global search box.

**Architecture:** Two new pure modules (`search-highlight.ts`, `search-recents.ts`) + integration into `global-search-box.tsx` (document keydown shortcut, unified recents/results list, `<mark>` highlighting). Release 0.129.0 "Slonczewski".

**Tech:** Next.js 16 (forked) / React 19 / TS / Tailwind / vitest+RTL. Full design: `docs/superpowers/specs/2026-06-22-search-polish-design.md`.

---

### Task 1: Pure `search-highlight.ts` (TDD)

**Files:** Create `src/app/search-highlight.ts`; Test `src/app/search-highlight.test.ts`.

- [ ] **Step 1: Failing tests** — assert `splitHighlight(text, query)` returns `HighlightSegment[]`:
  - `splitHighlight("Fix login bug", "login")` → `[{text:"Fix ",match:false},{text:"login",match:true},{text:" bug",match:false}]`.
  - multiple occurrences (`"aXaXa","X"`) → 5 alternating segments, matches at the X's.
  - case-insensitive: `splitHighlight("Login","log")` → match segment `"Log"` (original casing preserved).
  - no occurrence → single `{text, match:false}`.
  - empty/whitespace query → single `{text, match:false}` (no match segment).
  - regex metachars literal: `splitHighlight("a.b","." )` matches the literal `.` only (does NOT throw, does NOT treat as wildcard).
  Run `npm run test:run -- search-highlight` → FAIL.

- [ ] **Step 2: Implement** `splitHighlight` using `indexOf` scanning on `text.toLowerCase()` vs `query.trim().toLowerCase()` (NOT a `RegExp` built from input — avoids metachar escaping + the `/s` tsc trap). Walk occurrences, slice the ORIGINAL `text` for each segment to preserve casing. Empty/whitespace query → `[{text, match:false}]`. Export `HighlightSegment` + `splitHighlight`. Pure (no Date/Math.random).

- [ ] **Step 3: Green + gates.** `npm run test:run -- search-highlight`, `npx tsc --noEmit`, `npm run lint`.

- [ ] **Step 4: Commit.**
```bash
git add src/app/search-highlight.ts src/app/search-highlight.test.ts
git commit -m "feat: pure splitHighlight (match-substring segmentation for search results)"
```

---

### Task 2: Pure `search-recents.ts` (TDD)

**Files:** Create `src/app/search-recents.ts`; Test `src/app/search-recents.test.ts`.

- [ ] **Step 1: Failing tests** (jsdom has `localStorage`):
  - `pushRecent([], r1)` → `[r1]`; `pushRecent([r1], r2)` → `[r2, r1]` (newest first).
  - dedupe: `pushRecent([r1], {...r1})` (same type+id) → `[r1]` length 1 (moved to front, not duplicated).
  - cap: pushing 10 distinct → length `MAX_RECENTS` (8), newest kept.
  - `loadRecents()` with nothing stored → `[]`.
  - `loadRecents()` with malformed JSON / wrong-shape entries → drops bad entries (or `[]`), never throws.
  - round-trip: `saveRecents([r1,r2]); loadRecents()` → `[r1,r2]`.
  Build `SearchResult` fixtures (`{type:"task",id:1,view:"open-points",title:"A",subtitle:""}`). `beforeEach(() => localStorage.clear())`.
  Run → FAIL.

- [ ] **Step 2: Implement** `RECENTS_KEY="lop-app:search-recents"`, `MAX_RECENTS=8`, `loadRecents` (JSON.parse in try/catch → validate each entry: `type` is one of the 5 `SearchResultType`s, `id` number, `view` string, `title` string, `subtitle` string; filter invalid; return [] on any throw), `pushRecent` (pure: filter out same `type+id`, unshift, slice to cap), `saveRecents` (try/catch `localStorage.setItem`, swallow). Import `SearchResult`/`SearchResultType` from `./global-search`. No Date/Math.random.

- [ ] **Step 3: Green + gates.** `npm run test:run -- search-recents`, `npx tsc --noEmit`, `npm run lint`.

- [ ] **Step 4: Commit.**
```bash
git add src/app/search-recents.ts src/app/search-recents.test.ts
git commit -m "feat: per-device search-recents store (load/push/save, capped + validated)"
```

---

### Task 3: Integrate into `global-search-box.tsx` + i18n (TDD)

**Files:** Modify `src/app/global-search-box.tsx`, `src/app/global-search-box.test.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: i18n key.** Add `searchRecent` to `i18n.ts` EN (`"Recent"`) and `i18n.de.ts` DE (`"Zuletzt"`, via node utf8 write — CRLF anchor, no Edit tool). Verify parity (tsc).

- [ ] **Step 2: Failing box tests** (in `global-search-box.test.tsx`, `beforeEach` clears localStorage; stub `scrollIntoView`):
  - ⌘K: `fireEvent.keyDown(document, { key: "k", metaKey: true })` → the search input has focus (`document.activeElement === input`).
  - "/" guarded: with `document.body` active, `keyDown(document,{key:"/"})` → input focused; but when another text input is focused first, "/" does NOT steal focus (assert the other input keeps focus).
  - recents: pre-seed via `saveRecents([...])` (or render then select one), focus the empty box → a "Recent" header (`getByText` the EN label) + the recent option(s) render; clicking one calls `onSelect` with it.
  - highlight: type a query that matches → the matched substring renders inside a `<mark>`-like element (assert an element with the highlight class / a `mark` tag wraps the matched text). Use a container query.
  Run → FAIL.

- [ ] **Step 3: Implement** the box changes per the design "Box integration":
  - lazy `recents` state from `loadRecents()`; `recentsToShow` memo (filter to live workspace by `type+id`); `showingRecents`; unified `items`; `useCombobox(query, items.length)`; `shouldOpen` extended; `onFocus` opens.
  - document `keydown` effect for ⌘K / Ctrl-K + guarded "/"; cleanup on unmount; Escape in input also blurs.
  - `select` pushes + saves recents.
  - render: "Recent" header `<div>` when `showingRecents`; map `items`; for query mode wrap title/subtitle via `splitHighlight` → `<mark className="rounded-sm bg-AIPM-green/20">` for match segments (plain text otherwise); no-results only when querying.
  - Keep option ids/`aria-activedescendant` over `items`; keep the activedescendant pattern (no nested button).
  - Hard rules: exhaustive-deps satisfied (memo deps are slice refs + `recents` + `query`; the keydown effect deps — `[]` plus refs are stable, but if it reads nothing reactive use `[]`; inputRef is a ref); NO `Date.now()`/`Math.random()`/`new Date()`; no unused vars; `useId` stable.

- [ ] **Step 4: Green + gates.** `npm run test:run -- global-search-box`, `npx tsc --noEmit`, `npm run lint`.

- [ ] **Step 5: a11y.** `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` and `-g "Settings"` → green (top-bar control re-scanned; `<mark>`/"Recent" header are non-interactive).

- [ ] **Step 6: Commit.**
```bash
git add src/app/global-search-box.tsx src/app/global-search-box.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: search focus shortcut, match highlighting, recent items"
```

---

### Task 4: Release 0.129.0 "Slonczewski" + docs

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `README.md`, `package.json`, `AGENTS.md`.

- [ ] **Step 1: version.ts** — `APP_VERSION="0.129.0"`, `APP_MILESTONE="Slonczewski"` (Joan Slonczewski), `APP_BUILD_DATE="2026-06-22"`, update the milestone doc-comment + build-date comment. NO new highlight key.

- [ ] **Step 2: CHANGELOG** — new top entry:
```
## [0.129.0] - 2026-06-22 "Slonczewski"

### Changed
- Global search polish: press ⌘K / Ctrl-K (or "/") to jump to the search box; matched text is highlighted in results; and recently opened items appear when you focus the empty search box.
```

- [ ] **Step 3: README badge** → `v0.129.0_%22Slonczewski%22`. **package.json** → `"0.129.0"`.

- [ ] **Step 4: AGENTS.md** — extend the global-search bullet: focus shortcut (⌘K/Ctrl-K always; "/" guarded against editable elements; Escape blurs), `search-highlight.ts` (`splitHighlight`, `indexOf`-based not RegExp, `<mark>` = `bg-AIPM-green/20`), `search-recents.ts` (per-device `lop-app:search-recents`, `MAX_RECENTS=8`, validated load, shown on empty focus filtered to live workspace, OUT of exports/Turso, cleared by `clearAppConfig`).

- [ ] **Step 5: Verify** — `npx tsc --noEmit`, `npm run lint`, `npm run test:run`, `npm run build`; restore any CRLF-only diff on `operating-guide-builtin.generated.ts`; confirm tree clean.

- [ ] **Step 6: Commit.**
```bash
git add src/app/version.ts CHANGELOG.md README.md package.json AGENTS.md
git commit -m "release: 0.129.0 \"Slonczewski\" — search polish (shortcut, highlight, recents)"
```

---

## Self-review

- Coverage: highlight engine (T1), recents store (T2), box integration + i18n (T3), release+docs (T4). ✓
- Type consistency: `HighlightSegment{text,match}`, `splitHighlight(text,query)`, `loadRecents/pushRecent/saveRecents`, `SearchResult` reused. ✓
- a11y: activedescendant preserved, `<mark>`/header non-interactive, axe gate in T3. ✓
- No placeholders. ✓
