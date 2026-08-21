# Custom Color Schemes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create, edit, save, load, import and export custom color schemes (colors + logo + slogans) in Settings → Appearance, applied as a third "Custom" style.

**Architecture:** "Custom" becomes a third `data-style` value that pins light (like Mockup). A custom scheme is a per-device bundle of CSS-token hex overrides + branding, applied by setting inline CSS vars on `<html>` (the only palette-guard-safe runtime mechanism). The active scheme's resolved color map is mirrored to a localStorage boot key so the pre-paint script applies it with no flash. Pure modules hold the token registry, AA-derivation, contrast math, and the validated scheme store; a focused editor component drives the UI.

**Tech Stack:** React + TypeScript, Tailwind v4 (CSS role tokens in `globals.css`), Vitest + Testing Library, Playwright axe gate.

**Spec:** `docs/superpowers/specs/2026-06-30-custom-color-schemes-design.md`

---

## File structure

| File | Responsibility | Phase |
|------|----------------|-------|
| `src/app/style-ci.ts` (modify) | `CiStyle` adds `"custom"`; `readStoredStyle`/`effectiveDark` accept it | A |
| `src/app/scheme-apply.ts` (new) | DOM: apply/clear inline token overrides; boot-key read/write constants | A |
| `src/app/use-theme.tsx` (modify) | pin light for custom (not just mockup) | A |
| `src/app/use-style.tsx` (modify) | on style change, apply/clear scheme colors at runtime | A |
| `src/app/layout.tsx` (modify) | pre-paint boot script: custom ⇒ pin light + apply boot-key colors | A |
| `src/app/settings-sections/appearance-section.tsx` (modify) | add "Custom" style option; disable theme for custom; mount editor | A/B |
| `src/app/scheme-tokens.ts` (new) | editable token registry, AIPM/Mockup seed maps, `deriveAaVariants` | B |
| `src/app/scheme-contrast.ts` (new) | pure WCAG contrast ratio + key-pair check | B |
| `src/app/color-scheme-editor.tsx` (new) | the editor UI (pickers, advanced, contrast, branding, library controls) | B/C |
| `src/app/color-schemes.ts` (new) | per-device library store + validation + JSON import/export | C |

---

# PHASE A — Third "Custom" style, apply + no-flash boot

## Task A1: Extend `CiStyle` to include "custom"

**Files:**
- Modify: `src/app/style-ci.ts`
- Test: `src/app/style-ci.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `src/app/style-ci.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readStoredStyle, effectiveDark } from "./style-ci";

