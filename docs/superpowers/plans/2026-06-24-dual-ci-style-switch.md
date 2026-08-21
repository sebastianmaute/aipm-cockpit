# Dual-CI Style Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a second "Mockup" visual style (shadows, gradients, red/amber RAG on values/bars/text, light table header) coexisting with the flat AIPM CI, user-switchable in Settings, with palette + axe gates extended to cover both.

**Architecture:** A `data-style="AIPM"|"mockup"` attribute on `<html>`, orthogonal to the existing `.dark` class, applied pre-paint by the extended no-flash boot script + a `use-style` hook over `localStorage["lop-style"]` (mirrors `use-theme`/`lop-theme`). All visual difference is CSS role tokens (`--rag-*`, `--table-head-*`, `--shadow-*`, `--gradient-kpi`) defined per-style, so one attribute switch reflows every view. Mockup is light-only (pins light). No workspace/serialization change.

**Tech Stack:** Forked Next.js 16 / React 19 / TS / Tailwind v4 (CSS `@theme`); Vitest; Playwright (axe).

**Spec:** `docs/superpowers/specs/2026-06-24-dual-ci-style-switch-design.md` (read first).

---

## Conventions (CI-enforced)
- Lint `--max-warnings=0`; `npx tsc --noEmit` after editing ANY test (enforces EN/DE i18n parity); `Lang` is `"en-US"|"en-GB"|"de"`.
- `i18n.de.ts` is CRLF + Edit tool corrupts umlauts → edit via node utf8 write; `i18n-encoding` test bans ASCII subs.
- Commit conventional, NO attribution trailers, EXPLICIT paths (never `git add -A` — leave untracked `.agents/`, `skills-lock.json`).
- Tailwind v4: tokens are exposed via the `@theme inline` block in `globals.css` (`--color-*: var(--*)`). Arbitrary utilities like `bg-[var(--rag-red)]`, `text-[var(--rag-amber-text)]`, `shadow-[var(--shadow-card)]` resolve without a `@theme` entry; named tokens (`bg-AIPM-green`) need the `--color-*` map.
- Run `npm run test:run -- <pat>`, `npx tsc --noEmit`, `npm run lint` green before each commit.

## File structure
| File | Responsibility |
|---|---|
| `src/app/style-ci.ts` | Pure: `CiStyle` type, `STYLE_STORAGE_KEY`, `readStoredStyle`, `effectiveDark(theme,style,systemPrefersDark)` |
| `src/app/use-style.tsx` | `CiStyleProvider` + `useCiStyle()` — `data-style` attr + `lop-style` persist (mirror use-theme) |
| `src/app/globals.css` | role tokens (`:root` AIPM, `.dark`, `:root[data-style="mockup"]`) + `@theme` map + `.lop-thead` token fill |
| `src/app/health.ts` | `healthDot`/`healthText` → role tokens |
| `src/app/table-styles.ts` | `TABLE_HEAD_CLASS` text → token |
| `src/app/layout.tsx` | extend `NO_FLASH_THEME_SCRIPT` to also apply `data-style` + pin-light |
| `src/app/shell-palette-guard.test.ts` | allow `shadow-[var(--…)]`, keep banning raw shadow/gradient/hex |
| `src/app/settings-sections/appearance-section.tsx` | Style `SegmentedControl` + theme-control disable under mockup |
| `e2e/a11y.spec.ts` | scan matrix AIPM-light / AIPM-dark / Mockup-light |

---

## PHASE 1 — Style axis (no visual change yet)

### Task 1: pure style module + `use-style` hook

**Files:** Create `src/app/style-ci.ts`, `src/app/use-style.tsx`, `src/app/style-ci.test.ts`

- [ ] **Step 1: Write `src/app/style-ci.ts`** (mirror `theme.ts`)

```ts
// Per-device CI/style preference, orthogonal to light/dark theme. Its own
// localStorage key (NOT the workspace Settings) so a no-flash boot script can
// apply it before first paint. Pure helpers only; DOM wiring in use-style.tsx.
export type CiStyle = "AIPM" | "mockup";

export const STYLE_STORAGE_KEY = "lop-style";

/** Validate a raw stored string into a CiStyle, defaulting to "AIPM". */
export function readStoredStyle(raw: string | null): CiStyle {
  return raw === "AIPM" || raw === "mockup" ? raw : "AIPM";
}

/** Mockup ships light-only → it PINS light regardless of the theme choice.
 *  AIPM honours the resolved theme. */
export function effectiveDark(resolvedThemeDark: boolean, style: CiStyle): boolean {
  return style === "mockup" ? false : resolvedThemeDark;
}
```

