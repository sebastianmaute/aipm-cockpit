# Custom Color Schemes — Design

**Date:** 2026-06-30
**Status:** Approved (design); not yet implemented

## Problem

Settings → Appearance offers two fixed built-in styles (AIPM, Mockup) via the `data-style`
axis, plus separate branding inputs (logo / app name / footer slogan / favicon) in
`settings.branding`. Users want to **create, save, load, edit, import and export their own
color schemes** — bundled with logo + slogans — for white-labeling.

## Constraints (from the codebase)

- **Style axis:** `data-style="AIPM"|"mockup"` on `<html>`, stored in localStorage `lop-style`
  (NOT the settings blob), applied pre-paint by the no-flash boot script in `layout.tsx`.
  `use-style.tsx` writes the attribute; `use-theme` owns `.dark`; `style-ci.ts` holds the pure
  helpers. Mockup is light-only and PINS light (`effectiveDark`).
- **All style difference = CSS role-token VALUES** in `globals.css` (`:root` AIPM defaults,
  `:root[data-style="mockup"]` overrides, `.dark` overrides). ~6 base semantic tokens
  (`--background`/`--foreground`/`--surface`/`--surface-muted`/`--line`/`--muted-foreground`),
  9 brand colors + 3 AA `-strong` variants, ~15 role tokens (rag-*, table-head-*, segment-*,
  shadow-*, gradient-kpi, *-chip, delta-chip-pad).
- **Palette guard** (`shell-palette-guard` / palette-sweep) scans CSS **source** for off-palette
  hex / `box-shadow` / `bg-gradient-`. It does NOT scan runtime token overrides applied via
  inline style or localStorage — so custom colors are compatible **only if** they flow through
  token-var overrides, never through new Tailwind classes.
- **axe contrast gate** (`e2e/a11y.spec.ts`) scans only the shipped AIPM-light / AIPM-dark /
  Mockup-light combos. User schemes are their own data and are not gate-scanned — hence the
  in-editor contrast warning.
- **Branding** (`settings.branding {logo?, slogan?, footerSlogan?, favicon?}`) is per-device,
  validated by `sanitizeBranding` (raster-only `data:image` for logo/favicon — SVG excluded as
  XSS surface). The Appearance section already renders all four inputs.

## Decisions (from brainstorming)

1. **Custom = a 3rd style** beside AIPM/Mockup. AIPM + Mockup stay untouched built-in presets.
   A new scheme can be **seeded** from either.
2. **Tiered editor:** a curated **core 8** always visible + an **Advanced** disclosure for the
   remaining *color* role tokens. Structural tokens (`--shadow-*`, `--gradient-kpi`,
   `--delta-chip-pad`) are NOT editable (stay AIPM/none).
3. **Light-only:** a scheme defines one value per token and pins light, exactly like Mockup. The
   theme toggle disables while Custom is active.
4. **Contrast:** compute WCAG AA for key pairs, show a non-blocking ⚠ + ratio; save/apply still
   allowed.
5. **Library + JSON import/export:** per-device named library; export to / import from a JSON
   file. Import re-validates colors (hex-only) and re-sanitizes logo/favicon.

## Architecture

### Data model

```ts
type SchemeColors = Record<string, string>; // token name (e.g. "--AIPM-dark-blue") -> hex value
interface ColorScheme {
  id: number;
  name: string;
  colors: SchemeColors;     // only the tokens the scheme overrides
  branding: BrandingConfig; // logo / slogan / footerSlogan / favicon (reuses the existing type)
}
```

Tokens absent from `colors` fall back to the `:root` AIPM defaults (Custom is not Mockup), so a
scheme stores only what it overrides. Seeding from AIPM/Mockup pre-fills the editor from that
preset's token values.

### Style axis extension

- `CiStyle` → `"AIPM" | "mockup" | "custom"` (`style-ci.ts`).
- `readStoredStyle` accepts `"custom"`.
- `effectiveDark(dark, style)` → Custom pins light (same branch as Mockup).
- Keep the three sync sites in lockstep (the file documents them): the `style-ci.ts` helper,
  `use-theme.tsx` (reads the `data-style` attr), and the `layout.tsx` pre-paint boot string.

### Application (no-flash)

