# Scheme De-hardcode (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. FEATURE branch `feat/scheme-dehardcode-phase2` (already created off main). `npx tsc --noEmit` + `npm run test:run` after each task; each task its own commit. NOT a release until the user says "release".

**Goal:** Fold AIPM + Mockup into the scheme engine as read-only built-in schemes so the look is fully scheme-driven; `data-style` collapses to the constant `"custom"`; the scheme model gains a structural (non-color) token group.

**Architecture:** One runtime path (scheme store). `globals.css :root` keeps AIPM-light as a static no-JS/pre-boot fallback; the `.dark` token block + `[data-style="mockup"]` block are removed (their values move into the AIPM/Mockup scheme maps). `.dark` stays as a class toggle (Tailwind `dark:` utilities). Built-ins resolve through `resolveSchemeColors`, whose precedence flips to **base-wins** so AIPM/Mockup can pin exact hand-tuned `-strong`/`-text`/`muted-foreground` values.

**Tech stack:** Next.js (forked) · React · TypeScript · Tailwind v4 · Vitest · Playwright/axe.

**Design doc:** `docs/superpowers/specs/2026-07-12-scheme-dehardcode-phase2-design.md`

---

## Token reference (authoritative source values — copied from globals.css pre-change)

**AIPM light** (`:root`): `--background#ffffff --foreground#636362 --surface#ffffff --surface-muted#e3e6e6 --line#e3e6e6 --muted-foreground#636362 --AIPM-dark-blue#004159 --AIPM-green#84bd00 --AIPM-light-grey#e3e6e6 --AIPM-medium-grey#939598 --AIPM-blue#60c0dd --AIPM-pink#e5497c --AIPM-purple#aa4899 --AIPM-green-strong#4d7000 --AIPM-pink-strong#c41e5a --AIPM-purple-strong#7a2d72 --rag-red#ef4444 --rag-amber#f59e0b --rag-green#10b981 --rag-red-text#c41e5a --rag-amber-text#aa4899 --rag-green-text#4d7000 --table-head-bg#004159 --table-head-fg#ffffff --table-head-accent#84bd00 --segment-track-bg#ffffff --segment-active-bg#004159 --segment-active-fg#ffffff`
AIPM light **structural**: `--shadow-card none · --shadow-control none · --shadow-card-hover none · --gradient-kpi var(--AIPM-green) · --delta-chip-pad 0 · --rag-green-chip transparent · --rag-red-chip transparent`

**AIPM dark** (`:root.dark` overrides, else inherit light): `--background#0b0f12 --foreground#e3e6e6 --surface#121619 --surface-muted#1b2024 --line#2b3137 --muted-foreground#9ca3a9 --AIPM-green-strong#84bd00 --AIPM-pink-strong#e96089 --AIPM-purple-strong#d98cc8`; rag-*-text inherit dark -strong → `--rag-red-text#e96089 --rag-amber-text#aa4899 --rag-green-text#84bd00`. Structural = same as AIPM light (all `none`).

**Mockup** (`[data-style="mockup"]`, light-only): base = AIPM-light with `--rag-red#d64545 --rag-amber#f0a020 --rag-green#5aa700 --table-head-bg#f1f3f4 --table-head-fg#3f4448 --table-head-accent#3d7a00 --segment-track-bg#eef1f3 --segment-active-bg#ffffff --segment-active-fg#3d7a00`; pinned text `--rag-red-text#c0392b --rag-amber-text#a96a00 --rag-green-text#3d7a00`. Structural: `--shadow-card "0 1px 3px rgba(0, 65, 89, 0.12), 0 1px 2px rgba(0, 65, 89, 0.08)" · --shadow-control "0 1px 2px rgba(0, 65, 89, 0.10)" · --shadow-card-hover "0 4px 10px rgba(0, 65, 89, 0.14), 0 2px 4px rgba(0, 65, 89, 0.10)" · --gradient-kpi "linear-gradient(90deg, var(--rag-red), var(--rag-amber), var(--rag-green))" · --delta-chip-pad "0.125rem 0.375rem" · --rag-green-chip #e6f2d8 · --rag-red-chip #fae9e9`.

---

## Task 1 — Flip `resolveSchemeColors` to base-wins precedence

