# Scheme-Driven Palettes — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or executing-plans). Implement task-by-task; each task its own commit. `npx tsc --noEmit` + `npm run test:run` after each. FEATURE branch off `main` (`feat/scheme-driven-palettes`). NOT a release until the user says "release".

**Goal:** Make the look **scheme-driven** — extend the custom-scheme engine to carry **light+dark** maps, ship 3 **built-in** dark-capable schemes (**Harbor** default, **Meridian**, **Umber**), and apply the default on fresh install. AIPM/Mockup stay as `globals.css` styles this phase.

**Spec:** `docs/superpowers/specs/2026-07-12-scheme-driven-palettes-phase1-design.md`.

**Architecture:** A built-in/user scheme applies under `data-style="custom"` via inline `setProperty` (existing mechanism). A new per-device `activeSchemeId` selects which scheme; fresh install → Harbor. `ColorScheme` gains `{ light, dark?, supportsDark, builtIn? }`. `supportsDark` is surfaced to the pin-light rule + boot script so dark-capable schemes let the theme toggle work.

## The 6 hard parts (from the signature reference — read before starting)
1. **Model migration** — `ColorScheme.colors` (flat) → `{ light, dark?, supportsDark, builtIn? }`; ripples through `cleanScheme`/`add`/`update`/`export`/`import` + the editor.
2. **Mode-aware AA derivation** — `deriveAaVariants` hardcodes the light `--surface` as the AA background; a dark map needs its `-text`/`-strong` derived against the DARK surface (lighten-to-AA, not darken).
3. **Theme→apply reactivity** — `applySchemeColors` only fires on style change today; a dark-capable scheme must re-apply the correct sub-map when `.dark` toggles.
4. **Boot script + 3 synced sites** — `effectiveDark` (`style-ci.ts`), the `use-theme` `pinsLight` read, and `NO_FLASH_THEME_SCRIPT` all hardcode `custom→light`. All three + the pinned `layout-boot-script.test.ts` string change; the boot script must pick light/dark sub-map pre-paint from a boot-readable signal.
5. **Built-in id space** — numeric `nextId` collides with code-defined built-ins; use **string ids** + a `removeScheme` built-in guard (mirror `use-operating-guides` `BUILTIN_IDS`).
6. **Axe seeding** — Harbor light+dark combos need `addInitScript` to seed the resolved Harbor map + supportsDark key, not just a COMBOS row.

## Key files
`color-schemes.ts`, `scheme-tokens.ts`, `scheme-apply.ts`, `style-ci.ts`, `use-style.tsx`, `use-theme.tsx`, `layout.tsx` (+ `layout-boot-script.test.ts`), `settings-sections/appearance-section.tsx`, `color-scheme-editor.tsx`, `e2e/a11y.spec.ts`, `i18n.ts`/`i18n.de.ts`. New: `builtin-schemes.ts`, `use-color-schemes.ts` (reconcile/active hook).

---

## Task 1 — `ColorScheme` model migration (light+dark, built-in, string ids)

**Files:** `color-schemes.ts`, `color-schemes.test.ts` (create/extend).

- [ ] **Step 1 — failing tests:** (a) a legacy `{ id, name, colors, branding }` scheme loads/migrates to `{ id, name, light: colors, supportsDark:false, branding }` (no data loss); (b) `cleanScheme` accepts the new `{ light, dark?, supportsDark }` shape, validating both maps via `cleanColors`; (c) `removeScheme` on a `builtIn` id is a no-op; (d) `nextId` returns a string for user schemes disjoint from built-in ids (or keep numeric for user + reserve string ids for built-ins — see step 3).

- [ ] **Step 2 — model + migration** (`color-schemes.ts`):
```ts
export interface ColorScheme {
  id: string;              // user: "u-<n>"; built-in: "harbor"/"meridian"/"umber"
  name: string;
  builtIn?: boolean;
  supportsDark: boolean;
  light: SchemeColorMap;
  dark?: SchemeColorMap;   // present iff supportsDark
  branding: BrandingConfig;
}
export interface SchemeStore { schemes: ColorScheme[]; activeId: string | null; }
```
`cleanScheme(raw, id)`: read `light` from `raw.light ?? raw.colors` (migration); `dark = raw.supportsDark ? cleanColors(raw.dark) : undefined`; `supportsDark = raw.supportsDark === true && Object.keys(dark ?? {}).length > 0`. `exportScheme` emits `{ name, light, dark?, supportsDark, branding }` (drop id). `importScheme` via `cleanScheme(parsed, nextUserId())`.