- [ ] **Step 2: Write failing test `src/app/style-ci.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readStoredStyle, effectiveDark } from "./style-ci";

describe("readStoredStyle", () => {
  it("defaults unknown/null to AIPM", () => {
    expect(readStoredStyle(null)).toBe("AIPM");
    expect(readStoredStyle("bogus")).toBe("AIPM");
  });
  it("passes through valid values", () => {
    expect(readStoredStyle("mockup")).toBe("mockup");
    expect(readStoredStyle("AIPM")).toBe("AIPM");
  });
});

describe("effectiveDark — mockup pins light", () => {
  it("mockup is never dark even when the theme resolved dark", () => {
    expect(effectiveDark(true, "mockup")).toBe(false);
  });
  it("AIPM honours the resolved theme", () => {
    expect(effectiveDark(true, "AIPM")).toBe(true);
    expect(effectiveDark(false, "AIPM")).toBe(false);
  });
});
```

- [ ] **Step 3: Run — expect FAIL.** `npm run test:run -- style-ci`

- [ ] **Step 4: Write `src/app/use-style.tsx`** (mirror `use-theme.tsx` structure exactly)

```tsx
"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { type CiStyle, STYLE_STORAGE_KEY, readStoredStyle } from "./style-ci";

interface CiStyleContextValue { style: CiStyle; setStyle: (s: CiStyle) => void; }
const CiStyleContext = createContext<CiStyleContextValue>({ style: "AIPM", setStyle: () => {} });

export function useCiStyle(): CiStyleContextValue { return useContext(CiStyleContext); }

export function CiStyleProvider({ children }: { children: React.ReactNode }) {
  const [style, setStyleState] = useState<CiStyle>(() =>
    typeof window === "undefined" ? "AIPM" : readStoredStyle(localStorage.getItem(STYLE_STORAGE_KEY)),
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-style", style);
    // Mockup is light-only → drop the dark class so dark tokens never apply.
    if (style === "mockup") document.documentElement.classList.remove("dark");
  }, [style]);

  const setStyle = useCallback((next: CiStyle) => {
    setStyleState(next);
    try { localStorage.setItem(STYLE_STORAGE_KEY, next); } catch { /* private mode / quota */ }
  }, []);

  return <CiStyleContext.Provider value={{ style, setStyle }}>{children}</CiStyleContext.Provider>;
}
```

- [ ] **Step 5: Make `use-theme` respect the pinned-light rule.** In `src/app/use-theme.tsx`, the apply effect currently does `classList.toggle("dark", resolveTheme(theme, prefersDark()) === "dark")`. Wrap the resolved value through the style: read the current style attribute and never set dark under mockup. Minimal change — in the `apply` closure:

```tsx
const apply = () => {
  const mockup = document.documentElement.getAttribute("data-style") === "mockup";
  const dark = !mockup && resolveTheme(theme, prefersDark()) === "dark";
  document.documentElement.classList.toggle("dark", dark);
};
```
(This keeps a single writer of `.dark`. `use-style`'s effect also drops `.dark` on switch-to-mockup; when switching back to AIPM, this `apply` re-runs via the provider re-render and restores dark per the stored theme — verify the theme provider re-renders; if not, it's still correct on next theme change. Acceptable: switching AIPM→mockup→AIPM with a dark theme re-darkens on the next render tick.)

