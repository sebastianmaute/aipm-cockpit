# Petrol/Mockup Theme Decoupling + Harbor Brand Default — Design (Release A)

**Date:** 2026-07-18
**Status:** Approved design → implementation plan next
**Milestone target:** 0.190.x "Pinsker" (next patch)

## Goal

Stop treating Petrol as the privileged base of the color-scheme system. Petrol and Mockup
("Dashboard") become shippable, self-contained, importable `/public/themes/*.json`
theme files. Harbor becomes the true base seed, the `globals.css :root` no-JS/pre-boot
fallback, and the brand default. Harbor, Meridian, and Umber remain code-baked canonical
built-ins.

The internal `--ui-*` CSS variable names and `ui-*` Tailwind class names are **kept as-is**
in Release A (they are internal; users never see them). Renaming them to neutral names
(`--brand-primary`, `bg-accent`, …) is **Release B**, a separate later spec.

## Scope decisions (from brainstorm)

- **Phased:** this is Release A (functional decoupling). Release B = the neutral rename.
- **Petrol/Mockup home:** shipped `/public/themes/*.json` + an in-app gallery import. They
  LEAVE `BUILTIN_SCHEMES`.
- **No migration / no back-compat:** there are no active users whose Petrol/Mockup selection
  must be preserved. An orphaned `activeId` of `petrol`/`mockup` simply Harbor-falls-back.
- **Fresh-install picker:** Harbor / Meridian / Umber only. Petrol + Dashboard appear only
  after the user imports them from the gallery.
- **Branding refresh (folded in):** default app name = "AI PM Cockpit"; fix stale
  the `alt` that names the employer. Keep the existing `/app-logo.svg` logo.

## Architecture

The scheme apply mechanism is unchanged:

```
scheme store (aipm-cockpit:color-schemes)
  → activeSchemeOf / resolveActiveScheme(isDark)
  → resolveSchemeColors (base-wins: derive AA variants, then pinned colors win)
  → scheme-apply: documentElement.style.setProperty(--ui-*, …) + structural
  ↑ boot-theme-script paints from the mirrored boot keys pre-JS
```

Petrol is removed only from the **privileged** spots:
1. `PETROL_SEED` no longer the spread base / AA-derivation fallback.
2. `globals.css :root` no longer holds Petrol values.
3. Petrol + Mockup no longer in `BUILTIN_SCHEMES`.

Imported Petrol/Mockup are ordinary removable user schemes (`u-<n>`). They already flow
through the same apply path — including `structural`, because `resolveActiveStructural`
returns `activeSchemeOf(store).structural ?? {}` generically (works for user schemes today).

## Portable theme format

