# Palette Sweep — RAID Panel (0.15.6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `src/app/raid-panel.tsx` (1345 LOC) to the brand palette + surface tokens — three semantic color systems (R/A/I/D categories, R/A/G health dots, Low/Med/High/Crit severity ramp) + chrome — with no behavior/markup change.

**Architecture:** Single-file class-string migration applying the shared chunk mapping + the per-system color decisions (decided in the spec) via exact before→after replacements. Verified by both grep regexes + duplicate-utility scan + existing behavioral tests staying green.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-palette-sweep-raid-panel-design.md`
**Reference (binding):** `docs/DESIGN-TOKENS.md`
**Branch:** `feat/0.15.6-palette-sweep-raid-panel` (already created off `main`).

> **Heads-up for the implementer subagent:**
> 1. Fact-forcing gate. Before FIRST shell command print 2 facts (task + command purpose). Before EVERY Edit, in the SAME message print 4 facts — (a) importers (Grep `RaidPanel` in same turn), (b) public symbols affected (none — class strings + 2 record literals), (c) data fields (none), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry the Edit.
> 2. win32 — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore` it BEFORE committing.
> 4. **Class strings ONLY** (plus the named record-literal contents below). Targeted edits — preserve all logic/markup/tests byte-for-byte.

---

## Task 1: Migrate `raid-panel.tsx`

**Files:** Modify `src/app/raid-panel.tsx`.

READ the file. Apply the chunk mapping + the EXACT named edits below. **CRITICAL: REPLACE each utility in place — NEVER add a second color utility. No element may end with two `bg-*`, two `border-<color>`, two `divide-*`, or two `text-<color>` base utilities (variants like `hover:`/`dark:` and `border` width + `border-line` color are fine).**

### Chunk mapping (chrome):
| Current | Replace with |
|---|---|
| `bg-white` | `bg-surface` |
| `bg-zinc-50/100`, `dark:bg-zinc-900/950` | `bg-surface-muted` |
| `border-zinc-200/300`, `dark:border-zinc-700/800`, `border-ui-light-grey` | `border-line` |
| `divide-zinc-*`, `divide-ui-light-grey` | `divide-line` |
| `bg-ui-light-grey`(`/NN`) | `bg-surface-muted` |
| `shadow-*` | remove |
| `focus:ring-ui-dark-blue` / `focus-visible:ring-ui-dark-blue` / `ring-zinc-*` | `ring-ui-green` |
| `hover:bg-zinc-*` / `dark:hover:bg-zinc-*` / `hover:bg-ui-light-grey` | `hover:bg-surface-muted` |
| `text-zinc-9/8/700` (+dark) | `text-foreground` |
| `text-zinc-5/6/400` (+dark) | `text-muted-foreground` |
| `text-ui-dark-grey` (+ any `dark:text-ui-light-grey`) | `text-foreground` |
| `text-ui-medium-grey` (+ any dark) | `text-muted-foreground` |
| `bg-gradient-*`, `from-*`, `via-*`, `to-*` | remove |

**KEEP UNCHANGED:** `bg-ui-dark-blue text-white` fills; heading pairs `text-ui-dark-blue dark:text-ui-light-grey`; ALL non-class code.

### Named edits (EXACT before→after)

**A) Category chips — the `RAID_CATEGORIES`-keyed record (~lines 68–71):**
- `R: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"` → `R: "bg-ui-pink/15 text-ui-pink dark:bg-ui-pink/20"`
- `A: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"` → `A: "bg-ui-blue/15 text-ui-blue dark:bg-ui-blue/20"`
- `I: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"` → `I: "bg-ui-purple/15 text-ui-purple dark:bg-ui-purple/20"`
- `D: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300"` → `D: "bg-ui-green/15 text-ui-green dark:bg-ui-green/20"`

**B) RAG health dots (~lines 75–77):**
- `R: "bg-red-500"` → `R: "bg-ui-pink"`
- `A: "bg-amber-500"` → `A: "bg-ui-purple"`
- `G: "bg-emerald-500"` → `G: "bg-ui-green"`

