# Global Cross-Entity Search (#13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Top-bar search box across tasks/RAID/changes/milestones/stakeholders; selecting a result `requestOpen(view,id)` (deep-link → editor + flash).

**Architecture:** Pure `global-search.ts` engine → ranked `SearchResult[]`; presentational `global-search-box.tsx` (reuses `combobox-shared.tsx` a11y); module-level `GlobalSearchConnected` wrapper instantiates `useWorkspace`+`useWorkspaceTab`; wired into both headers in `task-manager.tsx`.

**Tech:** Next.js 16 (forked) / React 19 / TS / Tailwind / vitest+RTL. Full design: `docs/superpowers/specs/2026-06-22-global-search-design.md`.

---

### Task 1: Pure engine `global-search.ts` (TDD)

**Files:** Create `src/app/global-search.ts`; Test `src/app/global-search.test.ts`.

- [ ] **Step 1: Read `types.ts`** for the exact field names on `Task`, `RaidItem`, `ChangeItem`, `Milestone`, `Stakeholder` (confirm `taskName`, `assignee`, `assigneeEmail`, `notes`, `blockers`, `group`, `labels`, `jiraKey`; `title`/`description`/`mitigation`/`owner`/`ownerEmail`/`category`; `requestedBy`/`type`; `name`/`description`; `organization`/`title`/`email`/`category`). Use only fields that actually exist (skip any that don't).

- [ ] **Step 2: Write failing tests** `global-search.test.ts`:
  - title hit ranks above body-only hit (e.g. a task with the query in `taskName` precedes one with it only in `notes`).
  - per-entity body-field match (one assertion each: a RAID matched via `owner`, a change via `requestedBy`, a stakeholder via `organization`, a milestone via `description`, a task via `labels`).
  - numeric query `"7"` returns the entity with `id===7` ranked FIRST (id-exact), ahead of text matches containing "7".
  - `searchWorkspace(ws, "a")` (1 char < `SEARCH_MIN_QUERY`) → `[]`.
  - `searchWorkspace(ws, "")` → `[]`.
  - case-insensitivity (upper-case query matches lower-case field).
  - each result's `view` is the correct `AppView` literal for its type.
  - caps: build >8 matching tasks → at most `SEARCH_MAX_PER_TYPE` task results; build matches across all types exceeding 20 → at most `SEARCH_MAX_RESULTS` total.
  Run `npm run test:run -- global-search` → FAIL.

- [ ] **Step 3: Implement** `global-search.ts` per the design's engine spec (`SearchResult`, `SearchResultType`, `SEARCH_MIN_QUERY=2`, `SEARCH_MAX_RESULTS=20`, `SEARCH_MAX_PER_TYPE=8`, `searchWorkspace`). Pure: no `Date`/`Math.random`/i18n. Stable sort by tier (id-exact → title → body), preserve entity order within tier, apply per-type cap then global cap. Build `subtitle` from a sensible secondary field per type (assignee / owner / requestedBy / organization / "").

- [ ] **Step 4: Green.** `npm run test:run -- global-search` PASS; `npx tsc --noEmit` clean; `npm run lint` clean.

- [ ] **Step 5: Commit.**
```bash
git add src/app/global-search.ts src/app/global-search.test.ts
git commit -m "feat: pure global-search engine (ranked cross-entity substring search)"
```

---

### Task 2: Search box component + connected wrapper (TDD)

**Files:** Create `src/app/global-search-box.tsx`; Test `src/app/global-search-box.test.tsx`. (Read `combobox-shared.tsx` + `display-tz-switcher.tsx` first for the `useCombobox` API + the connected-wrapper pattern.)

- [ ] **Step 1: Failing tests** `global-search-box.test.tsx` — render `GlobalSearchBox` with explicit props (workspace slices + `lang="en-US"` + a `vi.fn()` `onSelect`), so no provider needed:
  - typing ≥2 chars renders a `role="listbox"` with `role="option"` rows; each option's accessible name contains both the type label and the title (row-unique).
  - ArrowDown then Enter calls `onSelect` with the highlighted result's `{type,id,view,...}`.
  - clicking an option calls `onSelect` with that result.
  - Escape closes the listbox (no `option`s) and clears the input.
  - 1-char query → no listbox; a query with no matches → no `option`s but a visible "no results" text.
  - the input has an `aria-label` (the `searchLabel` string) and `role="combobox"`.
  Run → FAIL.

- [ ] **Step 2: Implement** `global-search-box.tsx`:
  - `GlobalSearchBox` props: `{ lang: Lang; tasks; raid; changes; milestones; stakeholders; onSelect: (r: SearchResult) => void }`.
  - Controlled `query` state; `const results = useMemo(() => searchWorkspace({tasks,raid,changes,milestones,stakeholders}, query), [tasks, raid, changes, milestones, stakeholders, query])` (deps are the array refs — scalars for exhaustive-deps).
  - Use `useCombobox` for open/highlight/rootRef/inputRef/keyboard. Input: `role="combobox"`, `aria-label={t(lang,"searchLabel")}`, `placeholder={t(lang,"searchPlaceholder")}`, `aria-expanded`, `aria-controls={listId}`, `aria-autocomplete="list"`. Generate a stable `listId` (e.g. `useId()`).
  - On change: set query; open when `query.trim().length >= SEARCH_MIN_QUERY`.
  - Render `<ul role="listbox" id={listId}>` when open && results.length: each result a `<li role="option" aria-selected={i===highlight}>` containing a `<button>` whose `aria-label` = `${t(lang, resultTypeLabelKey(type))} – ${title}`; show title + subtitle + a text type badge (palette token classes only — `text-muted-foreground`, brand tokens; NO off-palette, NO shadow).
  - When open && query≥min && results empty → a `<div>` (NOT role=option) with `t(lang,"searchNoResults")`.
  - Enter → select `results[highlight]`; click → select that row; select → `onSelect(r)`, clear query, close. Escape/outside-click → clear + close.
  - A small `resultTypeLabelKey(type)` map → the 5 i18n keys.
  - `GlobalSearchConnected({ lang }: { lang: Lang })` — module-level: `const ws = useWorkspace(); const { requestOpen } = useWorkspaceTab(); return <GlobalSearchBox lang={lang} tasks={ws.tasks} raid={ws.raid} changes={ws.changes} milestones={ws.milestones} stakeholders={ws.stakeholders} onSelect={(r) => requestOpen(r.view, r.id)} />;`
  - Keep the component palette-safe + responsive (a reasonable max-width; the dropdown `absolute` under the input, `z`-above content, `max-h` + `overflow-auto` with `pr-2`).

- [ ] **Step 3: Green + gates.** `npm run test:run -- global-search-box` PASS; `npx tsc --noEmit`; `npm run lint`.

- [ ] **Step 4: Commit.**
```bash
git add src/app/global-search-box.tsx src/app/global-search-box.test.tsx
git commit -m "feat: global-search-box combobox (a11y listbox, deep-link on select)"
```

---

### Task 3: Wire into both headers

**Files:** Modify `src/app/task-manager.tsx`.

- [ ] **Step 1:** Import `GlobalSearchConnected`. Read how `DisplayTzSwitcherConnected`/the Ask-Claude control are placed in (a) the modern `topBarMenus` JSX cluster and (b) the classic `AppHeader trailing` prop.

- [ ] **Step 2:** Render `<GlobalSearchConnected lang={lang} />` in BOTH: the modern `topBarMenus` cluster (leading or beside the existing controls — pick a sensible spot, e.g. before the Ask-Claude/switcher group) and the classic `AppHeader trailing` slot. Do NOT add it to the popout `legacyTree` (it has no header). If `trailing` already carries a control, compose both in a fragment/flex wrapper.

- [ ] **Step 3: Verify.** `npx tsc --noEmit`, `npm run lint`, `npm run test:run` (full suite green — existing task-manager tests must pass). 

- [ ] **Step 4: a11y gate.** `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` and `-g "Settings"` (top-bar control now scanned in every view) → green. Fix any axe finding (label/role) before proceeding.

- [ ] **Step 5: Commit.**
```bash
git add src/app/task-manager.tsx
git commit -m "feat: mount global search in both top-bar headers"
```

---

### Task 4: Release 0.128.0 "Harrison" + i18n + docs

**Files:** `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `CHANGELOG.md`, `README.md`, `package.json`, `AGENTS.md`.

- [ ] **Step 1: version.ts** — `APP_VERSION="0.128.0"`, `APP_MILESTONE="Harrison"` (Harry Harrison), `APP_BUILD_DATE="2026-06-22"`, update the milestone doc-comment, append `"versionHighlightGlobalSearch"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: i18n EN** (`i18n.ts`) — add: `searchLabel: "Global search"`, `searchPlaceholder: "Search tasks, RAID, changes, milestones, stakeholders…"`, `searchNoResults: "No matching items"`, `searchResultTask: "Task"`, `searchResultRaid: "RAID"`, `searchResultChange: "Change"`, `searchResultMilestone: "Milestone"`, `searchResultStakeholder: "Stakeholder"`, `versionHighlightGlobalSearch: "Global search across tasks, RAID, changes, milestones, and stakeholders"`.

- [ ] **Step 3: i18n DE** (`i18n.de.ts`) — add the SAME keys via a node utf8 write script (NOT the Edit tool; CRLF `\r\n` anchors; real umlauts). Values: `searchLabel: "Globale Suche"`, `searchPlaceholder: "Aufgaben, RAID, Änderungen, Meilensteine, Stakeholder durchsuchen…"`, `searchNoResults: "Keine passenden Einträge"`, `searchResultTask: "Aufgabe"`, `searchResultRaid: "RAID"`, `searchResultChange: "Änderung"`, `searchResultMilestone: "Meilenstein"`, `searchResultStakeholder: "Stakeholder"`, `versionHighlightGlobalSearch: "Globale Suche über Aufgaben, RAID, Änderungen, Meilensteine und Stakeholder"`. Verify EN/DE parity (`npx tsc --noEmit`) and umlauts intact.

- [ ] **Step 4: CHANGELOG** — new top entry:
```
## [0.128.0] - 2026-06-22 "Harrison"

### Added
- Global search in the top bar: query tasks, RAID items, changes, milestones, and stakeholders at once; selecting a result jumps to the item, opens its editor, and highlights its row.
```

- [ ] **Step 5: README badge** → `v0.128.0_%22Harrison%22`. **package.json** → `"0.128.0"`.

- [ ] **Step 6: AGENTS.md** — add an architecture pointer: pure `global-search.ts` (`searchWorkspace`, caps, id-exact/title/body ranking) + `global-search-box.tsx` (combobox via `combobox-shared`, `role=listbox/option`) + module-level `GlobalSearchConnected` wrapping `useWorkspace`+`useWorkspaceTab`, mounted in BOTH headers (`topBarMenus` + `AppHeader trailing`, not popout). Result select → `requestOpen(view,id)` → deep-link + flash. ★ Top-bar control → scanned in every axe view; keep combobox a11y intact.

- [ ] **Step 7: Verify** — `npx tsc --noEmit`, `npm run lint`, `npm run test:run`, `npm run build`. Restore any CRLF-only diff on `operating-guide-builtin.generated.ts`. Confirm tree clean (only intended files).

- [ ] **Step 8: Commit.**
```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md README.md package.json AGENTS.md
git commit -m "release: 0.128.0 \"Harrison\" — global cross-entity search"
```

---

## Self-review

- Coverage: engine (T1), box+wrapper (T2), header wiring (T3), release+i18n+docs (T4). ✓
- Type consistency: `SearchResult{type,id,view,title,subtitle}`, `searchWorkspace(ws, query)`, `GlobalSearchBox` props, `GlobalSearchConnected({lang})`. ✓
- a11y: combobox/listbox/option roles + aria-label, top-bar axe gate in T3. ✓
- No placeholders. ✓
