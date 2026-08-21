# Palette Sweep — Gantt (0.15.7) — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.15.7-palette-sweep-gantt`
**Context:** E-sweep chunk 4c — the last design-heavy single-file chunk before the final menus+chrome+misc sweep (which will close out sub-project E at 0.16.0 with the headline). Migrates `gantt.tsx` to the AIPM palette. See [[design-system-batch]].

## Goal

Migrate `src/app/gantt.tsx` (1726 LOC — the largest file in the app) from `zinc-*`/shadows/off-palette status colors to the AIPM palette + semantic surface tokens, with no behavior/layout/markup change.

## Decided color schemes

`gantt.tsx` turned out to have only a handful of semantic-color spots beyond chrome. Every one maps to an already-decided pattern from earlier chunks — no new design decisions.

### Severity icon fill (~lines 142-145, the priority ramp on each gantt bar)

A 4-state ramp identical in role to the task-row Priority chip ramp from chunk 4a. Currently 3 of 4 entries are already palette (`fill-AIPM-medium-grey`/`fill-AIPM-blue`/`fill-AIPM-pink`); only **High** is still Tailwind amber. Map per the priority-chip ramp:

| Level | Current | → New |
|---|---|---|
| Low | `fill-AIPM-medium-grey` | unchanged |
| Medium | `fill-AIPM-blue` | unchanged |
| **High** | `fill-amber-500` | **`fill-AIPM-purple`** |
| Urgent | `fill-AIPM-pink` | unchanged |

After this edit the icon ramp reads grey → blue → purple → pink — visually consistent with the task-row priority chips.

### Absence-state column tints (~lines 506-510)

Three column-background washes painted on gantt day columns for assignee absences. These are the gantt analogue of the calendar's absence cells; map per the calendar's decided scheme:

| State | Current | → New |
|---|---|---|
| Vacation (blue) | `bg-blue-200/40 dark:bg-blue-900/30` | `bg-AIPM-blue/20 dark:bg-AIPM-blue/25` |
| Sick (red) | `bg-red-200/40 dark:bg-red-900/30` | `bg-AIPM-pink/20 dark:bg-AIPM-pink/25` |
| Training (amber) | `bg-amber-200/40 dark:bg-amber-900/30` | `bg-AIPM-purple/20 dark:bg-AIPM-purple/25` |

Alpha (`/20` light, `/25` dark) is slightly stronger than the calendar's column washes (`/10–/15`) because gantt is denser — the bars sit on the column, so the tint needs to remain visible behind a bar but stay subordinate.

### Destructive button (~line 1108)

A discard/delete-style control on the gantt itself (NOT in a modal panel). Use a variant of the canonical destructive recipe — same AIPM-pink semantic, but with an explicit `bg-AIPM-pink/10` background (rather than `bg-surface` from the modal version) so it stands out against the gantt's surface.

Current: `border-red-500 bg-red-50 text-red-700 hover:bg-red-100 focus:ring-red-500 dark:border-red-500 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60`
→ New: `border-AIPM-pink bg-AIPM-pink/10 text-AIPM-pink hover:bg-AIPM-pink/20 focus:ring-AIPM-pink dark:border-AIPM-pink dark:bg-AIPM-pink/15`

### Overdue ring (~line 1594)

A red ring drawn around overdue gantt bars to flag them. Direct red → pink:

| Current | → New |
|---|---|
| `ring-2 ring-red-500` | `ring-2 ring-AIPM-pink` |

## Chrome (standard sweep mapping)

The whole-chunk pattern (per `docs/DESIGN-TOKENS.md`): `zinc-*`/`border-AIPM-light-grey`/`divide-AIPM-light-grey`/`bg-AIPM-light-grey` → `bg-surface`/`bg-surface-muted`/`border-line`/`divide-line`/`text-foreground`/`text-muted-foreground`; `shadow-*` removed; `focus:ring-AIPM-dark-blue` → `focus:ring-AIPM-green`; `hover:bg-zinc-*` + `hover:bg-AIPM-light-grey` → `hover:bg-surface-muted`. KEEP `bg-AIPM-dark-blue text-white` fills and `text-AIPM-dark-blue dark:text-AIPM-light-grey` heading pairs.

REPLACE in place — never add a second color utility.

## Non-goals

- No behavior/layout/markup change — class-strings only.
- No new tokens (E0 covered them).
- The menus+chrome+misc files stay untouched (the final chunk, which bumps to 0.16.0 with the `versionHighlightPalette` headline).

## Edge cases

- **`fill-*` utilities** (severity icons): Tailwind's `fill-` arbitrary class works with our `--AIPM-*` tokens via Tailwind v4's `@theme inline`-derived color utilities (e.g. `fill-AIPM-purple` is generated from the `--color-AIPM-purple` theme color). No CSS changes needed.
- **Overdue ring on an absence-tinted column**: a pink ring on a blue/pink/purple-tinted column stays visible because the ring is solid `AIPM-pink` while the column wash is `/20-/25` alpha — strong contrast at the ring's stroke width.
- **Destructive button vs heading text**: this gantt's destructive button uses `text-AIPM-pink` text on `bg-AIPM-pink/10` — distinct from the standard `text-AIPM-dark-blue` heading text, so no collision.

## Testing

- Existing `gantt.test.tsx` tests assert behavior (bar layout, drag, click handlers) — not color classes — and must stay green.
- **Verification grep** on `gantt.tsx` → ZERO matches for:
  - (a) `zinc-|shadow-|bg-gradient|from-\[|(amber|red|emerald|sky|rose|slate|gray|orange|yellow|teal|cyan|indigo|violet|fuchsia|green|blue|purple|pink)-[0-9]`
  - (b) `border-AIPM-light-grey|divide-AIPM-light-grey|bg-AIPM-light-grey|text-AIPM-dark-grey|text-AIPM-medium-grey`
- Duplicate-utility scan: no element with two same-property color base utilities.
- Gates: `npx tsc --noEmit` (0), `npm run lint` (0), full suite green.

## Release

Patch → **0.15.7** (keep "Le Guin"), no highlight key. Bump `version.ts` (top comment + `APP_VERSION = "0.15.7"`), add `[0.15.7]` CHANGELOG entry, update `docs/DESIGN-TOKENS.md` migration-status line (`E-sweep gantt (0.15.7): gantt.tsx. ✅`) and trim "Remaining" so only menus+chrome+misc are left.

Gates: lint 0, tsc 0, `test:coverage` green (≥70%).