- **`scheme-apply.ts`** (DOM module): `applySchemeColors(colors | null)` →
  `documentElement.style.setProperty(token, value)` for each entry; passing `null` removes the
  inline overrides (`removeProperty`). This is the only legal runtime mechanism (mirrors the KPI
  gradient's inline style); it never adds a Tailwind class.
- The **active scheme's resolved color map** is mirrored to a dedicated boot key
  `lop-active-scheme-colors` (flat `{token: hex}` JSON). The `layout.tsx` pre-paint boot script
  reads `lop-style`; if `"custom"`, it `JSON.parse`s the boot key and `setProperty`s each entry
  before first paint (dependency-free, tiny). Removing/changing the active scheme rewrites this
  key.
- **Branding:** Applying a scheme copies `scheme.branding` into `settings.branding` (via the
  settings setter → `writeSettings`), so every existing logo/slogan/favicon consumer
  (sidebar / classic header / footer / favicon) works unchanged — **no consumer edits**. While
  Custom is active, the scheme is the source of truth; editing a branding field in the editor
  updates the scheme AND mirrors to `settings.branding`.

### Token mapping (core 8)

| Core control   | Primary token        | Auto-derived AA companions                |
|----------------|----------------------|-------------------------------------------|
| Brand primary  | `--AIPM-dark-blue`    | (cascades to `--table-head-bg`)           |
| Accent         | `--AIPM-green`        | `--AIPM-green-strong` (darken-to-AA)       |
| Background     | `--background`       | —                                         |
| Surface        | `--surface`          | `--surface-muted` (slight tint)           |
| Text           | `--foreground`       | `--muted-foreground` (follows)            |
| RAG red        | `--rag-red`          | `--rag-red-text` (darken-to-AA)           |
| RAG amber      | `--rag-amber`        | `--rag-amber-text` (darken-to-AA)         |
| RAG green      | `--rag-green`        | `--rag-green-text` (darken-to-AA)         |

**`scheme-tokens.ts`** (pure): the editable-token registry (core + advanced lists), the AIPM and
Mockup seed maps (canonical hex per token — single source for seeding + editor defaults), and
`deriveAaVariants(colors)` (darken a base hex until it clears AA on its background, pure). The
advanced list = remaining color tokens (`--AIPM-pink`, `--AIPM-purple`, `--AIPM-blue`,
`--AIPM-medium-grey`, `--AIPM-light-grey`, `--surface-muted`, `--line`, `--table-head-fg`,
`--segment-track-bg`, `--segment-active-bg`, `--segment-active-fg`, `--rag-*-chip`). Structural
tokens are excluded entirely.

### Contrast

**`scheme-contrast.ts`** (pure): `contrastRatio(hexA, hexB)` (WCAG relative-luminance) +
`checkSchemePairs(colors)` → `{pair, ratio, passesAa}[]` for the key pairs (Text/Background,
Accent/Surface, each RAG-text/Surface). The editor renders a ⚠ + ratio when `passesAa` is false;
nothing is blocked.

### Library + persistence

**`color-schemes.ts`** (pure, per-device — mirrors `saved-views.ts`):
- Key `lop-app:color-schemes` → `{ schemes: ColorScheme[], activeId: number | null }`,
  `MAX_SCHEMES = 30`, `id = max+1`, validated load (drop malformed), oldest dropped at cap.
- Helpers: `loadSchemes`, `saveSchemes`, `addScheme`, `updateScheme`, `removeScheme`,
  `exportScheme(scheme) -> string` (JSON), `importScheme(raw) -> ColorScheme | null`.
- **Validation** (`importScheme` + every load): each color value must match a strict hex regex
  (`/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i`) — rejects `var()`/`url()`/CSS-injection;
  unknown token keys dropped; `name` trimmed + capped; `branding` re-run through
  `sanitizeBranding` (raster-only data-URI). `setProperty` with a validated hex is injection-safe
  regardless, but hex-only is the belt-and-braces guard.
- OUT of exports/Turso; auto-cleared by `clearAppConfig`'s `lop-app:*` sweep (no extra wiring).

### UI

**`color-scheme-editor.tsx`** (new; AppearanceSection is already ~280 lines and stays lean):
- The Appearance Style `SegmentedControl` gains a `"custom"` option.
- When Custom is active, the editor renders below: scheme `<select>` (library) +
  Apply / Rename / Delete / New(seed from AIPM|Mockup) / Import / Export, the core-8 color
  pickers, an Advanced `<details>` with the remaining pickers, contrast badges, and the existing
  logo / app-name / footer-slogan / favicon inputs (now bound to the active scheme).
- **a11y:** Settings → Appearance IS axe-scanned. Every `<input type="color">` needs an
  `aria-label`; every icon/button needs an accessible name; color swatches show the user's hex via
  inline `style` (legal). Editor chrome itself uses only AIPM tokens.
- **i18n:** new EN + DE keys (DE patched via node utf8 write — the Edit tool corrupts umlauts in
  `i18n.de.ts`; file is CRLF).

## Implementation phases (one spec, phased tasks)

- **Phase A — 3rd style + apply + boot.** Extend `CiStyle`/`readStoredStyle`/`effectiveDark`;
  `scheme-apply.ts`; the `layout.tsx` boot-script branch + `lop-active-scheme-colors`; the
  Style segmented control gains "Custom"; theme toggle disables for Custom. Verifiable with a
  single hardcoded/seeded scheme.
- **Phase B — editor.** `scheme-tokens.ts` (registry + seeds + derive-AA), `scheme-contrast.ts`,
  `color-scheme-editor.tsx` core+advanced pickers + contrast + branding binding.
- **Phase C — library + import/export.** `color-schemes.ts` store + the library controls +
  JSON import/export + validation.

## Testing

- **Unit:** `scheme-tokens` (seed maps present for every editable token; `deriveAaVariants`
  produces ≥AA), `scheme-contrast` (known ratios — black/white = 21, equal = 1), `color-schemes`
  (round-trip export→import; importer rejects non-hex, drops unknown keys, caps name, sanitizes
  logo; cap + id=max+1; validated load drops malformed).
- **Component:** editor renders pickers with aria-labels; selecting Custom shows the editor;
  Apply writes active id + boot key + merges branding; contrast ⚠ appears for a sub-AA pair.
- **Eye-verify:** apply a scheme → colors change app-wide with no flash on reload; theme toggle
  disabled; seeding from Mockup reproduces Mockup; advanced tokens take effect.
- **axe gate:** re-run Settings (Appearance is scanned) for the shipped AIPM/Mockup combos —
  expect green (the editor adds labeled controls; user schemes aren't gate-scanned).

## Out of scope (YAGNI)

- Dark-mode pairs for custom schemes (light-only by decision).
- Editing structural tokens (shadows / KPI gradient / chip padding).
- Cross-device sync of the library (per-device; JSON file is the portability path).
- Non-hex color formats (hex-only for the validation guard).
