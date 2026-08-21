# Resources Tab Unification (0.16.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the Resources panel's Directory, Planning (+ Rollup), and Resources Report tables to the Workload tab's table chrome — class-string changes only.

**Architecture:** Single-file class-string migrations in 3 source files (`resource-directory.tsx`, `resources-panel.tsx` planning view + rollup, `resources-report.tsx`). No JSX restructure, no new tokens, no new components. Each table adopts the Workload recipe: `text-sm` base, `sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground` thead, `px-3 py-2 font-medium` th, `px-3 py-2` td, `divide-y divide-line` tbody. Verified per file with scoped grep.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-resources-tab-unify-design.md`
**Reference:** Workload recipe lives in `src/app/resource-workload.tsx` (already canonical).
**Branch:** `feat/0.16.1-resources-tab-unify` (already created off `main`).

> **Heads-up for the implementer subagent:**
> 1. **Fact-forcing gate.** Before FIRST shell command print 2 facts (task + command purpose). Before EVERY Edit, in the SAME message print 4 facts — (a) importers (Grep the component or function name in same turn), (b) symbols affected (none — class strings only), (c) data fields (none), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry the Edit.
> 2. **win32** — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. **Class strings ONLY** — preserve all logic/markup/props/tests byte-for-byte except where explicitly asked to update test assertions.
> 4. **No duplicate utilities.** Each element ends with at most one `bg-*` base utility, one `border-<color>` base utility, one `text-<color>` base utility (variants like `hover:`/`dark:` are fine).
> 5. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore` it BEFORE committing.

---

## Task 1: Directory — name button size

**Files:** Modify `src/app/resource-directory.tsx`.

The Directory table is already 95% aligned with Workload. The only delta is the name-button size: it uses `text-xs font-medium` while Workload uses base size (`text-sm`-inherited) + `font-medium`. Drop `text-xs` so the name inherits the table's `text-sm`.

- [ ] **Step 1: Read the current name-button line**

Read `src/app/resource-directory.tsx` around line 250-260 — the `<button>` that wraps `resourceDisplayName(r)` inside the first `<td>` of the rendered rows.

Expected current `className`:
```
rounded-md border border-transparent px-2 py-0.5 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted
```

- [ ] **Step 2: Apply the edit**

Edit `src/app/resource-directory.tsx`:
- Find: `rounded-md border border-transparent px-2 py-0.5 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted`
- Replace with: `rounded-md border border-transparent px-2 py-0.5 font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted`

(`text-xs ` removed — nothing else changes.)

- [ ] **Step 3: Check for tests asserting on the old class**

Run: `npx vitest run resource-directory`
Expected: PASS. If any assertion checks for `text-xs` on the name button (e.g. `getByText("…").className.includes("text-xs")`), update it to drop the assertion or replace it with a size-agnostic check.

- [ ] **Step 4: Verify no stray `text-xs` on the name button**

Grep `src/app/resource-directory.tsx` for the line containing `resourceDisplayName(r)}</button>` and inspect — the wrapping button should NOT contain `text-xs`.

- [ ] **Step 5: Gates**

Run:
```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors each. (Lint may report up to ~6 pre-existing warnings in unrelated test files — ignore.)

If `git status` shows `src/app/sample-workspace.md` dirty, restore it: `git restore src/app/sample-workspace.md`.

- [ ] **Step 6: Commit**

```bash
git add src/app/resource-directory.tsx
git add src/app/resource-directory.test.tsx 2>/dev/null || true
git commit -m "style(resources): directory name button to Workload size (drop text-xs)"
```

---

## Task 2: Planning view — table chrome to Workload recipe

**Files:** Modify `src/app/resources-panel.tsx` (planning view, ~lines 343–434).

Apply Workload's table recipe to the Planning grid. Class-string replacements on existing JSX.

- [ ] **Step 1: Read the planning table section**

Read `src/app/resources-panel.tsx` lines 342–434 (the `view === "planning"` block, from the outer `overflow-auto` wrapper through the `</table>` + `</div>`). Confirm the structure matches what's described in the spec.

- [ ] **Step 2: Apply the edits**

Apply these Edits to `src/app/resources-panel.tsx`. Each `Find` is unique within the file because the strings include enough context.

**A) Planning `<table>`** (~L343):
- Find: `<table className="text-left text-xs">`
- Replace: `<table className="w-full text-left text-sm">`

**B) Planning `<thead>`** (~L344):
- Find: `<thead className="sticky top-0 bg-surface-muted">`
- Replace: `<thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">`