**Files:** Modify `src/app/scheme-tokens.ts:130-132`; Test `src/app/scheme-tokens.test.ts`.

Rationale: AIPM/Mockup must pin exact `-strong`/`-text`/`muted-foreground` values that `deriveAaVariants` would otherwise recompute. Base-wins = derivation FILLS missing tokens only. No-op for all existing schemes (they carry no base derived tokens — `cleanColors` strips them on save; built-ins currently omit them).

- [ ] **Step 1: Failing test.** Add to `scheme-tokens.test.ts`:
```ts
import { resolveSchemeColors } from "./scheme-tokens";
test("resolveSchemeColors: an explicit base derived token wins over derivation", () => {
  const out = resolveSchemeColors({ "--AIPM-green": "#84bd00", "--surface-muted": "#1b2024", "--AIPM-green-strong": "#84bd00" });
  expect(out["--AIPM-green-strong"]).toBe("#84bd00"); // pinned, NOT re-derived/darkened
});
test("resolveSchemeColors: missing derived tokens are still filled", () => {
  const out = resolveSchemeColors({ "--AIPM-green": "#84bd00", "--surface-muted": "#e3e6e6" });
  expect(out["--AIPM-green-strong"]).toBeDefined();
});
```
- [ ] **Step 2: Run — expect FAIL** (first test: derived currently wins). `npm run test:run -- scheme-tokens`
- [ ] **Step 3: Implement.** Change line 131:
```ts
export function resolveSchemeColors(colors: SchemeColorMap): SchemeColorMap {
  // base-wins: derivation FILLS the AA variants a scheme omits; an explicitly
  // pinned -strong/-text/muted-foreground (built-in AIPM/Mockup) is preserved.
  return { ...deriveAaVariants(colors), ...colors };
}
```
- [ ] **Step 4: Run — expect PASS.** Also run full `scheme-tokens` + `builtin-schemes` + `scheme-apply` suites (guard no regression). `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `refactor(schemes): base-wins precedence in resolveSchemeColors`.

## Task 2 — Structural token model: type, validator, apply, boot-key helpers

**Files:** Modify `src/app/scheme-apply.ts`; Test `src/app/scheme-apply.test.ts`.

- [ ] **Step 1: Failing tests.** Add:
```ts
import { isSafeRawCssValue, applySchemeStructural, readActiveSchemeStructural, writeActiveSchemeStructural } from "./scheme-apply";
test("isSafeRawCssValue accepts shadows/gradients/lengths/keywords", () => {
  for (const v of ["none", "transparent", "0", "0.125rem 0.375rem", "var(--AIPM-green)",
    "linear-gradient(90deg, var(--rag-red), var(--rag-amber), var(--rag-green))",
    "0 1px 3px rgba(0, 65, 89, 0.12), 0 1px 2px rgba(0, 65, 89, 0.08)", "#e6f2d8"])
    expect(isSafeRawCssValue(v)).toBe(true);
});
test("isSafeRawCssValue rejects injection vectors", () => {
  for (const v of ["url(evil)", "red; }", "a{b}", "expression(alert(1))", "x@import", "<script>"])
    expect(isSafeRawCssValue(v)).toBe(false);
});
test("readActiveSchemeStructural drops unsafe values", () => {
  localStorage.setItem("lop-active-scheme-structural", JSON.stringify({ "--shadow-card": "none", "--x": "url(bad)", "notatoken": "none" }));
  expect(readActiveSchemeStructural()).toEqual({ "--shadow-card": "none" });
});
```
- [ ] **Step 2: Run — expect FAIL** (exports missing).
- [ ] **Step 3: Implement** in `scheme-apply.ts`:
```ts
export type SchemeStructuralMap = Record<string, string>;
export const ACTIVE_SCHEME_STRUCTURAL_KEY = "lop-active-scheme-structural";