**C) Severity ramp helper (~lines 1270–1275) — the cold→hot ramp:**
- `bg-emerald-200 hover:bg-emerald-300 dark:bg-emerald-900/50 dark:hover:bg-emerald-900` → `bg-ui-green/20 hover:bg-ui-green/30 dark:bg-ui-green/20 dark:hover:bg-ui-green/30`
- `bg-amber-200 hover:bg-amber-300 dark:bg-amber-900/50 dark:hover:bg-amber-900` → `bg-ui-blue/20 hover:bg-ui-blue/30 dark:bg-ui-blue/20 dark:hover:bg-ui-blue/30`
- `bg-orange-300 hover:bg-orange-400 dark:bg-orange-900/60 dark:hover:bg-orange-900` → `bg-ui-purple/25 hover:bg-ui-purple/35 dark:bg-ui-purple/25 dark:hover:bg-ui-purple/35`
- `bg-red-400 hover:bg-red-500 dark:bg-red-900/70 dark:hover:bg-red-900` → `bg-ui-pink/30 hover:bg-ui-pink/40 dark:bg-ui-pink/30 dark:hover:bg-ui-pink/40`

**D) Stale / amber bits:**
- (~line 381) `rounded-md border border-amber-400 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-300` → `rounded-md border border-ui-purple/40 bg-ui-purple/10 px-2.5 py-1.5 text-xs font-medium text-ui-purple hover:bg-ui-purple/20 dark:border-ui-purple/50 dark:bg-ui-purple/15`
- (~line 576) `inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300` → `inline-flex items-center rounded bg-ui-purple/15 px-1.5 py-0.5 text-[10px] font-medium text-ui-purple dark:bg-ui-purple/20`
- (~line 881) `text-[11px] italic text-amber-700 dark:text-amber-400` → `text-[11px] italic text-ui-purple`
- (~line 1201) `inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60` → `inline-flex items-center gap-1 rounded bg-ui-purple/10 px-2 py-0.5 text-xs text-ui-purple hover:bg-ui-purple/20 dark:bg-ui-purple/15 dark:hover:bg-ui-purple/25`

**E) Red error box (~line 1214):**
- `rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300 sm:col-span-2` → `rounded-md bg-ui-pink/10 px-3 py-2 text-sm text-ui-pink dark:bg-ui-pink/15 sm:col-span-2`

### Verify (REQUIRED — all must pass)
- [ ] **Step 1: Migrate** — READ `src/app/raid-panel.tsx`; apply the chrome mapping table to all chrome (zinc/shadow/light-grey/dark-grey/medium-grey, focus rings, hover bgs); then apply the 5 named edit blocks A–E above with exact before→after strings.
- [ ] **Step 2: Grep-verify** — run BOTH regexes on `src/app/raid-panel.tsx`:
  - (a) `zinc-|shadow-|bg-gradient|from-\[|(amber|red|emerald|sky|rose|slate|gray|orange|yellow|teal|cyan|indigo|violet|fuchsia|green|blue|purple|pink)-[0-9]` → ZERO matches
  - (b) `border-ui-light-grey|divide-ui-light-grey|bg-ui-light-grey|text-ui-dark-grey|text-ui-medium-grey` → ZERO matches
- [ ] **Step 3: Duplicate-utility scan** — read each changed className → confirm NO element has two `bg-*`, two `border-<color>`, or two `text-<color>` base utilities (variants are fine).
- [ ] **Step 4: Gates** — `npx vitest run raid-panel` (existing tests must stay green); `npx tsc --noEmit` (0); `npm run lint` (0). Restore `sample-workspace.md` if dirty.
- [ ] **Step 5: Commit**
```bash
git add src/app/raid-panel.tsx
git commit -m "style(palette): raid-panel to brand palette (categories pink/blue/purple/green; severity ramp green->blue->purple->pink; RAG; stale -> purple; error -> pink)"
```

---

## Task 2: Release 0.15.6

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `docs/DESIGN-TOKENS.md`.

- [ ] **Step 1: version.ts** — READ. Set `export const APP_VERSION = "0.15.6";` (currently "0.15.5"). Keep `APP_BUILD_DATE = "2026-05-28"; // Le Guin milestone`. Do NOT add a highlight key. Add a top comment above the existing `// 0.15.5 …` block:
```ts
// 0.15.6 sweeps the RAID panel onto the brand palette — surface tokens, no
// shadows; R/A/I/D category chips in pink/blue/purple/green; severity ramp
// (Low->Critical) in green/blue/purple/pink (cold->hot); RAG dots in
// pink/purple/green; stale/aging chips in purple; error box in pink.
```

