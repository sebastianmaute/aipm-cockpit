# Scheme De-hardcode (Phase 2) — Design

**Goal:** Make AIPM and Mockup first-class **built-in color schemes** so the app look is fully scheme-driven, with NO hardcoded `data-style` CSS blocks as the source of truth. Extend the scheme model to carry the structural (non-color) tokens Mockup needs.

**Context:** Phase 1 (v0.182.0 "Reynolds") built the scheme engine — light+dark maps, built-in dark-capable schemes (Harbor/Meridian/Umber), no-flash boot, unified Settings → Appearance picker, WCAG-AA derivation. AIPM and Mockup were left as `globals.css` `data-style` blocks. Phase 2 finishes the original ask ("move AIPM tokens to a color scheme … remove that it is hardcoded into the app") by folding AIPM + Mockup into the same scheme mechanism.

**Decisions (confirmed with user):**
- **Scope:** AIPM **and** Mockup both become built-in schemes; the `data-style` axis collapses to the single constant `"custom"` (everything is scheme-driven).
- **Structural tokens:** ride the scheme via a new raw-string token group, allowlist-validated (not just hex).
- **`data-style` attribute:** kept as a written constant `"custom"` (not removed) to bound churn in boot/use-theme/e2e; `activeId` carries "which built-in".

---

## Architecture

### One runtime path
Today: `data-style ∈ {AIPM, mockup, custom}` selects a `globals.css` CSS block (AIPM `:root`, AIPM-dark `:root.dark`, Mockup `:root[data-style="mockup"]`) OR the inline scheme overrides (`custom`). After Phase 2 there is exactly ONE path — the **scheme store**. `data-style` is pinned to `"custom"`; AIPM/Mockup are scheme ids in the store (like Harbor).

### `globals.css` after Phase 2
- `:root` **KEEPS** the AIPM-light values (colors + the 7 structural tokens) as the **static no-JS / pre-boot fallback baseline** — the one unavoidable "hardcoded" spot (needed for the split-second before the boot IIFE runs and for JS-disabled clients). It is now a *fallback*, not the source of truth; the AIPM scheme re-writes identical values inline when AIPM is active (a no-op visually).
- **REMOVE** the `:root.dark` **token-override** block. AIPM-dark now rides the AIPM scheme's dark map (applied inline). `.dark` **remains a class toggle** — hundreds of Tailwind `dark:` utilities depend on it; only the CSS-variable redefinitions inside the `.dark` block move into the scheme.
- **REMOVE** the `:root[data-style="mockup"]` block entirely (Mockup is now a scheme).

### Pin-light rule
`effectiveDark` simplifies to `dark = themeDark && activeScheme.supportsDark`. Mockup (`supportsDark:false`) pins light exactly as before; the `style === "mockup"` special-case disappears. Must stay in lockstep across the THREE sites (per Phase-1 landmine): `style-ci.effectiveDark`, `use-theme`'s `apply()`, and the boot string.

---

## File structure

| File | Responsibility / change |
|------|--------------------------|
| `src/app/globals.css` | Keep `:root` AIPM-light fallback (colors + structural); DELETE `.dark` token block + `[data-style="mockup"]` block; keep `.dark` class. |
| `src/app/scheme-apply.ts` | Add `SchemeStructuralMap` type + `isSafeRawCssValue` allowlist validator; `applySchemeColors` also applies a structural map; add `read/writeActiveSchemeStructural` boot-key helpers; hex path unchanged for colors. |
| `src/app/scheme-tokens.ts` | Add `STRUCTURAL_TOKENS` registry + `ICC_STRUCTURAL` / `MOCKUP_STRUCTURAL` seed maps; `resolveSchemeColors` unchanged (colors only — structural is not AA-derived). |
| `src/app/builtin-schemes.ts` | Add `AIPM` + `MOCKUP` `ColorScheme`s (with `structural`); `BUILTIN_SCHEMES` now 5; `resolveActiveScheme` unchanged; add `resolveActiveStructural(store)`. |
| `src/app/color-schemes.ts` | `ColorScheme` gains optional `structural?: SchemeStructuralMap`; `cleanColors`/persistence unchanged for user schemes (they carry no structural this phase). |
| `src/app/style-ci.ts` | `effectiveDark(themeDark, schemeSupportsDark)` (drop `style` param); `CiStyle` narrows toward `"custom"`; keep back-compat readers for migration. |
| `src/app/boot-theme-script.ts` | Always `data-style="custom"`; apply active scheme colors AND structural inline (mirror both validators); fresh → Harbor (unchanged). |
| `src/app/use-style.tsx` | `syncScheme` also resolves + applies + mirrors the structural map; one-time migration of `lop-style` `AIPM`/`mockup` → activeId; always write `data-style="custom"`. |
| `src/app/use-theme.tsx` | `apply()` pin-light from `data-scheme-dark` only (mockup special-case gone). |
| `src/app/settings-sections/appearance-section.tsx` | AIPM/Mockup are scheme options (already in the unified `<select>`); remove any residual AIPM/Mockup style-toggle; both read-only in editor (built-in). |
| `src/app/color-scheme-editor.tsx` | AIPM/Mockup read-only (built-in) — no new UI. |
| `e2e/a11y.spec.ts` | Re-seed the 5 axe combos as scheme selections (AIPM/mockup/harbor × theme) instead of `data-style`. |
| palette-guard test(s) | Allowlist `builtin-schemes.ts` for the raw `shadow`/`gradient` strings it now contains. |
| `AGENTS.md` + memory | Update the "Scheme-driven color schemes" bullet (AIPM/Mockup now schemes; data-style constant; structural token group). |

