# Palette-Drift Re-Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace drifted `AIPM-*-grey` chrome utilities with semantic surface tokens (palette hygiene + dark-mode correctness + minor a11y), remap low-emphasis tints with alpha preserved, keep deliberate category greys, and add a guard test so the chrome greys can't drift again.

**Architecture:** Pure className edits (no logic change). A new `palette-chrome-sweep.test.ts` is the TDD anchor — RED before the sweep (drift present), GREEN after. No light-mode visual change (alpha preserved; `surface-muted` light = `AIPM-light-grey`).

**Tech Stack:** Next.js 16, React 19, TS, Tailwind v4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-06-14-palette-drift-resweep.md`

**Conventions:** `npx vitest run <path>`, `npx tsc --noEmit`, `npx eslint <files> --max-warnings=0`. Replace utilities IN PLACE — never add a 2nd color utility. Keep `text-AIPM-dark-blue dark:text-AIPM-light-grey` heading pairs + `bg-AIPM-dark-blue text-white` fills + `hover:text-AIPM-dark-blue`/`focus:ring-AIPM-green` accents.

---

## Task 1: Guard test (RED first)

**Files:** Create `src/app/palette-chrome-sweep.test.ts`.

- [ ] **Step 1: Write the test:**
```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Chrome-only grey utilities with ZERO legitimate uses after the 0.79.1 sweep.
// (AIPM-medium-grey is intentionally NOT forbidden — it has category uses: the
// monitor tier dot, the storage-not-ready dot, the calendar "other" absence
// cell, and the RACI "Informed" chip.)
const FORBIDDEN = /\b(?:bg|border|divide)-AIPM-light-grey\b|\btext-AIPM-dark-grey\b/;

const SRC = join(process.cwd(), "src/app");
const tsxFiles = readdirSync(SRC).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));