The existing `exportScheme` output is **lossy** for a faithful Petrol/Mockup dump:
- It omits `structural` (Mockup's shadows + KPI gradient are its identity).
- `cleanColors` keeps only the 21 editable tokens (`CORE_TOKENS` + `ADVANCED_TOKENS`),
  stripping the hand-pinned AA variants (`--ui-green-strong`, `--ui-pink-strong`,
  `--ui-purple-strong`, `--rag-red-text`, `--rag-amber-text`, `--rag-green-text`,
  `--muted-foreground`). Without those pins, base-wins `resolveSchemeColors` re-derives
  them via `nudgeToAa` — the exact regressions the pins were added to fix.

Portable theme file shape (superset, back-compatible with current export):

```json
{
  "name": "Petrol",
  "supportsDark": true,
  "light": { "--ui-dark-blue": "#004159", ...full map incl. pinned AA variants },
  "dark":  { ...full dark map },
  "structural": { "--shadow-card": "none", "--gradient-kpi": "var(--ui-green)", ... },
  "branding": {}
}
```

Validation on import:
- Colors: hex-gated (`HEX_RE`) against a **widened** allowlist = the 21 editable tokens
  **plus** the 7 pinned derived tokens above (28 total). The editor still edits only the
  21; the extra 7 are import-only pass-through.
- Structural: new `cleanStructural(raw)` keeps only keys ∈ `STRUCTURAL_TOKENS`, each value
  gated by the existing `isSafeRawCssValue` (blocks `url(`, `expression`, `;`, braces, `@`,
  angle brackets, backtick).

## File-by-file changes

### 1. `src/app/scheme-tokens.ts`
- Delete `PETROL_SEED`, `MOCKUP_SEED`, `PETROL_STRUCTURAL`, `MOCKUP_STRUCTURAL`.
- Add `const FALLBACK_SURFACE = "#ffffff";` and use it as the AA-derivation surface
  fallback (the only surviving `PETROL_SEED` reference in `deriveAaVariants` /
  `resolveSchemeColors`).
- Keep `CORE_TOKENS`, `ADVANCED_TOKENS`, `deriveAaVariants`, `resolveSchemeColors`,
  `STRUCTURAL_TOKENS` (add if it lives here; else keep in scheme-apply).

### 2. `src/app/builtin-schemes.ts`
- Delete `PETROL_LIGHT`, `PETROL_DARK`, `MOCKUP_LIGHT` (and the `PETROL_SEED`/`MOCKUP_SEED`
  imports).
- `BUILTIN_SCHEMES = [harbor, meridian, umber]`.
- `DEFAULT_SCHEME_ID` stays `"harbor"`; `BUILTIN_SCHEME_IDS` derives from the trimmed list.
- `reconcileBuiltins` unchanged in logic — an `activeId` of `petrol`/`mockup` no longer
  resolves and Harbor-falls-back (acceptable: no users).

### 3. `src/app/color-schemes.ts`
- `exportScheme`: add `...(scheme.structural ? { structural } : {})`.
- Widen `VALID_TOKENS` to include the 7 pinned derived tokens.
- Add `cleanStructural(raw): SchemeStructuralMap` (keys ∈ `STRUCTURAL_TOKENS`, values
  `isSafeRawCssValue`).
- `cleanScheme`: read + validate `structural` when present; include it on the returned
  scheme.

### 4. `public/themes/petrol.json`, `public/themes/mockup.json`
- Full self-contained dumps generated once from the current code maps
  (`PETROL_LIGHT`/`PETROL_DARK`/`PETROL_STRUCTURAL`; `MOCKUP_LIGHT`/`MOCKUP_STRUCTURAL`) before
  deletion. Committed as static assets.
- `src/app/shipped-themes.test.ts`: fetch/read both files, assert invariants — brand
  `--ui-dark-blue === "#004159"`, Petrol `structural["--shadow-card"] === "none"`, Mockup
  `structural["--gradient-kpi"]` contains `linear-gradient`, both parse through
  `cleanScheme` non-null with pins + structural preserved.

### 5. Appearance scheme editor (`src/app/settings-sections/appearance-section.tsx` + a new `src/app/theme-gallery.tsx`)
- A "Shipped themes" gallery: two hardcoded descriptors `{ id, name, file }`
  (Petrol → `/themes/petrol.json`, Dashboard → `/themes/mockup.json`).
- Each row: an Import button → `fetch(file)` → `importScheme(text)` (widened) →
  `addScheme` → `setActive(newId)`. Same-origin fetch, no CSP change.
- Uses the shared `Button`/`Banner`/toast primitives (no hand-rolled controls, per
  no-handroll rule). Appearance is axe-scanned → labeled controls.
- Failure (offline / parse) → error toast via `reportSilentFailure` / `Banner`.

### 6. `src/app/globals.css`
- Replace the `:root` brand color values with **Harbor-light resolved** values (colors +
  the pinned AA variants + Harbor structural). Keep every `--ui-*` variable NAME and the
  entire `@theme inline { --color-brand-*: var(--brand-*) }` block (Release B renames those).
- Fixed neutrals not owned by any scheme (`--ui-dark-grey`, `--ui-white`) stay as-is.

### 7. `src/app/boot-theme-script.ts`
- Base/default paint → Harbor (embed Harbor's resolved light + structural, as it already
  embeds a default).
- Drop the embedded Petrol/Mockup maps and the legacy `aipm-cockpit-style="petrol"/"mockup"`
  → scheme mapping (any legacy value → Harbor default).
- Still writes `data-style="custom"` and still reads the mirrored
  `aipm-cockpit-active-scheme-colors` / `-structural` / `-scheme-supports-dark` boot keys
  for a returning non-default user.
- `src/app/layout-boot-script.test.ts` pins the exact boot string + runtime-evals it →
  update in lockstep.

### 8. `src/app/use-style.tsx`
- Remove the one-time legacy `aipm-cockpit-style="petrol"/"mockup"` → scheme-activeId
  migration in the lazy `useState` initializer. Any legacy value resolves to the Harbor
  default. `syncScheme` remains the sole apply path, unchanged.

### 9. Branding refresh (minimal — most already correct)
- `appTitle` is **already** "AI PM Cockpit" in both `i18n.ts` and `i18n.de.ts` — no change.
- `app-header.tsx:97`: the ONLY stale-brand fix — the default-logo `alt` that names the employer
  fallback → `t(lang, "appTitle")` ("AI PM Cockpit"). (Sidebar already falls back to the
  app title.)
- `DEFAULT_FOOTER_SLOGAN` stays; Harbor `branding:{}` inherits it. Keep `/app-logo.svg`.
- **Deliberately NOT touched (legitimate employer references, out of scope):** the
  AI-usage-policy strings (`aiConsentPolicy*`, `helpPolicyLink` — genuinely the employer's
  policy), the export attribution (`export.ts` footer, `export-pptx.ts` OOXML theme name —
  company attribution; the user IS the employer, repo on the internal GitLab host), the historical
  `versionHighlightDualCi`/`versionHighlightMockupPolish` copy (accurate history), and the
  `styleIcc` label. Only the logo alt text is a genuine stale-brand bug.

## Testing

- **Unit (vitest):** update the 7 scheme-layer tests — `builtin-schemes.test`,
  `color-schemes.test` (new structural round-trip + widened allowlist), `scheme-tokens.test`
  (FALLBACK_SURFACE), `style-tokens.test` + `shell-palette-guard.test` (`:root` now Harbor
  hex), `use-style.test` (legacy migration removed), `layout-boot-script.test` (new boot
  string). New `shipped-themes.test`. New `theme-gallery` render/import test (mock fetch).
- **e2e axe (`e2e/a11y.spec.ts`) — the landmine:** it currently imports the Petrol/Mockup
  **code maps** for its 5-combo scan (`petrol-light`, `petrol-dark`, `mockup-light`,
  `harbor-light`, `harbor-dark`). Rewrite `SCHEME_SEED` to read `public/themes/petrol.json` +
  `mockup.json` node-side, and seed the store with them as **user schemes**
  (`schemes: [{ id, name, supportsDark, light, dark, structural, branding }]`, `activeId`)
  — not the empty-`schemes[]`+built-in-`activeId` shortcut, because Petrol/Mockup are no
  longer built-ins (`reconcileBuiltins` would drop them → Harbor). All 5 combos keep
  coverage.
- **Local gates before MR:** `npx tsc --noEmit`, `npm run lint`, `npx vitest run`,
  `npm run size:check`, `npm run dup:check`, `npx vitest run palette`,
  `npx playwright test e2e/a11y.spec.ts --project=chromium`.
- **Superpowers code review** before the MR (mandatory).

## Docs

- **AGENTS.md:** update the scheme-driven-palettes section — Petrol/Mockup are no longer
  built-in schemes (now shipped importable theme files); `BUILTIN_SCHEMES` = harbor/
  meridian/umber; the 5-combo axe matrix + seed landmine (#4) reflect the JSON-sourced +
  user-scheme seed; `:root` is now the Harbor no-JS fallback.
- **CHANGELOG.md** + `version.ts` bump + a `versionHighlight*` key (EN/DE) per the release
  ritual.

## Release ritual

Branch → build → all gates green → superpowers review (fix findings) → commit →
push (HTTPS) → MR via `glab api projects/<PROJECT_ID>` → poll pipeline → merge on green (standing
auto-merge authorization). Retry the documented `timelog-panel` partial-toast flake once
if it hits.

## Out of scope (→ Release B, separate spec)

- Renaming the brand-prefixed `--brand-*` CSS vars + `brand-*` Tailwind classes → neutral names across ~230
  source files, the `@theme inline` map, palette guards, tests, and AGENTS.md.
- Any new/Harbor-specific logo asset (keeping `/app-logo.svg`).
- A theme-file manifest / third-party theme marketplace (YAGNI; two hardcoded gallery
  descriptors suffice).
- Letting the scheme editor edit `dark` maps / `structural` for user schemes (import
  preserves them; editing stays a future phase).