// Raw (non-hex) CSS VALUE guard for structural tokens (shadows/gradient/length/
// keyword). setProperty applies a property VALUE only — it cannot inject a rule/
// selector — so this is defense-in-depth + boot-key tamper hygiene. Allowlist
// charset then denylist dangerous substrings.
const RAW_VALUE_RE = /^[\w\s#.,%()/-]+$/;
const RAW_DENY = ["url(", "expression", "image-set", ";", "{", "}", "@", "<", ">", "\\"];
export function isSafeRawCssValue(v: string): boolean {
  if (typeof v !== "string" || v.length === 0 || v.length > 256) return false;
  if (!RAW_VALUE_RE.test(v)) return false;
  const low = v.toLowerCase();
  return !RAW_DENY.some((d) => low.includes(d));
}

let lastStructural: string[] = [];
/** Apply (or, with null, clear) the structural token overrides on <html>. */
export function applySchemeStructural(map: SchemeStructuralMap | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const token of lastStructural) root.style.removeProperty(token);
  lastStructural = [];
  if (!map) return;
  for (const [token, value] of Object.entries(map)) {
    if (BOOT_TOKEN_RE.test(token) && isSafeRawCssValue(value)) {
      root.style.setProperty(token, value);
      lastStructural.push(token);
    }
  }
}
export function writeActiveSchemeStructural(map: SchemeStructuralMap | null): void {
  try {
    if (map) localStorage.setItem(ACTIVE_SCHEME_STRUCTURAL_KEY, JSON.stringify(map));
    else localStorage.removeItem(ACTIVE_SCHEME_STRUCTURAL_KEY);
  } catch { /* private mode / quota */ }
}
export function readActiveSchemeStructural(): SchemeStructuralMap | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SCHEME_STRUCTURAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: SchemeStructuralMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>))
      if (typeof v === "string" && BOOT_TOKEN_RE.test(k) && isSafeRawCssValue(v)) out[k] = v;
    return out;
  } catch { return null; }
}
```
(`BOOT_TOKEN_RE` already exists in the file — reuse it; move its declaration above these if needed.)
- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(schemes): structural token model + raw-value validator`.

## Task 3 — Structural registry + AIPM/Mockup structural seeds

**Files:** Modify `src/app/scheme-tokens.ts`; Test `src/app/scheme-tokens.test.ts`.

- [ ] **Step 1: Failing test.**
```ts
import { STRUCTURAL_TOKENS, ICC_STRUCTURAL, MOCKUP_STRUCTURAL } from "./scheme-tokens";
test("structural seeds cover the 7 structural tokens", () => {
  const keys = STRUCTURAL_TOKENS.map((t) => t.token);
  expect(keys).toEqual(["--shadow-card","--shadow-control","--shadow-card-hover","--gradient-kpi","--delta-chip-pad","--rag-green-chip","--rag-red-chip"]);
  for (const k of keys) { expect(ICC_STRUCTURAL[k]).toBeDefined(); expect(MOCKUP_STRUCTURAL[k]).toBeDefined(); }
  expect(ICC_STRUCTURAL["--shadow-card"]).toBe("none");
  expect(MOCKUP_STRUCTURAL["--gradient-kpi"]).toContain("linear-gradient");
});
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** in `scheme-tokens.ts` (import `SchemeStructuralMap` from `./scheme-apply`):
```ts
export const STRUCTURAL_TOKENS: readonly TokenSpec[] = [
  { token: "--shadow-card", labelKey: "schemeTokenShadowCard" },
  { token: "--shadow-control", labelKey: "schemeTokenShadowControl" },
  { token: "--shadow-card-hover", labelKey: "schemeTokenShadowCardHover" },
  { token: "--gradient-kpi", labelKey: "schemeTokenGradientKpi" },
  { token: "--delta-chip-pad", labelKey: "schemeTokenDeltaChipPad" },
  { token: "--rag-green-chip", labelKey: "schemeTokenRagGreenChip" },
  { token: "--rag-red-chip", labelKey: "schemeTokenRagRedChip" },
] as const;

