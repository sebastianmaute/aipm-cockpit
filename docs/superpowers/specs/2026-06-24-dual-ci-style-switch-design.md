# Dual-CI Style Switch — Design

**Date:** 2026-06-24
**Status:** Approved (design); pending implementation plan.

## Goal

Make the app able to look like the `docs/patterns/{color,table}.png` mockups (shadows, gradients,
red/amber RAG on values/bars/text, light table header) WITHOUT losing the current flat AIPM CI.
Ship a second "Mockup" visual style that coexists with the AIPM style, user-switchable in Settings.
Extend the palette-sweep + axe gates to cover both styles.

## Reference

`docs/patterns/color.png` (KPI cards) + `docs/patterns/table.png` (profit-centre table) — the Acme
"Financial Weather Report" dashboard mockup. Same brand core (dark-blue `#004159` header, green
`#84bd00` accent, grey text) but richer: drop-shadows, gradient KPI bars, conventional red/amber/green
RAG on values + bars + text, and a light/white table header (vs the app's dark-blue header).

## Decisions (locked)

- **Orthogonal axis:** a new `style` axis (`AIPM` | `mockup`) INDEPENDENT of the existing light/dark/system
  theme. Applied as a `data-style` attribute on `<html>`, alongside the existing `.dark` class.
- **Fidelity (what Mockup adopts):** shadows + gradients; richer RAG (red/amber/green on values, bars,
  AND text — not just status dots); light table header. NOT weather-icon status (out of scope).
- **Mockup is light-only this slice:** selecting Mockup pins light mode (clears `.dark`, theme control
  disabled). A Mockup dark variant is deferred.
- **Gates scan every shipped combo:** AIPM-light, AIPM-dark, Mockup-light.
- **Style stored in a no-flash `localStorage["lop-style"]`** (mirrors `lop-theme`), NOT the settings blob.
- **One MR.**

## Current architecture (confirmed)

- Theme = `.dark` class on `<html>`, driven by `use-theme.tsx` (`THEME_STORAGE_KEY = "lop-theme"`,
  `resolveTheme(theme, systemPrefersDark())`), applied pre-paint so there is no flash. Theme choice is
  NOT in the settings blob.
- Tokens: `globals.css` `:root` (light) + `.dark` override; exposed to Tailwind via the `@theme inline`
  `--color-*` mapping. Brand tokens `--AIPM-*` + `--background/-foreground/-surface/-surface-muted/-line/
  -muted-foreground` + AA text variants `--AIPM-green-strong`/`--AIPM-pink-strong`. No amber token.
- RAG today (`health.ts`): `healthDot = { R: "bg-red-500", A: "bg-amber-500", G: "bg-emerald-500" }`
  (semantic Tailwind dot fills); `healthText = { R: "text-AIPM-pink-strong", A: "text-AIPM-purple",
  G: "text-AIPM-green-strong" }`.
- Palette gates EXIST: `palette-chrome-sweep.test.ts` + `shell-palette-guard.test.ts` (ban off-token
  hex + box-shadow). axe gate `e2e/a11y.spec.ts` — single pass, 13 `A11Y_VIEWS`, current theme only.
- Table header: `TABLE_HEAD_CLASS` (`table-styles.ts`) = `.lop-thead` marker; dark-blue fill + white
  text + rounded corners via `globals.css` `.lop-thead` th rules.
- App is currently flat (no shadow-/gradient- utilities in components).

## Architecture

### 1. Style axis — `data-style` + no-flash store
- New `use-style.tsx` hook (sibling of `use-theme.tsx`): reads/writes `localStorage["lop-style"]`
  (`"AIPM" | "mockup"`, default `"AIPM"`), exposes `{ style, setStyle }` via a small provider, and sets
  `document.documentElement.setAttribute("data-style", style)`.
- The existing pre-paint boot script (the inline script that sets `.dark` before first paint) is extended
  to ALSO read `lop-style` and set `data-style` before paint (no FOUC). When `style === "mockup"` the
  boot script ALSO removes `.dark` (Mockup pins light) so dark tokens never apply to Mockup.
- `use-theme` integration: when style is `mockup`, theme resolves to light regardless of the stored theme;
  the Appearance theme control is disabled with a "Mockup is light-only" note. Switching back to AIPM
  restores the user's prior theme choice (the `lop-theme` value is untouched).

### 2. Token layer (semantic role tokens; both styles define them)
All visual difference is expressed as CSS variables so a single attribute switch reflows every view.
Add to `globals.css`:
- AIPM values live in `:root` (and `.dark`) as today, PLUS new role tokens:
  - `--rag-red`, `--rag-amber`, `--rag-green` — RAG FILL colors.
  - `--rag-red-text`, `--rag-amber-text`, `--rag-green-text` — AA-passing TEXT variants (amber-as-text
    must be darker than amber-as-fill; same rule that produced `green-strong`).
  - `--table-head-bg`, `--table-head-fg`.
  - `--shadow-card`, `--shadow-control` (AIPM: `none`).
  - `--gradient-kpi` (AIPM: a flat single-token fill / `none`).
- AIPM role-token values reproduce TODAY's look: `--table-head-bg = var(--AIPM-dark-blue)`,
  `--table-head-fg = #fff`; RAG tokens = the current semantic dot/text colors; shadows `none`.
- Mockup overrides in a `:root[data-style="mockup"]` block: light `--table-head-bg`/dark `-fg`; soft
  tinted `--shadow-*`; red→amber→green `--gradient-kpi`; mockup red/amber/green RAG (fills + AA text).
- Wire the role tokens into the `@theme inline` map so Tailwind utilities (`bg-[var(--rag-amber)]`,
  `shadow-[var(--shadow-card)]`, etc.) resolve. All new colors AA-verified on their own surfaces.

### 3. RAG refactor (the central reuse)
`health.ts`: `healthDot`/`healthText` point at the `--rag-*` / `--rag-*-text` tokens (via
`bg-[var(--rag-…)]` / `text-[var(--rag-…-text)]`). The KPI value/delta/progress-bar coloring in the
dashboard + reports panels switches to the same tokens. Net: one style switch reflows all RAG/KPI color.
`RagBadge` keeps its dot+label structure (no weather icons). Adds the first real amber token.

### 4. Table header + cards
`.lop-thead` th rules reference `var(--table-head-bg/-fg)`. Card/surface primitives opt into
`shadow-[var(--shadow-card)]` (a no-op under AIPM → flat unchanged). KPI bars use `--gradient-kpi`.

### 5. Gates (extended)
- **palette-sweep** (`palette-chrome-sweep` + `shell-palette-guard`): made style-aware — still BANS
  hardcoded off-token hex AND raw shadow literals (`shadow-md`, `shadow-[0_2px…]`, etc.) everywhere;
  ALLOWS `shadow-[var(--shadow-*)]`, `bg-[var(--rag-*)]`, `[var(--gradient-kpi)]`, and the new role
  tokens. Shadows/gradients are therefore legal only via tokens, so AIPM stays provably flat.
- **axe** `e2e/a11y.spec.ts`: parametrize over the shipped combos — AIPM-light, AIPM-dark, Mockup-light —
  setting `lop-style` (+ theme) before each view scan. Add AA-contrast assertions for the mockup
  red/amber/green TEXT tokens on mockup surfaces. (Mockup-dark not shipped → not scanned.)

### 6. Settings switch
`AppearanceSection` gains a **Style** `SegmentedControl<"AIPM"|"mockup">` driven by `use-style`
(no-flash store). The theme control is disabled (with a note) while Mockup is active. New i18n keys
(EN + DE, real umlauts via node-write): style label + the two option labels + the light-only note.

## Error handling
- `lop-style` read is validated (`"AIPM"|"mockup"`, else `"AIPM"`); a corrupt value never throws.
- Boot script is defensive (try/catch like the theme boot) so a storage failure degrades to AIPM-light.
- No new persisted Workspace/serialization field → exports, Turso, golden byte-stability all unaffected.

## Testing
- `use-style` unit: read/validate/default, set→attribute, mockup-pins-light (clears `.dark`).
- Token-presence test: every role token defined under `:root`, `.dark` (where applicable), and
  `:root[data-style="mockup"]`; AIPM role tokens equal today's literals (no-op for existing users).
- RAG-token mapping test: `healthDot`/`healthText` resolve to the role tokens.
- palette-sweep updates: a raw `shadow-md` still FAILS; a `shadow-[var(--shadow-card)]` PASSES; an
  off-token hex still FAILS under both styles.
- axe matrix: 13 views × {AIPM-light, AIPM-dark, Mockup-light} green; AA-contrast for mockup text tokens.
- Settings: Style control renders + persists (no-flash); theme control disabled under Mockup.
- Full unit suite + golden byte-stability unaffected.

## Release
- Bump `version.ts` (APP_VERSION + milestone), CHANGELOG, `versionHighlightDualCi` (EN+DE), README badge.
- AGENTS.md: a "Dual-CI / style axis" bullet — `data-style` orthogonal to `.dark`; role tokens are the
  switch surface; Mockup is light-only + pins light; palette-sweep is style-aware (shadows/gradients only
  via `--shadow-*`/`--gradient-*` tokens); axe scans AIPM-light/AIPM-dark/Mockup-light.

## Out of scope (this slice)
Weather-icon RAG status; Mockup dark variant; per-view bespoke redesign; sparkline restyle beyond token
color; making the style a per-project (workspace) or shared/exported setting (stays per-device).