**C) Planning first `<th>`** (~L346):
- Find: `<th className="px-2 py-1.5 text-left">{t(lang, "assignee")}</th>`
- Replace: `<th className="px-3 py-2 font-medium">{t(lang, "assignee")}</th>`

**D) Planning period-key `<th>`** (~L348):
- Find: `<th key={p.key} className="px-2 py-1.5 text-right tabular-nums">{p.key}</th>`
- Replace: `<th key={p.key} className="px-3 py-2 text-right font-medium tabular-nums">{p.key}</th>`

**E) Planning capacity / cost / margin `<th>`** (~L350–353): four separate Edits, one per th. Each Find is unique because of the i18n key inside.
- Find: `<th className="px-2 py-1.5 text-right" title={t(lang, "resourcesCapacityDaysHint")}>{t(lang, "resourcesCapacityDays")}</th>`
- Replace: `<th className="px-3 py-2 text-right font-medium" title={t(lang, "resourcesCapacityDaysHint")}>{t(lang, "resourcesCapacityDays")}</th>`

- Find: `<th className="px-2 py-1.5 text-right" title={t(lang, "resourcesInternalCostHint")}>{t(lang, "resourcesInternalCost")}</th>`
- Replace: `<th className="px-3 py-2 text-right font-medium" title={t(lang, "resourcesInternalCostHint")}>{t(lang, "resourcesInternalCost")}</th>`

- Find: `<th className="px-2 py-1.5 text-right" title={t(lang, "resourcesExternalCostHint")}>{t(lang, "resourcesExternalCost")}</th>`
- Replace: `<th className="px-3 py-2 text-right font-medium" title={t(lang, "resourcesExternalCostHint")}>{t(lang, "resourcesExternalCost")}</th>`

- Find: `<th className="px-2 py-1.5 text-right" title={t(lang, "resourcesMarginHint")}>{t(lang, "resourcesMargin")}</th>`
- Replace: `<th className="px-3 py-2 text-right font-medium" title={t(lang, "resourcesMarginHint")}>{t(lang, "resourcesMargin")}</th>`

**F) Planning name `<td>`** (~L371): the `<td>` immediately surrounding the resource-edit button. Use context to disambiguate.
- Find:
```
              <tr key={r.id}>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => onEditResource(r)}
```
- Replace:
```
              <tr key={r.id}>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onEditResource(r)}
```
(Preserves the surrounding 4 lines verbatim — only the td className changes.)

**G) Planning number-input wrapper `<td>`** (~L392):
- Find: `<td key={p.key} className="px-1 py-1 text-right align-top">`
- Replace: `<td key={p.key} className="px-3 py-2 text-right align-top">`

**H) Planning totals/cost row `<td>`s** (~L411–414):
- Find: `<td className="px-2 py-1 text-right tabular-nums font-medium">{(totalHours / workdayHours).toFixed(1)}</td>`
- Replace: `<td className="px-3 py-2 text-right tabular-nums font-medium">{(totalHours / workdayHours).toFixed(1)}</td>`

- Find: `<td className="px-2 py-1 text-right tabular-nums">{formatCurrency(cost.internal, plan.currency, loc)}</td>`
- Replace: `<td className="px-3 py-2 text-right tabular-nums">{formatCurrency(cost.internal, plan.currency, loc)}</td>`