export const ICC_STRUCTURAL: SchemeStructuralMap = {
  "--shadow-card": "none", "--shadow-control": "none", "--shadow-card-hover": "none",
  "--gradient-kpi": "var(--AIPM-green)", "--delta-chip-pad": "0",
  "--rag-green-chip": "transparent", "--rag-red-chip": "transparent",
};
export const MOCKUP_STRUCTURAL: SchemeStructuralMap = {
  "--shadow-card": "0 1px 3px rgba(0, 65, 89, 0.12), 0 1px 2px rgba(0, 65, 89, 0.08)",
  "--shadow-control": "0 1px 2px rgba(0, 65, 89, 0.10)",
  "--shadow-card-hover": "0 4px 10px rgba(0, 65, 89, 0.14), 0 2px 4px rgba(0, 65, 89, 0.10)",
  "--gradient-kpi": "linear-gradient(90deg, var(--rag-red), var(--rag-amber), var(--rag-green))",
  "--delta-chip-pad": "0.125rem 0.375rem", "--rag-green-chip": "#e6f2d8", "--rag-red-chip": "#fae9e9",
};
```
- [ ] **Step 4:** Add the 7 new `schemeToken*` i18n keys to BOTH `i18n.ts` and `i18n.de.ts` (edit `i18n.de.ts` via node utf8 write, CRLF `\r\n` anchors, real umlauts). Labels are settings-editor labels (not user-facing this phase but tsc enforces parity). `npx tsc --noEmit` confirms parity.
- [ ] **Step 5: Run — expect PASS.** Commit `feat(schemes): structural token registry + AIPM/Mockup seeds`.

## Task 4 — `ColorScheme.structural` field

**Files:** Modify `src/app/color-schemes.ts`; Test `src/app/color-schemes.test.ts`.

- [ ] **Step 1: Failing test.** Assert a `ColorScheme` may carry `structural` and that `loadSchemes`/save round-trip of a USER scheme (no structural) is unchanged:
```ts
test("ColorScheme.structural is optional and user schemes round-trip without it", () => {
  const s = addScheme("Draft", { "--AIPM-green": "#84bd00" });
  expect(s.structural).toBeUndefined();
});
```
- [ ] **Step 2: Run — expect FAIL** only if the type/build breaks; otherwise this documents the invariant (may pass immediately — that's fine, keep it as a guard).
- [ ] **Step 3: Implement.** Add to the `ColorScheme` interface: `structural?: import("./scheme-apply").SchemeStructuralMap;`. Do NOT touch `cleanColors` (user schemes stay color-only; built-ins carry structural in code, never persisted through the editor).
- [ ] **Step 4:** `npx tsc --noEmit`; `npm run test:run -- color-schemes`. Commit `feat(schemes): optional structural field on ColorScheme`.

## Task 5 — AIPM + Mockup built-in schemes + `resolveActiveStructural`

**Files:** Modify `src/app/builtin-schemes.ts`; Test `src/app/builtin-schemes.test.ts`.

- [ ] **Step 1: Failing tests.**
```ts
import { BUILTIN_SCHEMES, BUILTIN_SCHEME_IDS, resolveActiveStructural, reconcileBuiltins } from "./builtin-schemes";
import { resolveActiveScheme } from "./builtin-schemes";
import { resolveSchemeColors } from "./scheme-tokens";
test("AIPM and Mockup are built-ins (5 total, undeletable)", () => {
  const ids = BUILTIN_SCHEMES.map((s) => s.id);
  expect(ids).toEqual(["AIPM","mockup","harbor","meridian","umber"]);
  expect(BUILTIN_SCHEME_IDS.has("AIPM")).toBe(true);
});
test("AIPM light resolves to the shipped AIPM palette (pinned -strong survive)", () => {
  const store = reconcileBuiltins({ schemes: [], activeId: "AIPM" });
  const c = resolveSchemeColors(resolveActiveScheme(store, false));
  expect(c["--AIPM-green"]).toBe("#84bd00");
  expect(c["--AIPM-green-strong"]).toBe("#4d7000");   // pinned, not re-derived
  expect(c["--rag-red-text"]).toBe("#c41e5a");
});
test("AIPM dark keeps dimmer muted-foreground + dark -strong", () => {
  const store = reconcileBuiltins({ schemes: [], activeId: "AIPM" });
  const c = resolveSchemeColors(resolveActiveScheme(store, true));
  expect(c["--surface"]).toBe("#121619");
  expect(c["--muted-foreground"]).toBe("#9ca3a9");
  expect(c["--AIPM-pink-strong"]).toBe("#e96089");
});
test("Mockup is light-only with structural shadows + gradient", () => {
  const m = BUILTIN_SCHEMES.find((s) => s.id === "mockup")!;
  expect(m.supportsDark).toBe(false);
  const store = reconcileBuiltins({ schemes: [], activeId: "mockup" });
  expect(resolveActiveStructural(store)["--shadow-card"]).toContain("rgba");
});
test("resolveActiveStructural for AIPM = all none", () => {
  const store = reconcileBuiltins({ schemes: [], activeId: "AIPM" });
  expect(resolveActiveStructural(store)["--shadow-card"]).toBe("none");
});
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** In `builtin-schemes.ts` add (import `ICC_SEED, MOCKUP_SEED, ICC_STRUCTURAL, MOCKUP_STRUCTURAL` from `./scheme-tokens`):
```ts
export const ICC_LIGHT: SchemeColorMap = {
  ...ICC_SEED,
  "--AIPM-green-strong": "#4d7000", "--AIPM-pink-strong": "#c41e5a", "--AIPM-purple-strong": "#7a2d72",
  "--rag-red-text": "#c41e5a", "--rag-amber-text": "#aa4899", "--rag-green-text": "#4d7000",
  "--muted-foreground": "#636362",
};
export const ICC_DARK: SchemeColorMap = {
  ...ICC_SEED,
  "--background": "#0b0f12", "--foreground": "#e3e6e6", "--surface": "#121619",
  "--surface-muted": "#1b2024", "--line": "#2b3137", "--muted-foreground": "#9ca3a9",
  "--AIPM-green-strong": "#84bd00", "--AIPM-pink-strong": "#e96089", "--AIPM-purple-strong": "#d98cc8",
  "--rag-red-text": "#e96089", "--rag-amber-text": "#aa4899", "--rag-green-text": "#84bd00",
};
export const MOCKUP_LIGHT: SchemeColorMap = {
  ...MOCKUP_SEED,
  "--rag-red-text": "#c0392b", "--rag-amber-text": "#a96a00", "--rag-green-text": "#3d7a00",
};
```
Prepend to `BUILTIN_SCHEMES` (order matters — AIPM first, the classic default look; Harbor stays fresh-install default via `DEFAULT_SCHEME_ID`):
```ts
{ id: "AIPM", name: "AIPM", builtIn: true, supportsDark: true, light: ICC_LIGHT, dark: ICC_DARK, structural: ICC_STRUCTURAL, branding: {} },
{ id: "mockup", name: "Dashboard", builtIn: true, supportsDark: false, light: MOCKUP_LIGHT, structural: MOCKUP_STRUCTURAL, branding: {} },
```
Extend `cloneBuiltin` to copy `structural`: `...(s.structural ? { structural: { ...s.structural } } : {})`. Add:
```ts
/** The active scheme's structural (non-color) token map, or {} if none. */
export function resolveActiveStructural(store: SchemeStore): SchemeStructuralMap {
  return activeSchemeOf(store).structural ?? {};
}
```
(import `SchemeStructuralMap` type.) `DEFAULT_SCHEME_ID` stays `"harbor"`.
- [ ] **Step 4: Run — expect PASS.** Run the full `builtin-schemes` suite incl. the existing WCAG-AA assertions (they now cover 5 schemes). If AIPM/Mockup trip an AA assertion, that's Task 12's tuning surface — note it but the *pinned* values reproduce today's shipping look, so AA should already hold.
- [ ] **Step 5: Commit** `feat(schemes): AIPM + Mockup as built-in schemes`.

