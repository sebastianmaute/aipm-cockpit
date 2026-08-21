# Palette Sweep — Calendar chunk: `resource-calendar.tsx` (0.15.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `resource-calendar.tsx` to the AIPM palette + surface tokens — replace `zinc`/`shadow`/Tailwind status colors and the broken `AIPM-light-blue`, with a decided per-state color scheme. No behavior/markup change.

**Architecture:** A single-file class-string migration applying exact before→after replacements below (the color scheme was decided in the spec). Verified by a grep + duplicate-utility scan + the existing behavioral tests staying green.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-27-palette-sweep-calendar-design.md`
**Reference:** `docs/DESIGN-TOKENS.md`
**Branch:** `feat/0.15.3-palette-sweep-calendar` (already created off `main`).

> **Heads-up for the implementer subagent:**
> 1. Fact-forcing gate: before FIRST shell command print 2 facts (task + command purpose); before EVERY Edit, in the SAME message print 4 facts — (a) importers (Grep `ResourceCalendar` in same turn), (b) symbols affected (none — class strings only), (c) data fields (none), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry.
> 2. win32 — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. **CLASS STRINGS ONLY. REPLACE each string in place — never ADD a second color utility. No element may end with two `bg-*`, two `border-<color>`, two `divide-*`, or two `text-<color>` utilities.** Apply the EXACT before→after pairs below; do not improvise other changes. Preserve all logic/markup/tests.

---

## Task 1: Migrate `resource-calendar.tsx`

**Files:** Modify `src/app/resource-calendar.tsx`.

READ the file, then apply these EXACT replacements (each `old` string appears once unless noted; replace with `new`):

- [ ] **Step 1: Absence-cell colors** — in `absenceCellBg()`:
  - `bg-blue-200 hover:bg-blue-300 dark:bg-blue-900/70 dark:hover:bg-blue-800/70` → `bg-AIPM-blue/30 hover:bg-AIPM-blue/40 dark:bg-AIPM-blue/25 dark:hover:bg-AIPM-blue/35`
  - `bg-red-200 hover:bg-red-300 dark:bg-red-900/70 dark:hover:bg-red-800/70` → `bg-AIPM-pink/30 hover:bg-AIPM-pink/40 dark:bg-AIPM-pink/25 dark:hover:bg-AIPM-pink/35`
  - `bg-amber-200 hover:bg-amber-300 dark:bg-amber-900/70 dark:hover:bg-amber-800/70` → `bg-AIPM-purple/30 hover:bg-AIPM-purple/40 dark:bg-AIPM-purple/25 dark:hover:bg-AIPM-purple/35`
  - `bg-zinc-300 hover:bg-zinc-400 dark:bg-zinc-600 dark:hover:bg-zinc-500` → `bg-AIPM-medium-grey/45 hover:bg-AIPM-medium-grey/55 dark:bg-AIPM-medium-grey/35 dark:hover:bg-AIPM-medium-grey/45`

- [ ] **Step 2: Header day-cell ternary + bases**:
  - `sticky top-0 z-20 border-b border-r border-zinc-200 px-0 py-1 text-center text-[10px] font-medium tracking-wide dark:border-zinc-800` → `sticky top-0 z-20 border-b border-r border-line px-0 py-1 text-center text-[10px] font-medium tracking-wide`
  - `bg-AIPM-light-blue/30 text-AIPM-dark-blue dark:bg-AIPM-dark-blue/30 dark:text-AIPM-light-blue` → `bg-AIPM-green/20 text-AIPM-dark-blue dark:bg-AIPM-green/20 dark:text-AIPM-light-grey`
  - `bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300` → `bg-AIPM-purple/15 text-AIPM-purple dark:bg-AIPM-purple/20 dark:text-AIPM-purple`
  - `bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500` → `bg-surface-muted text-muted-foreground`
  - `bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400` → `bg-surface-muted text-muted-foreground`

- [ ] **Step 3: Outer container + sticky assignee header `<th>`**:
  - `min-h-0 flex-1 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800` → `min-h-0 flex-1 overflow-auto rounded-md border border-line`
  - `sticky left-0 top-0 z-30 border-b border-r border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400` → `sticky left-0 top-0 z-30 border-b border-r border-line bg-surface-muted px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground`

- [ ] **Step 4: Sticky assignee `<td>` + name button**:
  - `sticky left-0 z-10 border-b border-r border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-950` → `sticky left-0 z-10 border-b border-r border-line bg-surface px-2 py-1`
  - `rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-dark-blue dark:text-AIPM-light-grey dark:hover:bg-zinc-800` → `rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-green`

- [ ] **Step 5: Body-cell `baseBg` ternary + cell `<td>` + button + glyph**:
  - `bg-AIPM-light-blue/20 hover:bg-AIPM-light-blue/40 dark:bg-AIPM-dark-blue/20 dark:hover:bg-AIPM-dark-blue/40` → `bg-AIPM-green/15 hover:bg-AIPM-green/25 dark:bg-AIPM-green/15 dark:hover:bg-AIPM-green/25`
  - `bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/20 dark:hover:bg-purple-950/40` → `bg-AIPM-purple/10 hover:bg-AIPM-purple/20 dark:bg-AIPM-purple/15 dark:hover:bg-AIPM-purple/25`
  - `bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900/50 dark:hover:bg-zinc-800/50` → `bg-surface-muted hover:bg-AIPM-medium-grey/20 dark:hover:bg-AIPM-medium-grey/20`
  - `bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900` → `bg-surface hover:bg-surface-muted`
  - `border-b border-r border-zinc-200 p-0 dark:border-zinc-800` → `border-b border-r border-line p-0`
  - `focus:ring-1 focus:ring-inset focus:ring-AIPM-dark-blue` → `focus:ring-1 focus:ring-inset focus:ring-AIPM-green` (inside the cell button's template-literal className)
  - the glyph `<span>`: `text-AIPM-dark-grey dark:text-AIPM-light-grey` → `text-foreground`

- [ ] **Step 6: Legend container + chips + LegendChip border**:
  - `flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-AIPM-medium-grey` → `flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground`
  - `bg-blue-200 dark:bg-blue-900/70` → `bg-AIPM-blue/30 dark:bg-AIPM-blue/25`
  - `bg-red-200 dark:bg-red-900/70` → `bg-AIPM-pink/30 dark:bg-AIPM-pink/25`
  - `bg-amber-200 dark:bg-amber-900/70` → `bg-AIPM-purple/30 dark:bg-AIPM-purple/25`
  - `bg-zinc-300 dark:bg-zinc-600` → `bg-AIPM-medium-grey/45 dark:bg-AIPM-medium-grey/35`
  - `bg-AIPM-light-blue/30 dark:bg-AIPM-dark-blue/30` → `bg-AIPM-green/20 dark:bg-AIPM-green/20`
  - `bg-purple-100 dark:bg-purple-950/30` → `bg-AIPM-purple/15 dark:bg-AIPM-purple/20`
  - in the `LegendChip` component's inner `<span>`: `rounded-sm border border-zinc-300 dark:border-zinc-700` → `rounded-sm border border-line`

- [ ] **Step 7: Verify** (all must pass):
  1. Grep `src/app/resource-calendar.tsx` → ZERO: `zinc-|shadow-|AIPM-light-blue|AIPM-dark-blue/|bg-gradient|(amber|red|emerald|sky|rose|slate|gray|orange|yellow|teal|cyan|indigo|violet|fuchsia|green|blue|purple|pink)-[0-9]`
     (Note: `bg-AIPM-green/20`, `bg-AIPM-purple/15`, `text-AIPM-dark-blue`, `border-AIPM-dark-blue` do NOT match — no digit follows the color word, and the `AIPM-dark-blue/NN` backgrounds were all in the removed today-token. Confirm no `AIPM-dark-blue/NN` background remains.)
  2. Read every changed className → confirm NO element has two `bg-*`, two `border-<color>`, two `text-<color>` utilities.
  3. `npx vitest run src/app/resource-calendar.test.tsx` (expect the 2 assignee-click tests green); `npx tsc --noEmit` (0); `npm run lint` (0). Restore `sample-workspace.md` if dirty.

- [ ] **Step 8: Commit**
```bash
git add src/app/resource-calendar.tsx
git commit -m "style(palette): resource-calendar to AIPM palette (today=green, holiday=purple, fix AIPM-light-blue)"
```

---

## Task 2: Release 0.15.3

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `docs/DESIGN-TOKENS.md`.

- [ ] **Step 1: version.ts** — READ it. Set `export const APP_VERSION = "0.15.3";` (currently "0.15.2"). Keep `APP_BUILD_DATE = "2026-05-27"; // Le Guin milestone`. Do NOT add a highlight key (patch). Add a top comment above the existing `// 0.15.2 …` block:
```ts
// 0.15.3 sweeps the resource calendar onto the AIPM palette: absence cells in
// blue/pink/purple/grey + glyph, today=green wash, holiday=purple wash,
// weekend=muted; fixes the previously-undefined AIPM-light-blue token.
```