---

## Structural tokens

`STRUCTURAL_TOKENS` (7): `--shadow-card`, `--shadow-control`, `--shadow-card-hover`, `--gradient-kpi`, `--delta-chip-pad`, `--rag-green-chip`, `--rag-red-chip`.

- **AIPM structural:** `--shadow-*: none`, `--gradient-kpi: var(--AIPM-green)`, `--delta-chip-pad: 0`, `--rag-green-chip/-red-chip: transparent`.
- **Mockup structural:** the box-shadow strings, the red→amber→green `linear-gradient`, the chip padding, the opaque chip hexes (current `[data-style="mockup"]` values).

`isSafeRawCssValue(v)`: allow `^[\w\s#.,%()/-]+$` (covers hex, rgba(), linear-gradient(), var(--x), lengths, `none`, `transparent`), then REJECT if it contains any of `url(`, `expression`, `;`, `{`, `}`, `@`, `<`, `>`, `\`. Boot string mirrors this. `setProperty` applies a property VALUE only — it cannot break out into a selector/rule — so this is defense-in-depth / boot-key tamper hygiene, not a live injection sink.

---

## Migration

One-time, in the scheme load/reconcile path (`use-style` init or `loadSchemes`):
- `lop-style === "AIPM"` → `activeId = "AIPM"`
- `lop-style === "mockup"` → `activeId = "mockup"`
- then set `lop-style = "custom"`
- `custom` users keep their existing `activeId`.

Idempotent (re-running with `lop-style="custom"` is a no-op). `reconcileBuiltins` remains the sole `activeId` validator.

---

## Risk areas

1. **AIPM-dark AA re-verify.** AIPM-dark currently uses hand-tuned `-strong` values + a sparse override + Tailwind `dark:` utilities. As a scheme it runs through `deriveAaVariants` (recompute `-strong` vs `--surface-muted`) → values may differ. The axe gate (AIPM light+dark in `A11Y_VIEWS`) catches regressions; tune the AIPM dark map like Phase 1 tuned Harbor. Brand hues (`--AIPM-green` etc.) are theme-invariant so the AIPM-dark map can be sparse (surface/surface-muted/foreground + let derivation handle `-strong`), relying on the `:root` fallback for the rest — but VERIFY the derived `-strong` passes before shipping.
2. **palette-guard.** `shell-palette-guard` + `palette-chrome-sweep` scan source for raw `shadow`/`gradient-`. The structural strings now live in `builtin-schemes.ts`/`scheme-tokens.ts` — allowlist those files or strip-then-ban trips. (Note: AGENTS.md/comments are Tailwind-scanned too — keep the token examples oblique.)
3. **Boot-string pin.** `layout-boot-script.test.ts` runtime-evals + pins the exact IIFE — update in lockstep (structural application + always-custom + migration read).
4. **e2e axe seed.** Same 5 visual combos, re-expressed as scheme selections; update `seedScript`.
5. **No-JS fallback.** Keeping `:root` = AIPM-light means a JS-off client shows AIPM (not Harbor). Acceptable + documented (Harbor-default needs JS; the pre-paint boot writes it before first paint for JS-on clients).

---

## Testing strategy

- **Unit:** structural validator (accept safe / reject `url(`, `;`, `{`); AIPM & Mockup scheme resolve to expected maps; migration maps `AIPM`/`mockup`→activeId + sets `custom`; `effectiveDark` new signature; `resolveActiveStructural`.
- **Boot:** `layout-boot-script.test.ts` runtime-eval covers fresh→Harbor, `custom`+colors+structural, migration path, injection-guard (bad structural value skipped).
- **Component:** AppearanceSection selecting AIPM/Mockup applies the scheme + structural; editor read-only for both.
- **e2e/axe:** 5 combos green (AIPM-light, AIPM-dark, mockup-light, harbor-light, harbor-dark).
- **Gates:** `npx tsc --noEmit`, `npm run test:run`, `npm run build`, `npm run size:check`, `npm run dup:check`, `npx playwright test e2e/a11y.spec.ts`.

---

## Out of scope
- User custom schemes carrying structural tokens (this phase: built-ins only; user schemes stay color-only, light-only).
- DB-loaded schemes (Phase 3) · logo/favicon in scheme apply beyond existing branding (Phase 4).
- Removing the `data-style` attribute entirely (kept as the `"custom"` constant).