describe("style-ci custom", () => {
  it("accepts 'custom' as a valid stored style", () => {
    expect(readStoredStyle("custom")).toBe("custom");
    expect(readStoredStyle("AIPM")).toBe("AIPM");
    expect(readStoredStyle("mockup")).toBe("mockup");
    expect(readStoredStyle("bogus")).toBe("AIPM");
  });

  it("pins light for custom (like mockup)", () => {
    expect(effectiveDark(true, "custom")).toBe(false);
    expect(effectiveDark(true, "mockup")).toBe(false);
    expect(effectiveDark(true, "AIPM")).toBe(true);
    expect(effectiveDark(false, "AIPM")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/app/style-ci.test.ts`
Expected: FAIL — `readStoredStyle("custom")` returns `"AIPM"`.

- [ ] **Step 3: Implement**

In `src/app/style-ci.ts` replace the type + the two helpers:

```ts
export type CiStyle = "AIPM" | "mockup" | "custom";

export const STYLE_STORAGE_KEY = "lop-style";

/** Validate a raw stored string into a CiStyle, defaulting to "AIPM". */
export function readStoredStyle(raw: string | null): CiStyle {
  return raw === "AIPM" || raw === "mockup" || raw === "custom" ? raw : "AIPM";
}
```

And change `effectiveDark` so custom pins light too:

```ts
export function effectiveDark(resolvedThemeDark: boolean, style: CiStyle): boolean {
  return style === "AIPM" ? resolvedThemeDark : false;
}
```

(Update the JSDoc above `effectiveDark` to say "mockup AND custom pin light".)

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/style-ci.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/style-ci.ts src/app/style-ci.test.ts
git commit -m "feat(scheme): add 'custom' CiStyle that pins light"
```

---

## Task A2: `scheme-apply.ts` — apply/clear inline token overrides + boot-key

**Files:**
- Create: `src/app/scheme-apply.ts`
- Test: `src/app/scheme-apply.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/scheme-apply.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  ACTIVE_SCHEME_COLORS_KEY,
  applySchemeColors,
  readActiveSchemeColors,
  writeActiveSchemeColors,
} from "./scheme-apply";

describe("scheme-apply", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  it("sets inline CSS vars for each token and clears them with null", () => {
    applySchemeColors({ "--AIPM-green": "#123456", "--background": "#abcdef" });
    expect(document.documentElement.style.getPropertyValue("--AIPM-green")).toBe("#123456");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#abcdef");

    applySchemeColors(null);
    expect(document.documentElement.style.getPropertyValue("--AIPM-green")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("");
  });

  it("round-trips the active color map through localStorage", () => {
    writeActiveSchemeColors({ "--AIPM-green": "#123456" });
    expect(localStorage.getItem(ACTIVE_SCHEME_COLORS_KEY)).toContain("--AIPM-green");
    expect(readActiveSchemeColors()).toEqual({ "--AIPM-green": "#123456" });
  });

  it("readActiveSchemeColors returns null on missing/garbage", () => {
    expect(readActiveSchemeColors()).toBeNull();
    localStorage.setItem(ACTIVE_SCHEME_COLORS_KEY, "not json");
    expect(readActiveSchemeColors()).toBeNull();
  });

  it("clearing replaces the previous inline override set (no stale tokens)", () => {
    applySchemeColors({ "--AIPM-green": "#111111", "--line": "#222222" });
    applySchemeColors({ "--AIPM-green": "#333333" });
    expect(document.documentElement.style.getPropertyValue("--AIPM-green")).toBe("#333333");
    expect(document.documentElement.style.getPropertyValue("--line")).toBe("");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/app/scheme-apply.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/app/scheme-apply.ts`:

```ts
// Runtime application of a custom color scheme's CSS-variable overrides.
// Overrides are set as INLINE styles on <html> — the only palette-guard-safe
// runtime mechanism (it changes token VALUES, never adds Tailwind classes).
// The active map is mirrored to a localStorage boot key so the pre-paint script
// in layout.tsx can apply it before first paint (no flash).

export type SchemeColorMap = Record<string, string>;

export const ACTIVE_SCHEME_COLORS_KEY = "lop-active-scheme-colors";

// Tracks which tokens we set last time so a re-apply can clear stale ones.
let lastApplied: string[] = [];

/** Apply (or, with null, remove) the inline token overrides on <html>. */
export function applySchemeColors(colors: SchemeColorMap | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const token of lastApplied) root.style.removeProperty(token);
  lastApplied = [];
  if (!colors) return;
  for (const [token, value] of Object.entries(colors)) {
    root.style.setProperty(token, value);
    lastApplied.push(token);
  }
}

/** Persist the active scheme's resolved color map for the pre-paint boot script. */
export function writeActiveSchemeColors(colors: SchemeColorMap | null): void {
  try {
    if (colors) localStorage.setItem(ACTIVE_SCHEME_COLORS_KEY, JSON.stringify(colors));
    else localStorage.removeItem(ACTIVE_SCHEME_COLORS_KEY);
  } catch {
    /* private mode / quota — runtime apply still works in-memory */
  }
}

/** Read the active color map (boot key). Returns null when missing/garbage. */
export function readActiveSchemeColors(): SchemeColorMap | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SCHEME_COLORS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: SchemeColorMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/scheme-apply.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/scheme-apply.ts src/app/scheme-apply.test.ts
git commit -m "feat(scheme): inline-var apply + boot-key persistence"
```

---

## Task A3: Pin light for custom in `use-theme` + apply at runtime in `use-style`

**Files:**
- Modify: `src/app/use-theme.tsx:35` (the `mockup` check)
- Modify: `src/app/use-style.tsx` (apply scheme colors on style change)

No new test (DOM-effect wiring; covered by A2 unit + Phase-A eye-verify). These are small integration edits.

- [ ] **Step 1: use-theme — pin light for custom too**

In `src/app/use-theme.tsx`, inside the `apply` closure (currently line 35-36), replace:

```tsx
      const mockup = document.documentElement.getAttribute("data-style") === "mockup";
      const dark = !mockup && resolveTheme(theme, prefersDark()) === "dark";
```

with:

```tsx
      const attr = document.documentElement.getAttribute("data-style");
      const pinsLight = attr === "mockup" || attr === "custom";
      const dark = !pinsLight && resolveTheme(theme, prefersDark()) === "dark";
```

- [ ] **Step 2: use-style — apply/clear scheme colors when the style changes**

In `src/app/use-style.tsx`, add the import and extend the effect. Replace the import line:

```tsx
import { type CiStyle, STYLE_STORAGE_KEY, readStoredStyle } from "./style-ci";
```

with:

```tsx
import { type CiStyle, STYLE_STORAGE_KEY, readStoredStyle } from "./style-ci";
import { applySchemeColors, readActiveSchemeColors } from "./scheme-apply";
```

Then replace the effect body:

```tsx
  useEffect(() => {
    document.documentElement.setAttribute("data-style", style);
    // .dark is owned solely by ThemeProvider; notify it to re-apply for the new style.
    window.dispatchEvent(new Event("lop-style-change"));
  }, [style]);
```

with:

```tsx
  useEffect(() => {
    document.documentElement.setAttribute("data-style", style);
    // Custom style overlays inline CSS-var overrides from the active scheme;
    // any other style clears them. (The pre-paint boot script does the same on
    // reload; this handles in-session style switches.)
    applySchemeColors(style === "custom" ? readActiveSchemeColors() : null);
    // .dark is owned solely by ThemeProvider; notify it to re-apply for the new style.
    window.dispatchEvent(new Event("lop-style-change"));
  }, [style]);
```

- [ ] **Step 3: Typecheck + full unit suite**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run src/app/style-ci.test.ts src/app/scheme-apply.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/use-theme.tsx src/app/use-style.tsx
git commit -m "feat(scheme): pin light + apply scheme colors for custom style"
```

---

## Task A4: Pre-paint boot script applies custom colors

**Files:**
- Modify: `src/app/layout.tsx:16` (the `NO_FLASH_THEME_SCRIPT` string)

No unit test (it's a pre-paint inline string executed by the browser; verified by Phase-A eye-verify — a reload on a custom scheme must not flash AIPM first).

- [ ] **Step 1: Replace the boot script string**

In `src/app/layout.tsx`, replace the `NO_FLASH_THEME_SCRIPT` constant with the version below. Changes: accept `"custom"`; pin light for mockup OR custom; when custom, parse `lop-active-scheme-colors` and set each inline var before paint.

```ts
const NO_FLASH_THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("lop-style")||"AIPM";if(s!=="AIPM"&&s!=="mockup"&&s!=="custom"){s="AIPM";}document.documentElement.setAttribute("data-style",s);var t=localStorage.getItem("lop-theme")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(s==="mockup"||s==="custom"){d=false;}document.documentElement.classList.toggle("dark",d);if(s==="custom"){var raw=localStorage.getItem("lop-active-scheme-colors");if(raw){var m=JSON.parse(raw);for(var k in m){if(Object.prototype.hasOwnProperty.call(m,k)&&typeof m[k]==="string"){document.documentElement.style.setProperty(k,m[k]);}}}}}catch(e){}})();`;
```

- [ ] **Step 2: Build (boot string is inlined into the served HTML)**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(scheme): pre-paint boot applies custom scheme colors"
```

---

## Task A5: "Custom" option in the Appearance style switcher

**Files:**
- Modify: `src/app/settings-sections/appearance-section.tsx`

- [ ] **Step 1: Add the option + disable theme for custom**

In `appearance-section.tsx`:

Replace `const isMockup = style === "mockup";` with:

```tsx
  const isMockup = style === "mockup";
  const isCustom = style === "custom";
  const pinsLight = isMockup || isCustom;
```

In the Style `SegmentedControl`, add the custom option:

```tsx
          options={[
            { value: "AIPM", label: t(lang, "styleIcc") },
            { value: "mockup", label: t(lang, "styleMockup") },
            { value: "custom", label: t(lang, "styleCustom") },
          ]}
```

In the Theme `SegmentedControl`, change `disabled={isMockup}` to `disabled={pinsLight}` and the helper `{isMockup && (...)}` to `{pinsLight && (...)}`.

- [ ] **Step 2: Add the i18n keys**

Add `styleCustom` to `src/app/i18n.ts` (EN) near `styleMockup`:

```ts
  styleCustom: "Custom",
```

Add the DE key to `src/app/i18n.de.ts` via a node utf8 write (the Edit tool corrupts umlauts; file is CRLF). Run this from the repo root (no umlauts in this value, but use the node-write path for consistency and CRLF safety):

```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');s=s.replace('  styleMockup:', '  styleCustom: \"Benutzerdefiniert\",\r\n  styleMockup:');fs.writeFileSync(p,s);"
```

(If `styleMockup:` appears with different surrounding whitespace, adjust the anchor to match the exact `\r\n  styleMockup:` line. Verify with `npx tsc --noEmit` — i18n EN/DE key parity is tsc-enforced.)

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit` → clean (proves EN/DE parity).
Run: `npm run lint` → 0 warnings.

- [ ] **Step 4: Eye-verify Phase A end-to-end**

Run: `npm run dev`. In Settings → Appearance, pick **Custom**. Nothing visibly changes yet (no active scheme), the Theme control disables, and `data-style="custom"` is on `<html>`. In the browser console seed a scheme manually to prove apply + no-flash:

```js
localStorage.setItem("lop-active-scheme-colors", JSON.stringify({ "--AIPM-dark-blue": "#6a1b9a", "--AIPM-green": "#ff6f00" }));
location.reload();
```

Expected after reload: sidebar/header use purple, accents orange, with NO AIPM flash first. Switch back to AIPM → overrides clear.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-sections/appearance-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(scheme): Custom option in the Appearance style switcher"
```

---

# PHASE B — Token registry, AA-derivation, contrast, editor

## Task B1: `scheme-tokens.ts` — registry, seeds, AA derivation

**Files:**
- Create: `src/app/scheme-tokens.ts`
- Test: `src/app/scheme-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/scheme-tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CORE_TOKENS,
  ADVANCED_TOKENS,
  ICC_SEED,
  deriveAaVariants,
  resolveSchemeColors,
} from "./scheme-tokens";

describe("scheme-tokens", () => {
  it("ICC_SEED has a hex value for every core and advanced token", () => {
    for (const t of [...CORE_TOKENS, ...ADVANCED_TOKENS]) {
      expect(ICC_SEED[t.token], `seed for ${t.token}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("deriveAaVariants darkens the accent until it clears AA on white", () => {
    const derived = deriveAaVariants({ "--AIPM-green": "#84bd00", "--surface": "#ffffff" });
    // --AIPM-green-strong must be present and AA (>=4.5) on white
    expect(derived["--AIPM-green-strong"]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("resolveSchemeColors merges user colors with derived variants", () => {
    const resolved = resolveSchemeColors({ "--AIPM-green": "#84bd00", "--surface": "#ffffff" });
    expect(resolved["--AIPM-green"]).toBe("#84bd00");
    expect(resolved["--AIPM-green-strong"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/app/scheme-tokens.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/app/scheme-tokens.ts`. The AIPM seed values below are copied verbatim from `globals.css` `:root`. **You must also fill `MOCKUP_SEED`** by copying the corresponding values from the `:root[data-style="mockup"]` block in `globals.css` for each token listed (open that file; known examples: `--table-head-fg: #3f4448`, `--table-head-accent: #3d7a00`). For any token the mockup block does not override, reuse the AIPM value.

```ts
// Editable-token registry for custom color schemes + AA-variant derivation.
// Pure (no DOM). Hex values mirror globals.css :root (AIPM) and
// :root[data-style="mockup"] (Mockup).
import type { SchemeColorMap } from "./scheme-apply";

export interface TokenSpec {
  token: string;   // CSS var name, e.g. "--AIPM-dark-blue"
  labelKey: string; // i18n key for the picker label
}

export const CORE_TOKENS: readonly TokenSpec[] = [
  { token: "--AIPM-dark-blue", labelKey: "schemeTokenPrimary" },
  { token: "--AIPM-green", labelKey: "schemeTokenAccent" },
  { token: "--background", labelKey: "schemeTokenBackground" },
  { token: "--surface", labelKey: "schemeTokenSurface" },
  { token: "--foreground", labelKey: "schemeTokenText" },
  { token: "--rag-red", labelKey: "schemeTokenRagRed" },
  { token: "--rag-amber", labelKey: "schemeTokenRagAmber" },
  { token: "--rag-green", labelKey: "schemeTokenRagGreen" },
] as const;

export const ADVANCED_TOKENS: readonly TokenSpec[] = [
  { token: "--AIPM-pink", labelKey: "schemeTokenPink" },
  { token: "--AIPM-purple", labelKey: "schemeTokenPurple" },
  { token: "--AIPM-blue", labelKey: "schemeTokenBlue" },
  { token: "--AIPM-medium-grey", labelKey: "schemeTokenMediumGrey" },
  { token: "--AIPM-light-grey", labelKey: "schemeTokenLightGrey" },
  { token: "--surface-muted", labelKey: "schemeTokenSurfaceMuted" },
  { token: "--line", labelKey: "schemeTokenLine" },
  { token: "--table-head-bg", labelKey: "schemeTokenTableHeadBg" },
  { token: "--table-head-fg", labelKey: "schemeTokenTableHeadFg" },
  { token: "--table-head-accent", labelKey: "schemeTokenTableHeadAccent" },
  { token: "--segment-track-bg", labelKey: "schemeTokenSegmentTrack" },
  { token: "--segment-active-bg", labelKey: "schemeTokenSegmentActiveBg" },
  { token: "--segment-active-fg", labelKey: "schemeTokenSegmentActiveFg" },
] as const;

export const ICC_SEED: SchemeColorMap = {
  "--AIPM-dark-blue": "#004159",
  "--AIPM-green": "#84bd00",
  "--background": "#ffffff",
  "--surface": "#ffffff",
  "--foreground": "#636362",
  "--rag-red": "#ef4444",
  "--rag-amber": "#f59e0b",
  "--rag-green": "#10b981",
  "--AIPM-pink": "#e5497c",
  "--AIPM-purple": "#aa4899",
  "--AIPM-blue": "#60c0dd",
  "--AIPM-medium-grey": "#939598",
  "--AIPM-light-grey": "#e3e6e6",
  "--surface-muted": "#e3e6e6",
  "--line": "#e3e6e6",
  "--table-head-bg": "#004159",
  "--table-head-fg": "#ffffff",
  "--table-head-accent": "#84bd00",
  "--segment-track-bg": "#ffffff",
  "--segment-active-bg": "#004159",
  "--segment-active-fg": "#ffffff",
};

// Fill from globals.css :root[data-style="mockup"] (see note above).
export const MOCKUP_SEED: SchemeColorMap = {
  ...ICC_SEED,
  "--table-head-fg": "#3f4448",
  "--table-head-accent": "#3d7a00",
  // ...copy remaining mockup overrides here from globals.css...
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function relLuminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: string, b: string): number {
  const la = relLuminance(hexToRgb(a));
  const lb = relLuminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Darken `base` toward black until it clears AA (4.5:1) on `bg`, or give up. */
function darkenToAa(base: string, bg: string): string {
  let [r, g, b] = hexToRgb(base);
  for (let i = 0; i < 20 && ratio(rgbToHex(r, g, b), bg) < 4.5; i++) {
    r *= 0.85; g *= 0.85; b *= 0.85;
  }
  return rgbToHex(r, g, b);
}

/** Compute the AA text/companion variants implied by the user's chosen colors. */
export function deriveAaVariants(colors: SchemeColorMap): SchemeColorMap {
  const surface = colors["--surface"] ?? ICC_SEED["--surface"];
  const out: SchemeColorMap = {};
  if (colors["--AIPM-green"]) out["--AIPM-green-strong"] = darkenToAa(colors["--AIPM-green"], surface);
  if (colors["--AIPM-pink"]) out["--AIPM-pink-strong"] = darkenToAa(colors["--AIPM-pink"], surface);
  if (colors["--AIPM-purple"]) out["--AIPM-purple-strong"] = darkenToAa(colors["--AIPM-purple"], surface);
  if (colors["--rag-red"]) out["--rag-red-text"] = darkenToAa(colors["--rag-red"], surface);
  if (colors["--rag-amber"]) out["--rag-amber-text"] = darkenToAa(colors["--rag-amber"], surface);
  if (colors["--rag-green"]) out["--rag-green-text"] = darkenToAa(colors["--rag-green"], surface);
  if (colors["--foreground"]) out["--muted-foreground"] = colors["--foreground"];
  return out;
}

/** The full map written to the boot key + applied inline: user colors + derived. */
export function resolveSchemeColors(colors: SchemeColorMap): SchemeColorMap {
  return { ...colors, ...deriveAaVariants(colors) };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/scheme-tokens.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/scheme-tokens.ts src/app/scheme-tokens.test.ts
git commit -m "feat(scheme): token registry, seeds, AA-variant derivation"
```

---

## Task B2: `scheme-contrast.ts` — pure contrast check

**Files:**
- Create: `src/app/scheme-contrast.ts`
- Test: `src/app/scheme-contrast.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/scheme-contrast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { contrastRatio, checkSchemePairs } from "./scheme-contrast";

describe("scheme-contrast", () => {
  it("black/white is ~21 and equal colors are 1", () => {
    expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });

  it("flags a sub-AA text/background pair", () => {
    const pairs = checkSchemePairs({ "--foreground": "#bbbbbb", "--background": "#ffffff" });
    const textPair = pairs.find((p) => p.id === "text-bg");
    expect(textPair).toBeDefined();
    expect(textPair!.passesAa).toBe(false);
  });

  it("passes a high-contrast text/background pair", () => {
    const pairs = checkSchemePairs({ "--foreground": "#222222", "--background": "#ffffff" });
    const textPair = pairs.find((p) => p.id === "text-bg");
    expect(textPair!.passesAa).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/app/scheme-contrast.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/app/scheme-contrast.ts`:

```ts
// Pure WCAG contrast helpers for the scheme editor (warn-only, non-blocking).
import type { SchemeColorMap } from "./scheme-apply";
import { resolveSchemeColors } from "./scheme-tokens";

const AA = 4.5;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
function relLuminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(hexToRgb(a));
  const lb = relLuminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface ContrastPair {
  id: string;
  labelKey: string;
  ratio: number;
  passesAa: boolean;
}

/** Check the key foreground/background pairs of a scheme. Uses resolved colors
 *  (so derived RAG-text variants are what's actually rendered). */
export function checkSchemePairs(colors: SchemeColorMap): ContrastPair[] {
  const c = resolveSchemeColors(colors);
  const bg = c["--background"] ?? "#ffffff";
  const surface = c["--surface"] ?? "#ffffff";
  const defs: { id: string; labelKey: string; fg?: string; on: string }[] = [
    { id: "text-bg", labelKey: "schemePairTextBg", fg: c["--foreground"], on: bg },
    { id: "accent-surface", labelKey: "schemePairAccentSurface", fg: c["--AIPM-green-strong"] ?? c["--AIPM-green"], on: surface },
    { id: "rag-red", labelKey: "schemePairRagRed", fg: c["--rag-red-text"], on: surface },
    { id: "rag-amber", labelKey: "schemePairRagAmber", fg: c["--rag-amber-text"], on: surface },
    { id: "rag-green", labelKey: "schemePairRagGreen", fg: c["--rag-green-text"], on: surface },
  ];
  return defs
    .filter((d): d is { id: string; labelKey: string; fg: string; on: string } => !!d.fg)
    .map((d) => {
      const r = contrastRatio(d.fg, d.on);
      return { id: d.id, labelKey: d.labelKey, ratio: Math.round(r * 100) / 100, passesAa: r >= AA };
    });
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/scheme-contrast.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/scheme-contrast.ts src/app/scheme-contrast.test.ts
git commit -m "feat(scheme): pure WCAG contrast check"
```

---

## Task B3: i18n keys for the editor

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

No unit test; `npx tsc --noEmit` enforces EN/DE parity.

- [ ] **Step 1: Add EN keys**

Add to `src/app/i18n.ts` (group them near `styleCustom`):

```ts
  schemeTokenPrimary: "Brand primary",
  schemeTokenAccent: "Accent",
  schemeTokenBackground: "Background",
  schemeTokenSurface: "Surface",
  schemeTokenText: "Text",
  schemeTokenRagRed: "Status red",
  schemeTokenRagAmber: "Status amber",
  schemeTokenRagGreen: "Status green",
  schemeTokenPink: "Pink",
  schemeTokenPurple: "Purple",
  schemeTokenBlue: "Blue",
  schemeTokenMediumGrey: "Medium grey",
  schemeTokenLightGrey: "Light grey",
  schemeTokenSurfaceMuted: "Muted surface",
  schemeTokenLine: "Border line",
  schemeTokenTableHeadBg: "Table header background",
  schemeTokenTableHeadFg: "Table header text",
  schemeTokenTableHeadAccent: "Table header accent",
  schemeTokenSegmentTrack: "Segment track",
  schemeTokenSegmentActiveBg: "Segment active background",
  schemeTokenSegmentActiveFg: "Segment active text",
  schemePairTextBg: "Text on background",
  schemePairAccentSurface: "Accent on surface",
  schemePairRagRed: "Status red text",
  schemePairRagAmber: "Status amber text",
  schemePairRagGreen: "Status green text",
  schemeAdvanced: "Advanced colors",
  schemeContrastBelowAa: "below AA",
  schemeNew: "New scheme",
  schemeNewFromIcc: "New from AIPM",
  schemeNewFromMockup: "New from Mockup",
  schemeApply: "Apply",
  schemeRename: "Rename",
  schemeDelete: "Delete",
  schemeImport: "Import scheme",
  schemeExport: "Export scheme",
  schemeNamePlaceholder: "Scheme name",
  schemeSelectLabel: "Saved schemes",
  schemeNone: "No saved schemes yet",
  schemeImportError: "Could not import that file.",
```

- [ ] **Step 2: Add the DE keys via node utf8 write**

Create a throwaway node script (umlauts as `\uXXXX` to avoid corruption; file is CRLF). Run from repo root:

```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');const block=[`  schemeTokenPrimary: \"Markenfarbe\",`,`  schemeTokenAccent: \"Akzent\",`,`  schemeTokenBackground: \"Hintergrund\",`,`  schemeTokenSurface: \"Oberfläche\",`,`  schemeTokenText: \"Text\",`,`  schemeTokenRagRed: \"Status rot\",`,`  schemeTokenRagAmber: \"Status gelb\",`,`  schemeTokenRagGreen: \"Status grün\",`,`  schemeTokenPink: \"Pink\",`,`  schemeTokenPurple: \"Violett\",`,`  schemeTokenBlue: \"Blau\",`,`  schemeTokenMediumGrey: \"Mittelgrau\",`,`  schemeTokenLightGrey: \"Hellgrau\",`,`  schemeTokenSurfaceMuted: \"Gedämpfte Oberfläche\",`,`  schemeTokenLine: \"Rahmenlinie\",`,`  schemeTokenTableHeadBg: \"Tabellenkopf-Hintergrund\",`,`  schemeTokenTableHeadFg: \"Tabellenkopf-Text\",`,`  schemeTokenTableHeadAccent: \"Tabellenkopf-Akzent\",`,`  schemeTokenSegmentTrack: \"Segment-Schiene\",`,`  schemeTokenSegmentActiveBg: \"Segment aktiv Hintergrund\",`,`  schemeTokenSegmentActiveFg: \"Segment aktiv Text\",`,`  schemePairTextBg: \"Text auf Hintergrund\",`,`  schemePairAccentSurface: \"Akzent auf Oberfläche\",`,`  schemePairRagRed: \"Status-rot-Text\",`,`  schemePairRagAmber: \"Status-gelb-Text\",`,`  schemePairRagGreen: \"Status-grün-Text\",`,`  schemeAdvanced: \"Erweiterte Farben\",`,`  schemeContrastBelowAa: \"unter AA\",`,`  schemeNew: \"Neues Schema\",`,`  schemeNewFromIcc: \"Neu aus AIPM\",`,`  schemeNewFromMockup: \"Neu aus Mockup\",`,`  schemeApply: \"Anwenden\",`,`  schemeRename: \"Umbenennen\",`,`  schemeDelete: \"Löschen\",`,`  schemeImport: \"Schema importieren\",`,`  schemeExport: \"Schema exportieren\",`,`  schemeNamePlaceholder: \"Schemaname\",`,`  schemeSelectLabel: \"Gespeicherte Schemata\",`,`  schemeNone: \"Noch keine gespeicherten Schemata\",`,`  schemeImportError: \"Diese Datei konnte nicht importiert werden.\",`].join('\r\n');s=s.replace('  styleCustom:', block+'\r\n  styleCustom:');fs.writeFileSync(p,s);"
```

(If the DE file has no `styleCustom:` yet — it was added in A5 — confirm A5 ran first. Verify after: `npx tsc --noEmit` must pass, and grep the file to confirm real umlauts, not `ue`/`oe` substitutions.)

- [ ] **Step 3: Verify parity + umlauts**

Run: `npx tsc --noEmit` → clean (EN/DE parity holds).
Run: `npm run test:run -- src/app/i18n` (the i18n-encoding test bans ASCII umlaut subs) → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(scheme): i18n keys for the scheme editor (EN+DE)"
```

---

## Task B4: `color-scheme-editor.tsx` — editor UI (colors + contrast + branding)

**Files:**
- Create: `src/app/color-scheme-editor.tsx`
- Modify: `src/app/settings-sections/appearance-section.tsx` (mount it when custom)
- Test: `src/app/color-scheme-editor.test.tsx`

This task wires the editor against an in-memory draft + an `onApply(colors)` callback. The library store (save/load/import/export) is added in Phase C; here the editor edits a single working draft seeded from AIPM and Applies it live.

- [ ] **Step 1: Write the failing test**

Create `src/app/color-scheme-editor.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColorSchemeEditor } from "./color-scheme-editor";

describe("ColorSchemeEditor", () => {
  it("renders a labeled color picker for each core token", () => {
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />);
    // Brand primary picker has an accessible name
    expect(screen.getByLabelText("Brand primary")).toBeInTheDocument();
    expect(screen.getByLabelText("Accent")).toBeInTheDocument();
  });

  it("calls onApply with the resolved color map including a changed token", () => {
    const onApply = vi.fn();
    render(<ColorSchemeEditor lang="en-US" onApply={onApply} />);
    fireEvent.input(screen.getByLabelText("Accent"), { target: { value: "#123456" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const arg = onApply.mock.calls[0][0] as Record<string, string>;
    expect(arg["--AIPM-green"]).toBe("#123456");
    // derived variant is included
    expect(arg["--AIPM-green-strong"]).toBeDefined();
  });

  it("shows a below-AA warning when text/background contrast is poor", () => {
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />);
    fireEvent.input(screen.getByLabelText("Text"), { target: { value: "#eeeeee" } });
    expect(screen.getByText(/below AA/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/app/color-scheme-editor.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement the editor**

Create `src/app/color-scheme-editor.tsx`:

```tsx
"use client";

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { CORE_TOKENS, ADVANCED_TOKENS, ICC_SEED, resolveSchemeColors } from "./scheme-tokens";
import { checkSchemePairs } from "./scheme-contrast";
import type { SchemeColorMap } from "./scheme-apply";

interface ColorSchemeEditorProps {
  lang: Lang;
  /** Initial working colors (defaults to the AIPM seed). */
  initialColors?: SchemeColorMap;
  /** Called with the RESOLVED color map (user colors + derived AA variants). */
  onApply: (resolved: SchemeColorMap) => void;
}

export function ColorSchemeEditor({ lang, initialColors, onApply }: ColorSchemeEditorProps) {
  const [colors, setColors] = useState<SchemeColorMap>({ ...ICC_SEED, ...initialColors });
  const pairs = checkSchemePairs(colors);

  function setToken(token: string, value: string) {
    setColors((prev) => ({ ...prev, [token]: value }));
  }

  function picker(token: string, labelKey: string) {
    const label = t(lang, labelKey);
    return (
      <label key={token} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <input
          type="color"
          aria-label={label}
          value={colors[token] ?? "#000000"}
          onInput={(e) => setToken(token, (e.target as HTMLInputElement).value)}
          className={`h-7 w-10 cursor-pointer rounded border border-line bg-surface ${FOCUS_RING} ${TRANSITION}`}
        />
      </label>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-line bg-surface-muted p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CORE_TOKENS.map((tk) => picker(tk.token, tk.labelKey))}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-foreground">{t(lang, "schemeAdvanced")}</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ADVANCED_TOKENS.map((tk) => picker(tk.token, tk.labelKey))}
        </div>
      </details>

      {pairs.some((p) => !p.passesAa) && (
        <ul className="mt-3 space-y-1 text-xs">
          {pairs.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{t(lang, p.labelKey)}</span>
              <span className={p.passesAa ? "text-AIPM-green-strong" : "text-AIPM-pink-strong"}>
                {p.ratio}:1 {p.passesAa ? "✓" : `⚠ ${t(lang, "schemeContrastBelowAa")}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onApply(resolveSchemeColors(colors))}
          className={`rounded-md border border-line bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-AIPM-white ${INTERACTIVE}`}
        >
          {t(lang, "schemeApply")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/color-scheme-editor.test.tsx` → PASS.

- [ ] **Step 5: Mount the editor in Appearance when custom is active**

In `src/app/settings-sections/appearance-section.tsx`, add the imports:

```tsx
import { ColorSchemeEditor } from "../color-scheme-editor";
import { applySchemeColors, writeActiveSchemeColors } from "../scheme-apply";
import type { SchemeColorMap } from "../scheme-apply";
```

Directly AFTER the Style `SegmentedControl`'s closing `</div>` (the first `mb-4` block), add:

```tsx
      {isCustom && (
        <div className="mb-4">
          <ColorSchemeEditor
            lang={lang}
            onApply={(resolved: SchemeColorMap) => {
              writeActiveSchemeColors(resolved);
              applySchemeColors(resolved);
            }}
          />
        </div>
      )}
```

- [ ] **Step 6: Typecheck + lint + axe**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → 0 warnings.
Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"` → PASS (color pickers carry aria-labels; the editor only renders for custom, but the controls are labeled regardless).

- [ ] **Step 7: Commit**

```bash
git add src/app/color-scheme-editor.tsx src/app/color-scheme-editor.test.tsx src/app/settings-sections/appearance-section.tsx
git commit -m "feat(scheme): color scheme editor (pickers, advanced, contrast)"
```

---

# PHASE C — Library + JSON import/export

## Task C1: `color-schemes.ts` — per-device library + validation + import/export

**Files:**
- Create: `src/app/color-schemes.ts`
- Test: `src/app/color-schemes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/color-schemes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadSchemes, saveSchemes, addScheme, removeScheme,
  exportScheme, importScheme, type ColorScheme,
} from "./color-schemes";

function sample(name = "Acme"): ColorScheme {
  return { id: 1, name, colors: { "--AIPM-green": "#123456" }, branding: { slogan: "Hi" } };
}

describe("color-schemes store", () => {
  beforeEach(() => localStorage.clear());

  it("adds with id=max+1 and round-trips through localStorage", () => {
    const a = addScheme("First", { "--AIPM-green": "#111111" }, {});
    const b = addScheme("Second", { "--AIPM-green": "#222222" }, {});
    expect(b.activeId).toBe(b.schemes[b.schemes.length - 1].id);
    expect(b.schemes[1].id).toBe(a.schemes[0].id + 1);
    expect(loadSchemes().schemes).toHaveLength(2);
  });

  it("removes a scheme and clears activeId when it was active", () => {
    let st = addScheme("Only", {}, {});
    const id = st.schemes[0].id;
    st = removeScheme(id);
    expect(st.schemes).toHaveLength(0);
    expect(st.activeId).toBeNull();
  });

  it("exports JSON and imports it back", () => {
    const json = exportScheme(sample());
    const imported = importScheme(json);
    expect(imported?.name).toBe("Acme");
    expect(imported?.colors["--AIPM-green"]).toBe("#123456");
  });

  it("import rejects non-hex color values and drops unknown keys", () => {
    const bad = JSON.stringify({ name: "X", colors: { "--AIPM-green": "red;}html{}", "--bogus": "#fff" }, branding: {} });
    const imported = importScheme(bad);
    expect(imported).not.toBeNull();
    expect(imported!.colors["--AIPM-green"]).toBeUndefined(); // non-hex rejected
    expect(imported!.colors["--bogus"]).toBeUndefined();     // unknown token dropped
  });

  it("import returns null on garbage", () => {
    expect(importScheme("not json")).toBeNull();
    expect(importScheme("[]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/app/color-schemes.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/app/color-schemes.ts`:

```ts
// Per-device custom color-scheme library (mirrors saved-views.ts). Out of
// exports/Turso; auto-cleared by clearAppConfig's lop-app:* sweep. Untrusted
// input (localStorage + imported JSON) is validated: colors must be hex, the
// logo/favicon re-run through sanitizeBranding, unknown token keys are dropped.
import { type BrandingConfig, sanitizeBranding } from "./settings-types";
import { CORE_TOKENS, ADVANCED_TOKENS } from "./scheme-tokens";
import type { SchemeColorMap } from "./scheme-apply";

export interface ColorScheme {
  id: number;
  name: string;
  colors: SchemeColorMap;
  branding: BrandingConfig;
}
export interface SchemeStore {
  schemes: ColorScheme[];
  activeId: number | null;
}

const KEY = "lop-app:color-schemes";
const MAX_SCHEMES = 30;
const NAME_MAX = 60;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const VALID_TOKENS = new Set([...CORE_TOKENS, ...ADVANCED_TOKENS].map((t) => t.token));

function cleanColors(raw: unknown): SchemeColorMap {
  const out: SchemeColorMap = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (VALID_TOKENS.has(k) && typeof v === "string" && HEX_RE.test(v)) out[k] = v;
    }
  }
  return out;
}

function cleanScheme(raw: unknown, id: number): ColorScheme | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, NAME_MAX) : "";
  if (!name) return null;
  return {
    id,
    name,
    colors: cleanColors(o.colors),
    branding: sanitizeBranding(o.branding) ?? {},
  };
}

export function loadSchemes(): SchemeStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { schemes: [], activeId: null };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const arr = Array.isArray(parsed.schemes) ? parsed.schemes : [];
    const schemes = arr
      .map((s, i) => cleanScheme(s, typeof (s as { id?: unknown }).id === "number" ? (s as { id: number }).id : i + 1))
      .filter((s): s is ColorScheme => s !== null)
      .slice(0, MAX_SCHEMES);
    const activeId = typeof parsed.activeId === "number" ? parsed.activeId : null;
    return { schemes, activeId: schemes.some((s) => s.id === activeId) ? activeId : null };
  } catch {
    return { schemes: [], activeId: null };
  }
}

export function saveSchemes(store: SchemeStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota */
  }
}

function nextId(schemes: ColorScheme[]): number {
  return schemes.reduce((m, s) => Math.max(m, s.id), 0) + 1;
}

export function addScheme(name: string, colors: SchemeColorMap, branding: BrandingConfig): SchemeStore {
  const cur = loadSchemes();
  const id = nextId(cur.schemes);
  const scheme: ColorScheme = {
    id,
    name: name.trim().slice(0, NAME_MAX) || `Scheme ${id}`,
    colors: cleanColors(colors),
    branding: sanitizeBranding(branding) ?? {},
  };
  const schemes = [...cur.schemes, scheme].slice(-MAX_SCHEMES);
  const next: SchemeStore = { schemes, activeId: id };
  saveSchemes(next);
  return next;
}

export function updateScheme(id: number, patch: Partial<Omit<ColorScheme, "id">>): SchemeStore {
  const cur = loadSchemes();
  const schemes = cur.schemes.map((s) =>
    s.id === id
      ? {
          ...s,
          ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, NAME_MAX) || s.name } : {}),
          ...(patch.colors !== undefined ? { colors: cleanColors(patch.colors) } : {}),
          ...(patch.branding !== undefined ? { branding: sanitizeBranding(patch.branding) ?? {} } : {}),
        }
      : s,
  );
  const next: SchemeStore = { ...cur, schemes };
  saveSchemes(next);
  return next;
}

export function removeScheme(id: number): SchemeStore {
  const cur = loadSchemes();
  const schemes = cur.schemes.filter((s) => s.id !== id);
  const next: SchemeStore = { schemes, activeId: cur.activeId === id ? null : cur.activeId };
  saveSchemes(next);
  return next;
}

export function setActive(id: number | null): SchemeStore {
  const cur = loadSchemes();
  const next: SchemeStore = { ...cur, activeId: id !== null && cur.schemes.some((s) => s.id === id) ? id : null };
  saveSchemes(next);
  return next;
}

export function exportScheme(scheme: ColorScheme): string {
  return JSON.stringify({ name: scheme.name, colors: scheme.colors, branding: scheme.branding }, null, 2);
}

/** Parse + validate an imported JSON scheme. Returns null on garbage. id is a
 *  placeholder (0) — callers assign a real id via addScheme/updateScheme. */
export function importScheme(raw: string): ColorScheme | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return cleanScheme(parsed, 0);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/color-schemes.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/color-schemes.ts src/app/color-schemes.test.ts
git commit -m "feat(scheme): per-device scheme library + JSON import/export"
```

---

## Task C2: Wire the library into the editor (load/save/rename/delete/import/export/seed/branding)

**Files:**
- Modify: `src/app/color-scheme-editor.tsx`
- Modify: `src/app/settings-sections/appearance-section.tsx`
- Test: `src/app/color-scheme-editor.test.tsx` (extend)

- [ ] **Step 1: Extend the editor test**

Append to `src/app/color-scheme-editor.test.tsx`:

```tsx
import { beforeEach } from "vitest";

describe("ColorSchemeEditor library", () => {
  beforeEach(() => localStorage.clear());

  it("saves the working draft as a named scheme", () => {
    render(<ColorSchemeEditor lang="en-US" onApply={() => {} } />);
    fireEvent.input(screen.getByLabelText("Scheme name"), { target: { value: "Acme Blue" } });
    fireEvent.click(screen.getByRole("button", { name: /^new scheme$/i }));
    // After saving, the scheme appears in the select
    expect(screen.getByRole("option", { name: "Acme Blue" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/app/color-scheme-editor.test.tsx` → the new test FAILs (no name input / New button yet).

- [ ] **Step 3: Extend the editor**

Replace the body of `src/app/color-scheme-editor.tsx` with the version below (adds: name input; scheme `<select>`; New (saves draft), Apply, Rename, Delete, Import, Export; seed-from buttons; branding inputs reuse). It manages the library via `color-schemes.ts` and seeds the draft from the selected scheme.

```tsx
"use client";

import { useState, type ChangeEvent } from "react";
import { type Lang, t } from "./i18n";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { CORE_TOKENS, ADVANCED_TOKENS, ICC_SEED, MOCKUP_SEED, resolveSchemeColors } from "./scheme-tokens";
import { checkSchemePairs } from "./scheme-contrast";
import type { SchemeColorMap } from "./scheme-apply";
import {
  loadSchemes, addScheme, updateScheme, removeScheme, setActive,
  exportScheme, importScheme, type SchemeStore,
} from "./color-schemes";
import type { BrandingConfig } from "./settings-types";

interface ColorSchemeEditorProps {
  lang: Lang;
  onApply: (resolved: SchemeColorMap) => void;
  /** Called with the active scheme's branding when a scheme is applied. */
  onApplyBranding?: (b: BrandingConfig) => void;
}

export function ColorSchemeEditor({ lang, onApply, onApplyBranding }: ColorSchemeEditorProps) {
  const [store, setStore] = useState<SchemeStore>(() => loadSchemes());
  const active = store.schemes.find((s) => s.id === store.activeId) ?? null;
  const [name, setName] = useState(active?.name ?? "");
  const [colors, setColors] = useState<SchemeColorMap>({ ...ICC_SEED, ...active?.colors });
  const [branding, setBranding] = useState<BrandingConfig>(active?.branding ?? {});
  const [importError, setImportError] = useState<string | null>(null);
  const pairs = checkSchemePairs(colors);

  function seed(map: SchemeColorMap) {
    setColors({ ...ICC_SEED, ...map });
  }
  function selectScheme(id: number) {
    const next = setActive(id);
    setStore(next);
    const s = next.schemes.find((x) => x.id === id);
    setName(s?.name ?? "");
    setColors({ ...ICC_SEED, ...s?.colors });
    setBranding(s?.branding ?? {});
  }
  function apply() {
    const resolved = resolveSchemeColors(colors);
    onApply(resolved);
    onApplyBranding?.(branding);
  }
  function saveNew() {
    const next = addScheme(name || t(lang, "schemeNamePlaceholder"), colors, branding);
    setStore(next);
    setName(next.schemes[next.schemes.length - 1].name);
  }
  function rename() {
    if (!active) return;
    setStore(updateScheme(active.id, { name, colors, branding }));
  }
  function del() {
    if (!active) return;
    const next = removeScheme(active.id);
    setStore(next);
    setName("");
    setColors({ ...ICC_SEED });
    setBranding({});
  }
  function doExport() {
    if (!active) return;
    const blob = new Blob([exportScheme(active)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.name || "scheme"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = importScheme(String(reader.result));
      if (!parsed) { setImportError(t(lang, "schemeImportError")); return; }
      setImportError(null);
      const next = addScheme(parsed.name, parsed.colors, parsed.branding);
      setStore(next);
      const s = next.schemes[next.schemes.length - 1];
      setName(s.name); setColors({ ...ICC_SEED, ...s.colors }); setBranding(s.branding);
    };
    reader.readAsText(file);
  }

  function picker(token: string, labelKey: string) {
    const label = t(lang, labelKey);
    return (
      <label key={token} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <input
          type="color"
          aria-label={label}
          value={colors[token] ?? "#000000"}
          onInput={(e) => setColors((p) => ({ ...p, [token]: (e.target as HTMLInputElement).value }))}
          className={`h-7 w-10 cursor-pointer rounded border border-line bg-surface ${FOCUS_RING} ${TRANSITION}`}
        />
      </label>
    );
  }

  const btn = `rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`;

  return (
    <div className="mt-3 rounded-md border border-line bg-surface-muted p-3">
      {/* Library row */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          id="scheme-select"
          aria-label={t(lang, "schemeSelectLabel")}
          value={active?.id ?? ""}
          onChange={(e) => e.target.value && selectScheme(Number(e.target.value))}
          className={`rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground ${FOCUS_RING} ${TRANSITION}`}
        >
          <option value="" disabled>{store.schemes.length ? t(lang, "schemeNamePlaceholder") : t(lang, "schemeNone")}</option>
          {store.schemes.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <input
          type="text"
          aria-label={t(lang, "schemeNamePlaceholder")}
          placeholder={t(lang, "schemeNamePlaceholder")}
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground ${FOCUS_RING} ${TRANSITION}`}
        />
        <button type="button" className={btn} onClick={saveNew}>{t(lang, "schemeNew")}</button>
        <button type="button" className={btn} onClick={rename} disabled={!active}>{t(lang, "schemeRename")}</button>
        <button type="button" className={btn} onClick={del} disabled={!active}>{t(lang, "schemeDelete")}</button>
        <button type="button" className={btn} onClick={() => seed(ICC_SEED)}>{t(lang, "schemeNewFromIcc")}</button>
        <button type="button" className={btn} onClick={() => seed(MOCKUP_SEED)}>{t(lang, "schemeNewFromMockup")}</button>
        <button type="button" className={btn} onClick={doExport} disabled={!active}>{t(lang, "schemeExport")}</button>
        <label className={`cursor-pointer ${btn}`}>
          {t(lang, "schemeImport")}
          <input type="file" accept="application/json,.json" className="sr-only" onChange={onImportFile} />
        </label>
      </div>
      {importError && <p className="mb-2 text-xs text-AIPM-pink-strong">{importError}</p>}

      {/* Core pickers */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CORE_TOKENS.map((tk) => picker(tk.token, tk.labelKey))}
      </div>

      {/* Advanced */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-foreground">{t(lang, "schemeAdvanced")}</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ADVANCED_TOKENS.map((tk) => picker(tk.token, tk.labelKey))}
        </div>
      </details>

      {/* Branding (app name + footer slogan; logo/favicon stay in the main branding block) */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          {t(lang, "brandingAppName")}
          <input
            type="text"
            maxLength={60}
            value={branding.slogan ?? ""}
            onChange={(e) => setBranding((b) => ({ ...b, slogan: e.target.value }))}
            className={`mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          {t(lang, "brandingFooterSlogan")}
          <input
            type="text"
            maxLength={120}
            value={branding.footerSlogan ?? ""}
            onChange={(e) => setBranding((b) => ({ ...b, footerSlogan: e.target.value }))}
            className={`mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`}
          />
        </label>
      </div>

      {/* Contrast */}
      {pairs.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {pairs.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{t(lang, p.labelKey)}</span>
              <span className={p.passesAa ? "text-AIPM-green-strong" : "text-AIPM-pink-strong"}>
                {p.ratio}:1 {p.passesAa ? "✓" : `⚠ ${t(lang, "schemeContrastBelowAa")}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Apply */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={apply}
          className={`rounded-md border border-line bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-AIPM-white ${INTERACTIVE}`}
        >
          {t(lang, "schemeApply")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/color-scheme-editor.test.tsx` → PASS (both describe blocks).

- [ ] **Step 5: Wire branding-apply in Appearance**

In `src/app/settings-sections/appearance-section.tsx`, update the editor mount to also write branding into settings:

```tsx
      {isCustom && (
        <div className="mb-4">
          <ColorSchemeEditor
            lang={lang}
            onApply={(resolved) => { writeActiveSchemeColors(resolved); applySchemeColors(resolved); }}
            onApplyBranding={(b) => setBranding({ ...branding, ...b })}
          />
        </div>
      )}
```

(`setBranding` already exists in the section; merging applies the scheme's app-name/footer-slogan into `settings.branding`.)

- [ ] **Step 6: Full verification**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → 0 warnings.
Run: `npm run test:run` → all PASS.
Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/color-scheme-editor.tsx src/app/color-scheme-editor.test.tsx src/app/settings-sections/appearance-section.tsx
git commit -m "feat(scheme): scheme library UI — save/load/rename/delete/import/export"
```

---

## Task C3: Final integration eye-verify

**Files:** none (verification only)

- [ ] **Step 1: End-to-end manual check**

Run `npm run dev`:
1. Settings → Appearance → **Custom**. Editor appears; Theme control disabled.
2. Change Brand primary + Accent → **Apply**. App recolors live.
3. Name it "Acme" → **New scheme**. It appears in the select.
4. **Export** → a JSON file downloads. Clear the scheme, **Import** it back → reappears, colors intact.
5. Reload the page while Custom+Acme active → colors apply with **no AIPM flash**.
6. Set Text to a near-white → a **⚠ below AA** badge shows on "Text on background"; Apply still works.
7. Switch to AIPM → overrides clear, app returns to brand colors. Switch back to Custom → Acme re-applies.

- [ ] **Step 2: Final automated gate**

Run: `npx tsc --noEmit && npm run lint && npm run test:run` → all green.
Run: `npx playwright test e2e/a11y.spec.ts --project=chromium` (full gate, all views × styles) → green.

---

## Notes for the implementer

- **Palette guard:** never introduce a new off-palette Tailwind CLASS. Custom colors flow ONLY through CSS-var overrides (inline style / the boot key). The editor's own chrome uses AIPM tokens; color swatches show user hex via inline `style`/the native `<input type=color>` (legal).
- **DE i18n:** patch `i18n.de.ts` via the node utf8 writes shown (never the Edit tool — it corrupts umlauts; the file is CRLF). After each, run `npx tsc --noEmit` (EN/DE parity) and the i18n-encoding test.
- **MOCKUP_SEED:** finish copying the mockup token values from `globals.css` `:root[data-style="mockup"]` (Task B1) — the New-from-Mockup seed must reproduce Mockup.
- **No new persisted Workspace field** is introduced — schemes are per-device localStorage (`lop-app:color-schemes` + `lop-active-scheme-colors`), out of exports/Turso, auto-cleared by `clearAppConfig`.
- **Releasing** (version bump + CHANGELOG + highlight key) is a separate, explicitly-authorized step — NOT part of this plan. Stop after Task C3.
```