- Find: `<td className="px-2 py-1 text-right tabular-nums">{formatCurrency(cost.external, plan.currency, loc)}</td>`
- Replace: `<td className="px-3 py-2 text-right tabular-nums">{formatCurrency(cost.external, plan.currency, loc)}</td>`

- Find: `<td className="px-2 py-1 text-right tabular-nums">{formatCurrency(cost.margin, plan.currency, loc)}</td>`
- Replace: `<td className="px-3 py-2 text-right tabular-nums">{formatCurrency(cost.margin, plan.currency, loc)}</td>`

**I) Planning `<tfoot>` cells** (~L423–428): six tfoot td cells.
- Find: `<td className="px-2 py-1.5">{t(lang, "resourcesTotal")}</td>`
- Replace: `<td className="px-3 py-2">{t(lang, "resourcesTotal")}</td>`

- Find: `<td className="px-1 py-1.5" colSpan={periods.length} />`
- Replace: `<td className="px-3 py-2" colSpan={periods.length} />`

- Find: `<td className="px-2 py-1.5 text-right tabular-nums">{totals.days.toFixed(1)}</td>`
- Replace: `<td className="px-3 py-2 text-right tabular-nums">{totals.days.toFixed(1)}</td>`

- Find: `<td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(totals.internal, plan.currency, loc)}</td>`
- Replace: `<td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.internal, plan.currency, loc)}</td>`

- Find: `<td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(totals.external, plan.currency, loc)}</td>`
- Replace: `<td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.external, plan.currency, loc)}</td>`

- Find: `<td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(totals.margin, plan.currency, loc)}</td>`
- Replace: `<td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.margin, plan.currency, loc)}</td>`

- [ ] **Step 3: Verify scoped grep**

Run on `src/app/resources-panel.tsx`:
- `text-left text-xs` → expected: 1 match (rollup table on ~L448; will go to ZERO after Task 3)
- `px-2 py-1\.?5?` inside the planning view (lines 290–435) → expected: ZERO
- `px-1 py-1` (file-wide) → expected: ZERO

If the planning view still contains `px-2 py-1` or `px-2 py-1.5` or `px-1 py-1` between lines 290–435 after the edits, find the missed line and apply the same `px-3 py-2` substitution.

- [ ] **Step 4: Tests**

Run:
```bash
npx vitest run resources-panel
```
Expected: PASS. If any test asserts on `text-xs` or `px-2 py-1` for the planning view, update it. If it asserts on header text exactly (e.g. `"Days"`) it still passes — uppercase is CSS, not source.

- [ ] **Step 5: Gates**

Run `npx tsc --noEmit` (0) and `npm run lint` (0). Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/resources-panel.tsx
git add src/app/resources-panel.test.tsx 2>/dev/null || true
git commit -m "style(resources): planning grid to Workload table chrome"
```

---

## Task 3: Rollup sub-table — match Workload

**Files:** Modify `src/app/resources-panel.tsx` (rollup sub-table, ~lines 447–474).

The rollup sub-table sits inside the planning view and currently shares Planning's old denser styling. Apply the same Workload recipe.

- [ ] **Step 1: Apply the edits**

After Task 2, the strings below should each have exactly ONE remaining match (the rollup occurrence). Verify uniqueness with Grep before each Edit.

**A) Rollup `<table>`** (~L448):
- Find: `<table className="text-left text-xs">`
- Replace: `<table className="w-full text-left text-sm">`

**B) Rollup `<thead>`** (~L449):
- Find: `<thead className="sticky top-0 bg-surface-muted">`
- Replace: `<thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">`

**C) Rollup first `<th>`** (~L451):
- Find: `<th className="px-2 py-1.5 text-left">{t(lang, "assignee")}</th>`
- Replace: `<th className="px-3 py-2 font-medium">{t(lang, "assignee")}</th>`

**D) Rollup period-key `<th>`** (~L453):
- Find: `<th key={rp.key} className="px-2 py-1.5 text-right tabular-nums">{rp.key}</th>`
- Replace: `<th key={rp.key} className="px-3 py-2 text-right font-medium tabular-nums">{rp.key}</th>`