- [ ] **Step 2: CHANGELOG** — READ to match style; add above `[0.15.2]`:
```markdown
## [0.15.3] — 2026-05-27

### Changed
- Continued the AIPM design-system rollout: the resource calendar now uses the AIPM palette — absence types in blue (vacation), pink (sick), purple (training) and grey (other), today highlighted in green, holidays in purple, weekends muted. Fixes a long-standing bug where the "today" highlight used an undefined color and rendered invisibly.
```
(Match whatever format `[0.15.2]` uses if it differs.)

- [ ] **Step 3: DESIGN-TOKENS.md** — under "## Migration status (sub-project E)" add:
```markdown
- E-sweep calendar (0.15.3): resource-calendar.tsx. ✅
```
and add a short subsection documenting the calendar mapping:
```markdown
## Calendar status colors

- Absence cells (with V/S/T/O glyph): vacation `AIPM-blue`, sick `AIPM-pink`, training `AIPM-purple`, other `AIPM-medium-grey` (alpha ~/30).
- Column shades: today `AIPM-green` wash, holiday `AIPM-purple` wash (fainter than the training cell), weekend `surface-muted`, normal `surface`.
```
Adjust the "Remaining" line so the calendar is no longer listed as pending (modals + tasks/RAID/gantt/reports + menus still pending).

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint` (0); `npm run test:coverage` (green, ≥70%). Then `git status`; if `src/app/sample-workspace.md` is dirty, `git restore src/app/sample-workspace.md`.

- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts CHANGELOG.md docs/DESIGN-TOKENS.md
git commit -m "docs(release): 0.15.3 — calendar palette sweep"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Read `version.ts`/`CHANGELOG.md` directly (don't infer version from diff sign). Confirm: `APP_VERSION === "0.15.3"`, no new highlight key, real `[0.15.3]` entry, DESIGN-TOKENS updated (calendar ✅ + Calendar-status-colors section). Run the Step-7 grep on `resource-calendar.tsx` → ZERO matches (no `zinc-`/`shadow-`/`AIPM-light-blue`/`AIPM-dark-blue/NN`/off-palette-shade). Duplicate-utility scan clean. Confirm the scheme: absence cells blue/pink/purple/grey, today=green, holiday=purple, weekend=surface-muted, glyph=`text-foreground`, focus rings `AIPM-green`. Confirm class-strings only (no logic/markup/behavior change) and scope = `resource-calendar.tsx` + version.ts + CHANGELOG.md + docs/DESIGN-TOKENS.md (4 files). Full suite green. Then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:** absence-type colors (blue/pink/purple/grey) → Task 1 Step 1 + legend Step 6; today=green (fixes AIPM-light-blue) → Steps 2,5,6; holiday=purple wash → Steps 2,5,6; weekend=surface-muted, normal=surface → Steps 2,5; chrome (borders/header/assignee button/glyph) → Steps 2–6; release + DESIGN-TOKENS calendar section → Task 2. All spec items covered.

**Placeholder scan:** No TBD/TODO. Every replacement is an exact before→after string. The CHANGELOG "match style" note is a real source-confirmation.

**Type consistency:** Only Tailwind class names change; targets (`bg-AIPM-blue/30`, `bg-AIPM-green/15`, `bg-AIPM-purple/10`, `bg-AIPM-medium-grey/45`, `border-line`, `bg-surface`, `bg-surface-muted`, `text-foreground`, `text-muted-foreground`, `ring-AIPM-green`, `text-AIPM-purple`) all resolve (palette `--AIPM-*` supports arbitrary alpha; surface tokens defined in E0). The Step-7 grep regex excludes `AIPM-*` alpha utilities (no digit after the color word) so it won't false-flag the new classes.
