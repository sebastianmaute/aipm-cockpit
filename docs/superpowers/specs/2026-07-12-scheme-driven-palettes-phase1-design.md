# Scheme-Driven Palettes — Phase 1 Design

**Status:** Approved (design). **Date:** 2026-07-12.

**Goal:** Make the app's look **scheme-driven**. Ship three dark-capable, built-in color schemes — **Harbor** (the new default), **Meridian**, **Umber** — selectable in Settings → Appearance, applied via the existing inline-token mechanism. This lays the foundation for later phases (de-hardcoding AIPM, database loading, logo-in-scheme).

**Approach:** Extend the existing custom-scheme engine (`scheme-tokens.ts` / `scheme-apply.ts` / `color-schemes.ts`) to support (a) **light + dark** token sets per scheme, (b) **built-in** (code-defined, undeletable) schemes, and (c) a **default** scheme applied on a fresh install. AIPM and Mockup remain their current `globals.css` `data-style` styles for now (still selectable); AIPM's `:root` stays as the physical fallback. **No de-hardcoding of AIPM in this phase.**

---

## Decisions (confirmed with user)

1. **New base default = Harbor.** A fresh install applies Harbor, not AIPM.
2. **Scheme-driven architecture** (not new `globals.css` `data-style` blocks) — so this phase becomes the de-hardcode foundation rather than throwaway CSS.
3. **Light + dark** for all three built-in schemes.
4. **Custom-scheme editor stays light-only this phase** — dark-editing for user/custom schemes is a later phase. Built-in schemes carry both.

## Non-goals (explicitly later phases)

- **Phase 2:** turn AIPM (and Mockup) into built-in schemes, then thin/remove the hardcoded `globals.css` palette blocks (the actual de-hardcode).
- **Phase 3:** load schemes from the **database** (Turso, shared/tenant brand) — a global table out of `TABLE_NAMES`, `tursoConfig !== null` gated, with a synchronous localStorage mirror for no-flash.
- **Phase 4:** **logo/favicon** carried in a scheme (full brand pack) — extend `mergeAppliedBranding` beyond slogan/footer.
- Dark-editing UI for custom schemes.

---

## Architecture

### Scheme model (extended)

Today (`color-schemes.ts`): `ColorScheme = { id, name, colors: SchemeColorMap, branding }` — `colors` is a single **light-only** map. Extend to:

```ts
type SchemeColorMap = Record<string, string>;           // token -> hex (unchanged)
interface ColorScheme {
  id: number | string;      // built-ins use a stable string id ("harbor"); user schemes keep numeric
  name: string;
  builtIn?: boolean;        // true => undeletable, name/colors code-owned (like operating-guide built-ins)
  supportsDark: boolean;    // built-ins: true; migrated user schemes: false
  light: SchemeColorMap;    // renamed/expanded from `colors`
  dark?: SchemeColorMap;    // present iff supportsDark
  branding: BrandingConfig;
}
```

**Back-compat migration** (`cleanScheme` load path): a legacy `{ colors }` scheme → `{ light: colors, supportsDark: false }`. No data loss; existing per-device libraries keep working.

### Applying a scheme (theme-aware)

`scheme-apply.ts` currently applies one map. Change:
- `resolveActiveScheme(theme: "light"|"dark")` picks `scheme.dark ?? scheme.light` when `theme==="dark" && supportsDark`, else `scheme.light`.
- `resolveSchemeColors(map)` still runs `deriveAaVariants` to synthesize the `-strong`/`-text` tokens.
- Apply via inline `documentElement.style.setProperty` (unchanged — the only palette-guard-safe runtime mechanism).

### The style axis + default

- `data-style` stays `"AIPM" | "mockup" | "custom"`. A **built-in or user scheme is applied under `data-style="custom"`** (the runtime-injection slot). AIPM/Mockup keep their `globals.css` blocks.
- **Active-scheme state** (per-device): a new `activeSchemeId` (localStorage) selects which scheme is applied. On a fresh install with no stored style/scheme → **default to Harbor** (built-in), `data-style="custom"`, Harbor tokens injected.
- **`effectiveDark`** (`style-ci.ts`, `use-theme`, boot string — the 3 in-sync sites): the "pin light for custom" rule becomes "pin light unless the ACTIVE scheme `supportsDark`". Harbor/Meridian/Umber support dark → the theme toggle works; a light-only custom scheme still pins light.

