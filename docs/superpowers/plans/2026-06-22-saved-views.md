# Saved Views — SP1 Tasks (#15) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Save/apply/delete named presets of the tasks view's filters + sort + visible columns.

**Architecture:** Pure store `saved-views.ts` → hook `use-saved-views.ts` (functional updater + persist-effect) → toolbar control `saved-views-control.tsx` (applies via `useFilters` + `setHiddenCols`). Per-device global store. Release 0.130.0 "Ballard".

**Tech:** Next.js 16 (forked) / React 19 / TS / Tailwind / vitest+RTL. Full design: `docs/superpowers/specs/2026-06-22-saved-views-design.md`.

---

### Task 1: Pure store `saved-views.ts` (TDD)

**Files:** Create `src/app/saved-views.ts`; Test `src/app/saved-views.test.ts`.

- [ ] **Step 1: Read types.** From `filters-context.tsx` get `SortKey`/`SortDir`; from `types.ts` get `Priority`. Define `SavedViewPayload` (search, priorityFilter: `Priority|"All"`, assigneeFilter, groupFilter, labelFilter: string, sortKey: SortKey, sortDir: SortDir, hiddenCols: string[]).

- [ ] **Step 2: Failing tests** `saved-views.test.ts` (`beforeEach(() => localStorage.clear())`; `mkPayload(over)` factory):
  - `addSavedView([], "A", p)` → 1 view, `id === 1`; add "B" → second `id === 2`.
  - `removeSavedView(list, 1)` removes by id.
  - `renameSavedView(list, 1, "X")` renames.
  - cap: add `MAX_SAVED_VIEWS + 2` → length `MAX_SAVED_VIEWS`, OLDEST dropped (newest kept, ids still increasing).
  - `loadSavedViews()` absent → `[]`; malformed JSON → `[]`; an array with one valid + one bad entry → only the valid.
  - round-trip: `saveSavedViews([v]); loadSavedViews()` → `[v]`.
  Run `npm run test:run -- saved-views` → FAIL.

- [ ] **Step 3: Implement** per design §1: `SAVED_VIEWS_KEY="lop-app:saved-views"`, `MAX_SAVED_VIEWS=30`; `loadSavedViews` (try/catch, array-guard, per-entry validator: `id` finite number, `name` string, `payload` an object with string `search/assigneeFilter/groupFilter/labelFilter`, string `priorityFilter/sortKey/sortDir`, `hiddenCols` an array of strings; drop invalid), `addSavedView` (`id = Math.max(0, ...list.map(v=>v.id)) + 1`; append; if length > cap, drop from the FRONT to cap), `removeSavedView`, `renameSavedView`, `saveSavedViews` (try/catch setItem, SSR-guard). No `Date.now`/`Math.random`. Pure mutators (new arrays).

- [ ] **Step 4: Green + gates.** `npm run test:run -- saved-views`, `npx tsc --noEmit`, `npm run lint`.

- [ ] **Step 5: Commit.**
```bash
git add src/app/saved-views.ts src/app/saved-views.test.ts
git commit -m "feat: pure saved-views store (filter/sort/column presets, capped + validated)"
```

---

### Task 2: Hook `use-saved-views.ts` (TDD)

**Files:** Create `src/app/use-saved-views.ts`; Test `src/app/use-saved-views.test.tsx`.

- [ ] **Step 1: Failing tests** — render the hook via a tiny probe (or `@testing-library/react` `renderHook`). `beforeEach` clears localStorage. Assert:
  - initial `views` = `loadSavedViews()` (seed localStorage, mount → views present).
  - `addView("A", p)` → `views` has it AND localStorage now contains it (persisted via effect; flush with `act`).
  - `removeView(id)` → gone from state + storage.
  - `renameView(id,"X")` → renamed in state + storage.
  Run → FAIL.

- [ ] **Step 2: Implement** `useSavedViews`: `const [views, setViews] = useState(() => loadSavedViews());` mutators via functional updater (`setViews(prev => addSavedView(prev, name, payload))`, etc.); `useEffect(() => { saveSavedViews(views); }, [views])`. No setState-in-effect (saveSavedViews is localStorage). Return `{views, addView, removeView, renameView}`.

- [ ] **Step 3: Green + gates.** test:run scoped, tsc, lint.

- [ ] **Step 4: Commit.**
```bash
git add src/app/use-saved-views.ts src/app/use-saved-views.test.tsx
git commit -m "feat: useSavedViews hook (load + persist presets via functional updater)"
```

---

### Task 3: Control `saved-views-control.tsx` + wire into tasks toolbar + i18n (TDD)

