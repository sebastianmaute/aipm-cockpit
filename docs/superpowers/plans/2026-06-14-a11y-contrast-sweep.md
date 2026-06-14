# A11y Contrast Sweep + Gate Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Sweep `text-AIPM-green` → `text-AIPM-green-strong` (AA), fix the RACI chips palette-safely, add a green-text guard, and extend the e2e axe gate to 5 more views (fixing what it flags).

**Architecture:** Mostly className edits. A boundary-safe node script does the green sweep; a new guard test is the TDD anchor; the gate extension is iterative (run the a11y spec locally, fix criticals, loop).

**Tech Stack:** Next.js 16, React 19, TS, Tailwind v4, Vitest 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-14-a11y-contrast-sweep.md`

**Pinned facts:** `--AIPM-green-strong` = #4D7000 (light, AA ✓) / #84BD00 (dark). `text-AIPM-green` (#84BD00) fails AA as text (~2:1). `text-AIPM-green\b` ALSO matches inside `text-AIPM-green-strong` (the `-` is a word boundary) → ALWAYS use the negative lookahead `\btext-AIPM-green(?!-)` to target the bare token. `e2e/a11y.spec.ts` L10 `A11Y_VIEWS`. Conventions: `npx vitest run <p>`, `npx tsc --noEmit`, `npx eslint <f> --max-warnings=0`, `npx playwright test e2e/a11y.spec.ts`.

---

## Task 1: Green-text guard (RED)

**Files:** Create `src/app/green-text-contrast.test.ts`.

- [ ] **Step 1: Write the test:**
```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// `text-AIPM-green` (#84BD00) fails WCAG AA as text. Use `text-AIPM-green-strong`
// (#4D7000 light / #84BD00 dark) for any foreground text/icon. Fills/borders/
// rings (`bg-/border-/ring-/hover:bg-AIPM-green`) are fine — not a contrast issue.
// The (?!-) excludes the legitimate `text-AIPM-green-strong`.
const FORBIDDEN = /\btext-AIPM-green(?!-)/;

const SRC = join(process.cwd(), "src/app");
const tsxFiles = readdirSync(SRC).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));

