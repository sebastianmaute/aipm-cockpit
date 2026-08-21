# Palette Sweep — Chunk 1: Resources + Budget Panels (0.15.2) — Design

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.15.2-palette-sweep-panels`
**Context:** First area-sweep chunk of sub-project **E** (after E0 / 0.15.1 established the tokens + `docs/DESIGN-TOKENS.md` + migrated the shared primitives). See [[design-system-batch]]. This chunk mechanically applies `docs/DESIGN-TOKENS.md` to the Resources + Budget **panel** components. The design rules are already decided and documented; this is their application, not new design.

## Goal

Migrate 5 panel components from `zinc-*`/shadows/off-palette status colors to the semantic surface tokens + AIPM palette defined in `docs/DESIGN-TOKENS.md`, with no behavior/layout/markup changes.

## Scope (5 files)

`resources-panel.tsx`, `resource-directory.tsx`, `resource-workload.tsx`, `resources-report.tsx`, `budget-panel.tsx`.

**Explicitly excluded:** `resource-calendar.tsx` (its 7-state color legend exceeds the 4 palette hues and it uses a pre-existing undefined `AIPM-light-blue` token — it gets its own focused cycle), and all edit modals (`resource-edit-modal`, `shift-edit-modal`, `absence-edit-modal`, `roles-modal`, `budget-bucket-modal` — a later "modals" chunk).

## Mapping (per `docs/DESIGN-TOKENS.md` — mechanical)

| Current | → |
|---|---|
| `bg-white` (panels/cards/sticky headers) | `bg-surface` |
| `bg-zinc-50` / `dark:bg-zinc-900` / `dark:bg-zinc-950` (alt-rows, table-header zones, hovers) | `bg-surface-muted` |
| `border-zinc-200` / `border-zinc-300` / `dark:border-zinc-700` / `dark:border-zinc-800` | `border-line` |
| `text-zinc-900` / `text-zinc-800` / `text-zinc-700` / `dark:text-zinc-100|200|300` | `text-foreground` |
| `text-zinc-500` / `text-zinc-600` / `text-zinc-400` / `dark:text-zinc-400|500` | `text-muted-foreground` |
| `shadow-sm` / any `shadow-*` | removed (separation via `border-line`) |
| focus `ring-AIPM-dark-blue` / `ring-zinc-*` | `ring-AIPM-green` |
| `bg-gradient`/`from-`/`via-`/`to-` | removed (none expected in these files) |

Solid fills stay `bg-AIPM-dark-blue text-white` (unchanged). `hover:bg-AIPM-light-grey` (already palette) may be folded into `hover:bg-surface-muted` for light/dark consistency where it pairs with a removed `dark:hover:bg-zinc-*`.

### Per-file status colors (the only non-chrome edits)

- **resource-workload.tsx**: `text-red-600 dark:text-red-400` (overdue counts) → `text-AIPM-pink`.
- **budget-panel.tsx**: `text-emerald-600 dark:text-emerald-400` (positive CCI tone) → `text-AIPM-green`; the negative branch already uses `text-AIPM-pink` (leave it).
- **resources-panel.tsx**: the absence-override input `border-amber-200 text-amber-700 dark:border-amber-900/50 dark:text-amber-400` → `border-AIPM-purple/40 text-AIPM-purple dark:border-AIPM-purple/50 dark:text-AIPM-purple` (amber/warning → purple). Plus the outer `<section>` card (`bg-white p-4 shadow-sm dark:bg-zinc-950 …`) → `bg-surface … border-line` (drop shadow).
- **resource-directory.tsx**, **resources-report.tsx**: pure chrome — no status colors (resources-report has no shadows/semantic colors at all; just zinc).

## Non-goals

- No layout, logic, markup, prop, or behavior changes — class strings only.
- No new tokens or palette changes (E0 defined them).
- `resource-calendar.tsx`, the modals, and all non-resource/budget files are untouched (later chunks). The app stays visually mixed mid-migration.

## Edge cases

- A removed `shadow-sm` on a card/sticky-header that relied on it for separation: ensure the element keeps (or gains) a `border border-line` so it stays visually delineated.
- Sticky table headers currently using `bg-zinc-50 … shadow-sm`: → `bg-surface-muted` (drop shadow); a sticky header over scrolling rows reads fine with the muted background + the table's `border-line`.
- `text-foreground`/`text-muted-foreground` already adapt to dark mode, so the paired `dark:text-zinc-*` utilities are dropped (folded into the token), not converted to a second `dark:` class.

## Testing

- The existing component tests (`resources-panel.test.tsx`, `resource-directory.test.tsx`, `resource-workload.test.tsx`, `resources-report.test.tsx`, and budget tests) assert behavior/roles/text — not zinc classes — so they must stay green (primary safety net). Do NOT add brittle full-className snapshots.
- **Per-file verification gate** (not a unit test — source files aren't unit-testable): after migrating each file, grep it and confirm ZERO remaining `zinc-`, `shadow-`, `bg-gradient`/`from-`/`via-`/`to-`, and zero off-palette color utilities (`amber|red|emerald|sky|rose|slate|gray|green-[0-9]|blue-[0-9]` etc.) — i.e. it references only `--AIPM-*` + the semantic tokens.
- Gates each task: `npx tsc --noEmit` (0), `npm run lint` (0), relevant `npx vitest run` green.

## Release

Patch → **0.15.2** (keep the "Le Guin" codename), no highlight key (patch; the headline `versionHighlightPalette` lands with the final sweep cycle). Bump `version.ts` (`APP_VERSION = "0.15.2"`, build date 2026-05-27, top comment), add a `[0.15.2]` CHANGELOG entry, and update the "Migration status" line in `docs/DESIGN-TOKENS.md` to mark these 5 panels done. Gates: lint 0, tsc 0, `test:coverage` green (≥70%).
