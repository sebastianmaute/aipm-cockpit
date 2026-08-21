# Popout Banner Cleanup (0.18.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the read-only-mirror banner in the three report-style popouts (`resource-report`, `reports`, `raid-report`).

**Architecture:** Extract a tiny constant array `REPORT_POPOUT_TABS` and a pure predicate `isReportPopoutTab(tab)` into `src/app/broadcast-sync.ts` (the file that already owns `POPOUT_TABS`). Use the predicate in `src/app/task-manager.tsx` to tighten the existing `{isPopout && <ReadOnlyMirrorBanner />}` gate. Unit-test the predicate directly — no heavy `<TaskManager>` mocking needed.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-popout-banner-cleanup-design.md`
**Branch:** `feat/0.18.1-popout-banner-cleanup` (already created off `main`).

> **Heads-up for the implementer subagent:**
> 1. **Fact-forcing gate.** Before FIRST shell command print 2 facts. Before EVERY Edit, in the SAME message print 4 facts — (a) importers (Grep `POPOUT_TABS`, `ReadOnlyMirrorBanner`), (b) symbols affected, (c) data fields (none), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry.
> 2. **win32** — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore` it BEFORE committing.

---

## Task 1: Add the `isReportPopoutTab` helper + unit tests

**Files:**
- Modify `src/app/broadcast-sync.ts`
- Modify `src/app/broadcast-sync.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/app/broadcast-sync.test.ts`, append a new `describe` block:

```ts
import { isReportPopoutTab, REPORT_POPOUT_TABS } from "./broadcast-sync";

describe("isReportPopoutTab", () => {
  it("returns true for the three report-style popout tabs", () => {
    expect(isReportPopoutTab("resource-report")).toBe(true);
    expect(isReportPopoutTab("reports")).toBe(true);
    expect(isReportPopoutTab("raid-report")).toBe(true);
  });

  it("returns false for editing popout tabs", () => {
    expect(isReportPopoutTab("raid")).toBe(false);
    expect(isReportPopoutTab("gantt")).toBe(false);
    expect(isReportPopoutTab("resources")).toBe(false);
    expect(isReportPopoutTab("activity")).toBe(false);
    expect(isReportPopoutTab("chat")).toBe(false);
    expect(isReportPopoutTab("budget")).toBe(false);
    expect(isReportPopoutTab("address-book")).toBe(false);
  });

  it("returns false for null (no popout)", () => {
    expect(isReportPopoutTab(null)).toBe(false);
  });

  it("REPORT_POPOUT_TABS contains exactly the three report tabs", () => {
    expect(REPORT_POPOUT_TABS).toEqual(["resource-report", "reports", "raid-report"]);
  });
});
```

If the file already imports from `./broadcast-sync` (it does — existing tests reference `openPopoutWindow`, `POPOUT_TABS`, etc.), extend the existing import line rather than adding a duplicate.

- [ ] **Step 2: Confirm tests fail**

```bash
npx vitest run broadcast-sync
```
Expected: FAIL with "Cannot find name 'isReportPopoutTab'" / "REPORT_POPOUT_TABS is not exported".

- [ ] **Step 3: Add the export to `broadcast-sync.ts`**

Read `src/app/broadcast-sync.ts` around L101–115 (the existing `POPOUT_TABS` literal and `PopoutTab` type). After the `PopoutTab` type alias declaration (`export type PopoutTab = (typeof POPOUT_TABS)[number];`), insert:

```ts
/** Subset of POPOUT_TABS that are read-only "report" surfaces. Used by the
 *  task-manager shell to skip the read-only-mirror banner in popouts where
 *  the banner would be redundant (reports are read-only by their nature). */
export const REPORT_POPOUT_TABS: readonly PopoutTab[] = [
  "resource-report",
  "reports",
  "raid-report",
] as const;

/** True for the three report-style popout tabs; false for editing popouts
 *  and `null`. */
export function isReportPopoutTab(tab: PopoutTab | null): boolean {
  if (tab === null) return false;
  return (REPORT_POPOUT_TABS as readonly string[]).includes(tab);
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
npx vitest run broadcast-sync
```
Expected: 4 new tests PASS (existing tests still pass).

