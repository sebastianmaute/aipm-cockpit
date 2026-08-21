# Palette Sweep — RAID Panel (0.15.6) — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.15.6-palette-sweep-raid-panel`
**Context:** E-sweep chunk 4b. After 4a/0.15.5 (tasks UI + inputs + reports), this single-file chunk migrates `raid-panel.tsx` — the design-heavy display with three color systems (R/A/I/D categories, R/A/G health dots, Low/Medium/High/Critical severity ramp). 4c/gantt and chunk 5/menus+chrome+misc follow. See [[design-system-batch]].

## Goal

Migrate `src/app/raid-panel.tsx` (1345 LOC) to the AIPM palette + surface tokens with deliberate per-system color decisions for the three semantic systems, plus standard chrome + stale/error-box mapping. No behavior/markup change.

## Decided color schemes

### Category chips (R/A/I/D — 4-state, all 4 palette hues)

The `RAID_CATEGORIES` ladder is `R | A | I | D` (`types.ts:93`). Map to the four palette accent hues for maximum distinguishability:

| Category | Current | → New |
|---|---|---|
| **R** Risk | `bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300` | `bg-AIPM-pink/15 text-AIPM-pink dark:bg-AIPM-pink/20` |
| **A** Action | `bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300` | `bg-AIPM-blue/15 text-AIPM-blue dark:bg-AIPM-blue/20` |
| **I** Issue | `bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300` | `bg-AIPM-purple/15 text-AIPM-purple dark:bg-AIPM-purple/20` |
| **D** Decision | `bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300` | `bg-AIPM-green/15 text-AIPM-green dark:bg-AIPM-green/20` |

Semantic fit: R→alert, A→info, I→warning, D→positive/settled. The pink/blue/purple/green spread also matches the priority-chip ramp from chunk 4a (same alpha intensities `/15` light, `/20` dark) — visually consistent across the app.

### Severity ramp (Low / Medium / High / Critical — cold → hot, 4-state)

Currently emerald → amber → orange → red `-200/-300/-900/50/...` at ~lines 1270–1275 (the `severityRowBg`/heatmap helper). Map cold→hot using all 4 palette hues:

| Level | Current | → New |
|---|---|---|
| Low | `bg-emerald-200 hover:bg-emerald-300 dark:bg-emerald-900/50 dark:hover:bg-emerald-900` | `bg-AIPM-green/20 hover:bg-AIPM-green/30 dark:bg-AIPM-green/20 dark:hover:bg-AIPM-green/30` |
| Medium | `bg-amber-200 hover:bg-amber-300 dark:bg-amber-900/50 dark:hover:bg-amber-900` | `bg-AIPM-blue/20 hover:bg-AIPM-blue/30 dark:bg-AIPM-blue/20 dark:hover:bg-AIPM-blue/30` |
| High | `bg-orange-300 hover:bg-orange-400 dark:bg-orange-900/60 dark:hover:bg-orange-900` | `bg-AIPM-purple/25 hover:bg-AIPM-purple/35 dark:bg-AIPM-purple/25 dark:hover:bg-AIPM-purple/35` |
| Critical | `bg-red-400 hover:bg-red-500 dark:bg-red-900/70 dark:hover:bg-red-900` | `bg-AIPM-pink/30 hover:bg-AIPM-pink/40 dark:bg-AIPM-pink/30 dark:hover:bg-AIPM-pink/40` |

Reads as **green (ok) → blue (note) → purple (warn) → pink (alarm)** — a 4-step ramp that also escalates alpha (`/20 → /30`) so the visual weight grows with severity in addition to the hue shift. Aligned with the category mapping: a Critical-severity Risk row is double-pink (alarm + Risk), a Low-severity Decision is double-green (settled + positive) — reinforcing meaning.

### RAG health dots (R/A/G — 3-state, at ~lines 75-77)

The standard RAG triple, identical to task-form-modal + reports:

| Key | Current | → New |
|---|---|---|
| R | `bg-red-500` | `bg-AIPM-pink` |
| A | `bg-amber-500` | `bg-AIPM-purple` |
| G | `bg-emerald-500` | `bg-AIPM-green` |