**E) Rollup name `<td>`** (~L462):
- Find: `<td className="px-2 py-1 font-medium text-foreground dark:text-AIPM-light-grey">{resourceDisplayName(r)}</td>`
- Replace: `<td className="px-3 py-2 font-medium text-foreground">{resourceDisplayName(r)}</td>`

**F) Rollup period-value `<td>`** (~L464):
- Find: `<td key={rp.key} className="px-2 py-1 text-right tabular-nums text-muted-foreground">`
- Replace: `<td key={rp.key} className="px-3 py-2 text-right tabular-nums text-muted-foreground">`

- [ ] **Step 2: Verify scoped grep — ZERO matches**

Run on `src/app/resources-panel.tsx`:
- `text-left text-xs` → expected: ZERO
- `px-2 py-1\.?5?` (file-wide) → expected: ZERO
- `px-1 py-1` (file-wide) → expected: ZERO

- [ ] **Step 3: Tests**

Run: `npx vitest run resources-panel`. Expected: PASS.

- [ ] **Step 4: Gates**

Run `npx tsc --noEmit` (0) and `npm run lint` (0). Restore `sample-workspace.md` if dirty.

- [ ] **Step 5: Commit**

```bash
git add src/app/resources-panel.tsx
git commit -m "style(resources): planning rollup sub-table to Workload chrome"
```

---

## Task 4: Resources Report — Table helper + Td color

**Files:** Modify `src/app/resources-report.tsx`.

The report uses a small `<Table>` helper component (~L119–130) and a `<Td>` first-column helper (~L132–134). Update both to match Workload.

- [ ] **Step 1: Apply the edits**

**A) `<Table>` `<table>`** (~L122):
- Find: `<table className="min-w-full text-left text-xs">`
- Replace: `<table className="min-w-full text-left text-sm">`

**B) `<Table>` `<thead>`** (~L123):
- Find: `<thead className="bg-surface-muted uppercase tracking-wide text-muted-foreground">`
- Replace: `<thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">`

**C) `<Table>` `<th>`** (~L124):
- Find: ``<th key={i} className={`px-3 py-2 ${i === 0 ? "" : "text-right"}`}>{h}</th>``
- Replace: ``<th key={i} className={`px-3 py-2 font-medium ${i === 0 ? "" : "text-right"}`}>{h}</th>``
- (NOTE: backtick template literals are part of the JSX — preserve them; only `font-medium ` is inserted between `py-2 ` and `${i === 0`.)

**D) `<Td>` helper** (~L133):
- Find: `<td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{children}</td>`
- Replace: `<td className="px-3 py-2 font-medium text-foreground">{children}</td>`

- [ ] **Step 2: Verify scoped grep**

Run on `src/app/resources-report.tsx`:
- `text-left text-xs` → ZERO
- `text-AIPM-dark-blue dark:text-AIPM-light-grey` count file-wide → expected: exactly 2 (the Tile `<p>` and the Section `<h3>` — both intentional, both out of scope per the spec). If 3+, the Td edit didn't land. If 0–1, you also touched Tile or Section — revert that.

- [ ] **Step 3: Tests**

Run:
```bash
npx vitest run resources-report
```
Expected: PASS. If any assertion checks for `text-AIPM-dark-blue` on a Td cell or `text-xs` on the Table, update it.

- [ ] **Step 4: Gates**

Run `npx tsc --noEmit` (0) and `npm run lint` (0). Restore `sample-workspace.md` if dirty.

- [ ] **Step 5: Commit**

```bash
git add src/app/resources-report.tsx
git add src/app/resources-report.test.tsx 2>/dev/null || true
git commit -m "style(resources): report Table+Td helpers to Workload chrome"
```

---

## Task 5: Release 0.16.1

**Files:** `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — READ first. Set `APP_VERSION = "0.16.1"`. Keep `APP_BUILD_DATE = "2026-05-28"; // Butler milestone`. Add a NEW top-of-file comment block ABOVE the existing `// 0.16.0 "Butler"` block:
```ts
// 0.16.1 unifies the Resources panel's Directory, Planning (+ Rollup), and
// Resources Report tables to the Workload tab's table chrome — sticky
// uppercase header, consistent padding, text-sm density. Class strings only.
```