- [ ] **Step 2: CHANGELOG** — READ to match style; add above `[0.15.5]`:
```markdown
## [0.15.6] — 2026-05-28

### Changed
- Continued the brand design-system rollout: the RAID panel now uses the brand palette and surface tokens — consistent light/dark surfaces, no drop shadows, R/A/I/D category chips remapped (Risk=pink, Action=blue, Issue=purple, Decision=green), severity ramp recoloured cold-to-hot (Low=green, Medium=blue, High=purple, Critical=pink), RAG health dots in pink/purple/green, stale/aging indicators in purple, error box in pink.
```
(Match `[0.15.5]` style if it differs.)

- [ ] **Step 3: DESIGN-TOKENS.md** — under "## Migration status (sub-project E)" add:
```markdown
- E-sweep raid-panel (0.15.6): raid-panel.tsx. ✅
```
Update the existing "Remaining" line to drop raid-panel (only `gantt` and menus+chrome+misc remain).

Add a new subsection (place it sensibly, e.g. after "Calendar status colors"):
```markdown
## RAID category & severity colors

- **Categories (R/A/I/D)** — 4-state chips, all 4 palette hues: Risk=`ui-pink`, Action=`ui-blue`, Issue=`ui-purple`, Decision=`ui-green`. Chips render at `/15` alpha light, `/20` dark.
- **Severity ramp (Low→Critical)** — 4-step cold→hot: Low=`ui-green`, Medium=`ui-blue`, High=`ui-purple`, Critical=`ui-pink`. Alpha escalates with severity (`/20` Low/Medium → `/25` High → `/30` Critical).
- **RAG health dots (R/A/G)** — solid dots: R=`bg-ui-pink`, A=`bg-ui-purple`, G=`bg-ui-green` (same triple as the task-form-modal RAG indicator and the reports legend).
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint` (0); `npm run test:coverage` (green, ≥70%). Then `git status`; if `src/app/sample-workspace.md` is dirty, `git restore` it.

- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts CHANGELOG.md docs/DESIGN-TOKENS.md
git commit -m "docs(release): 0.15.6 — palette sweep of the RAID panel"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Read `version.ts`/`CHANGELOG.md` directly. Confirm: `APP_VERSION === "0.15.6"`, no new highlight key, real `[0.15.6]` entry, DESIGN-TOKENS migration-status updated + RAID-colors subsection added. Run BOTH verification regexes on `raid-panel.tsx` → ZERO matches each. Confirm the named edits landed (category chips pink/blue/purple/green; RAG triple; severity ramp green→blue→purple→pink with `/20→/30` alpha; all stale chips → ui-purple; red error box → ui-pink). Confirm class-strings only (no logic/markup/behavior change). Confirm scope = `raid-panel.tsx` + `version.ts` + `CHANGELOG.md` + `docs/DESIGN-TOKENS.md` (4 files). Full suite green. Then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:** Category chips (R/A/I/D → pink/blue/purple/green) → Task 1 block A. Severity ramp (cold→hot, escalating alpha) → block C. RAG dots (R/A/G → pink/purple/green) → block B. Stale amber bits (×4 spots) → block D. Red error box → block E. Chrome → the chunk mapping. Release 0.15.6 + DESIGN-TOKENS subsection → Task 2. All spec items mapped.

**Placeholder scan:** No TBD/TODO; every replacement is an exact before→after string. The CHANGELOG "match style" note is a real source-confirmation.

**Type consistency:** Only Tailwind utility names; targets (`bg-ui-pink/15`, `bg-ui-blue/15`, `bg-ui-purple/15`, `bg-ui-green/15`, `bg-ui-pink/20–/40`, `bg-ui-purple/10–/35`, `bg-ui-green/20–/30`, `bg-ui-blue/20–/30`, `text-ui-pink/blue/purple/green`, `border-ui-purple/40`, plus the standard surface tokens) all resolve. Verification regex excludes `ui-*` utilities (no digit after the color word).
