# Palette Sweep — Calendar chunk: `resource-calendar.tsx` (0.15.3) — Design

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.15.3-palette-sweep-calendar`
**Context:** E-sweep chunk of sub-project **E** (after E0/0.15.1 tokens and chunk-1/0.15.2 panels). `resource-calendar.tsx` was deferred from chunk 1 because its 7-state color legend exceeds the palette's 4 hues and it uses an undefined `AIPM-light-blue` token. This chunk applies `docs/DESIGN-TOKENS.md` to it with a deliberate color scheme. See [[design-system-batch]].

## Goal

Migrate `resource-calendar.tsx` to the AIPM palette + semantic surface tokens: replace `zinc`/`shadow`/Tailwind status colors and the broken `AIPM-light-blue`, assigning each calendar state a palette color. No behavior/markup change.

## Decided color scheme

### Absence cells (solid-ish palette alpha tints + V/S/T/O glyph)
The cell is a filled day with a one-letter glyph, so hue + glyph together identify the type. Map per `docs/DESIGN-TOKENS.md` status colors:
- vacation → `AIPM-blue` (info)
- sick → `AIPM-pink` (alert)
- training → `AIPM-purple` (warning)
- other → `AIPM-medium-grey` (neutral)

Use alpha tints so each reads on both light and dark surfaces — proposed: light `bg-AIPM-<c>/30 hover:bg-AIPM-<c>/40`, dark `dark:bg-AIPM-<c>/25 dark:hover:bg-AIPM-<c>/35` (for grey use slightly higher alpha, e.g. `/45` light, since medium-grey is low-contrast). The glyph text becomes `text-foreground` (was `text-AIPM-dark-grey dark:text-AIPM-light-grey`, which is equivalent).

### Column shades (subtle washes, fainter than cells, no glyph)
- **today** → `AIPM-green` wash. Body cell `bg-AIPM-green/15 hover:bg-AIPM-green/25` (dark similar); header `bg-AIPM-green/20`. Header text keeps the heading style `text-AIPM-dark-blue dark:text-AIPM-light-grey`. **This replaces the undefined `AIPM-light-blue` token.** Green is the palette accent and "today" is the active column.
- **holiday** → faint `AIPM-purple` wash. Body cell `bg-AIPM-purple/10 hover:bg-AIPM-purple/20`; header `bg-AIPM-purple/15 text-AIPM-purple`. Lighter than the solid training cell, so the shared hue is distinguishable by intensity + the training glyph + column-vs-cell context.
- **weekend** → neutral. Body cell `bg-surface-muted` (so it stays visibly dimmer than a normal day); header `bg-surface-muted text-muted-foreground`.
- **normal** → body cell `bg-surface hover:bg-surface-muted`; header `bg-surface-muted text-muted-foreground`.

### Legend
The bottom legend chips reuse the same per-state classes so each swatch matches its cells/columns: vacation=blue, sick=pink, training=purple (stronger), other=grey, today=green, holiday=purple (fainter wash). The two purple chips are intentional (training vs holiday) and the chip labels disambiguate.

## Chrome (standard sweep mapping — identical to chunk 1)

- table/cell borders `border-zinc-200/300 dark:border-zinc-700/800` → `border-line`
- sticky assignee `<th>` and day-number header zones `bg-zinc-50/100 ... text-zinc-500/400 dark:bg-zinc-900 dark:text-zinc-400/500` → `bg-surface-muted text-muted-foreground`
- assignee name button: drop `shadow-sm`; `hover:bg-zinc-50 dark:hover:bg-zinc-800` → `hover:bg-surface-muted`; `focus-visible:ring-AIPM-dark-blue` → `focus-visible:ring-AIPM-green`; `text-AIPM-dark-grey dark:text-AIPM-light-grey` → `text-foreground`
- the sticky assignee `<td>` `bg-white dark:bg-zinc-950` → `bg-surface`
- any `text-AIPM-medium-grey` → `text-muted-foreground`; keep `text-AIPM-dark-blue` headings and `bg-AIPM-dark-blue` fills.

## Non-goals

- Only `resource-calendar.tsx` + release docs change. No logic/markup/prop/behavior change (color classes only).
- No new globals.css tokens (all colors are the existing `--AIPM-*` palette + the E0 surface tokens, with alpha).
- The resource modals (absence/shift edit) and remaining areas are later chunks.

## Edge cases

- **Glyph legibility** on the new alpha tints: verify the `text-foreground` glyph reads on `bg-AIPM-<c>/30` over white and on the dark-mode tint over the dark surface (especially the lower-contrast grey "other"). Bump the "other" alpha if needed.
- **Today + absence on the same day:** the absence cell's solid tint sits in the today column; today is conveyed by the column header's green wash (the body absence cell keeps the absence color). This matches today's behavior (absence cell color wins in the body).
- **Holiday vs training purple:** acceptable shared hue — holiday wash is `/10–/15`, training cell is `/30` + "T" glyph.

## Testing

- `resource-calendar.test.tsx` (the 2 assignee-click tests from sub-project A) asserts behavior, not colors → must stay green.
- **Verification grep** on `resource-calendar.tsx` → ZERO matches for `zinc-`, `shadow-`, `AIPM-light-blue`, `bg-gradient`, and Tailwind palette shades `(amber|red|emerald|sky|rose|slate|gray|orange|yellow|teal|cyan|indigo|violet|fuchsia|green|blue|purple|pink)-[0-9]`. Plus a duplicate-utility scan. (No brittle color-class unit tests.)
- Gates: `npx tsc --noEmit` (0), `npm run lint` (0), `npx vitest run` green.

## Release

Patch → **0.15.3** (keep "Le Guin"), no highlight key. Bump `version.ts` (top comment, `APP_VERSION = "0.15.3"`, date 2026-05-27), add a `[0.15.3]` CHANGELOG entry, update the `docs/DESIGN-TOKENS.md` migration status (calendar ✅) and add a short "Calendar status colors" subsection documenting the absence/column mapping. Gates: lint 0, tsc 0, `test:coverage` green (≥70%).