- [ ] **Step 3 — ids + guards:** `nextUserId(schemes)` → `"u-" + (max numeric suffix + 1)`. `removeScheme(id)`: `if (schemes.find(s=>s.id===id)?.builtIn) return store;`. `updateScheme` on a built-in: allow only non-code fields or block (built-ins are code-defined — block, return unchanged). `mergeAppliedBranding` unchanged (slogan/footer only, this phase).

- [ ] **Step 4 — run tests → GREEN.** `npx tsc --noEmit` (the shape change ripples — expect editor/appearance callers to break; fix in Task 6, but keep this file self-consistent + its tests green).

- [ ] **Step 5 — commit:** `feat(schemes): ColorScheme light+dark+builtIn model + migration`

## Task 2 — mode-aware AA-variant derivation

**Files:** `scheme-tokens.ts`, `scheme-tokens.test.ts`.

- [ ] **Step 1 — failing test:** `resolveSchemeColors(darkMap)` derives `--rag-*-text`/`--AIPM-*-strong` that PASS AA (≥4.5) against the map's OWN `--surface` (a dark surface), not the light `ICC_SEED` surface. Assert a known dark map yields light-enough text tokens (ratio ≥4.5 vs its dark surface).

- [ ] **Step 2 — implement:** in `deriveAaVariants`, background = `colors["--surface"]` (already), but choose direction by surface luminance: if the surface is **dark** (`relLuminance(surface) < 0.5`), *lighten* the base toward AA (`×1/0.85` per iteration, clamp to #fff) instead of darkening. Extract a `nudgeToAa(base, bg, {dark})` helper. `resolveSchemeColors` unchanged signature (`{...colors, ...deriveAaVariants(colors)}`) — it now works for both light and dark maps because it reads the map's own surface.

- [ ] **Step 3 — GREEN; commit:** `feat(schemes): derive AA text/strong variants against the map's own (light or dark) surface`

## Task 3 — built-in schemes data + reconcile/active hook

**Files:** `builtin-schemes.ts` (new), `use-color-schemes.ts` (new, coverage-excluded glue if it holds hooks; the reconcile fn is pure/tested), `builtin-schemes.test.ts`, `use-color-schemes.test.ts`.

- [ ] **Step 1 — failing tests:** (a) `BUILTIN_SCHEMES` has harbor/meridian/umber, each `builtIn:true`, `supportsDark:true`, both maps covering all 21 `VALID_TOKENS`; (b) every built-in × {light,dark} passes `checkSchemePairs` (AA) — assert zero failing pairs; (c) `reconcileBuiltins(existing)` seeds absent built-ins, refreshes changed code fields, preserves the user's `activeId`; a built-in is undeletable; (d) fresh (empty) store → `activeId` defaults to `"harbor"`.

- [ ] **Step 2 — the palettes** (`builtin-schemes.ts`). Full 21-token light+dark maps (identity locked from the spec; advanced tokens filled per the rules, AA-verified by the Step-1 test — adjust any failing hex):

```ts
export const HARBOR_LIGHT: SchemeColorMap = {
  "--AIPM-dark-blue":"#153a5c","--AIPM-green":"#0e8f86","--background":"#f6f8fa","--surface":"#ffffff",
  "--foreground":"#15212e","--rag-red":"#d24a4a","--rag-amber":"#cf8a1c","--rag-green":"#2f9d70",
  "--AIPM-pink":"#c24a76","--AIPM-purple":"#5f57a8","--AIPM-blue":"#2f6f9e","--AIPM-medium-grey":"#7d8a97",
  "--AIPM-light-grey":"#c9d3dc","--surface-muted":"#eef2f6","--line":"#dbe2ea","--table-head-bg":"#153a5c",
  "--table-head-fg":"#ffffff","--table-head-accent":"#0e8f86","--segment-track-bg":"#eef2f6",
  "--segment-active-bg":"#153a5c","--segment-active-fg":"#ffffff",
};
export const HARBOR_DARK: SchemeColorMap = {
  "--AIPM-dark-blue":"#2b6493","--AIPM-green":"#22b3a7","--background":"#0e1620","--surface":"#16212e",
  "--foreground":"#e4edf4","--rag-red":"#ef7676","--rag-amber":"#e8b25a","--rag-green":"#4bc394",
  "--AIPM-pink":"#e88bb0","--AIPM-purple":"#a596d8","--AIPM-blue":"#5aa6d8","--AIPM-medium-grey":"#8493a1",
  "--AIPM-light-grey":"#3a4a58","--surface-muted":"#1b2836","--line":"#273746","--table-head-bg":"#1c3550",
  "--table-head-fg":"#dce8f2","--table-head-accent":"#5fd0c6","--segment-track-bg":"#1b2836",
  "--segment-active-bg":"#2b6493","--segment-active-fg":"#f2f8fc",
};
// MERIDIAN_LIGHT / MERIDIAN_DARK / UMBER_LIGHT / UMBER_DARK — same 21 keys; identity hexes:
//  Meridian light  primary #3730a3 accent #0f9d6b bg #f7f8fc surf #ffffff fg #191a2b
//    rag #d83a3a/#d18309/#16a34a  muted #eef0f8 line #e0e2f0 head-bg #3730a3 head-accent #0f9d6b
//    pink #c93a86 purple #7c3aed blue #4f6bd8 med-grey #7d8098 light-grey #cbcede head-fg #ffffff
//    seg-track #eef0f8 seg-active-bg #3730a3 seg-active-fg #ffffff
//  Meridian dark   primary #6366f1 accent #10b981 bg #111120 surf #1a1a2c fg #e8e8f5
//    rag #f27171/#f0b64f/#37c46f  muted #23233a line #31314a head-bg #2c2b6e head-accent #a5b4fc
//    pink #e87ab8 purple #a78bfa blue #818cf8 med-grey #82849e light-grey #43435a head-fg #e2e2f5
//    seg-track #23233a seg-active-bg #6366f1 seg-active-fg #f5f5ff
//  Umber light     primary #3b332a accent #b5771a bg #faf8f4 surf #ffffff fg #2a241d
//    rag #bd4a30/#c88f17/#6c8a35  muted #f1ece3 line #e6ded2 head-bg #3b332a head-accent #b5771a
//    pink #b34a5a purple #7a5a8a blue #4a6a8a med-grey #9a8f7e light-grey #d8cfc0 head-fg #f2ebe0
//    seg-track #f1ece3 seg-active-bg #3b332a seg-active-fg #f2ebe0
//  Umber dark      primary #6a5a45 accent #d99b3a bg #181410 surf #221d16 fg #efe7db
//    rag #e07a5f/#e0b34a/#9cb85e  muted #2c261e line #382f25 head-bg #33291e head-accent #e0a94a
//    pink #d98a9a purple #b394c8 blue #7a9ab8 med-grey #8a7f6e light-grey #4a4030 head-fg #efe4d3
//    seg-track #2c261e seg-active-bg #6a5a45 seg-active-fg #f6efe4

export const BUILTIN_SCHEMES: ColorScheme[] = [
  { id:"harbor",   name:"Harbor",   builtIn:true, supportsDark:true, light:HARBOR_LIGHT,   dark:HARBOR_DARK,   branding:{} },
  { id:"meridian", name:"Meridian", builtIn:true, supportsDark:true, light:MERIDIAN_LIGHT, dark:MERIDIAN_DARK, branding:{} },
  { id:"umber",    name:"Umber",    builtIn:true, supportsDark:true, light:UMBER_LIGHT,    dark:UMBER_DARK,    branding:{} },
];
export const DEFAULT_SCHEME_ID = "harbor";
export const BUILTIN_SCHEME_IDS = new Set(BUILTIN_SCHEMES.map(s => s.id));
```
Names are English-only labels (built-in ids stable). Write **all six full maps** (don't leave the comment shorthand — expand to literal objects).

- [ ] **Step 3 — reconcile** (mirror `use-operating-guides.reconcileBuiltins`): merge `BUILTIN_SCHEMES` into the loaded store (refresh code fields, keep user's `activeId`); enforce undeletable via `BUILTIN_SCHEME_IDS`; if `activeId` is null/absent → `DEFAULT_SCHEME_ID`. `resolveActiveScheme(store, theme)` → the active scheme's `dark`-or-`light` map (per theme + supportsDark), else Harbor's.

- [ ] **Step 4 — GREEN (incl. the AA assertion for all 6 maps — fix any sub-AA hex); commit:** `feat(schemes): built-in Harbor/Meridian/Umber (light+dark) + reconcile + Harbor default`

## Task 4 — apply plumbing: theme-correct re-apply + supportsDark signal

**Files:** `scheme-apply.ts`, `style-ci.ts`, `use-style.tsx`, `use-theme.tsx`, their tests.

- [ ] **Step 1 — failing tests:** (a) `effectiveDark(true, "custom", /*supportsDark*/ true)` → true; `false` when `supportsDark` false (pin light); (b) toggling theme while a dark-capable scheme is active re-applies the DARK resolved map (spy `applySchemeColors`).

- [ ] **Step 2 — supportsDark signal:** on style/scheme apply, set `document.documentElement.dataset.schemeDark = supportsDark ? "1" : "0"` (a boot-readable `data-scheme-dark` attr) alongside `data-style`. `effectiveDark(dark, style, schemeSupportsDark)` → `style==="AIPM" ? dark : (style==="custom" && schemeSupportsDark ? dark : false)`.

- [ ] **Step 3 — reactivity:** `use-style` resolves the active scheme for the CURRENT theme and applies on both style change AND a new `lop-theme-change` event; `use-theme`'s `apply()` reads `data-scheme-dark` for the pin-light decision and, after toggling `.dark`, dispatches `lop-theme-change` so `use-style` re-applies the correct sub-map. Keep the 3-site sync (helper/attr-read/boot) in lockstep. `writeActiveSchemeColors` stores the RESOLVED (theme-collapsed) map; it's rewritten on each theme/scheme change.

- [ ] **Step 4 — GREEN; commit:** `feat(schemes): theme-correct scheme re-apply + supportsDark pin-light`

## Task 5 — no-flash boot script (default → Harbor, pick light/dark)

**Files:** `layout.tsx`, `layout-boot-script.test.ts`.

- [ ] **Step 1 — update `NO_FLASH_THEME_SCRIPT`:** when `lop-style` is absent → treat as `custom` with the default scheme (the fresh-install seed, Task 6, writes `lop-style="custom"` + the Harbor resolved map + `data-scheme-dark`). Boot logic: read `lop-style`; compute `d` from `lop-theme`; force `d=false` only for `mockup` OR (`custom` AND `lop-scheme-supports-dark`!=="1"); set `data-style` + `data-scheme-dark`; if `custom`, read `lop-active-scheme-colors` (already theme-resolved by the app on last write) and `setProperty`. Persist a boot-readable `lop-scheme-supports-dark` key on apply (Task 4). ★ The active-colors mirror is theme-correct because the app rewrites it on theme flip — the boot script does NOT re-pick light/dark, it applies whatever was last mirrored (matches the `d` it computes since the app mirrors in lockstep). Document this invariant.

- [ ] **Step 2 — update the pinned test** (`layout-boot-script.test.ts`) in lockstep: replace the `'if(s==="mockup"||s==="custom"){d=false;}'` assertion with the new mockup-only + supportsDark form; add assertions for `data-scheme-dark` + `lop-scheme-supports-dark`.

- [ ] **Step 3 — first-run test:** a boot-simulation (jsdom) with empty localStorage applies Harbor's resolved map + `.dark=false` (or dark if system prefers + supportsDark). GREEN.

- [ ] **Step 4 — commit:** `feat(schemes): boot default→Harbor, dark-capable custom no-flash`

## Task 6 — Appearance UI: built-in selector + default + fresh-install seed

**Files:** `settings-sections/appearance-section.tsx`, `color-scheme-editor.tsx`, `use-color-schemes.ts`, `i18n.ts`/`i18n.de.ts`, tests.

- [ ] **Step 1 — fresh-install seed:** on first mount (no `lop-style` stored), set style `custom` + activeId `harbor` + apply. `readStoredStyle` default stays `"AIPM"` for an EXPLICITLY-invalid value, but the app-level initial state (no stored style at all) seeds Harbor. (Keep AIPM reachable via the switcher.)
- [ ] **Step 2 — scheme selector:** in Appearance, a selector listing built-ins (Harbor/Meridian/Umber) + AIPM + Mockup + user custom schemes. Selecting a built-in/user scheme → `setActive(id)` + style `custom` + apply (resolve for current theme). AIPM/Mockup set `data-style` as today. Merge `BUILTIN_SCHEMES` into the editor's `store.schemes` list (reconcile).
- [ ] **Step 3 — theme toggle enable:** `disabled` when the active scheme is light-only (mockup, or a custom scheme with `supportsDark:false`); enabled for AIPM + Harbor/Meridian/Umber. Read active supportsDark from the store/hook.
- [ ] **Step 4 — i18n:** built-in scheme display names (or use the code `name`), any new selector labels (EN+DE). Built-in names are proper nouns — keep identical EN/DE.
- [ ] **Step 5 — tsc/lint/size; Appearance axe (`npx playwright test e2e/a11y.spec.ts -g "Settings"`); commit:** `feat(schemes): Appearance scheme selector + Harbor default + dark toggle gating`

## Task 7 — axe gate: Harbor light + dark

**Files:** `e2e/a11y.spec.ts`.

- [ ] Add combos `{style:"custom", theme:"light", scheme:"harbor"}` and `{...dark}`. In `addInitScript`, for a `custom` combo seed `lop-style="custom"`, `lop-theme`, `lop-active-scheme-colors` = the resolved Harbor map for that theme (import `resolveSchemeColors(theme==="dark"?HARBOR_DARK:HARBOR_LIGHT)`), `lop-scheme-supports-dark="1"`, `data-scheme-dark` handled by boot. Run the Dashboard+Settings subset to confirm green, then the full matrix in CI.
- [ ] **Commit:** `test(a11y): scan the new default (Harbor) light + dark`

## Task 8 — Release prep (only on "release")

- [ ] `version.ts` bump (minor — new default look is user-visible) + milestone codename + `versionHighlightSchemes` in `APP_HIGHLIGHT_KEYS` + EN/DE strings (DE via node utf8). CHANGELOG entry (new default palette + Harbor/Meridian/Umber schemes, dark support). Full gates (tsc/lint/test/build/size/dup/axe). Commit + release chain.

---

## Security / constraints
- **Palette guards:** color still flows through `globals.css` tokens overridden by inline `setProperty` of VALUES — no new Tailwind classes, no raw shadow/gradient. Do not add `[data-style="custom"]` CSS blocks.
- **No-flash invariant:** the app must mirror the theme-resolved active map to `lop-active-scheme-colors` on every style/scheme/theme change; the boot script only replays it. Keep the 3 synced sites + pinned test in lockstep.
- **Built-ins undeletable + code-owned;** user schemes keep string ids disjoint from built-in ids.
- **AA:** every built-in map (light+dark) passes `checkSchemePairs`; Harbor also passes the e2e axe gate (light+dark).
- **Per-device this phase:** schemes stay out of workspace exports/Turso (DB loading is Phase 3). No golden-fixture change.
- **i18n:** EN/DE parity (tsc); DE via node utf8 write.

## Verification
`npx tsc --noEmit`; `npm run test:run`; `npm run build`; `npm run size:check`; `npm run dup:check`; `npx playwright test e2e/a11y.spec.ts --project=chromium` (incl. new Harbor combos). Manual: fresh profile → app opens in Harbor; switch Harbor↔Meridian↔Umber↔AIPM↔Mockup; toggle light/dark on each dark-capable scheme; reload → no flash, choice persists; export/import a custom scheme still works.
