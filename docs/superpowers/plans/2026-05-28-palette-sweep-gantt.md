# Palette Sweep — Gantt (0.15.7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `src/app/gantt.tsx` (1726 LOC — the largest file in the app) to the AIPM palette + surface tokens; chrome + 6 named status-color edits, with no behavior/markup change.

**Architecture:** Single-file class-string migration applying the shared chunk mapping + 4 named edit blocks (decided in the spec). Verified by both grep regexes + duplicate-utility scan + existing behavioral tests staying green.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-palette-sweep-gantt-design.md`
**Reference (binding):** `docs/DESIGN-TOKENS.md`
**Branch:** `feat/0.15.7-palette-sweep-gantt` (already created off `main`).

> **Heads-up for the implementer subagent:**
> 1. Fact-forcing gate. Before FIRST shell command print 2 facts (task + command purpose). Before EVERY Edit, in the SAME message print 4 facts — (a) importers (Grep `Gantt` in same turn), (b) symbols affected (none — class strings + 1 severity-fill record), (c) data fields (none), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry the Edit.
> 2. win32 — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore` it BEFORE committing.
> 4. **Class strings ONLY** (plus the 1 severity-fill record-literal value). Targeted edits — preserve all logic/markup/tests byte-for-byte.
> 5. This is a 1726-line file — be systematic, edit region by region.

---

## Task 1: Migrate `gantt.tsx`

**Files:** Modify `src/app/gantt.tsx`.

READ the file. Apply the chunk mapping + the EXACT named edits below. **CRITICAL: REPLACE each utility in place — NEVER add a second color utility. No element may end with two `bg-*`, two `border-<color>`, two `divide-*`, or two `text-<color>` base utilities (variants like `hover:`/`dark:` and `border` width + `border-line` color are fine).**

### Chunk mapping (chrome):
| Current | Replace with |
|---|---|
| `bg-white` | `bg-surface` |
| `bg-zinc-50/100`, `dark:bg-zinc-900/950` | `bg-surface-muted` |
| `border-zinc-200/300`, `dark:border-zinc-700/800`, `border-AIPM-light-grey` | `border-line` |
| `divide-zinc-*`, `divide-AIPM-light-grey` | `divide-line` |
| `bg-AIPM-light-grey`(`/NN`) | `bg-surface-muted` |
| `shadow-*` | remove |
| `focus:ring-AIPM-dark-blue` / `focus-visible:ring-AIPM-dark-blue` / `ring-zinc-*` | `ring-AIPM-green` |
| `hover:bg-zinc-*` / `dark:hover:bg-zinc-*` / `hover:bg-AIPM-light-grey` | `hover:bg-surface-muted` |
| `text-zinc-9/8/700` (+dark) | `text-foreground` |
| `text-zinc-5/6/400` (+dark) | `text-muted-foreground` |
| `text-AIPM-dark-grey` (+ any `dark:text-AIPM-light-grey`) | `text-foreground` |
| `text-AIPM-medium-grey` (+ any dark) | `text-muted-foreground` |
| `bg-gradient-*`, `from-*`, `via-*`, `to-*` | remove |

**KEEP UNCHANGED:** `bg-AIPM-dark-blue text-white` fills; heading pairs `text-AIPM-dark-blue dark:text-AIPM-light-grey`; ALL non-class code.

### Named edits (EXACT before→after)

**A) Severity icon fill — `High` entry of the severity-fill record (~line 144):**
- `High: "fill-amber-500"` → `High: "fill-AIPM-purple"`
- (Leave `Low: "fill-AIPM-medium-grey"`, `Medium: "fill-AIPM-blue"`, `Urgent: "fill-AIPM-pink"` UNCHANGED — they are already palette.)

**B) Absence-state column tints (~lines 506–510):**
- `bg-blue-200/40 dark:bg-blue-900/30` → `bg-AIPM-blue/20 dark:bg-AIPM-blue/25`
- `bg-red-200/40 dark:bg-red-900/30` → `bg-AIPM-pink/20 dark:bg-AIPM-pink/25`
- `bg-amber-200/40 dark:bg-amber-900/30` → `bg-AIPM-purple/20 dark:bg-AIPM-purple/25`

**C) Destructive button (~line 1108):**
- `border-red-500 bg-red-50 text-red-700 hover:bg-red-100 focus:ring-red-500 dark:border-red-500 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60` → `border-AIPM-pink bg-AIPM-pink/10 text-AIPM-pink hover:bg-AIPM-pink/20 focus:ring-AIPM-pink dark:border-AIPM-pink dark:bg-AIPM-pink/15`

**D) Overdue ring (~line 1594):**
- `ring-2 ring-red-500` → `ring-2 ring-AIPM-pink`

### Verify (REQUIRED — all must pass)
- [ ] **Step 1: Migrate** — READ `src/app/gantt.tsx`; apply the chrome mapping table to all chrome; then apply the 4 named edit blocks A–D above with exact before→after strings.
- [ ] **Step 2: Grep-verify** — run BOTH regexes on `src/app/gantt.tsx`:
  - (a) `zinc-|shadow-|bg-gradient|from-\[|(amber|red|emerald|sky|rose|slate|gray|orange|yellow|teal|cyan|indigo|violet|fuchsia|green|blue|purple|pink)-[0-9]` → ZERO matches
  - (b) `border-AIPM-light-grey|divide-AIPM-light-grey|bg-AIPM-light-grey|text-AIPM-dark-grey|text-AIPM-medium-grey` → ZERO matches