**Files:** Create `src/app/saved-views-control.tsx`, `src/app/saved-views-control.test.tsx`; Modify `src/app/tasks-section.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: i18n.** Add EN keys to `i18n.ts`: `savedViewsApply: "Apply a saved view"`, `savedViewsPlaceholder: "Saved views…"`, `savedViewsSave: "Save current view"`, `savedViewsName: "View name"`, `savedViewsCancel: "Cancel"`, `savedViewsDelete: "Delete the selected saved view"`. DE in `i18n.de.ts` via NODE utf8 write (CRLF anchor): `"Gespeicherte Ansicht anwenden"`, `"Gespeicherte Ansichten…"`, `"Aktuelle Ansicht speichern"`, `"Ansichtsname"`, `"Abbrechen"`, `"Ausgewählte Ansicht löschen"` (real umlauts: ä/ö in "löschen"/"Ausgewählte"). Verify parity (tsc) + umlauts intact.

- [ ] **Step 2: Failing control tests** `saved-views-control.test.tsx` — render `<SavedViewsControl>` inside a `FiltersProvider` (import the real provider) with `hiddenCols`/`setHiddenCols` props (a `vi.fn()` setter + a Set); `beforeEach` clears localStorage; seed filters by rendering a small harness that sets them, OR mock `useFilters` to return known values + spy setters. Assert:
  - clicking "Save current view", typing a name, clicking Save → `loadSavedViews()` has a view whose `payload` equals the current filter values + `[...hiddenCols]`.
  - with a seeded view, selecting it in the `<select>` (fireEvent.change to its id) → the `useFilters` setters are called with the payload values AND `setHiddenCols` called with a Set equal to `new Set(payload.hiddenCols)`.
  - delete: select a view, click Delete → `loadSavedViews()` no longer has it.
  - the `<select>` + Save button + Delete button have accessible names (the i18n strings).
  Run → FAIL.

- [ ] **Step 3: Implement** `saved-views-control.tsx` per design §3: `useFilters()` + `useSavedViews()`; local `selectedId` + `saving` (inline-input toggle) + `name` state; `capturePayload()` reads live filters + `[...hiddenCols]`; `applyView(view)` calls all setters incl. `setSearchImmediate`, `setRaidFilterTaskId(null)`, `setHiddenCols(new Set(payload.hiddenCols))`; the `<select>`/buttons/input with aria-labels; palette tokens only (match the toolbar's existing control styling — `border-line`, `bg-surface`, etc.). No `Date.now`/`Math.random`/`new Date()`.

- [ ] **Step 4: Wire** into `tasks-section.tsx`: import + render `<SavedViewsControl lang={lang} hiddenCols={hiddenCols} setHiddenCols={setHiddenCols} />` in the toolbar flex row (after the column-config button; confirm `lang`, `hiddenCols`, `setHiddenCols` are in scope there).

- [ ] **Step 5: Green + gates.** `npm run test:run -- saved-views-control`, then `npm run test:run` (full — tasks-section tests must still pass), `npx tsc --noEmit`, `npm run lint`.

- [ ] **Step 6: a11y.** `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"` → green.

- [ ] **Step 7: Commit.**
```bash
git add src/app/saved-views-control.tsx src/app/saved-views-control.test.tsx src/app/tasks-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: saved-views control in the tasks toolbar (apply/save/delete presets)"
```

---

### Task 4: Release 0.130.0 "Ballard" + docs

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `README.md`, `package.json`, `AGENTS.md`.

- [ ] **Step 1: version.ts** — `APP_VERSION="0.130.0"`, `APP_MILESTONE="Ballard"` (J.G. Ballard), `APP_BUILD_DATE="2026-06-22"`, update build-date + milestone doc-comment, APPEND `"versionHighlightSavedViews"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: i18n highlight key** — EN `versionHighlightSavedViews: "Save and re-apply named filter/sort/column presets for the tasks view"`; DE (node utf8 write) `"Benannte Filter-/Sortier-/Spaltenvorlagen für die Aufgabenansicht speichern und erneut anwenden"`.

- [ ] **Step 3: CHANGELOG** — new top entry:
```
## [0.130.0] - 2026-06-22 "Ballard"

### Added
- Saved views for the tasks list: save the current filters, sort, and visible columns as a named preset and re-apply it from the toolbar (per device). Delete presets you no longer need.
```

- [ ] **Step 4: README badge** → `v0.130.0_%22Ballard%22`. **package.json** → `"0.130.0"`.

- [ ] **Step 5: AGENTS.md** — add the architecture pointer from design §"AGENTS.md".

- [ ] **Step 6: Verify** — `npx tsc --noEmit`, `npm run lint`, `npm run test:run`, `npm run build`; restore any CRLF-only diff on `operating-guide-builtin.generated.ts`; confirm tree clean.

- [ ] **Step 7: Commit.**
```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md README.md package.json AGENTS.md
git commit -m "release: 0.130.0 \"Ballard\" — saved views for the tasks list"
```

---

## Self-review

- Coverage: store (T1), hook (T2), control + wiring + i18n (T3), release+docs (T4). ✓
- Type consistency: `SavedView{id:number,name,payload}`, `SavedViewPayload`, `useSavedViews` returns, control props. ✓
- a11y: single labeled controls (no row-list); Open Points axe gate in T3. ✓
- No placeholders. ✓
