# Palette Foundation (E0) — Design Tokens (0.15.1) — Design

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.15.1-palette-foundation`
**Context:** Sub-project **E0** — the FOUNDATION of the AIPM palette sweep (E). The broader E ("enforce the AIPM palette app-wide; never gradients/shadows/off-palette colors") is being done foundation-first: E0 (this spec) establishes the token system + mapping rules + migrates the shared primitives as the proven reference; follow-on cycles sweep the remaining ~40 files area by area, each applying the documented mapping. See [[design-system-batch]]. Theme (light/dark/system, class-based `.dark`) shipped in D / 0.15.0; this builds on it.

## Goal

Establish the single source of truth for color — semantic surface tokens (light + dark) plus documented mapping rules from today's `zinc`/amber/red/etc. to the AIPM palette — and prove it by migrating the shared UI primitives. After E0, every later area-sweep is a mechanical application of the documented mapping.

## Design rules (decided)

- **Accent strategy: Green accents, Dark Blue fills.** Solid fills (primary buttons, the selected segmented-control pill) stay `AIPM-dark-blue` + white text. **Green** `#84BD00` is the signature accent: focus rings, the app's top-tab active indicator/underline, links, positive/done states, small highlights. Dark Blue `#004159` is for headings, section titles, and table-header backgrounds.
- **Status color mapping:** red → `AIPM-pink` `#E5497C` (errors, delete, validation, overdue, critical); amber/warning/medium → `AIPM-purple` `#AA4899`; info/vacation/callouts → `AIPM-blue` `#60C0DD`; holiday/differentiation → `AIPM-purple` `#AA4899`; done/positive/low → `AIPM-green` `#84BD00`. Soft backgrounds use alpha tints of these (e.g. `/10`, `/40`) — alpha of a palette color is in-palette.
- **No drop shadows, no gradients.** Remove every `shadow-*` and `bg-gradient`/`from-`/`via-`/`to-`. Where a shadow conveyed separation (cards, modals, dropdowns, sticky headers), use a `border-line` border instead.
- **Components reference only semantic tokens + `--AIPM-*` brand utilities** — never raw `zinc-*` or raw hex. That is how "no off-palette colors" is enforced at the component layer.

## Semantic surface tokens (`globals.css`)

Add role-based tokens with light values under `:root` and dark values under `.dark`, exposed via `@theme inline` as Tailwind utilities. Brand `--AIPM-*` tokens stay fixed (unchanged).

| Token | Utility | Role | Light | Dark |
|---|---|---|---|---|
| `--background` | `bg-background` | page background | `#ffffff` | `#0b0f12` |
| `--foreground` | `text-foreground` | primary text | `#636362` | `#e3e6e6` |
| `--surface` | `bg-surface` | cards, panels, modals | `#ffffff` | `#121619` |
| `--surface-muted` | `bg-surface-muted` | alt rows, chips, hovers, subtle zones | `#e3e6e6` | `#1b2024` |
| `--line` | `border-line` | borders, dividers | `#e3e6e6` | `#2b3137` |
| `--muted-foreground` | `text-muted-foreground` | secondary text | `#939598` | `#939598` |

`--background` and `--foreground` already exist (D set their dark values under `.dark`); E0 keeps `--foreground` light = `#636362` and adds the rest. The `@theme inline` block gains `--color-surface`, `--color-surface-muted`, `--color-line`, `--color-muted-foreground` mapped to the vars (so `bg-surface`, `bg-surface-muted`, `border-line`, `text-muted-foreground` exist as utilities).

**Documented dark-neutral exception:** the AIPM palette is light-oriented — its darkest neutral (`#636362`) is a text grey, too light for dark-mode surfaces. The four dark neutrals (`#0b0f12`, `#121619`, `#1b2024`, `#2b3137` — a cool, dark-blue-leaning ramp) are the ONLY non-palette values and live solely inside `globals.css` token definitions. Components never see them; they use `bg-surface` etc. This is recorded in `docs/DESIGN-TOKENS.md`.