## Task 6 — Simplify `effectiveDark` signature

**Files:** Modify `src/app/style-ci.ts`; Test `src/app/style-ci.test.ts`; update callers.

- [ ] **Step 1: Failing test.** Rewrite the `effectiveDark` tests for the 2-arg form:
```ts
import { effectiveDark } from "./style-ci";
test("effectiveDark: dark only when theme dark AND scheme dark-capable", () => {
  expect(effectiveDark(true, true)).toBe(true);
  expect(effectiveDark(true, false)).toBe(false); // mockup / light-only
  expect(effectiveDark(false, true)).toBe(false);
});
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Replace `effectiveDark`:
```ts
/** Whether dark mode is active: the resolved theme is dark AND the active
 *  scheme is dark-capable. (Light-only schemes — Mockup and light-only user
 *  schemes — pin light.) Keep in lockstep with use-theme.apply() + the boot
 *  string. */
export function effectiveDark(resolvedThemeDark: boolean, schemeSupportsDark: boolean): boolean {
  return resolvedThemeDark && schemeSupportsDark;
}
```
Grep `effectiveDark(` for callers; update each (drop the `style` arg). Keep `CiStyle`/`readStoredStyle` for the migration reader.
- [ ] **Step 4:** `npx tsc --noEmit`; `npm run test:run -- style-ci`. Commit `refactor(schemes): effectiveDark drops the style arg (scheme-capability only)`.

## Task 7 — use-style: apply structural + mirror + migration + constant data-style

**Files:** Modify `src/app/use-style.tsx`; Test `src/app/use-style.test.tsx`.

- [ ] **Step 1: Failing tests.** Add:
```ts
test("migrates a legacy lop-style='mockup' to activeId mockup + custom", () => {
  localStorage.setItem("lop-style", "mockup");
  render(<CiStyleProvider><Probe/></CiStyleProvider>);
  expect(document.documentElement.getAttribute("data-style")).toBe("custom");
  // active scheme id now 'mockup' (assert via the store hook / exposed value)
});
test("syncScheme applies + mirrors the active scheme's structural map", () => {
  // select Mockup → --shadow-card set inline + mirrored to lop-active-scheme-structural
});
```
(Shape the assertions to the provider's existing test harness.)
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
  - On provider init: one-time migration — if `lop-style` is `"AIPM"` or `"mockup"`, call the scheme store's `setActive(that id)` (reconciled) and write `lop-style="custom"`. `"custom"`/absent → unchanged.
  - Always `setAttribute("data-style","custom")` (drop the AIPM/mockup branches).
  - In `syncScheme`: after resolving+applying+mirroring COLORS, also `applySchemeStructural(resolveActiveStructural(store))` + `writeActiveSchemeStructural(...)`. Clear both (`applySchemeStructural(null)` + remove key) is implicit since every active scheme has a (possibly empty) structural map — for `{}` pass `{}` (clears prior, sets nothing).
- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit`. Commit `feat(schemes): scheme-driven structural + legacy style migration in use-style`.

## Task 8 — use-theme: drop the mockup special-case

**Files:** Modify `src/app/use-theme.tsx`; Test `src/app/use-theme.test.tsx`.

- [ ] **Step 1: Update test.** The existing "recomputes .dark on lop-style-change" test still holds; add one asserting a `data-style="custom"` + `data-scheme-dark="0"` pins light regardless of theme, and remove any reliance on `data-style="mockup"`.
- [ ] **Step 2: Run — expect FAIL** if you tighten an assertion.
- [ ] **Step 3: Implement.** In `apply()` (line ~34-40) replace the pin-light computation with scheme-capability only:
```ts
const schemeDark = document.documentElement.getAttribute("data-scheme-dark") === "1";
const dark = schemeDark && resolveTheme(theme, prefersDark()) === "dark";
```
(Delete the `attr === "mockup"` read; `data-style` is always `"custom"` now. Mockup pins light via its `data-scheme-dark="0"`.)
- [ ] **Step 4: Run — expect PASS.** Commit `refactor(theme): pin-light from scheme-capability, drop mockup style branch`.

## Task 9 — boot-theme-script: always custom + structural + migration read + validators

**Files:** Modify `src/app/boot-theme-script.ts`; Test `src/app/layout-boot-script.test.ts`.

- [ ] **Step 1: Update the pinned test.** `layout-boot-script.test.ts` runtime-evals the IIFE. Update expectations: fresh→Harbor unchanged; `lop-style="AIPM"`/`"mockup"` (legacy) → boot sets `data-style="custom"` and (for the migration) still paints correctly by reading `lop-active-scheme-colors`/`-structural` if present, else Harbor fallback; a structural map with an unsafe value is skipped. Add an assertion that `data-style` is ALWAYS `"custom"`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Rewrite `NO_FLASH_THEME_SCRIPT`:
  - Always `data-style="custom"` (remove the `s=fresh?"custom":st` style echo; keep reading `lop-scheme-supports-dark`).
  - Keep the fresh→Harbor color fallback.
  - After the color `setProperty` loop, add a structural loop reading `lop-active-scheme-structural`, guarded by the SAME token regex + a mirrored raw-value check (inline: `/^[\w\s#.,%()/-]+$/.test(v) && !/url\(|expression|[;{}@<>\\]/.test(v)`).
  - Embed `AIPM`/`MOCKUP` need NOT be embedded — legacy `AIPM`/`mockup` users have `lop-active-scheme-colors` written by the first post-migration runtime apply; on the FIRST boot after upgrade the key may be absent, so also embed the resolved AIPM light/dark + structural maps as the migration fallback when `lop-style` is legacy `AIPM`/`mockup` and the boot key is missing. (Import `ICC_LIGHT, ICC_DARK, MOCKUP_LIGHT` + `ICC_STRUCTURAL, MOCKUP_STRUCTURAL`; `JSON.stringify(resolveSchemeColors(...))`.)
- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit`. Commit `feat(schemes): boot script paints scheme colors+structural, always custom`.

## Task 10 — globals.css: remove hardcoded blocks, keep fallback + `.dark` class

**Files:** Modify `src/app/globals.css`; verify via `npm run build` + axe.

- [ ] **Step 1:** Keep `:root` (lines ~5-103) AS-IS — it is the AIPM-light + structural static fallback (do NOT delete; it carries `--AIPM-white` and the Tailwind `--color-*` bridge). Ensure the 7 structural tokens + `--delta-chip-pad: 0` are present in `:root` (add any missing so the fallback is complete).
- [ ] **Step 2:** DELETE the `.dark { … }` TOKEN block (lines ~106-125) — its token values now live in `ICC_DARK`. Do NOT delete the `.dark` class usage elsewhere; Tailwind generates `.dark` variants independently. (If any non-token rule lives in that block, keep it.)
- [ ] **Step 3:** DELETE the entire `:root[data-style="mockup"] { … }` block (lines ~127-153).
- [ ] **Step 4:** `npm run build` (Tailwind compiles globals). Then `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` as a smoke check (full axe is Task 13).
- [ ] **Step 5: Commit** `refactor(css): drop hardcoded AIPM-dark + mockup blocks (now scheme-driven)`.

## Task 11 — AppearanceSection + editor: AIPM/Mockup as read-only scheme options

**Files:** Modify `src/app/settings-sections/appearance-section.tsx`, `src/app/color-scheme-editor.tsx`; Tests `appearance-section.test.tsx`, `color-scheme-editor.test.tsx`.

- [ ] **Step 1: Read** the current unified `<select>` — it already lists built-ins + AIPM + Mockup + user schemes. Determine whether AIPM/Mockup are still wired as `data-style` options (legacy) vs scheme ids.
- [ ] **Step 2: Failing test.** Assert selecting the AIPM option activates scheme id `"AIPM"` (not `setStyle("AIPM")`), and the editor shows AIPM/Mockup as read-only (Rename/Delete/Apply disabled, like Harbor).
- [ ] **Step 3: Implement.** Remove any residual AIPM/Mockup `setStyle` path; both route through `selectScheme(id)`. Built-in read-only already keys off `BUILTIN_SCHEME_IDS` (now includes AIPM/mockup) — verify no separate handling remains. Update the `pinsLight` derivation to `!activeSupportsDark` (AIPM dark-capable; Mockup not).
- [ ] **Step 4:** `npx tsc --noEmit`; component tests green. Commit `feat(settings): AIPM + Mockup are read-only scheme options`.

## Task 12 — palette-guard allowlist for structural strings

**Files:** the palette-guard test(s) (`shell-palette-guard` / `palette-chrome-sweep` — locate via grep); possibly `scheme-tokens.ts`/`builtin-schemes.ts`.

- [ ] **Step 1:** Run `npm run test:run -- palette` (or the guard test names). If `builtin-schemes.ts`/`scheme-tokens.ts` now trip RAW_SHADOW/gradient bans (they contain `box-shadow`-shaped strings + `linear-gradient`), the test FAILS.
- [ ] **Step 2:** Add those two files to the guard's allowlist/skip set (the guard already allowlists `globals.css` for legal token declarations — extend the same list). Keep the allowlist minimal (only these two data files).
- [ ] **Step 3:** Guard green. Commit `test(palette): allowlist scheme data files for structural token strings`.

## Task 13 — e2e axe: re-seed the 5 combos as scheme selections

**Files:** Modify `e2e/a11y.spec.ts`.

- [ ] **Step 1:** Update `COMBOS` + `seedScript(combo)`: every combo now seeds `lop-style="custom"`, `lop-theme`, `lop-scheme-supports-dark`, and the resolved active scheme colors + structural (`lop-active-scheme-colors` + `lop-active-scheme-structural`) for the chosen scheme. Combos: `{scheme:"AIPM",dark:false}`, `{scheme:"AIPM",dark:true}`, `{scheme:"mockup",dark:false}`, `{scheme:"harbor",dark:false}`, `{scheme:"harbor",dark:true}`. Import the resolved maps from the app modules (or inline the resolved JSON via a small helper mirroring the Phase-1 seed).
- [ ] **Step 2:** `npx playwright test e2e/a11y.spec.ts --project=chromium` — all 5 combos × 13 views green.
- [ ] **Step 3: Commit** `test(a11y): re-seed axe combos as scheme selections`.

## Task 14 — AA verification + tune AIPM-dark / Mockup

**Files:** `builtin-schemes.ts` (only if axe flags a failure).

- [ ] **Step 1:** From Task 13's axe run, collect any AA failures for AIPM-dark or Mockup. Because AIPM/Mockup pin today's shipping values, expect ZERO new failures — but the derivation base-fill could touch a token the old CSS didn't (e.g. a `-text` variant that globals left as a `var()`).
- [ ] **Step 2:** For any failure, adjust the offending pinned hex in `ICC_DARK`/`MOCKUP_LIGHT` (mirror the Phase-1 tuning method: brighten on dark surfaces, darken on light; re-run axe). Update the `builtin-schemes.test.ts` golden if a pinned value changes.
- [ ] **Step 3:** Full `npx playwright test e2e/a11y.spec.ts` green. Commit `fix(schemes): AA-tune AIPM/Mockup where the scheme path diverged` (skip if no change needed).

## Task 15 — Docs: AGENTS.md + memory

**Files:** `AGENTS.md`, memory `scheme-driven-palettes-reynolds.md` (or a new Phase-2 memory).

- [ ] **Step 1:** Update the AGENTS.md "Scheme-driven color schemes" bullet: AIPM + Mockup are now built-in schemes (5 total); `data-style` is the constant `"custom"`; the scheme model carries a structural (non-color) token group (raw-value validated); `globals.css :root` is the no-JS AIPM fallback; `resolveSchemeColors` is base-wins. Note the boot keys `lop-active-scheme-structural` (mirrors the colors key — NOT `lop-app:`-prefixed, not swept by clearAppConfig).
- [ ] **Step 2:** Update the memory file with the Phase-2 landmines (base-wins precedence; structural validator; AIPM-dark pinned muted-foreground; palette-guard allowlist; boot always-custom; migration).
- [ ] **Step 3: Commit** `docs: AGENTS.md + memory for Phase 2 scheme de-hardcode`.

---

## Final verification (whole tree)
- `npx tsc --noEmit` · `npm run test:run` · `npm run build` · `npm run size:check` · `npm run dup:check`
- `npx playwright test e2e/a11y.spec.ts --project=chromium` (5 combos green)
- Manual/eye: AIPM light+dark and Mockup look BYTE-IDENTICAL to pre-change; switching AIPM↔Mockup↔Harbor↔user schemes in Settings → Appearance works; reload persists; a legacy `lop-style="mockup"` device upgrades cleanly to the Mockup scheme with no flash.
- Dispatch a final code-reviewer over the whole branch.

## Self-review notes
- **Spec coverage:** every design section maps to a task (model→T2/T3/T4, AIPM/Mockup schemes→T5, globals→T10, pin-light→T6/T8, boot→T9, migration→T7/T9, palette-guard→T12, axe→T13/T14, docs→T15). The base-wins precedence (a design refinement found during planning) is T1.
- **Type consistency:** `SchemeStructuralMap` defined in T2 (scheme-apply.ts), consumed by T3/T4/T5/T7. `effectiveDark(themeDark, schemeSupportsDark)` fixed in T6, matched by T8's apply() + T9 boot.
- **No placeholders:** all token hexes are the authoritative pre-change values (reference block at top); core code is complete; CSS/e2e/config tasks cite exact blocks/line ranges.