describe("palette chrome sweep", () => {
  describe("detection regex", () => {
    it.each(["bg-AIPM-light-grey", "hover:bg-AIPM-light-grey", "border-AIPM-light-grey", "divide-AIPM-light-grey", "text-AIPM-dark-grey", "dark:text-AIPM-dark-grey"])(
      "flags chrome grey utility %s",
      (cls) => expect(FORBIDDEN.test(cls)).toBe(true),
    );
    it.each(["bg-surface-muted", "text-muted-foreground", "bg-AIPM-medium-grey", "text-AIPM-light-grey", "border-line"])(
      "allows token / category utility %s",
      (cls) => expect(FORBIDDEN.test(cls)).toBe(false),
    );
  });

  for (const file of tsxFiles) {
    it(`${file} uses semantic tokens, not chrome greys`, () => {
      const src = readFileSync(join(SRC, file), "utf8");
      expect(FORBIDDEN.test(src)).toBe(false);
    });
  }
});
```
- [ ] **Step 2:** Run `npx vitest run src/app/palette-chrome-sweep.test.ts` → FAIL (offenders: app-header, top-bar, modal-header, outlook×2, project-switcher, app-modals, influence-interest-matrix, stakeholder-map-panel, stakeholders-panel). Confirm the failing file list matches the spec's ① + ② sets.
- [ ] **Step 3: Commit** `test: palette chrome-sweep guard (RED)`.

---

## Task 2: Replace chrome text/bg/border greys

**Files:** Modify `app-header.tsx`, `top-bar.tsx`, `modal-header.tsx`, `outlook-import-modal.tsx`, `outlook-calendar-import-modal.tsx`, `project-switcher.tsx`, `app-modals.tsx`.

Apply these EXACT string replacements (each `old` → `new`; some files have multiple identical occurrences — replace all):

- [ ] **app-header.tsx**
  - L65 subtitle: `mt-1 text-sm text-AIPM-dark-grey dark:text-AIPM-medium-grey` → `mt-1 text-sm text-muted-foreground`
  - Icon buttons (L88 + L103 are identical → both; L123 has a leading `relative `): replace the substring `text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-AIPM-medium-grey dark:hover:text-AIPM-light-grey` → `text-muted-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:hover:text-AIPM-light-grey` (use replace-all; it matches all three buttons).
- [ ] **top-bar.tsx** — same icon-button substring as app-header (L32 + L51 identical, L64 has leading `relative `): replace-all `text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-AIPM-medium-grey dark:hover:text-AIPM-light-grey` → `text-muted-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:hover:text-AIPM-light-grey`.
- [ ] **modal-header.tsx** L73: `rounded-md p-2 text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:text-AIPM-light-grey` → `rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey`.
- [ ] **outlook-import-modal.tsx** L75 & **outlook-calendar-import-modal.tsx** L103 (identical): `rounded-md p-2 text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue` → `rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue`.
- [ ] **project-switcher.tsx**
  - L97: `hover:bg-AIPM-light-grey` → `hover:bg-surface-muted` (only that token; leave the rest of the className).
  - L112 chevron: `h-4 w-4 shrink-0 text-AIPM-dark-grey dark:text-AIPM-medium-grey` → `h-4 w-4 shrink-0 text-muted-foreground`.
- [ ] **app-modals.tsx** L203: `border-t border-AIPM-light-grey pt-6 text-xs text-muted-foreground dark:border-zinc-800` → `border-t border-line pt-6 text-xs text-muted-foreground`.

- [ ] **Verify:** `npx tsc --noEmit && npx eslint app-header.tsx top-bar.tsx modal-header.tsx outlook-import-modal.tsx outlook-calendar-import-modal.tsx project-switcher.tsx app-modals.tsx` (full `src/app/` paths) `--max-warnings=0` → clean. Per-file grep: `git grep -nE "text-AIPM-dark-grey|bg-AIPM-light-grey|border-AIPM-light-grey|border-zinc" -- <these files>` → ZERO.
- [ ] **Commit** `fix: re-sweep drifted chrome greys to semantic tokens`.

---

## Task 3: Remap low-emphasis tints (alpha preserved)

**Files:** Modify `influence-interest-matrix.tsx`, `stakeholder-map-panel.tsx`, `stakeholders-panel.tsx`.

- [ ] **influence-interest-matrix.tsx**
  - L23: `bg-AIPM-light-grey/30 hover:bg-AIPM-light-grey/40` → `bg-surface-muted/30 hover:bg-surface-muted/40`.
  - L24: `bg-surface-muted hover:bg-AIPM-light-grey/30` → `bg-surface-muted hover:bg-surface-muted/30`.
- [ ] **stakeholder-map-panel.tsx** L63: `bg-AIPM-light-grey/20 dark:bg-AIPM-medium-grey/25` → `bg-surface-muted/20`.
- [ ] **stakeholders-panel.tsx** L69: `bg-AIPM-light-grey/40 text-foreground dark:bg-AIPM-medium-grey/30 dark:text-AIPM-light-grey` → `bg-surface-muted/40 text-foreground dark:text-AIPM-light-grey`.
- [ ] **Verify:** `npx tsc --noEmit && npx eslint` (the 3 files) `--max-warnings=0` → clean. `git grep -nE "bg-AIPM-light-grey" -- src/app/influence-interest-matrix.tsx src/app/stakeholder-map-panel.tsx src/app/stakeholders-panel.tsx` → ZERO.
- [ ] **Commit** `fix: remap low-emphasis tints to surface-muted (dark-mode correctness)`.

---

## Task 4: Guard GREEN + full sweep verification

- [ ] **Step 1:** `npx vitest run src/app/palette-chrome-sweep.test.ts` → now PASS (all files clean).
- [ ] **Step 2:** Confirm the KEEP set is untouched — `git grep -nE "bg-AIPM-medium-grey" -- src/app/action-row.tsx src/app/sidebar-footer.tsx src/app/raci-chip-picker.tsx src/app/resource-calendar.tsx` still shows the deliberate category uses (tier dot, status dot, RACI "I", calendar "other"/weekend-hover).
- [ ] **Step 3: FULL sweep** `npx tsc --noEmit && npx vitest run && npx eslint src/app --max-warnings=0` → all green. Report totals.
- [ ] **Step 4: Commit** (only if Steps fixed anything not already committed; otherwise skip — the guard going green needs no code change here).

---

## Task 5: Version + CHANGELOG

**Files:** Modify `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — `APP_VERSION` `"0.79.0"` → `"0.79.1"`; update the `APP_BUILD_DATE` comment to `// 0.79.1 palette-drift re-sweep (chrome greys → semantic tokens)`. Leave `APP_MILESTONE` `"Willis"` (patch inherits the minor codename). Do NOT add a highlight key (patch).
- [ ] **Step 2: CHANGELOG** above `## [0.79.0]`:
```markdown
## [0.79.1] - 2026-06-14

### Fixed
- Components added since the 0.16.0 palette sweep had reintroduced legacy grey
  chrome utilities; re-swept them to semantic surface tokens. No change in light
  mode; dark mode now renders these surfaces correctly, and a stray off-palette
  border was removed. A new guard test prevents the chrome greys from drifting
  back.
```
- [ ] **Step 3:** `npx tsc --noEmit && npx vitest run && npx eslint src/app --max-warnings=0` → green.
- [ ] **Step 4: Commit** `git add src/app/version.ts CHANGELOG.md && git commit -m "docs: 0.79.1 — palette-drift re-sweep"`.

---

## Final verification (after all tasks)
- [ ] `npx tsc --noEmit` clean; `npx vitest run` all green (incl. the new guard); `npx eslint src/app --max-warnings=0` clean.
- [ ] `git grep -nE "text-AIPM-dark-grey|(bg|border|divide)-AIPM-light-grey|border-zinc" -- 'src/app/*.tsx'` (exclude tests) → ZERO.
- [ ] Manual: open app-header / top-bar / modal close-× / project-switcher / influence-matrix / stakeholder-map / stakeholders panels in BOTH light and dark — light unchanged, dark renders the greys correctly.
- [ ] e2e/a11y green (deterministic gate).
- [ ] Use **superpowers:finishing-a-development-branch**.