## Shared primitives migrated in E0 (the proven reference)

Migrate these from `zinc`/shadows to the tokens + rules above:

1. **`segmented-control.tsx`** — wrapper `border-zinc-300 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900` → `border-line bg-surface` (drop `shadow-sm`); the selected pill stays `bg-AIPM-dark-blue text-white` (fill); unselected `text-zinc-700 enabled:hover:bg-zinc-100 dark:text-zinc-200 dark:enabled:hover:bg-zinc-800` → `text-foreground enabled:hover:bg-surface-muted`; inter-segment divider `border-l border-zinc-300 dark:border-zinc-700` → `border-l border-line`; **focus ring `focus:ring-AIPM-dark-blue` → `focus:ring-AIPM-green`**.
2. **`modal.tsx`** — panel `bg-white dark:bg-zinc-900` → `bg-surface`, borders → `border-line`, remove shadow utilities (the dimmed backdrop provides separation; add a `border border-line` if needed for edge definition). Keep the backdrop behavior unchanged (only colors/shadows change).
3. **`modal-header.tsx`** — borders/text to `border-line`/`text-foreground`/`text-muted-foreground`; any accent → green; remove shadows.
4. **`app-header.tsx`** — header background/border to `bg-surface`/`border-line`; the settings/help/version controls' `text-zinc-*`/hover `zinc` → `text-muted-foreground`/`hover:bg-surface-muted`; if the header hosts the app's top-tab navigation, the selected tab indicator → `AIPM-green` underline; remove shadows.

`docs/DESIGN-TOKENS.md` (NEW, committed — not gitignored) documents: the token table, the accent strategy, the status mapping, the no-shadow/no-gradient rule, and canonical recipes (primary button = `bg-AIPM-dark-blue text-white`; secondary = `border border-line` outline; destructive = `AIPM-pink`; focus ring = `ring-AIPM-green`; card = `bg-surface border border-line`). Every follow-on area-sweep cycle references this file.

## Non-goals

- The other ~40 files keep their current `zinc`/colors — migrated in follow-on cycles. The app looks mixed mid-migration (expected per foundation-first).
- No behavior/logic changes — colors, borders, shadow removal only.
- No new component abstractions (no shared `<Button>`); recipes are documented for consistency, applied inline as the codebase already does.
- No theme-mechanism changes (D owns that).

## Edge cases

- **Shadow-dependent separation:** dropdowns/menus that floated on `shadow-lg` get a `border border-line` instead.
- **Soft status backgrounds:** use palette alpha (`bg-AIPM-pink/10`, etc.), not new hexes.
- **Dark-mode contrast:** `AIPM-green` accents and `AIPM-dark-blue` fills must remain legible on the dark surfaces; verify focus rings are visible on both `bg-surface` and `bg-surface-muted`.

## Testing

- Component tests for the migrated primitives stay green; add targeted assertions where meaningful and stable: e.g. SegmentedControl's focus-ring class is `ring-AIPM-green` (not dark-blue); the modal panel has no `shadow-` class. Avoid brittle full-className snapshots.
- `globals.css` token exposure is not unit-testable directly; rely on the component tests compiling against the new utilities + `npx tsc --noEmit` + `npm run lint` + the full suite staying green.

## Release

Foundation + primitive restyle (not the headline) → **patch 0.15.1** (keep the "Le Guin" codename). Do NOT add a highlight key (patch policy; the headline `versionHighlightPalette` lands with the final sweep cycle that completes the app, likely 0.16.0). Bump `version.ts` (`APP_VERSION = "0.15.1"`, build date 2026-05-27, top comment), add a `[0.15.1]` CHANGELOG entry, add `docs/DESIGN-TOKENS.md`, note the tokens in `docs/CODEMAPS/frontend.md`. Gates: lint 0, tsc 0, `test:coverage` green (≥70%).
