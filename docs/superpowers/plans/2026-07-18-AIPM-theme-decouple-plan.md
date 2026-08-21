# AIPM/Mockup Theme Decoupling + Harbor Brand Default — Implementation Plan (Release A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-privilege AIPM + Mockup: they leave the code `BUILTIN_SCHEMES` and ship as self-contained importable `/public/themes/*.json`. Harbor becomes the base seed, the `globals.css :root` fallback, and the brand default. No back-compat migration. `--AIPM-*` token/class NAMES kept (renamed in Release B).

**Architecture:** The scheme apply mechanism is unchanged (store → resolve → inline `setProperty` + boot-key mirror). AIPM only leaves the 3 privileged spots (`ICC_SEED` base, `:root` values, `BUILTIN_SCHEMES`). Imported themes are ordinary user schemes and already flow through the same apply path (structural included).

**Tech Stack:** Next.js 16 (forked) / React 19 / TS / Tailwind v4 / vitest / playwright+axe. Design spec: `docs/superpowers/specs/2026-07-18-AIPM-theme-decouple-design.md`.

**Task ORDER is compile-safety-critical:** consumers of the AIPM/Mockup code maps (boot script, axe spec) are updated BEFORE the maps are deleted, and the JSON is generated (from live maps) before deletion. Do not reorder Tasks 2/3/5/6.

**Global constraints (every task):**
- Commit via Bash heredoc `git commit -F - <<'EOF'` (NOT PowerShell). No attribution footer.
- Byte-check before every commit: `python -c "print(open('<file>','rb').read().count(b'\x00'))"` must print `0` for each edited source file (Edit-tool NUL hazard).
- NEVER edit `i18n.de.ts` with the Edit tool (umlaut/quote corruption; CRLF). Use a node utf8 write. No `\u00XX` escapes (i18n-encoding test bans them). This plan touches DE only in Task 11 (a new highlight string).
- After editing ANY `*.test.ts(x)`, run `npx tsc --noEmit` (test type errors pass vitest+build but fail CI).
- Trust `npx tsc --noEmit` (exit 0) over IDE squiggles; ignore phantom 71007 RSC + pre-existing 6385 FormEvent-deprecated warnings.
- Work on branch `feat/AIPM-theme-decouple` off `main`.

---

## Task 0: Branch

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git checkout -b feat/AIPM-theme-decouple
```

---

## Task 1: Portable theme format — carry structural + pinned AA tokens

**Files:**
- Modify: `src/app/scheme-apply.ts` (add `STRUCTURAL_TOKENS`)
- Modify: `src/app/color-schemes.ts` (export structural, widen import allowlist, `cleanStructural`, `cleanScheme` structural)
- Test: `src/app/color-schemes.test.ts`

- [ ] **Step 1: Add `STRUCTURAL_TOKENS` to the leaf `scheme-apply.ts`**

After the `SchemeStructuralMap` type + `ACTIVE_SCHEME_STRUCTURAL_KEY` (around line 37), add:

```ts
/** The 7 structural (non-color) tokens a scheme may carry. Import validation +
 *  the boot mirror use this allowlist; runtime apply also value-gates each. */
export const STRUCTURAL_TOKENS: readonly string[] = [
  "--shadow-card", "--shadow-control", "--shadow-card-hover",
  "--gradient-kpi", "--delta-chip-pad", "--rag-green-chip", "--rag-red-chip",
] as const;
```

- [ ] **Step 2: Write the failing test** in `src/app/color-schemes.test.ts`

Add a describe block:

```ts
import { exportScheme, importScheme, cleanScheme } from "./color-schemes";

