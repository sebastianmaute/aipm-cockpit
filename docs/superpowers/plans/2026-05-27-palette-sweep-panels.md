# Palette Sweep — Chunk 1: Resources + Budget Panels (0.15.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate 5 Resources/Budget panel components from `zinc-*`/shadows/off-palette status colors to the semantic surface tokens + AIPM palette in `docs/DESIGN-TOKENS.md`, with no behavior/layout/markup changes.

**Architecture:** A mechanical, per-file class-string migration applying the shared mapping table below. This is NOT classic TDD (no new behavior) — each file task is *transform → grep-verify-clean → existing tests stay green → commit*. Existing component tests assert behavior/roles/text (not classes), so they are the regression net; a per-file grep proves the migration is complete.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest + Testing Library. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-27-palette-sweep-panels-design.md`
**Reference (binding):** `docs/DESIGN-TOKENS.md`
**Branch:** `feat/0.15.2-palette-sweep-panels` (already created off `main`).

## Shared mapping table (apply in every file task)

| Current utility | Replace with |
|---|---|
| `bg-white` (panel/card/sticky-header backgrounds) | `bg-surface` |
| `bg-zinc-50`, `dark:bg-zinc-900`, `dark:bg-zinc-950` (alt-rows, table-header zones, hovers) | `bg-surface-muted` |
| `border-zinc-200`, `border-zinc-300`, `dark:border-zinc-700`, `dark:border-zinc-800` | `border-line` |
| `text-zinc-900`, `text-zinc-800`, `text-zinc-700`, and their `dark:text-zinc-100/200/300` pair | `text-foreground` (drop the `dark:` pair — the token adapts) |
| `text-zinc-500`, `text-zinc-600`, `text-zinc-400`, and their `dark:text-zinc-400/500` pair | `text-muted-foreground` (drop the `dark:` pair) |
| `shadow-sm`, `shadow-md`, any `shadow-*` | remove (separation comes from `border border-line`) |
| `focus:ring-AIPM-dark-blue`, `focus:ring-zinc-*`, `focus-visible:ring-AIPM-dark-blue` | `focus:ring-AIPM-green` / `focus-visible:ring-AIPM-green` |
| `hover:bg-zinc-50/100` + paired `dark:hover:bg-zinc-800` (and `hover:bg-AIPM-light-grey`) | `hover:bg-surface-muted` (single class, both modes) |
| `bg-gradient-*`, `from-*`, `via-*`, `to-*` | remove |

Leave UNCHANGED: solid fills `bg-AIPM-dark-blue text-white`; existing `--AIPM-*` utilities (`text-AIPM-dark-grey`, `text-AIPM-dark-blue`, `text-AIPM-medium-grey`, `text-AIPM-light-grey`, `border-AIPM-dark-blue`, `bg-AIPM-pink`, etc.); all non-class code (logic, markup, props, hooks).

## Per-file verification grep (run after each file)

Use the Grep tool on the single migrated file with this regex; expect **zero matches**:
```
zinc-|shadow-|bg-gradient|from-\[|(amber|red|emerald|sky|rose|slate|gray|orange|yellow|teal|cyan|indigo|violet|fuchsia|green|blue|purple|pink)-[0-9]
```
(This matches Tailwind palette shades like `red-600`/`green-500` but NOT the `AIPM-*` tokens, which have no digit after the color word — e.g. `bg-AIPM-green`, `text-AIPM-pink/10` are fine.)

> **Heads-up for every implementer subagent:**
> 1. Fact-forcing gate hook. Before your FIRST shell command, print 2 facts (task + what the command does). Before EVERY Edit, in the SAME message print 4 facts — (a) importers of the file (Grep in the same turn), (b) public symbols affected (none — class strings only), (c) data fields (none — styling), (d) the user instruction verbatim: "adjust the design to follow the following table:" (AIPM palette; green accent/dark-blue fills; never gradients/shadows/off-palette colors). Then retry the Edit.
> 2. **eslint.config.mjs is edit-protected — do NOT touch it.**
> 3. win32 — use the Bash tool for `npx`/`git`/`npm`; no `&&`-chained `cd`.
> 4. After test runs, if `git status` shows `src/app/sample-workspace.md` modified, `git restore` it before committing.
> 5. **Class strings ONLY.** Do not rewrite whole files, reorder JSX, or touch logic/tests. Read the file, apply the mapping table + the named per-file edits, preserve everything else byte-for-byte. Do NOT delete or alter existing tests.

---

## Task 1: `resource-directory.tsx` (pure chrome)

**Files:** Modify `src/app/resource-directory.tsx`.

- [ ] **Step 1: Migrate** — READ `src/app/resource-directory.tsx` and apply the shared mapping table to every off-palette class (it is pure chrome: `bg-white`, `bg-zinc-50`, `border-zinc-*`, `text-zinc-*`, `shadow-sm`, and the directory name/hover buttons). No status colors. The name-cell button already uses the canonical hover style — convert its `hover:bg-zinc-50 dark:hover:bg-zinc-800` → `hover:bg-surface-muted`, drop `shadow-sm`, and any `focus-visible:ring-AIPM-dark-blue` → `focus-visible:ring-AIPM-green`.
- [ ] **Step 2: Grep-verify** — run the per-file verification grep on `src/app/resource-directory.tsx`; expect zero matches.
- [ ] **Step 3: Gates** — `npx vitest run src/app/resource-directory.test.tsx` (green); `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/resource-directory.tsx
git commit -m "style(palette): resource-directory to surface tokens (no zinc/shadow)"
```

---

## Task 2: `resources-report.tsx` (pure chrome)

**Files:** Modify `src/app/resources-report.tsx`.

- [ ] **Step 1: Migrate** — READ `src/app/resources-report.tsx` and apply the shared mapping table. This file has NO shadows and NO status/semantic colors — only `zinc-*` chrome (≈6 occurrences). Map each per the table.
- [ ] **Step 2: Grep-verify** — run the per-file verification grep on `src/app/resources-report.tsx`; expect zero matches.
- [ ] **Step 3: Gates** — `npx vitest run src/app/resources-report.test.tsx` (green); `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/resources-report.tsx
git commit -m "style(palette): resources-report to surface tokens (no zinc)"
```

---

## Task 3: `resource-workload.tsx` (chrome + overdue red→pink)

**Files:** Modify `src/app/resource-workload.tsx`.

- [ ] **Step 1: Migrate** — READ `src/app/resource-workload.tsx` and apply the shared mapping table (sticky `<thead>` `bg-zinc-50 … shadow-sm dark:bg-zinc-900` → `bg-surface-muted`; the name/shift buttons' `shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800` → `hover:bg-surface-muted` minus shadow; `focus-visible:ring-AIPM-dark-blue` → `focus-visible:ring-AIPM-green`; `border-zinc-*`/`text-zinc-*` per the table).
- [ ] **Step 2: Named status edit** — the overdue-count class `font-medium text-red-600 dark:text-red-400` (appears twice) → `font-medium text-AIPM-pink`.
- [ ] **Step 3: Grep-verify** — run the per-file verification grep on `src/app/resource-workload.tsx`; expect zero matches.
- [ ] **Step 4: Gates** — `npx vitest run src/app/resource-workload.test.tsx` (green); `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/resource-workload.tsx
git commit -m "style(palette): resource-workload to surface tokens; overdue red->pink"
```

---

## Task 4: `budget-panel.tsx` (chrome + positive emerald→green)

**Files:** Modify `src/app/budget-panel.tsx`.

- [ ] **Step 1: Migrate** — READ `src/app/budget-panel.tsx` and apply the shared mapping table (≈21 `zinc-*`, the `dark:bg-zinc-900 dark:hover:bg-zinc-800` secondary button, `shadow-sm`, etc.). The primary `bg-AIPM-dark-blue` button stays; the secondary outline button `border-AIPM-dark-blue bg-white … hover:bg-AIPM-light-grey dark:bg-zinc-900 dark:hover:bg-zinc-800` → `border-AIPM-dark-blue bg-surface … hover:bg-surface-muted` (drop shadow, drop zinc).
- [ ] **Step 2: Named status edit** — the CCI tone helper line `const tone = value.amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-AIPM-pink";` → `const tone = value.amount >= 0 ? "text-AIPM-green" : "text-AIPM-pink";`.
- [ ] **Step 3: Grep-verify** — run the per-file verification grep on `src/app/budget-panel.tsx`; expect zero matches.
- [ ] **Step 4: Gates** — `npx vitest run budget` (green — covers budget-panel + budget specs); `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/budget-panel.tsx
git commit -m "style(palette): budget-panel to surface tokens; positive CCI emerald->green"
```

---

## Task 5: `resources-panel.tsx` (chrome + amber override→purple + section card)

**Files:** Modify `src/app/resources-panel.tsx`.

- [ ] **Step 1: Migrate** — READ `src/app/resources-panel.tsx` and apply the shared mapping table. Notable spots: the outer `<section>` `rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950` → `rounded-xl border border-line bg-surface p-4`; the `<h2>` `text-zinc-900 dark:text-zinc-100` → `text-foreground`; the planning/rollup `<thead>` `bg-zinc-50 dark:bg-zinc-900` → `bg-surface-muted`; the empty-state dashed border `border-zinc-300 dark:border-zinc-800` → `border-line`; the manage-roles/report/rollup buttons' `border-zinc-300 bg-white … shadow-sm hover:bg-zinc-50 dark:…zinc…` → `border-line bg-surface … hover:bg-surface-muted` (drop shadow); the plan date `<input>`s `border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900` → `border-line dark:bg-surface`; utilization `<input>` `border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900` (+ the derived `bg-zinc-100 … dark:bg-zinc-800`) → `border-line dark:bg-surface` (+ `bg-surface-muted`); divider rows `divide-zinc-100/divide-zinc-200 dark:divide-zinc-800` and `border-zinc-300 dark:border-zinc-700` → `divide-line`/`border-line`.
- [ ] **Step 2: Named status edit** — the absence-override `<input>` class `border-amber-200 … text-amber-700 dark:border-amber-900/50 dark:bg-zinc-900 dark:text-amber-400` → `border-AIPM-purple/40 … text-AIPM-purple dark:border-AIPM-purple/50 dark:bg-surface dark:text-AIPM-purple` (amber/warning → purple; the `dark:bg-zinc-900` → `dark:bg-surface`).
- [ ] **Step 3: Grep-verify** — run the per-file verification grep on `src/app/resources-panel.tsx`; expect zero matches. (The `<ResourceCalendar>` child is a separate file and is intentionally NOT migrated in this chunk — confirm no calendar code is touched here.)
- [ ] **Step 4: Gates** — `npx vitest run src/app/resources-panel.test.tsx` (green — this has the most tests of the five; all must pass); `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/resources-panel.tsx
git commit -m "style(palette): resources-panel to surface tokens; absence-override amber->purple"
```

---

## Task 6: Release 0.15.2

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `docs/DESIGN-TOKENS.md`.

- [ ] **Step 1: version.ts** — set `export const APP_VERSION = "0.15.2";` (keep `APP_BUILD_DATE = "2026-05-27"; // Le Guin milestone`). Do NOT add a highlight key (patch). Add a top comment above the existing `// 0.15.1 …` block:
```ts
// 0.15.2 sweeps the Resources + Budget panels (directory, workload, report,
// planning, budget) onto the AIPM design tokens — surface/line/muted tokens,
// no shadows, status colors mapped (overdue->pink, positive CCI->green,
// absence override->purple). Calendar + modals follow.
```
- [ ] **Step 2: CHANGELOG** — READ `CHANGELOG.md` to match the existing style; add above `[0.15.1]`:
```markdown
## [0.15.2] — 2026-05-27

### Changed
- Continued the AIPM design-system rollout: the Resources tabs (directory, workload, report, planning) and the Budget panel now use the AIPM palette and surface tokens — consistent light/dark surfaces, no drop shadows, and status colors mapped to the palette (overdue → pink, positive margins → green, absence overrides → purple).
```
(Match whatever format `[0.15.1]` uses if it differs.)
- [ ] **Step 3: DESIGN-TOKENS.md** — update the "Migration status (sub-project E)" section: add a line `- E-sweep chunk 1 (0.15.2): resources-panel, resource-directory, resource-workload, resources-report, budget-panel. ✅` and adjust the "Remaining" line accordingly (calendar + modals + other areas still pending).
- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint` (0); `npm run test:coverage` (green, ≥70%). Then `git status`; if `src/app/sample-workspace.md` is dirty, `git restore src/app/sample-workspace.md`.
- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts CHANGELOG.md docs/DESIGN-TOKENS.md
git commit -m "docs(release): 0.15.2 — palette sweep of Resources + Budget panels"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Instruct: read `version.ts`/`CHANGELOG.md` directly (don't infer version from diff sign); confirm `APP_VERSION === "0.15.2"`, no new highlight key, real `[0.15.2]` entry, DESIGN-TOKENS migration-status updated. For EACH of the 5 panel files, run the verification grep and confirm ZERO matches (no `zinc-`/`shadow-`/gradient/off-palette-shade). Confirm the named status edits are correct (workload overdue → `text-AIPM-pink`; budget positive → `text-AIPM-green`; resources-panel override → `AIPM-purple`). Confirm NO logic/markup/behavior changes (class-strings only) and `resource-calendar.tsx` + the modals are untouched. Confirm the full suite is green. Then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:** the 5 in-scope files → Tasks 1–5 (one each); the shared mapping table covers the chrome rules; the named status edits (workload red→pink T3, budget emerald→green T4, resources-panel amber→purple + section card T5) match the spec's per-file list; resource-directory + resources-report are pure chrome (T1, T2); release 0.15.2 + DESIGN-TOKENS status + CHANGELOG → T6. Calendar/modals excluded (stated in each relevant task). All spec requirements covered.

**Placeholder scan:** No TBD/TODO. The migration is expressed as a complete, deterministic mapping table + named per-file edits + an objective grep-completion check — not a vague "migrate the colors." The "match existing CHANGELOG style" note is a real source-confirmation.

**Type consistency:** Only Tailwind utility class names are involved; the target utilities (`bg-surface`, `bg-surface-muted`, `border-line`, `text-foreground`, `text-muted-foreground`, `ring-AIPM-green`, `text-AIPM-pink`, `text-AIPM-green`, `text-AIPM-purple`) all exist (defined in E0 / already in the palette). No code symbols change. The grep regex deliberately excludes `AIPM-*` tokens (no digit after the color word) so it won't false-flag the targets.