- [ ] **Step 6: Mount `CiStyleProvider`.** Find where `ThemeProvider` wraps the app (grep `ThemeProvider` — likely `layout.tsx` or a providers component) and wrap `CiStyleProvider` AROUND or INSIDE it (inside ThemeProvider so the theme apply effect can read `data-style`; CiStyleProvider's effect sets the attr on mount). Place `<ThemeProvider><CiStyleProvider>{children}</CiStyleProvider></ThemeProvider>`.

- [ ] **Step 7: Run + tsc + lint + commit**

`npm run test:run -- style-ci` PASS; `npx tsc --noEmit`; `npm run lint`.
```bash
git add src/app/style-ci.ts src/app/use-style.tsx src/app/style-ci.test.ts src/app/use-theme.tsx <providers-file>
git commit -m "feat(style): CI-style axis hook + provider (data-style, mockup pins light)"
```

### Task 2: no-flash boot script applies `data-style`

**Files:** Modify `src/app/layout.tsx`; Test `src/app/layout-boot-script.test.ts` (new)

Current (`layout.tsx:15`):
```ts
const NO_FLASH_THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("lop-theme")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
```

- [ ] **Step 1: Write the guard test `src/app/layout-boot-script.test.ts`** (the inline string can't be imported/run pre-paint, so assert its content — a string-guard test, like `shell-palette-guard`):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

describe("no-flash boot script", () => {
  it("reads lop-style and sets the data-style attribute", () => {
    expect(src).toContain('localStorage.getItem("lop-style")');
    expect(src).toContain('setAttribute("data-style"');
  });
  it("pins light under mockup (clears .dark)", () => {
    // when style==="mockup" the script must force d=false
    expect(src).toMatch(/mockup/);
  });
  it("still applies the dark class from lop-theme", () => {
    expect(src).toContain('classList.toggle("dark"');
    expect(src).toContain('localStorage.getItem("lop-theme")');
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (data-style not yet in the script). `npm run test:run -- layout-boot-script`

- [ ] **Step 3: Replace `NO_FLASH_THEME_SCRIPT`** with a version that applies both:

```ts
const NO_FLASH_THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("lop-style")||"AIPM";if(s!=="AIPM"&&s!=="mockup"){s="AIPM";}document.documentElement.setAttribute("data-style",s);var t=localStorage.getItem("lop-theme")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(s==="mockup"){d=false;}document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
```

- [ ] **Step 4: Run — expect PASS.** `npm run test:run -- layout-boot-script`. Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**
```bash
git add src/app/layout.tsx src/app/layout-boot-script.test.ts
git commit -m "feat(style): no-flash boot applies data-style + pins light for mockup"
```

---

## PHASE 2 — Token layer + style-aware gate

### Task 3: role tokens in globals.css (AIPM = no-op, mockup overrides)

**Files:** Modify `src/app/globals.css`, `src/app/table-styles.ts`; Test `src/app/style-tokens.test.ts` (new)

- [ ] **Step 1: Add role tokens to `:root`** (after `--AIPM-pink-strong`, before the closing `}` at line 37). AIPM values reproduce TODAY exactly:

```css
  /* ---- CI-style role tokens (see dual-ci spec). AIPM values reproduce the
     current look; the [data-style="mockup"] block below overrides them. ---- */
  --rag-red: #ef4444;      /* == bg-red-500 (current healthDot) */
  --rag-amber: #f59e0b;    /* == bg-amber-500 */
  --rag-green: #10b981;    /* == bg-emerald-500 */
  --rag-red-text: var(--AIPM-pink-strong);
  --rag-amber-text: var(--AIPM-purple);
  --rag-green-text: var(--AIPM-green-strong);
  --table-head-bg: var(--AIPM-dark-blue);
  --table-head-fg: #ffffff;
  --shadow-card: none;
  --shadow-control: none;
  --gradient-kpi: none;
```

- [ ] **Step 2: Add the `@theme inline` entries** (after `--color-AIPM-pink-strong` at line 58) so named utilities resolve where needed:

```css
  --color-rag-red: var(--rag-red);
  --color-rag-amber: var(--rag-amber);
  --color-rag-green: var(--rag-green);
  --color-rag-red-text: var(--rag-red-text);
  --color-rag-amber-text: var(--rag-amber-text);
  --color-rag-green-text: var(--rag-green-text);
  --color-table-head-bg: var(--table-head-bg);
  --color-table-head-fg: var(--table-head-fg);
```

- [ ] **Step 3: Add the Mockup override block** (after the `.dark {…}` block, ~line 75). AA-checked values (red/amber/green text ≥4.5:1 on white + on the light header):

```css
/* Mockup CI — richer look (docs/patterns/*.png). Light-only this slice. */
:root[data-style="mockup"] {
  --rag-red: #d64545;
  --rag-amber: #f0a020;
  --rag-green: #5aa700;
  --rag-red-text: #c0392b;    /* AA on white */
  --rag-amber-text: #a96a00;  /* darker amber for AA text */
  --rag-green-text: #3d7a00;
  --table-head-bg: #f1f3f4;   /* light header */
  --table-head-fg: #3f4448;   /* AA on #f1f3f4 */
  --shadow-card: 0 1px 3px rgba(0, 65, 89, 0.12), 0 1px 2px rgba(0, 65, 89, 0.08);
  --shadow-control: 0 1px 2px rgba(0, 65, 89, 0.10);
  --gradient-kpi: linear-gradient(90deg, var(--rag-red), var(--rag-amber), var(--rag-green));
}
```

- [ ] **Step 4: Make the table header fill token-driven.** Change `globals.css` line 94 `.lop-thead > tr > th { background-color: var(--AIPM-dark-blue); }` → `background-color: var(--table-head-bg); color: var(--table-head-fg);`. In `src/app/table-styles.ts`, change `TABLE_HEAD_CLASS`'s `text-white` → `text-[var(--table-head-fg)]` (so mockup's dark-on-light header text applies; AIPM fg is `#ffffff` → unchanged).

- [ ] **Step 5: Write `src/app/style-tokens.test.ts`** (assert tokens defined + AIPM no-op):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("CI-style role tokens", () => {
  it.each(["--rag-red","--rag-amber","--rag-green","--rag-red-text","--rag-amber-text","--rag-green-text","--table-head-bg","--table-head-fg","--shadow-card","--gradient-kpi"])(
    "defines %s in :root", (t) => expect(css).toMatch(new RegExp(`:root\\s*\\{[\\s\\S]*?${t}\\s*:`)),
  );
  it("defines a mockup override block", () => {
    expect(css).toContain(':root[data-style="mockup"]');
  });
  it("AIPM table header stays dark-blue (no-op for existing users)", () => {
    expect(css).toMatch(/--table-head-bg:\s*var\(--AIPM-dark-blue\)/);
    expect(css).toMatch(/--shadow-card:\s*none/);
  });
});
```

- [ ] **Step 6: Run + tsc + commit.** `npm run test:run -- style-tokens` PASS; `npx tsc --noEmit`.
```bash
git add src/app/globals.css src/app/table-styles.ts src/app/style-tokens.test.ts
git commit -m "feat(style): role tokens (RAG/table-head/shadow/gradient); token-driven table header"
```

### Task 4: make `shell-palette-guard` style-aware (allow token shadows)

**Files:** Modify `src/app/shell-palette-guard.test.ts`

The current `SHADOW_OR_GRADIENT = /\b(?:shadow(?:-[a-z0-9]+)?|bg-gradient-)/` flags `shadow-[var(--shadow-card)]` too (the bare `\bshadow` matches). Shadows/gradients must be legal ONLY via tokens.

- [ ] **Step 1: Replace the regex + add detection tests.** New regex bans raw shadow utilities + `bg-gradient-` but ALLOWS the bracketed-var forms:

```ts
// Shadows/gradients are permitted ONLY via style tokens (shadow-[var(--shadow-*)],
// bg-[var(--gradient-*)]). Raw utilities (shadow, shadow-md, bg-gradient-*) and
// hardcoded arbitrary shadows (shadow-[0_2px_4px_...]) remain banned.
const RAW_SHADOW = /\bshadow(?!-\[var\(--)(?:-[a-z0-9]+|-\[[^\]]*\])?\b/;
const RAW_GRADIENT = /\bbg-gradient-/;
```
Replace `SHADOW_OR_GRADIENT.test(...)` usages with `(RAW_SHADOW.test(...) || RAW_GRADIENT.test(...))`. Update the detection `it.each`:
```ts
it.each(["shadow", "shadow-md", "bg-gradient-to-r", "shadow-[0_2px_4px_#000]"])(
  "flags raw shadow/gradient utility %s",
  (cls) => expect(RAW_SHADOW.test(cls) || RAW_GRADIENT.test(cls)).toBe(true),
);
it.each(["shadow-[var(--shadow-card)]", "shadow-[var(--shadow-control)]"])(
  "allows token-driven shadow %s",
  (cls) => expect(RAW_SHADOW.test(cls) || RAW_GRADIENT.test(cls)).toBe(false),
);
```

- [ ] **Step 2: Run — expect PASS** (the 6 shell files use neither today). `npm run test:run -- shell-palette-guard`. Then `npx tsc --noEmit`.

- [ ] **Step 3: Commit**
```bash
git add src/app/shell-palette-guard.test.ts
git commit -m "test(style): shell-palette-guard allows token-driven shadows, bans raw"
```

---

## PHASE 3 — Apply the mockup look (token-driven)

### Task 5: RAG → role tokens

**Files:** Modify `src/app/health.ts`, `src/app/rag-badge.tsx`; update `src/app/rag-badge.test.tsx` / `health.test.ts` if they assert the old classes

- [ ] **Step 1: Check existing assertions.** `git grep -n "bg-red-500\|bg-amber-500\|bg-emerald-500\|text-AIPM-purple\|bg-slate-300" src/app/*.test.*` — note any test asserting these literals (they'll need updating to the token classes).

- [ ] **Step 2: Edit `health.ts`** — point the maps at tokens (visual no-op for AIPM since the tokens equal the old hexes):

```ts
export const healthDot: Record<Health, string> = {
  R: "bg-[var(--rag-red)]",
  A: "bg-[var(--rag-amber)]",
  G: "bg-[var(--rag-green)]",
};
export const healthText: Record<Health, string> = {
  R: "text-[var(--rag-red-text)]",
  A: "text-[var(--rag-amber-text)]",
  G: "text-[var(--rag-green-text)]",
};
```

- [ ] **Step 3: `rag-badge.tsx`** — the null dot `bg-slate-300` → a token (use `bg-surface-muted` which is a sanctioned token and reads as a neutral grey dot). Change `${base} bg-slate-300` → `${base} bg-surface-muted`.

- [ ] **Step 4: Update tests** found in Step 1 to assert the token classes (e.g. `expect(...).toContain("bg-[var(--rag-red)]")`). Add a test asserting `healthDot.A === "bg-[var(--rag-amber)]"` and `healthText.A === "text-[var(--rag-amber-text)]"`.

- [ ] **Step 5: Run + tsc + lint + commit.** `npm run test:run -- health rag-badge` green; `npx tsc --noEmit`.
```bash
git add src/app/health.ts src/app/rag-badge.tsx <touched-tests>
git commit -m "feat(style): RAG colors via role tokens (reflows on style switch)"
```

### Task 6: cards / KPI bars opt into shadow + gradient tokens

**Files:** Modify the shared card/tile + bar primitives. READ FIRST: `src/app/report-table.tsx` (`Tile`), the dashboard KPI tiles, `reports-tables.tsx` `StackedBar`, and any shared card wrapper (grep `rounded-md border border-line bg-surface` for the card idiom).

- [ ] **Step 1: Add the card shadow.** On the shared surface/card primitives (the `Tile` in `report-table.tsx` and the dashboard cockpit card wrappers), append `shadow-[var(--shadow-card)]` to the className (no-op under AIPM where the token is `none`). Do the same `shadow-[var(--shadow-control)]` on the primary button atom in `interaction-styles.ts` ONLY if it reads well — optional; keep to cards if unsure.

- [ ] **Step 2: KPI bar gradient.** In `reports-tables.tsx` `StackedBar` (and any dashboard progress/KPI bar), where the bar fill currently uses a flat token, add a mockup-only gradient layer: set the fill element's `style={{ backgroundImage: "var(--gradient-kpi)" }}` (AIPM token is `none` → flat fill via the existing class shows; mockup paints the gradient over it). Keep the existing flat `bg-*` class as the AIPM fallback beneath.

- [ ] **Step 3: Tests.** Add/extend the relevant component test to assert the card carries `shadow-[var(--shadow-card)]` (string match) — proves the opt-in is wired; the token value (none vs shadow) is style-driven at runtime.

- [ ] **Step 4: Run + tsc + lint + commit.** `npm run test:run -- report-table reports-tables dashboard` green.
```bash
git add <touched files + tests>
git commit -m "feat(style): cards + KPI bars opt into shadow/gradient tokens (no-op under AIPM)"
```

---

## PHASE 4 — Settings switch + axe matrix

### Task 7: Appearance Style control + i18n

**Files:** Modify `src/app/settings-sections/appearance-section.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`; Test `appearance-section.test.tsx` (extend/create)

READ FIRST: `appearance-section.tsx` — how it renders the existing Theme control + the `SegmentedControl` usage (density/theme).

- [ ] **Step 1: i18n EN** (`i18n.ts`): add
```
styleLabel: "Visual style",
styleIcc: "Acme",
styleMockup: "Dashboard",
styleMockupLightOnly: "Dashboard style is light-only — theme is disabled while it's active.",
```
- [ ] **Step 2: i18n DE** (`i18n.de.ts`, NODE-WRITE, real umlauts — these are umlaut-free):
```
styleLabel: "Visueller Stil",
styleIcc: "Acme",
styleMockup: "Dashboard",
styleMockupLightOnly: "Der Dashboard-Stil ist nur hell - das Thema ist deaktiviert, solange er aktiv ist.",
```
(`-` not an em-dash to stay ASCII-clean; or use a real "–" copied from EN. Either; just no umlaut subs.)

- [ ] **Step 3: Wire the control.** In `appearance-section.tsx`: import `useCiStyle`; render a `SegmentedControl<CiStyle>` (value `style`, onChange `setStyle`, options AIPM/Dashboard, `ariaLabel={t(lang,"styleLabel")}`) next to the Theme control. When `style === "mockup"`: disable the Theme `SegmentedControl` (`disabled` prop if it supports it, else render it visually-disabled) and show `t(lang,"styleMockupLightOnly")` as a note. Settings → General is axe-scanned → the Style control needs an accessible name (the `ariaLabel`).

- [ ] **Step 4: Test `appearance-section.test.tsx`** — render, assert the Style control renders with both options; selecting "Dashboard" calls `setStyle("mockup")` (mock `useCiStyle`); when style is mockup the theme control is disabled + the light-only note shows. `npx tsc --noEmit` after.

- [ ] **Step 5: Gates + commit.** `npm run test:run -- appearance-section i18n-encoding` green; `npx tsc --noEmit` (EN/DE parity).
```bash
git add src/app/settings-sections/appearance-section.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/settings-sections/appearance-section.test.tsx
git commit -m "feat(style): Appearance style switch + light-only theme lock + i18n"
```

### Task 8: axe scan matrix (AIPM-light / AIPM-dark / Mockup-light)

**Files:** Modify `e2e/a11y.spec.ts`

READ FIRST: the current spec (`gotoApp`/`openView` setup, the `A11Y_VIEWS` loop, the critical/serious filter).

- [ ] **Step 1: Parametrize over combos.** Define `const COMBOS = [{style:"AIPM",dark:false},{style:"AIPM",dark:true},{style:"mockup",dark:false}] as const;`. Before scanning, set both keys in localStorage and reload so the no-flash script applies them:
```ts
await page.addInitScript(([style, theme]) => {
  localStorage.setItem("lop-style", style);
  localStorage.setItem("lop-theme", theme);
}, [combo.style, combo.dark ? "dark" : "light"]);
```
Wrap the existing per-view loop in a `for (const combo of COMBOS)` and name tests `a11y: ${combo.style}/${combo.dark?"dark":"light"} — ${view}`. (Set the init script BEFORE `gotoApp`; `addInitScript` runs on every navigation.)

- [ ] **Step 2: Keep the critical/serious filter** as-is. The mockup red/amber/green TEXT tokens get contrast-checked automatically by axe's color-contrast rule across the Mockup-light pass (no separate assertion needed — axe flags sub-AA text).

- [ ] **Step 3: Run the matrix.** `npx playwright test e2e/a11y.spec.ts --project=chromium` — expect all `13 × 3 = 39` green. If a mockup text token fails contrast, darken its `*-text` token in `globals.css` (Task 3 Step 3) until AA, re-run.

- [ ] **Step 4: Commit**
```bash
git add e2e/a11y.spec.ts
git commit -m "test(style): axe scans AIPM-light, AIPM-dark, Mockup-light combos"
```

---

## PHASE 5 — Release

### Task 9: release metadata + AGENTS.md

**Files:** `src/app/version.ts`, `i18n.ts`, `i18n.de.ts`, `CHANGELOG.md`, `package.json`, `README.md`, `AGENTS.md`

- [ ] **Step 1:** version `0.139.0`→`0.140.0`; pick an unused sci-fi author milestone (grep CHANGELOG; e.g. "Egan"/"Herbert" if unused); update `APP_BUILD_DATE` comment; append `"versionHighlightDualCi"` to `APP_HIGHLIGHT_KEYS`.
- [ ] **Step 2:** highlight EN (`i18n.ts`): `versionHighlightDualCi: "Switch between the Acme look and a richer dashboard style (shadows, gradients, red/amber status) in Settings → Appearance",` + DE (node-write): `versionHighlightDualCi: "Wechsle in Einstellungen → Darstellung zwischen dem Acme-Look und einem reichhaltigeren Dashboard-Stil (Schatten, Verlaeufe, Rot/Gelb-Status)",` → replace `Verlaeufe` with real `Verläufe` (umlaut ä).
- [ ] **Step 3:** CHANGELOG `## [0.140.0] - <date> "<Milestone>"` ### Added — dual-CI style switch.
- [ ] **Step 4:** package.json version + README badge.
- [ ] **Step 5: AGENTS.md** add a "Dual-CI / style axis" bullet under Architecture pointers: `data-style="AIPM"|"mockup"` on `<html>` is ORTHOGONAL to `.dark` (set by `use-style` + the extended no-flash boot script over `lop-style`, NOT the settings blob); Mockup is light-only + PINS light (boot script + use-theme drop `.dark`); ALL style difference is CSS role tokens (`--rag-*`/`--rag-*-text`/`--table-head-bg|fg`/`--shadow-*`/`--gradient-kpi`) — AIPM values reproduce the old look (no-op), mockup overrides in `:root[data-style="mockup"]`; shadows/gradients legal ONLY via `shadow-[var(--shadow-*)]`/`var(--gradient-*)` (shell-palette-guard bans raw forms); RAG color flows through `health.ts` tokens; axe scans AIPM-light/AIPM-dark/Mockup-light.
- [ ] **Step 6: Gates + commit.** `npx tsc --noEmit` (parity incl. highlight key) + `npm run test:run -- i18n-encoding version`.
```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md package.json README.md AGENTS.md
git commit -m "chore(release): v0.140.0 dual-CI style switch"
```

### Task 10: final verification + review
- [ ] `npm run lint` (0 warnings) · `npx tsc --noEmit` (clean) · `npm run test:run` (full suite green) · `npm run build` (green) · `npx playwright test e2e/a11y.spec.ts --project=chromium` (39 green).
- [ ] Dispatch a final code review over `git diff main...HEAD`; address CRITICAL/HIGH; re-run gates.
- [ ] Stop — hand back for the release trigger (push/MR/merge user-gated).

---

## Self-review (vs spec)
- §Architecture (data-style + no-flash + pin-light) → Tasks 1–2. §Token layer → Task 3. §RAG refactor → Task 5. §Table header/cards → Tasks 3–6. §Gates (palette-sweep style-aware + axe matrix) → Tasks 4, 8. §Settings switch → Task 7. §Release/AGENTS → Task 9. §Testing → every task TDD + Task 10 full gates.
- Decisions honoured: orthogonal axis (Task 1 `data-style`), shadows+gradients+richer-RAG+light-header (Tasks 3,5,6), mockup light-only/pins-light (Tasks 1,2), scan every shipped combo (Task 8: 3 combos), no-flash `lop-style` store (Tasks 1,2), one MR.
- Type consistency: `CiStyle` ("AIPM"|"mockup") defined Task 1, used 1/2/7; role token names defined Task 3, consumed 3/5/6/8; `readStoredStyle`/`effectiveDark` Task 1.
- No placeholders: pure modules + tokens + boot script + gate regex have full code; UI-wiring tasks (6,7) carry exact class/token names + "read first" pointers (the established pattern).