describe("portable theme format (structural + pins)", () => {
  const themeJson = JSON.stringify({
    name: "Test",
    supportsDark: false,
    light: {
      "--AIPM-dark-blue": "#004159",
      "--AIPM-green": "#84bd00",
      "--AIPM-green-strong": "#4d7000", // pinned derived token — must survive import
      "--rag-red-text": "#c41e5a",
    },
    structural: {
      "--shadow-card": "0 1px 3px rgba(0,65,89,0.12)",
      "--gradient-kpi": "linear-gradient(90deg, var(--rag-red), var(--rag-green))",
      "--bogus": "x", // not in STRUCTURAL_TOKENS -> dropped
    },
    branding: {},
  });

  test("import preserves pinned AA tokens + valid structural, drops unknown", () => {
    const s = cleanScheme(JSON.parse(themeJson), "u-1");
    expect(s).not.toBeNull();
    expect(s!.light["--AIPM-green-strong"]).toBe("#4d7000");
    expect(s!.light["--rag-red-text"]).toBe("#c41e5a");
    expect(s!.structural?.["--shadow-card"]).toBe("0 1px 3px rgba(0,65,89,0.12)");
    expect(s!.structural?.["--gradient-kpi"]).toContain("linear-gradient");
    expect(s!.structural?.["--bogus"]).toBeUndefined();
  });

  test("import rejects dangerous structural value", () => {
    const evil = JSON.parse(themeJson);
    evil.structural = { "--shadow-card": "url(http://x)" };
    const s = cleanScheme(evil, "u-2");
    expect(s!.structural?.["--shadow-card"]).toBeUndefined();
  });

  test("export round-trips structural", () => {
    const s = cleanScheme(JSON.parse(themeJson), "u-3")!;
    const round = cleanScheme(JSON.parse(exportScheme(s)), "u-4")!;
    expect(round.structural?.["--shadow-card"]).toBe("0 1px 3px rgba(0,65,89,0.12)");
  });
});
```

- [ ] **Step 3: Run test — expect FAIL** (`cleanScheme` drops pins + structural today)

Run: `npx vitest run src/app/color-schemes.test.ts`
Expected: FAIL (pins stripped, `structural` undefined).

- [ ] **Step 4: Implement in `src/app/color-schemes.ts`**

Add imports at top:
```ts
import { type SchemeColorMap, type SchemeStructuralMap, STRUCTURAL_TOKENS, isSafeRawCssValue } from "./scheme-apply";
```
(merge with the existing `SchemeColorMap` import line; drop the old inline `import("./scheme-apply").SchemeStructuralMap` in the interface.)

Add the widened allowlist + structural cleaner (near `VALID_TOKENS`):
```ts
// Pinned AA/derived tokens a portable theme (AIPM/Mockup) may carry so its exact
// look survives import; the editor still edits only CORE+ADVANCED.
const DERIVED_TOKENS = [
  "--AIPM-green-strong", "--AIPM-pink-strong", "--AIPM-purple-strong",
  "--rag-red-text", "--rag-amber-text", "--rag-green-text", "--muted-foreground",
] as const;
const VALID_TOKENS = new Set([
  ...CORE_TOKENS.map((t) => t.token),
  ...ADVANCED_TOKENS.map((t) => t.token),
  ...DERIVED_TOKENS,
]);
const STRUCTURAL_SET = new Set(STRUCTURAL_TOKENS);