Do NOT add a new highlight key (patch release, consistency polish).

- [ ] **Step 2: CHANGELOG** — READ to match style; add a new `[0.16.1] — 2026-05-28` entry ABOVE `[0.16.0]`:
```markdown
## [0.16.1] — 2026-05-28

### Changed
- Resources panel: Directory / Planning / Report tables now share the Workload tab's table chrome — sticky uppercase header, consistent padding and density. Closes sub-project B from the 2026-05-27 batch (the AIPM design system + table consistency are now both complete across the app).
```

- [ ] **Step 3: Verify**

Run:
```bash
npx tsc --noEmit
npm run lint
npm run test:coverage
```
Expected: tsc 0; lint 0; all suites pass; coverage ≥ 70%.

If `git status` shows `src/app/sample-workspace.md` dirty, restore it.

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "docs(release): 0.16.1 — resources tables unified to Workload chrome"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. The reviewer should:

1. **Scope check:** the diff touches ONLY `src/app/resource-directory.tsx`, `src/app/resources-panel.tsx`, `src/app/resources-report.tsx`, `src/app/version.ts`, `CHANGELOG.md` (+ optionally any of the three test files if assertions had to be updated). Anything else = flag it.
2. **Scoped grep verification — ZERO matches each:**
   - `src/app/resource-directory.tsx` name button: no `text-xs` on the line containing `resourceDisplayName(r)}</button>`.
   - `src/app/resources-panel.tsx`: file-wide grep `text-left text-xs` → ZERO; `px-2 py-1\.?5?` → ZERO; `px-1 py-1` → ZERO.
   - `src/app/resources-report.tsx`: `text-left text-xs` inside the Table component → ZERO; file-wide `text-AIPM-dark-blue dark:text-AIPM-light-grey` count = exactly 2 (Tile value + Section h3 only).
3. **Workload recipe confirmed in all three surfaces:** each migrated `<table>` is `text-sm`; each migrated `<thead>` is `sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground`; each migrated `<th>` is `px-3 py-2 font-medium …`; each migrated `<td>` is `px-3 py-2 …`.
4. **Release metadata:** `APP_VERSION === "0.16.1"`, no new highlight key, `[0.16.1]` CHANGELOG section non-empty.
5. **Class-strings only:** the diff is entirely className changes; no logic/markup/prop/behavior changes; no new imports.
6. **Gates:** `npx tsc --noEmit` 0; `npm run lint` 0; `npx vitest run` all 890 tests passing; `npm run test:coverage` ≥ 70%.

After the reviewer approves, use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:**
- Directory name button drops `text-xs` → Task 1 ✓
- Planning table base + thead + th + td + tfoot → Task 2 (edits A–I) ✓
- Rollup sub-table → Task 3 (edits A–F) ✓
- Report Table helper + Td color → Task 4 (edits A–D) ✓
- Release 0.16.1 + CHANGELOG → Task 5 ✓
- Non-goals (Calendar, Tiles, Section h3) → explicitly NOT touched in any task ✓
- Edge cases (Planning width tradeoff, number-input cell padding, rollup dark-variant drop, Report Td color) → covered by the exact before→after strings ✓

**Placeholder scan:** No TBD/TODO; every Find/Replace is an exact, complete string. Commit messages and commands are concrete.

**Type consistency:** Plan only touches className strings; no symbols/types changed. The four Edits in Task 2-E target separate i18n keys for uniqueness — each before-string is distinct.

**Ordering note:** Task 3's edits rely on Task 2 having reduced the file's matches for `text-left text-xs` and `sticky top-0 bg-surface-muted` to one each. Subagent-driven runs sequentially, so this is fine. If executing in any other order, Task 3 would need explicit before-context including the `<button onClick={() => setShowRollup` wrapper.