### Stale / amber chips (~lines 381, 576, 1201)

Amber chips signalling staleness/aging items → `AIPM-purple` per the standard amber→purple rule:
- Border / bg-50 / text-800 pattern → `border-AIPM-purple/40 bg-AIPM-purple/10 text-AIPM-purple dark:border-AIPM-purple/50 dark:bg-AIPM-purple/15`
- Inline `bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300` chip → `bg-AIPM-purple/15 text-AIPM-purple dark:bg-AIPM-purple/20`
- Italic amber text (~line 881) `text-AIPM-purple` (single class, no separate dark variant needed)

### Red error box (~line 1214)

`rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300` → `rounded-md bg-AIPM-pink/10 px-3 py-2 text-sm text-AIPM-pink dark:bg-AIPM-pink/15` (the canonical soft-error-box recipe from chunk 3).

## Chrome (standard sweep mapping)

The whole-chunk pattern (per `docs/DESIGN-TOKENS.md`): `zinc-*`/`border-AIPM-light-grey`/`divide-AIPM-light-grey`/`bg-AIPM-light-grey` → `bg-surface`/`bg-surface-muted`/`border-line`/`divide-line`/`text-foreground`/`text-muted-foreground`; `shadow-*` removed; `focus:ring-AIPM-dark-blue` → `focus:ring-AIPM-green`; `hover:bg-zinc-*` + `hover:bg-AIPM-light-grey` → `hover:bg-surface-muted`. KEEP `bg-AIPM-dark-blue text-white` fills and `text-AIPM-dark-blue dark:text-AIPM-light-grey` heading pairs.

REPLACE in place — never add a second color utility.

## Non-goals

- No behavior/layout/markup/prop change — class-strings + the named record-literal contents only.
- No new tokens (E0 covered them).
- `gantt.tsx` and the menus+chrome files stay untouched (future chunks).

## Edge cases

- **Risk-matrix cells** (probability × impact, 5×5 grid): if the severity-ramp helper is also used for the matrix cell colors, the new ramp applies there too — the cold→hot escalation still reads correctly.
- **Category-D / severity-Critical visual coincidence:** a Critical-severity Decision (D) item shows a green chip on a pink-ramped row. Acceptable — the row coloring conveys severity, the chip conveys category; they answer different questions.
- **Multiple amber chips in different contexts:** all map to AIPM-purple (warning/stale), giving stale items a consistent purple thread across the panel.

## Testing

- Existing `raid-panel.test.tsx` tests assert behavior/sort/filter — not color classes — and must stay green (primary safety net).
- **Verification grep** (after migration): on `raid-panel.tsx`, ZERO matches for:
  - (a) `zinc-|shadow-|bg-gradient|from-\[|(amber|red|emerald|sky|rose|slate|gray|orange|yellow|teal|cyan|indigo|violet|fuchsia|green|blue|purple|pink)-[0-9]`
  - (b) `border-AIPM-light-grey|divide-AIPM-light-grey|bg-AIPM-light-grey|text-AIPM-dark-grey|text-AIPM-medium-grey`
- Duplicate-utility scan: no element with two same-property color base utilities.
- Gates: `npx tsc --noEmit` (0), `npm run lint` (0), full suite green.

## Release

Patch → **0.15.6** (keep "Le Guin"), no highlight key. Bump `version.ts` (top comment + `APP_VERSION = "0.15.6"`), add `[0.15.6]` CHANGELOG entry, update `docs/DESIGN-TOKENS.md`:
- Add migration-status line `E-sweep raid-panel (0.15.6): raid-panel.tsx. ✅`; update "Remaining" to drop raid-panel.
- Add a new "RAID category & severity colors" subsection documenting the category mapping (R=pink, A=blue, I=purple, D=green), the severity ramp (Low=green, Medium=blue, High=purple, Critical=pink), and the RAG dot triple (R=pink, A=purple, G=green).

Gates: lint 0, tsc 0, `test:coverage` green (≥70%).