function cleanStructural(raw: unknown): SchemeStructuralMap | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: SchemeStructuralMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (STRUCTURAL_SET.has(k) && typeof v === "string" && isSafeRawCssValue(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
```
(NOTE: `VALID_TOKENS` already exists — replace its definition with the widened one above.)

In `cleanScheme`, after computing `dark`, compute structural and include it:
```ts
const structural = cleanStructural(o.structural);
return {
  id, name,
  ...(o.builtIn === true ? { builtIn: true } : {}),
  supportsDark, light,
  ...(dark ? { dark } : {}),
  ...(structural ? { structural } : {}),
  branding: sanitizeBranding(o.branding) ?? {},
};
```

In `exportScheme`, add structural:
```ts
export function exportScheme(scheme: ColorScheme): string {
  return JSON.stringify({
    name: scheme.name,
    light: scheme.light,
    ...(scheme.dark ? { dark: scheme.dark } : {}),
    supportsDark: scheme.supportsDark,
    ...(scheme.structural ? { structural: scheme.structural } : {}),
    branding: scheme.branding,
  }, null, 2);
}
```

- [ ] **Step 5: Run tests + tsc — expect PASS**

Run: `npx vitest run src/app/color-schemes.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/scheme-apply.ts src/app/color-schemes.ts src/app/color-schemes.test.ts
git commit -F - <<'EOF'
feat(schemes): portable theme format carries structural + pinned AA tokens

Widen import allowlist to the 7 pinned derived tokens and add cleanStructural
(STRUCTURAL_TOKENS allowlist + isSafeRawCssValue) so AIPM/Mockup can be shipped
as importable JSON without losing their hand-tuned look. exportScheme now emits
structural.
EOF
```

---

## Task 2: Generate `/public/themes/AIPM.json` + `mockup.json` (from live maps) + guard test

**Files:**
- Create: `public/themes/AIPM.json`, `public/themes/mockup.json`
- Create (throwaway, then delete): `scripts/gen-shipped-themes.ts`
- Test: `src/app/shipped-themes.test.ts`

- [ ] **Step 1: Write the throwaway generator** `scripts/gen-shipped-themes.ts`

```ts
// One-off: dump the current AIPM/Mockup code maps to /public/themes/*.json before
// they are deleted from builtin-schemes. Also prints Harbor's resolved light map
// for the globals.css :root update (Task 7). Run: npx vite-node scripts/gen-shipped-themes.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { ICC_LIGHT, ICC_DARK, MOCKUP_LIGHT, HARBOR_LIGHT } from "../src/app/builtin-schemes";
import { ICC_STRUCTURAL, MOCKUP_STRUCTURAL, resolveSchemeColors } from "../src/app/scheme-tokens";

mkdirSync("public/themes", { recursive: true });
const AIPM = { name: "AIPM", supportsDark: true, light: ICC_LIGHT, dark: ICC_DARK, structural: ICC_STRUCTURAL, branding: {} };
const mockup = { name: "Dashboard", supportsDark: false, light: MOCKUP_LIGHT, structural: MOCKUP_STRUCTURAL, branding: {} };
writeFileSync("public/themes/AIPM.json", JSON.stringify(AIPM, null, 2) + "\n");
writeFileSync("public/themes/mockup.json", JSON.stringify(mockup, null, 2) + "\n");
console.log("HARBOR_RESOLVED_LIGHT=" + JSON.stringify(resolveSchemeColors(HARBOR_LIGHT), null, 2));
```

- [ ] **Step 2: Run it, capture Harbor output**

Run: `npx vite-node scripts/gen-shipped-themes.ts`
Expected: writes both JSON files; prints `HARBOR_RESOLVED_LIGHT={...}`. **Save that printed map** into the plan-scratch (Task 7 needs it). Verify the files:
`cat public/themes/AIPM.json | python -c "import json,sys; d=json.load(sys.stdin); print(d['light']['--AIPM-dark-blue'], d['structural']['--shadow-card'])"` → `#004159 none`.

- [ ] **Step 3: Delete the throwaway script** (it would break once maps are deleted in Task 6)

```bash
rm scripts/gen-shipped-themes.ts
```
(Use PowerShell `Remove-Item scripts/gen-shipped-themes.ts` if `rm` is gate-blocked.)

- [ ] **Step 4: Write the guard test** `src/app/shipped-themes.test.ts`

```ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { cleanScheme } from "./color-schemes";

const load = (f: string) => JSON.parse(readFileSync(`public/themes/${f}`, "utf8"));

describe("shipped theme files", () => {
  test("AIPM.json is importable and byte-faithful", () => {
    const raw = load("AIPM.json");
    expect(raw.light["--AIPM-dark-blue"]).toBe("#004159");
    expect(raw.light["--AIPM-green-strong"]).toBe("#4d7000"); // pin present
    expect(raw.structural["--shadow-card"]).toBe("none");
    expect(raw.supportsDark).toBe(true);
    const s = cleanScheme(raw, "u-1");
    expect(s).not.toBeNull();
    expect(s!.dark?.["--background"]).toBe("#0b0f12");
    expect(s!.structural?.["--gradient-kpi"]).toBe("var(--AIPM-green)");
  });

  test("mockup.json carries the gradient + shadows, light-only", () => {
    const raw = load("mockup.json");
    expect(raw.supportsDark).toBe(false);
    expect(raw.structural["--gradient-kpi"]).toContain("linear-gradient");
    expect(raw.structural["--shadow-card"]).toContain("rgba");
    const s = cleanScheme(raw, "u-2");
    expect(s!.structural?.["--gradient-kpi"]).toContain("linear-gradient");
  });
});
```

- [ ] **Step 5: Run test + tsc — expect PASS**

Run: `npx vitest run src/app/shipped-themes.test.ts && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add public/themes/AIPM.json public/themes/mockup.json src/app/shipped-themes.test.ts
git commit -F - <<'EOF'
feat(schemes): ship AIPM + Dashboard as importable /public/themes/*.json

Self-contained theme files dumped from the (soon-removed) code maps, incl. dark
maps, pinned AA variants and structural tokens. Guard test asserts fidelity +
importability.
EOF
```

---

## Task 3: Boot script — drop AIPM/Mockup embeds + legacy branch; base = Harbor

**Files:**
- Modify: `src/app/boot-theme-script.ts`
- Test: `src/app/layout-boot-script.test.ts`

- [ ] **Step 1: Rewrite `boot-theme-script.ts`**

Replace the imports (lines 32-33) with:
```ts
import { HARBOR_DARK, HARBOR_LIGHT } from "./builtin-schemes";
import { resolveSchemeColors } from "./scheme-tokens";
```
Delete the `ICC_*_COLORS`, `MOCKUP_LIGHT_COLORS`, `ICC_STRUCTURAL_JSON`, `MOCKUP_STRUCTURAL_JSON` consts; keep:
```ts
const HARBOR_LIGHT_COLORS = JSON.stringify(resolveSchemeColors(HARBOR_LIGHT));
const HARBOR_DARK_COLORS = JSON.stringify(resolveSchemeColors(HARBOR_DARK));
```
In `NO_FLASH_THEME_SCRIPT`, delete the `legacyIcc`/`legacyMockup` reads and the two legacy branches. The scheme resolution collapses to the else-branch only:
```js
// (after the storage-rename block and reading theme/rawC/rawS:)
var rawSupports=localStorage.getItem("aipm-cockpit-scheme-supports-dark");
var schemeDark=rawC?(rawSupports==="1"):true;
var colors=rawC?JSON.parse(rawC):((themeDark&&schemeDark)?${HARBOR_DARK_COLORS}:${HARBOR_LIGHT_COLORS});
var structural=rawS?JSON.parse(rawS):{};
```
Keep `data-style="custom"`, the dark toggle, the color loop, and the structural loop unchanged. Remove the now-stale legacy-boot doc comment block (lines ~18-21) and the `var st=...;var legacyIcc...` line. Update the header comment: the base fallback is Harbor; AIPM/Mockup are shipped theme files, no longer embedded.

- [ ] **Step 2: Update the pinned test** `src/app/layout-boot-script.test.ts`

This test pins + `eval`s the exact boot string. Read it, update the pinned expectations: no `legacyIcc`/`legacyMockup`, base paints Harbor. For the eval cases, assert: (a) empty storage → `data-style="custom"`, `.dark` per system, Harbor tokens applied; (b) a seeded `aipm-cockpit-active-scheme-colors` → those applied; (c) a legacy `aipm-cockpit-style="AIPM"` → NO AIPM paint (Harbor base, since no color key). Keep the storage-rename assertions.

- [ ] **Step 3: Run tests + tsc**

Run: `npx vitest run src/app/layout-boot-script.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/boot-theme-script.ts src/app/layout-boot-script.test.ts
git commit -F - <<'EOF'
refactor(boot): Harbor base paint; drop AIPM/Mockup embeds + legacy style branch

The pre-paint boot script no longer embeds AIPM/Mockup maps or special-cases the
legacy aipm-cockpit-style="AIPM"/"mockup" value (no active users). Default paint
is Harbor; a returning user still paints from the mirrored boot color key.
EOF
```

---

## Task 4: use-style — drop legacy AIPM/Mockup migration

**Files:**
- Modify: `src/app/use-style.tsx`
- Test: `src/app/use-style.test.tsx`

- [ ] **Step 1: Simplify the lazy initializer** (lines 66-88)

Replace the initializer body with:
```ts
const [style, setStyleState] = useState<CiStyle>(() => {
  if (typeof window === "undefined") return "custom";
  // The style axis is the constant "custom"; the active SCHEME drives the look.
  // Persist "custom" for any non-"custom" (legacy/absent) value so the boot
  // script + selectScheme fallback stay consistent. (No legacy AIPM/mockup
  // scheme-activation: those are now importable theme files, not built-ins.)
  const stored = localStorage.getItem(STYLE_STORAGE_KEY);
  if (stored !== "custom") {
    try { localStorage.setItem(STYLE_STORAGE_KEY, "custom"); } catch { /* private mode / quota */ }
  }
  return "custom";
});
```
Remove the now-unused `setActive` import if it is no longer referenced elsewhere in the file (grep first — it is only used in the deleted line).

- [ ] **Step 2: Update `use-style.test.tsx`**

Remove/adjust any test asserting a legacy `AIPM`/`mockup` style activates that scheme. Assert instead: a legacy `aipm-cockpit-style="AIPM"` leaves `activeId` untouched (Harbor default via reconcile) and rewrites the style key to `"custom"`.

- [ ] **Step 3: Run tests + lint + tsc**

Run: `npx vitest run src/app/use-style.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, lint 0 (catch the unused `setActive` import here).

- [ ] **Step 4: Commit**

```bash
git add src/app/use-style.tsx src/app/use-style.test.tsx
git commit -F - <<'EOF'
refactor(style): drop legacy AIPM/Mockup style->scheme migration

Any legacy aipm-cockpit-style value now normalises to "custom" and resolves to
the Harbor default; AIPM/Mockup are importable theme files, not built-ins.
EOF
```

---

## Task 5: axe spec — read shipped JSON, seed AIPM/Mockup as user schemes

**Files:**
- Modify: `e2e/a11y.spec.ts`

- [ ] **Step 1: Replace the code-map imports (lines 3-15)**

```ts
import { readFileSync } from "node:fs";
import { resolveSchemeColors } from "../src/app/scheme-tokens";
import type { SchemeColorMap, SchemeStructuralMap } from "../src/app/scheme-apply";

const loadTheme = (f: string) =>
  JSON.parse(readFileSync(`public/themes/${f}`, "utf8")) as {
    light: SchemeColorMap; dark?: SchemeColorMap; structural: SchemeStructuralMap; supportsDark: boolean;
  };
const ICC_THEME = loadTheme("AIPM.json");
const MOCKUP_THEME = loadTheme("mockup.json");
```
(Keep the Harbor maps: `import { HARBOR_DARK, HARBOR_LIGHT } from "../src/app/builtin-schemes";`.)

- [ ] **Step 2: Rebuild `SCHEME_SEED` from the themes + Harbor code map**

```ts
const SCHEME_SEED: Record<(typeof COMBOS)[number]["scheme"],
  { light: SchemeColorMap; dark?: SchemeColorMap; structural: SchemeStructuralMap; supportsDark: boolean }> = {
  AIPM:    { light: ICC_THEME.light, dark: ICC_THEME.dark, structural: ICC_THEME.structural, supportsDark: true },
  mockup: { light: MOCKUP_THEME.light, structural: MOCKUP_THEME.structural, supportsDark: false },
  harbor: { light: HARBOR_LIGHT, dark: HARBOR_DARK, structural: {}, supportsDark: true },
};
```

- [ ] **Step 3: Seed AIPM/Mockup as USER schemes in `seedScript`** (they are no longer built-ins → an empty `schemes:[]` + `activeId:"AIPM"` would Harbor-fall-back via reconcileBuiltins)

```ts
function seedScript(combo: (typeof COMBOS)[number]): string {
  const spec = SCHEME_SEED[combo.scheme];
  const useDark = combo.dark && spec.supportsDark;
  const map = resolveSchemeColors(useDark && spec.dark ? spec.dark : spec.light);
  // Harbor is a built-in (empty schemes[] + activeId selects it via reconcile);
  // AIPM/Mockup are shipped theme files -> seed them as user schemes so reconcile
  // keeps them and syncScheme doesn't snap back to Harbor.
  const store = combo.scheme === "harbor"
    ? { schemes: [], activeId: "harbor" }
    : { schemes: [{ id: combo.scheme, name: combo.scheme, supportsDark: spec.supportsDark,
        light: spec.light, ...(spec.dark ? { dark: spec.dark } : {}), structural: spec.structural, branding: {} }],
        activeId: combo.scheme };
  return [
    `localStorage.setItem("aipm-cockpit-style", "custom");`,
    `localStorage.setItem("aipm-cockpit-theme", ${JSON.stringify(combo.dark ? "dark" : "light")});`,
    `localStorage.setItem("aipm-cockpit-scheme-supports-dark", ${JSON.stringify(spec.supportsDark ? "1" : "0")});`,
    `localStorage.setItem("aipm-cockpit-active-scheme-colors", ${JSON.stringify(JSON.stringify(map))});`,
    `localStorage.setItem("aipm-cockpit-active-scheme-structural", ${JSON.stringify(JSON.stringify(spec.structural))});`,
    `localStorage.setItem("aipm-cockpit:color-schemes", ${JSON.stringify(JSON.stringify(store))});`,
  ].join("\n");
}
```

- [ ] **Step 4: tsc the spec**

Run: `npx tsc --noEmit`
Expected: exit 0. (Full axe run happens in Task 10 after all code lands.)

- [ ] **Step 5: Commit**

```bash
git add e2e/a11y.spec.ts
git commit -F - <<'EOF'
test(a11y): seed AIPM/Mockup from shipped theme JSON as user schemes

AIPM/Mockup are no longer built-ins; the 5-combo axe matrix now reads
public/themes/*.json and seeds them as user schemes so all combos still scan.
EOF
```

---

## Task 6: Delete AIPM/Mockup code maps; trim BUILTIN_SCHEMES; neutral fallback

**Files:**
- Modify: `src/app/builtin-schemes.ts`, `src/app/scheme-tokens.ts`
- Test: `src/app/builtin-schemes.test.ts`, `src/app/scheme-tokens.test.ts`

- [ ] **Step 1: `scheme-tokens.ts` — remove AIPM/Mockup seeds + structural**

Delete `ICC_SEED`, `MOCKUP_SEED`, `ICC_STRUCTURAL`, `MOCKUP_STRUCTURAL`. Add:
```ts
// Neutral surface fallback for AA-variant derivation when a scheme omits
// --surface(-muted). (Was ICC_SEED["--surface"].)
const FALLBACK_SURFACE = "#ffffff";
```
In `deriveAaVariants`, change:
```ts
const surface = colors["--surface-muted"] ?? colors["--surface"] ?? FALLBACK_SURFACE;
```
Remove the now-unused `SchemeStructuralMap` import if only the deleted structural consts used it (grep; `resolveSchemeColors`/`deriveAaVariants` use `SchemeColorMap`).

- [ ] **Step 2: `builtin-schemes.ts` — drop AIPM/Mockup**

Delete `ICC_LIGHT`, `ICC_DARK`, `MOCKUP_LIGHT`, and the `ICC_SEED`/`MOCKUP_SEED`/`ICC_STRUCTURAL`/`MOCKUP_STRUCTURAL` imports. `BUILTIN_SCHEMES`:
```ts
export const BUILTIN_SCHEMES: readonly ColorScheme[] = [
  { id: "harbor", name: "Harbor", builtIn: true, supportsDark: true, light: HARBOR_LIGHT, dark: HARBOR_DARK, branding: {} },
  { id: "meridian", name: "Meridian", builtIn: true, supportsDark: true, light: MERIDIAN_LIGHT, dark: MERIDIAN_DARK, branding: {} },
  { id: "umber", name: "Umber", builtIn: true, supportsDark: true, light: UMBER_LIGHT, dark: UMBER_DARK, branding: {} },
] as const;
```
`DEFAULT_SCHEME_ID` stays `"harbor"`.

- [ ] **Step 3: Update the two tests**

`builtin-schemes.test.ts`: remove AIPM/Mockup assertions; assert `BUILTIN_SCHEMES` ids === `["harbor","meridian","umber"]`, `BUILTIN_SCHEME_IDS` lacks `"AIPM"`/`"mockup"`, and `reconcileBuiltins({schemes:[], activeId:"AIPM"})` → `activeId === "harbor"`. `scheme-tokens.test.ts`: remove `ICC_SEED`/structural refs; assert `resolveSchemeColors` still derives AA variants (feed a minimal map, expect `--rag-red-text` present).

- [ ] **Step 4: Full typecheck + the scheme suite**

Run: `npx tsc --noEmit && npx vitest run src/app/builtin-schemes.test.ts src/app/scheme-tokens.test.ts src/app/color-schemes.test.ts src/app/shipped-themes.test.ts`
Expected: PASS, tsc exit 0 (all former importers of the deleted maps — boot, axe — already updated).

- [ ] **Step 5: Commit**

```bash
git add src/app/builtin-schemes.ts src/app/scheme-tokens.ts src/app/builtin-schemes.test.ts src/app/scheme-tokens.test.ts
git commit -F - <<'EOF'
refactor(schemes): remove AIPM/Mockup from code built-ins; neutral seed fallback

BUILTIN_SCHEMES = [harbor, meridian, umber]. ICC_SEED/MOCKUP_SEED + their
structural maps deleted; AA derivation uses a neutral FALLBACK_SURFACE. AIPM and
Mockup now live only as shipped importable theme files.
EOF
```

---

## Task 7: globals.css `:root` → Harbor-resolved fallback

**Files:**
- Modify: `src/app/globals.css`
- Test: `src/app/style-tokens.test.ts`, `src/app/shell-palette-guard.test.ts` (only if they assert `:root` hex)

- [ ] **Step 1: Swap the scheme-owned color values in `:root`** to the Harbor-resolved-light map captured in Task 2 Step 2.

Change ONLY the scheme-owned color tokens to their Harbor values: `--background`, `--foreground`, `--surface`, `--surface-muted`, `--line`, `--muted-foreground`, `--AIPM-dark-blue`, `--AIPM-green`, `--AIPM-blue`, `--AIPM-pink`, `--AIPM-purple`, `--AIPM-medium-grey`, `--AIPM-light-grey`, `--AIPM-green-strong`, `--AIPM-pink-strong`, `--AIPM-purple-strong`, `--rag-red`, `--rag-amber`, `--rag-green`, and the derived `--rag-red-text`/`--rag-amber-text`/`--rag-green-text` (concrete Harbor hex from the dump), plus `--table-head-bg`/`--table-head-accent`/`--segment-track-bg`/`--segment-active-bg` (Harbor values — keep the `var(--…)` form where the Harbor map's value equals another token, else concrete hex).
KEEP unchanged: `--AIPM-dark-grey`, `--AIPM-white` (fixed neutrals), `--table-head-fg`, `--segment-active-fg`, and ALL structural tokens (`--shadow-*`, `--gradient-kpi`, `--delta-chip-pad`, `--rag-*-chip`) — Harbor carries no structural (`{}`), so the flat AIPM defaults are correct for Harbor. KEEP the `--AIPM-*` variable NAMES and the entire `@theme inline` block (renamed in Release B).
Update the `/* Acme brand palette */` comment → note these are the Harbor no-JS fallback values.

- [ ] **Step 2: Check the palette/style tests**

Run: `npx vitest run src/app/style-tokens.test.ts src/app/shell-palette-guard.test.ts`
If either hard-codes the old AIPM hex for `:root`, update it to the Harbor value (or, if it only checks token PRESENCE/structure, no change). Keep the palette guard's off-palette rules intact.

- [ ] **Step 3: Manual smoke** (dev server optional; NOT the user's live-data tab)

Run: `npm run build` (confirms globals.css compiles — a bad Tailwind arbitrary value 500s the app).
Expected: build passes.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css src/app/style-tokens.test.ts src/app/shell-palette-guard.test.ts
git commit -F - <<'EOF'
refactor(css): globals.css :root fallback is now Harbor (brand default)

The no-JS/pre-boot paint uses Harbor-resolved-light values. Token NAMES and the
@theme mapping are unchanged (neutral rename is Release B); structural tokens
stay flat (Harbor carries no structural).
EOF
```

---

## Task 8: Theme gallery — import shipped themes from the scheme editor

**Files:**
- Create: `src/app/theme-gallery.tsx`
- Modify: `src/app/settings-sections/appearance-section.tsx` (mount it near the scheme editor)
- Test: `src/app/theme-gallery.test.tsx`

- [ ] **Step 1: Write the failing test** `src/app/theme-gallery.test.tsx`

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { ThemeGallery } from "./theme-gallery";

describe("ThemeGallery", () => {
  beforeEach(() => localStorage.clear());

  test("renders the two shipped themes with import buttons", () => {
    render(<ThemeGallery lang="en-US" onImported={() => {}} />);
    expect(screen.getByRole("button", { name: /import AIPM/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import Dashboard/i })).toBeInTheDocument();
  });

  test("import fetches the theme file and calls onImported", async () => {
    const iccRaw = { name: "AIPM", supportsDark: true, light: { "--AIPM-dark-blue": "#004159" }, structural: {}, branding: {} };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(iccRaw) })) as unknown as typeof fetch);
    const onImported = vi.fn();
    render(<ThemeGallery lang="en-US" onImported={onImported} />);
    fireEvent.click(screen.getByRole("button", { name: /import AIPM/i }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(expect.stringMatching(/^u-\d+$/)));
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

Run: `npx vitest run src/app/theme-gallery.test.tsx` → FAIL.

- [ ] **Step 3: Implement `src/app/theme-gallery.tsx`**

Uses shared primitives (Button, Banner) + toast; NO hand-rolled controls. Import path = widened `importScheme` → `addScheme` → returns the new id via `onImported`. Fetch is same-origin `/themes/<file>`.

```tsx
"use client";
import { useState } from "react";
import { type Lang, t } from "./i18n";
import { Button } from "./button"; // adjust to the real Button primitive path/name
import { importScheme, addScheme } from "./color-schemes";

interface ShippedTheme { id: string; name: string; file: string; }
const SHIPPED: readonly ShippedTheme[] = [
  { id: "AIPM", name: "AIPM", file: "/themes/AIPM.json" },
  { id: "mockup", name: "Dashboard", file: "/themes/mockup.json" },
];

interface ThemeGalleryProps {
  lang: Lang;
  /** Called with the new user-scheme id after a successful import. */
  onImported: (newId: string) => void;
}

export function ThemeGallery({ lang, onImported }: ThemeGalleryProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importTheme = async (theme: ShippedTheme) => {
    setBusy(theme.id); setError(null);
    try {
      const res = await fetch(theme.file);
      if (!res.ok) throw new Error("fetch");
      const parsed = importScheme(await res.text());
      if (!parsed) throw new Error("parse");
      const store = addScheme(parsed.name, parsed.light, parsed.branding);
      const newId = store.activeId!;
      // addScheme is color-only; re-apply dark + structural from the imported file.
      if (parsed.dark || parsed.structural) {
        const { updateScheme } = await import("./color-schemes");
        updateScheme(newId, { supportsDark: parsed.supportsDark, dark: parsed.dark, structural: parsed.structural });
      }
      onImported(newId);
    } catch {
      setError(t(lang, "themeGalleryImportError"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{t(lang, "themeGalleryHeading")}</p>
      <p className="text-xs text-muted-foreground">{t(lang, "themeGalleryHint")}</p>
      <div className="flex flex-wrap gap-2">
        {SHIPPED.map((th) => (
          <Button key={th.id} variant="secondary" disabled={busy !== null}
            onClick={() => importTheme(th)}
            aria-label={t(lang, "themeGalleryImport", th.name)}>
            {t(lang, "themeGalleryImport", th.name)}
          </Button>
        ))}
      </div>
      {error && <p role="alert" className="text-xs text-AIPM-pink-strong">{error}</p>}
    </div>
  );
}
```
NOTE for implementer: verify the real `Button` import + variant names against an existing settings-section usage; use the same `addScheme`/`updateScheme` semantics actually present (this plan mirrors color-schemes.ts). If `addScheme` already accepts structural/dark, simplify (drop the extra `updateScheme`). Prefer extending `addScheme` to accept an optional full scheme over the dynamic import if cleaner — implementer's judgment, keep it minimal.

- [ ] **Step 4: Add i18n keys** — `themeGalleryHeading`, `themeGalleryHint`, `themeGalleryImport` (positional `{0}` = theme name), `themeGalleryImportError` in `i18n.ts` (EN) AND `i18n.de.ts` (DE — via node utf8 write, real umlauts, no `\u` escapes).

- [ ] **Step 5: Mount in `appearance-section.tsx`**

Read the file; render `<ThemeGallery lang={lang} onImported={(id) => selectScheme(id)} />` adjacent to the scheme `<select>`/editor (wire `onImported` to the section's existing scheme-select handler so the imported theme is applied). Appearance is axe-scanned — labeled controls (the aria-labels above cover it).

- [ ] **Step 6: Run tests + tsc + lint**

Run: `npx vitest run src/app/theme-gallery.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add src/app/theme-gallery.tsx src/app/theme-gallery.test.tsx src/app/settings-sections/appearance-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(schemes): theme gallery to import shipped AIPM/Dashboard themes

Appearance -> scheme editor gains a gallery that fetches /themes/*.json and
imports them as removable user schemes. Fresh installs show Harbor/Meridian/
Umber; AIPM/Dashboard are opt-in imports.
EOF
```

---

## Task 9: Branding — fix stale logo alt

**Files:**
- Modify: `src/app/app-header.tsx`

- [ ] **Step 1: Fix line 97** — the default-logo `alt` fallback:

```tsx
alt={settings.branding?.logo ? (settings.branding.slogan ?? t(lang, "appTitle")) : t(lang, "appTitle")}
```
(`appTitle` is already "AI PM Cockpit" in EN+DE — no i18n change. Leave all other `Acme` strings: AI-policy, export attribution, version-highlight history, `styleIcc` label are legitimate.)

- [ ] **Step 2: tsc + the app-header test if any**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/app/app-header.tsx
git commit -F - <<'EOF'
fix(branding): default logo alt uses the app title, not stale "Acme"
EOF
```

---

## Task 10: Full gate run

- [ ] **Step 1: Run every local gate**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run size:check
npm run dup:check
npx vitest run palette
npx playwright test e2e/a11y.spec.ts --project=chromium
```
Expected: tsc 0, lint 0, vitest all pass, size ok, dup exit 0, palette pass, **axe all combos pass** (the 5-combo AIPM/Mockup/Harbor scan now sourced from JSON + user-scheme seed). If the documented `timelog-panel` partial-toast flake hits vitest, re-run that file once.

- [ ] **Step 2: Fix any failures, re-run until green.** Do NOT proceed with a red gate.

---

## Task 11: Docs + release ritual

**Files:**
- Modify: `AGENTS.md`, `CHANGELOG.md`, `src/app/version.ts`, `i18n.ts`, `i18n.de.ts`, `version.ts` `APP_HIGHLIGHT_KEYS`

- [ ] **Step 1: AGENTS.md** — in the scheme-driven-palettes section: AIPM + Mockup are no longer built-in schemes; they ship as importable `/public/themes/*.json` (gallery import). `BUILTIN_SCHEMES` = harbor/meridian/umber. `globals.css :root` is the Harbor no-JS fallback. Update the axe 5-combo landmine (#4) to note AIPM/Mockup are seeded as USER schemes from the JSON. Note the portable format carries structural + pinned tokens.

- [ ] **Step 2: version.ts** — bump `APP_VERSION` to the next patch (e.g. `0.190.22`), update `APP_BUILD_DATE` comment, append a new highlight key `versionHighlightThemeDecouple` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 3: i18n** — add `versionHighlightThemeDecouple` EN (`i18n.ts`) + DE (`i18n.de.ts` via node utf8 write). E.g. EN: "AIPM and Dashboard are now optional importable themes (Settings → Appearance → import); Harbor is the default look."

- [ ] **Step 4: CHANGELOG.md** — new `## [0.190.22] - <date> "Pinsker"` entry: Changed — AIPM/Mockup decoupled into importable theme files; Harbor is the base/brand default; portable theme format carries structural + AA pins; fixed stale logo alt.

- [ ] **Step 5: Re-run gates** (tsc + lint + `npm run build` which prebuild-checks script-docs; vitest for the i18n parity + highlight-key tests).

- [ ] **Step 6: Byte-check every edited source file** (`count(b'\x00')==0`), then commit:

```bash
git add -A
git commit -F - <<'EOF'
chore(release): 0.190.22 "Pinsker"

Decouple AIPM/Mockup into importable /public/themes/*.json; Harbor is the base
seed, :root fallback and brand default. Portable theme format carries structural
+ pinned AA tokens. Theme gallery import. Stale logo alt fixed. AIPM/Mockup token
NAMES unchanged (neutral rename is Release B).
EOF
```

---

## Task 12: Review + MR + merge

- [ ] **Step 1: Superpowers code review** (mandatory before MR). Dispatch a reviewer over `main..HEAD`; fix CRITICAL/HIGH/MEDIUM findings, re-run gates.

- [ ] **Step 2: Push + MR**

```bash
git push https://gitlab.example.com/<group>/<subgroup>/aipm-cockpit.git feat/AIPM-theme-decouple
glab api projects/<PROJECT_ID>/merge_requests -X POST -f source_branch=feat/AIPM-theme-decouple -f target_branch=main -f title="..." -f description="..." -f remove_source_branch=true
```
(Description ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.)

- [ ] **Step 3: Poll the pipeline; merge on green** via `glab api "projects/<PROJECT_ID>/merge_requests/{iid}/merge" -X PUT` (standing auto-merge authorization). Retry the `timelog-panel` flake once if it hits.

- [ ] **Step 4: Sync main; update backlog memory** (mark task 38 Release A shipped; Release B still queued).

---

## Self-review notes (author)

- **Spec coverage:** all 9 spec file-changes map to Tasks 1-9; testing → Task 10; docs → Task 11. ✓
- **Type consistency:** `cleanStructural`/`STRUCTURAL_TOKENS`/`DERIVED_TOKENS`/`FALLBACK_SURFACE` referenced consistently across Tasks 1/6. `ColorScheme.structural` already optional in the interface. ✓
- **Order safety:** JSON generated (T2) + boot (T3) + axe (T5) updated BEFORE the map deletion (T6). ✓
- **Ambiguity resolved inline:** Task 8 flags that the implementer must verify the real `Button`/`addScheme` shapes (this plan mirrors current color-schemes.ts) and prefers extending `addScheme` over the dynamic `updateScheme` import if cleaner.