### No-flash boot (the one delicate edit)

`layout.tsx` `NO_FLASH_THEME_SCRIPT` (pinned by `layout-boot-script.test.ts`) today injects scheme colors **only for `data-style="custom"`** from `lop-active-scheme-colors`. Changes:
- The **resolved active token map** (light or dark, per the booted theme) is always mirrored to `lop-active-scheme-colors` (the non-`lop-app:` boot key) whenever the active scheme or theme changes — including on first-run seeding of Harbor.
- The boot script: if no `lop-style` stored → treat as the default scheme (`custom` + Harbor); read `lop-active-scheme-colors` and `setProperty` pre-paint. Keep the mirror **theme-correct** (write the dark map when booting dark).
- **`layout-boot-script.test.ts` updated in lockstep** (it pins the exact string).

### Axe gate

`e2e/a11y.spec.ts` scans AIPM-light, AIPM-dark, Mockup-light across `A11Y_VIEWS`. Add **Harbor-light and Harbor-dark** (seed `lop-style="custom"` + `activeSchemeId="harbor"` + the mirror via `addInitScript`) so the **new default** look is contrast-verified in the gate. Meridian/Umber are verified by the pure `scheme-contrast.ts` AA check (unit) — not added to the e2e matrix to keep it fast (documented; matches how custom schemes are unscanned today).

---

## The three palettes (identity locked; light + dark)

Identity hexes locked from the approved mockup. The **CORE** role tokens (`--AIPM-dark-blue`=primary, `--AIPM-green`=accent, `--background`, `--surface`, `--foreground`, `--rag-red/-amber/-green`) + `--table-head-bg/-fg/-accent` + `--surface-muted` + `--line` are fixed below. The remaining **ADVANCED** tokens (`--AIPM-pink`, `--AIPM-purple`, `--AIPM-blue`, `--AIPM-medium-grey`, `--AIPM-light-grey`, `--segment-track-bg/-active-bg/-active-fg`) are filled per scheme during implementation by the token-fill rules (below) and AA-verified; the `-strong`/`-text` variants are auto-derived by `deriveAaVariants`.

### Harbor (DEFAULT) — cool navy / teal

| token | light | dark |
|---|---|---|
| primary (`--AIPM-dark-blue`) | `#153a5c` | `#2b6493` |
| on-primary (`--table-head-fg` / button text) | `#ffffff` | `#f2f8fc` |
| accent (`--AIPM-green`) | `#0e8f86` | `#22b3a7` |
| background | `#f6f8fa` | `#0e1620` |
| surface | `#ffffff` | `#16212e` |
| surface-muted | `#eef2f6` | `#1b2836` |
| foreground | `#15212e` | `#e4edf4` |
| line | `#dbe2ea` | `#273746` |
| rag-red | `#d24a4a` | `#ef7676` |
| rag-amber | `#cf8a1c` | `#e8b25a` |
| rag-green | `#2f9d70` | `#4bc394` |
| table-head-bg | `#153a5c` | `#1c3550` |
| table-head-accent | `#0e8f86` | `#5fd0c6` |

### Meridian — vivid indigo / emerald

| token | light | dark |
|---|---|---|
| primary | `#3730a3` | `#6366f1` |
| accent | `#0f9d6b` | `#10b981` |
| background | `#f7f8fc` | `#111120` |
| surface | `#ffffff` | `#1a1a2c` |
| surface-muted | `#eef0f8` | `#23233a` |
| foreground | `#191a2b` | `#e8e8f5` |
| line | `#e0e2f0` | `#31314a` |
| rag-red | `#d83a3a` | `#f27171` |
| rag-amber | `#d18309` | `#f0b64f` |
| rag-green | `#16a34a` | `#37c46f` |
| table-head-bg | `#3730a3` | `#2c2b6e` |
| table-head-accent | `#0f9d6b` | `#a5b4fc` |

### Umber — warm espresso / amber-gold