describe("green-text contrast guard", () => {
  describe("detection regex", () => {
    it.each(["text-AIPM-green", "hover:text-AIPM-green", "dark:text-AIPM-green"])(
      "flags bare green text %s",
      (c) => expect(FORBIDDEN.test(c)).toBe(true),
    );
    it.each(["text-AIPM-green-strong", "bg-AIPM-green", "border-AIPM-green", "ring-AIPM-green"])(
      "allows %s",
      (c) => expect(FORBIDDEN.test(c)).toBe(false),
    );
  });
  for (const file of tsxFiles) {
    it(`${file} has no AA-failing text-AIPM-green`, () => {
      // a11y-allow-green: opt a decorative aria-hidden line out (keep this tiny)
      const src = readFileSync(join(SRC, file), "utf8")
        .split(/\r?\n/).filter((l) => !l.includes("a11y-allow-green:")).join("\n");
      expect(FORBIDDEN.test(src)).toBe(false);
    });
  }
});
```
- [ ] **Step 2:** `npx vitest run src/app/green-text-contrast.test.ts` → FAIL (many files). The detection sub-tests PASS. Record the failing-file count.
- [ ] **Step 3:** `npx eslint src/app/green-text-contrast.test.ts --max-warnings=0` + `npx tsc --noEmit` → clean.
- [ ] **Step 4: Commit** `test: green-text contrast guard (RED)`.

---

## Task 2: Green-text sweep → `green-strong`

**Files:** Many `src/app/*.tsx` (script-driven).

- [ ] **Step 1: Write + run the sweep script** (boundary-safe; never double-suffixes `green-strong`):
```bash
cat > /tmp/green-sweep.mjs <<'EOF'
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const SRC = "src/app";
let changed = 0, hits = 0;
for (const f of readdirSync(SRC).filter((f) => f.endsWith(".tsx") && !f.includes(".test."))) {
  const p = join(SRC, f);
  const s = readFileSync(p, "utf8");
  const m = s.match(/\btext-AIPM-green(?!-)/g);
  if (!m) continue;
  hits += m.length;
  writeFileSync(p, s.replace(/\btext-AIPM-green(?!-)/g, "text-AIPM-green-strong"), "utf8");
  changed++;
  console.log(`${f}: ${m.length}`);
}
console.log(`changed ${changed} files, ${hits} replacements`);
EOF
node /tmp/green-sweep.mjs
```
- [ ] **Step 2: Spot-check for green-on-dark-fill** — `git grep -nE "text-AIPM-green-strong" -- 'src/app/*.tsx'` and eyeball any where the SAME element/className has a dark fill (`bg-AIPM-dark-blue`/`bg-AIPM-dark-grey`/`bg-AIPM-green`/a dark surface) — there #4D7000 (light mode) may read too dark. If ANY such case exists, revert THAT occurrence to `text-AIPM-green` + add `aria-hidden` (if decorative) or `// a11y-allow-green:` and note it. (Expected: none — almost all are on `surface`.)
- [ ] **Step 3: Verify** `npx tsc --noEmit && npx eslint src/app --max-warnings=0` → clean. `npx vitest run src/app/green-text-contrast.test.ts` → should now be GREEN except for `raci-chip-picker.tsx` IF the sweep left its off-state as `text-AIPM-green-strong` (it did — Task 3 finishes RACI). Confirm NO bare `text-AIPM-green` remains: `git grep -nE "text-AIPM-green(?!-)" -- 'src/app/*.tsx' | grep -v test` (PCRE: `git grep -P`) → ZERO.
- [ ] **Step 4: Commit** `fix(a11y): sweep info-text green to AIPM-green-strong (AA)`.

---

## Task 3: RACI chips — palette-safe contrast

**Files:** Modify `src/app/raci-chip-picker.tsx`.

- [ ] **Step 1:** Read the `CHIP` record (the `R/A/C/I` on/off map). Replace it with (exact):
```ts
const CHIP: Record<RaciRole, { on: string; off: string }> = {
  R: { on: "bg-AIPM-dark-blue text-white border-AIPM-dark-blue", off: "border-AIPM-dark-blue text-foreground" },
  A: { on: "bg-AIPM-green-strong text-white border-AIPM-green-strong", off: "border-AIPM-green-strong text-foreground" },
  C: { on: "bg-AIPM-purple text-white border-AIPM-purple", off: "border-AIPM-purple text-foreground" },
  I: { on: "bg-AIPM-dark-grey text-white border-AIPM-dark-grey", off: "border-AIPM-dark-grey text-foreground" },
};
```
(On = white on a dark-enough brand fill — AA. Off = colored border for identity + `text-foreground` for AA-readable text.)
- [ ] **Step 2: Verify** `npx tsc --noEmit && npx eslint src/app/raci-chip-picker.tsx --max-warnings=0` → clean. `npx vitest run src/app/green-text-contrast.test.ts` → now FULLY GREEN. Run any `raci-chip-picker` test if present.
- [ ] **Step 3: Commit** `fix(a11y): RACI chips meet AA (white-on-dark-brand on; foreground off)`.

---

## Task 4: Extend the axe gate + fix what it flags (iterative)

**Files:** Modify `e2e/a11y.spec.ts`; fix whatever it surfaces.

- [ ] **Step 1:** In `e2e/a11y.spec.ts` L10, extend:
```ts
const A11Y_VIEWS = ["Dashboard", "Open Points", "Gantt", "Resources", "Budget", "RAID", "Settings", "Stakeholders", "Changes", "Milestones", "Reports", "Activity"] as const;
```
- [ ] **Step 2:** Run `npx playwright test e2e/a11y.spec.ts` locally (the playwright config starts the dev `webServer`; first run pays a Turbopack compile — generous timeout already set in the spec/seed). Record which NEW views fail and the exact `color-contrast` nodes (fg/bg/ratio/html) from the report.
- [ ] **Step 3: Fix each NEW critical/serious** with no-new-token patterns:
  - green text → already `green-strong` (catch any missed; re-run the sweep script if needed).
  - white-on-pink/purple/grey small text → switch to `text-AIPM-dark-blue`/`text-foreground` on a tinted/`surface-muted` bg, OR a darker existing fill (`green-strong`/`dark-grey`/`dark-blue`), OR border-only identity. NEVER add a new palette color.
  - If a failing node is the `bg-AIPM-pink text-white` now-tier nav badge (≈3.9:1) OR any case needing a genuine brand-design call → STOP, do not guess; report it for a human decision (note it in the task result).
- [ ] **Step 4:** Re-run `npx playwright test e2e/a11y.spec.ts` after each fix; loop until GREEN (or BLOCKED on a flagged brand decision).
- [ ] **Step 5: Verify** `npx tsc --noEmit && npx eslint src/app --max-warnings=0 && npx vitest run` → all green.
- [ ] **Step 6: Commit** `feat(a11y): extend axe gate to Stakeholders/Changes/Milestones/Reports/Activity (+ contrast fixes)`. List every file touched + each violation fixed in the commit body.

---

## Task 5: Version + CHANGELOG

**Files:** `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — `APP_VERSION` `"0.79.1"`→`"0.79.2"`; build-date comment → `// 0.79.2 a11y contrast sweep (green-strong text, RACI chips) + wider axe gate`. Leave `APP_MILESTONE` `"Willis"`.
- [ ] **Step 2: CHANGELOG** above `## [0.79.1]`:
```markdown
## [0.79.2] - 2026-06-14

### Fixed
- Accessibility: info-bearing green text now uses the AA-contrast `green-strong`
  shade; the RACI chips meet AA (readable on selected and unselected states);
  and the automated accessibility gate now also covers the Stakeholders, Changes,
  Milestones, Reports, and Activity views, with the contrast issues it surfaced
  fixed. A guard test keeps low-contrast green text from returning.
```
- [ ] **Step 3:** `npx tsc --noEmit && npx vitest run && npx eslint src/app --max-warnings=0 && npx playwright test e2e/a11y.spec.ts` → all green.
- [ ] **Step 4: Commit** `git add src/app/version.ts CHANGELOG.md && git commit -m "docs: 0.79.2 — a11y contrast sweep + wider axe gate"`.

---

## Final verification (after all tasks)
- [ ] `npx tsc --noEmit` clean; `npx vitest run` green (incl. green-text guard); `npx eslint src/app --max-warnings=0` clean; `npx playwright test e2e/a11y.spec.ts` green (12 views).
- [ ] `git grep -P "\btext-AIPM-green(?!-)" -- 'src/app/*.tsx' | grep -v test` → ZERO (modulo any documented `a11y-allow-green:` exemption).
- [ ] Manual: RACI chips legible selected + unselected, both light/dark; green status text readable in light mode.
- [ ] Use **superpowers:finishing-a-development-branch**.