- [ ] **Step 5: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/broadcast-sync.ts src/app/broadcast-sync.test.ts
git commit -m "feat(popout): add isReportPopoutTab predicate + REPORT_POPOUT_TABS"
```

---

## Task 2: Tighten the banner gate in `task-manager.tsx`

**Files:** Modify `src/app/task-manager.tsx`.

- [ ] **Step 1: Add the import**

Read `src/app/task-manager.tsx` and Grep for `from "./broadcast-sync"`. Extend that import line to include `isReportPopoutTab`. If the import line is e.g. `import { openPopoutWindow } from "./broadcast-sync";`, change to `import { isReportPopoutTab, openPopoutWindow } from "./broadcast-sync";`. If `./broadcast-sync` is NOT yet imported in this file, add `import { isReportPopoutTab } from "./broadcast-sync";` near the other imports.

- [ ] **Step 2: Tighten the banner-render condition**

Read `src/app/task-manager.tsx` at ~L464. The current line is:
```tsx
{isPopout && <ReadOnlyMirrorBanner lang={lang} />}
```

Edit to:
```tsx
{isPopout && !isReportPopoutTab(activeTab) && <ReadOnlyMirrorBanner lang={lang} />}
```

The `activeTab` value is already destructured at L86 (`const { isPopout, activeTab } = useWorkspaceTab();`), so no extra wiring needed. `activeTab` is `PopoutTab | null` — the predicate handles `null` correctly.

- [ ] **Step 3: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run lint
```
Expected: full suite green (≥ 915 = existing 911 + 4 from Task 1); tsc 0; lint 0. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "fix(popout): hide read-only-mirror banner in report popouts (resource-report, reports, raid-report)"
```

---

## Task 3: Release 0.18.1

**Files:** `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — READ first. Set `APP_VERSION = "0.18.1"` (currently `"0.18.0"`). Keep `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone`. Do NOT add a highlight key. Add a new top-of-file comment block ABOVE the existing `// 0.18.0 …` block:

```ts
// 0.18.1 hides the read-only-mirror banner in report-style popouts
// (resource-report, reports, raid-report) where it was redundant.
// No change to editing popouts; reminder banners (Due / Birthday /
// Jira token) remain hidden in all popouts as before.
```

- [ ] **Step 2: CHANGELOG** — READ to match style; add a new `[0.18.1] — 2026-05-28` entry ABOVE the `[0.18.0]` entry:

```markdown
## [0.18.1] — 2026-05-28

### Changed
- Report popouts (Resources Report, Reports, RAID Report) no longer show the read-only-mirror banner — these views are read-only by their nature and the banner was redundant. Editing popouts still show it as before. Confirmed that due-task / birthday / Jira-token reminder banners remain hidden in every popout.
```

Match `[0.18.0]`'s exact formatting.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run lint
npm run test:coverage
```
Expected: tsc 0; lint 0; all suites pass; coverage ≥ 70%. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "docs(release): 0.18.1 — hide read-only-mirror banner in report popouts"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Confirm:

1. **Scope:** only `src/app/broadcast-sync.ts`, `src/app/broadcast-sync.test.ts`, `src/app/task-manager.tsx`, `src/app/version.ts`, `CHANGELOG.md` touched.
2. **Predicate:** `isReportPopoutTab` and `REPORT_POPOUT_TABS` are exported from `broadcast-sync.ts`; 4 unit tests pass.
3. **Banner gate:** `task-manager.tsx` imports `isReportPopoutTab` and the banner line uses `{isPopout && !isReportPopoutTab(activeTab) && <ReadOnlyMirrorBanner lang={lang} />}`.
4. **Reminder banners unchanged:** DueBanner / BirthdayBanner / JiraTokenBanner still have their existing `!isPopout` guards (Grep them to confirm — should appear at ~L482, ~L492, ~L496).
5. **Release metadata:** `APP_VERSION === "0.18.1"`; `APP_BUILD_DATE` and `APP_HIGHLIGHT_KEYS` UNCHANGED from 0.18.0; CHANGELOG `[0.18.1]` entry present.
6. **Gates:** `npx tsc --noEmit` 0; `npm run lint` 0; `npx vitest run` 915/915 (or higher) pass; `npm run test:coverage` ≥ 70%.

After approval, use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:**
- Hide read-only-mirror banner in the 3 report popouts → Tasks 1 + 2 ✓
- Reminder-banner audit (already correct, no change) → final reviewer confirms via Grep ✓
- 0.18.1 patch release, no highlight key → Task 3 ✓
- Non-goals (no change to editing popouts, no reminder-banner code change, no banner restructure) → none touched ✓

**Placeholder scan:** No TBD/TODO. Every snippet is concrete; the test file already exists (`broadcast-sync.test.ts`) so the new tests append, not create.

**Type consistency:** `PopoutTab` (existing type) flows through `REPORT_POPOUT_TABS` and `isReportPopoutTab`; `activeTab: PopoutTab | null` (from `useWorkspaceTab`) matches the predicate's parameter type.

**Ordering note:** Task 2 depends on Task 1's exports. Task 3 (release) depends on everything else. Subagent-driven runs sequentially → correct.