- [ ] **Step 3: Duplicate-utility scan** — read each changed className → confirm NO element has two `bg-*`, two `border-<color>`, or two `text-<color>` base utilities (variants are fine).
- [ ] **Step 4: Gates** — `npx vitest run gantt` (existing tests must stay green); `npx tsc --noEmit` (0); `npm run lint` (0). Restore `sample-workspace.md` if dirty. If any test file (`gantt.test.tsx` or `gantt-utils.test.ts` etc.) asserts on the OLD palette classes (zinc/amber/red shades), update those assertions to the NEW tokens to match the migration.
- [ ] **Step 5: Commit**
```bash
git add src/app/gantt.tsx
# also stage gantt.test.tsx if you updated assertions there:
git add src/app/gantt.test.tsx 2>/dev/null || true
git commit -m "style(palette): gantt to AIPM palette (High severity -> purple; absence column tints; overdue ring & destructive -> pink)"
```

---

## Task 2: Release 0.15.7

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `docs/DESIGN-TOKENS.md`.

- [ ] **Step 1: version.ts** — READ. Set `export const APP_VERSION = "0.15.7";` (currently "0.15.6"). Keep `APP_BUILD_DATE = "2026-05-28"; // Le Guin milestone`. Do NOT add a highlight key. Add a top comment above the existing `// 0.15.6 …` block:
```ts
// 0.15.7 sweeps the Gantt onto the AIPM palette — surface tokens, no shadows;
// High-severity icon fills purple to complete the priority ramp; absence
// column tints (vacation=blue, sick=pink, training=purple) at /20 alpha;
// overdue ring + destructive button in pink.
```

- [ ] **Step 2: CHANGELOG** — READ to match style; add above `[0.15.6]`:
```markdown
## [0.15.7] — 2026-05-28

### Changed
- Continued the AIPM design-system rollout: the Gantt now uses the AIPM palette and surface tokens — consistent light/dark surfaces, no drop shadows; the High-severity bar icon switched from amber to purple (completing the priority ramp); absence column tints recoloured to the palette (vacation=blue, sick=pink, training=purple); overdue ring and the destructive button now in pink.
```
(Match `[0.15.6]` style if it differs.)

- [ ] **Step 3: DESIGN-TOKENS.md** — under "## Migration status (sub-project E)" add:
```markdown
- E-sweep gantt (0.15.7): gantt.tsx. ✅
```
Update the existing "Remaining" line so the only outstanding chunk is `menus + chrome + misc` (the final one, which will bump the minor to ~0.16.0 with the `versionHighlightPalette` headline).

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint` (0); `npm run test:coverage` (green, ≥70%). Then `git status`; if `src/app/sample-workspace.md` is dirty, `git restore` it.

- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts CHANGELOG.md docs/DESIGN-TOKENS.md
git commit -m "docs(release): 0.15.7 — palette sweep of the Gantt"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Read `version.ts`/`CHANGELOG.md` directly. Confirm: `APP_VERSION === "0.15.7"`, no new highlight key, real `[0.15.7]` entry, DESIGN-TOKENS migration-status updated (gantt ✅; "Remaining" only mentions menus+chrome+misc). Run BOTH verification regexes on `gantt.tsx` → ZERO matches each. Confirm the named edits landed: severity High = `fill-AIPM-purple` (others unchanged); column tints blue/pink/purple at `/20`/`/25`; destructive button uses the gantt-variant recipe (`bg-AIPM-pink/10 ... hover:bg-AIPM-pink/20 dark:bg-AIPM-pink/15`); overdue ring = `ring-AIPM-pink`. Confirm class-strings only (no logic/markup/behavior change). Confirm scope = `gantt.tsx` (+ possibly `gantt.test.tsx`) + `version.ts` + `CHANGELOG.md` + `docs/DESIGN-TOKENS.md`. Full suite green. Then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:** Severity icon High → `fill-AIPM-purple` → block A. Absence column tints (vacation/sick/training) → block B. Destructive button (gantt-variant) → block C. Overdue ring → block D. Chrome → the chunk mapping. Release 0.15.7 + DESIGN-TOKENS migration-status → Task 2. All spec items mapped.

**Placeholder scan:** No TBD/TODO; every replacement is an exact before→after string. The CHANGELOG "match style" note is a real source-confirmation.

**Type consistency:** Only Tailwind utility names; targets (`fill-AIPM-purple`, `bg-AIPM-blue/20`, `bg-AIPM-pink/20`, `bg-AIPM-purple/20`, `bg-AIPM-pink/10`, `text-AIPM-pink`, `border-AIPM-pink`, `hover:bg-AIPM-pink/20`, `ring-AIPM-pink`, `dark:bg-AIPM-*/25` and `dark:bg-AIPM-pink/15`, plus the standard surface tokens) all resolve (palette `--AIPM-*` supports arbitrary alpha + `fill-` utilities; surface tokens defined in E0). The verification regex excludes `AIPM-*` alpha utilities (no digit follows the color word).