| token | light | dark |
|---|---|---|
| primary | `#3b332a` | `#6a5a45` |
| accent | `#b5771a` | `#d99b3a` |
| background | `#faf8f4` | `#181410` |
| surface | `#ffffff` | `#221d16` |
| surface-muted | `#f1ece3` | `#2c261e` |
| foreground | `#2a241d` | `#efe7db` |
| line | `#e6ded2` | `#382f25` |
| rag-red | `#bd4a30` | `#e07a5f` |
| rag-amber | `#c88f17` | `#e0b34a` |
| rag-green | `#6c8a35` | `#9cb85e` |
| table-head-bg | `#3b332a` | `#33291e` |
| table-head-accent | `#b5771a` | `#e0a94a` |

### Token-fill rules for the remaining ADVANCED tokens

- `--AIPM-blue` = a lighter tint of the primary hue (info/link secondary).
- `--AIPM-pink`, `--AIPM-purple` = harmonized secondary hues for the palette (used for the destructive/consent semantics + purple diff text); keep AA where used as small text via the `-strong` derivation.
- `--AIPM-medium-grey`, `--AIPM-light-grey` = neutral scale between `line` and `foreground`, biased slightly toward the primary hue (per artifact-design "neutrals, don't default").
- `--segment-track-bg` = `surface-muted`; `--segment-active-bg` = `primary`; `--segment-active-fg` = on-primary.
- All produced values run through `scheme-contrast.ts` (warn) + the Harbor set through the axe gate (fail).

---

## Storage

- **Built-in schemes** are code-defined (a `BUILTIN_SCHEMES` array, seeded/reconciled like `use-operating-guides`' built-ins: content code-owned, undeletable, but the user's `activeSchemeId` choice preserved).
- **`activeSchemeId`** (per-device localStorage, e.g. `lop-app:active-scheme`) selects the applied scheme. Default `"harbor"`.
- The per-device custom library (`lop-app:color-schemes`) is unchanged except the model migration (light-only → `{light, supportsDark:false}`).
- The boot mirror `lop-active-scheme-colors` now carries the **resolved (theme-correct) default** on first run.

## UI (Settings → Appearance)

- The style/scheme switcher lists: **Harbor (default) · Meridian · Umber · AIPM · Mockup · [user custom schemes]**. Selecting a built-in scheme sets `activeSchemeId` + applies. AIPM/Mockup select their `data-style`.
- The theme (light/dark) toggle is **enabled** when the active scheme `supportsDark` (Harbor/Meridian/Umber and AIPM); disabled for light-only schemes/Mockup (unchanged behavior for those).
- The custom-scheme editor is unchanged (light-only) this phase.
- Appearance is axe-scanned — keep the switcher's control labels/roles intact.

## Risks & mitigations (recap)

- **Boot flash on the new default** → boot script injects the resolved default map pre-paint + `layout-boot-script.test.ts` updated in lockstep.
- **Axe contrast** → Harbor light+dark added to the e2e matrix; all schemes pass the unit `scheme-contrast` AA check.
- **Palette guards** (`palette-chrome-sweep`/`shell-palette-guard`) → unaffected: color still comes from `globals.css` tokens whose *values* are overridden by inline `setProperty`; no new Tailwind classes, no raw shadows/gradients.
- **Seed drift** → the built-in scheme maps become a real source (not another duplicate); `ICC_SEED`/`MOCKUP_SEED` stay for the existing custom-editor seeds until Phase 2 collapses them.

## Testing strategy

- Pure: scheme model migration (legacy `{colors}` → `{light,supportsDark:false}`); `resolveActiveScheme(theme)` picks light/dark correctly; `deriveAaVariants` unchanged; `scheme-contrast` AA pass for all three built-ins (light+dark).
- Built-in seeding: `BUILTIN_SCHEMES` present + undeletable; `activeSchemeId` default Harbor; user override preserved across reload.
- Boot: `layout-boot-script.test.ts` pins the new string; a first-run (no localStorage) test asserts the default (Harbor) map mirrors + injects.
- e2e axe: Harbor light + dark added to `A11Y_VIEWS` scan.
- i18n EN/DE for the new scheme names + any switcher strings.
- No golden-fixture change (schemes are per-device chrome, out of workspace exports/Turso this phase).
