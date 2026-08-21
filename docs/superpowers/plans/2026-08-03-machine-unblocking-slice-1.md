# Machine-Unblocking Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the file-size ratchet block on `use-resource-planner.ts`, make the axe gate refuse to run against a stale server, and harden one fragile test matcher — so later slices can be written and trusted.

**Architecture:** Three independent changes plus register hygiene, ordered smallest-blast-radius first. §51 is a two-line test edit. §58 adds a `data-app-version` attribute to the server-rendered `<html>` and one guard test that compares it to `APP_VERSION`. §2 is a **move-only** extraction of two handler clusters out of `use-resource-planner.ts` into two per-entity CRUD hooks, mirroring `use-calendar-events.ts` — which was itself extracted from this same file for this same reason.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Vitest · Playwright + `@axe-core/playwright`

---

## Spec drift found while grounding — read before starting

Four things in [the spec](../specs/2026-08-03-machine-unblocking-design.md) and in `open-followups.md` §2 are **stale or wrong**. The plan below uses the corrected facts; §2 gets corrected in Task 6.

1. **§2's line counts are stale and the situation is worse than recorded.** The entry says "1037 lines, baseline 1038, one line of slack". Actual on `main` `0d770283`: the file is **1043** lines and `docs/baselines/file-sizes.json:6` records **1043**. `npm run size:check` exits 0 today with **zero** slack — 0.212.0 grew the file and re-baselined it. The next line added fails the build immediately, not after one more.

2. **§2's cluster line ranges have drifted** by ~6 lines and must not be pasted verbatim. Re-derive at execution time from the handler names listed in Tasks 3 and 4, which come from the hook's actual return object.

3. **§2 names the wrong precedent.** It says to follow `use-storage-file-ops.ts` (deps-object, non-memoized handlers). That convention is for *cross-cutting orchestration extracted from `task-manager.tsx`* — a different class. The precedent that actually applies is **`use-calendar-events.ts`**, which was extracted from `use-resource-planner.ts` for the file-size ratchet, takes optional callbacks, reads state via `useWorkspace()`, uses `useCallback`, and is spread into the same return this plan touches (`use-resource-planner.ts:394` and `:1014`). **This plan resolves the conflict by moving handlers verbatim** — see Task 3, Step 1.

4. **§58's flagged unknown is resolved, and the answer changes the task.** `APP_VERSION_LABEL` renders only inside `settings-view.tsx:414`, `version-info.tsx:59` and the version modal (`task-manager.tsx:2792`). There is **no view-independent DOM handle**, so the guard cannot simply read one — Task 2 adds it.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/app/use-tasks-dedup.test.tsx` (modify) | collapse a two-line gate into one modal-specific wait | 1 |
| `src/app/layout.tsx` (modify) | stamp `data-app-version` on the server-rendered `<html>` | 2 |
| `e2e/a11y.spec.ts` (modify) | guard test: served version must equal this checkout's | 2 |
| `src/app/use-reference-data.ts` (create) | roles · disciplines · grades CRUD + reorder — 15 handlers | 3 |
| `src/app/use-resource-directory.ts` (create) | resource CRUD · bulk · import + editing state — 9 handlers | 4 |
| `src/app/use-resource-planner.ts` (modify) | composes both new hooks; keeps RAID, absences, shifts, planning grid | 3, 4 |
| `docs/baselines/file-sizes.json` (modify) | re-record the shrunk size so the file cannot grow back | 5 |
| `docs/open-followups.md` (modify) | index rows §52–58 · new §59 · correct §2's stale numbers | 6 |

★ `src/app/task-manager.tsx` is the **only** production caller of `useResourcePlanner` (verified). `use-resource-planner.test.tsx` and `use-resource-planner.undo.test.tsx` are the regression net for Tasks 3–4 and must not be edited by them.

---

### Task 1: §51 — make the dedup test's wait and its assumption the same condition

**Files:**
- Modify: `src/app/use-tasks-dedup.test.tsx:109-110`

**Why:** `/dup/i` is a substring of the trigger button's own accessible name, "**Dedup**licate & unify tasks". So the `waitFor` gate on line 109 can be satisfied by something that does not imply the preview modal opened, and line 110's un-waited `getByRole` then fails immediately. This is a fragility fix, **not** the §51 diagnosis — do not claim it fixes the flake.

- [ ] **Step 1: Read the current two lines to confirm they still match**

Run: `sed -n '101,118p' src/app/use-tasks-dedup.test.tsx`

Expected — lines 108–110 read exactly:

```tsx
    fireEvent.click(screen.getByRole("button", { name: /deduplicate & unify tasks/i }));
    await waitFor(() => expect(screen.getByText(/dup/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /merge selected/i }));
```

If they do not match, STOP — the file moved under this plan; re-derive before editing.

- [ ] **Step 2: Replace the gate with one modal-specific async find**

In `src/app/use-tasks-dedup.test.tsx`, replace these two lines:

```tsx
    await waitFor(() => expect(screen.getByText(/dup/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /merge selected/i }));
```

with:

```tsx
    // The wait and the assumption must be the SAME condition: /dup/i is a
    // substring of the trigger's own name ("Deduplicate & unify tasks"), so a
    // waitFor on it can pass without the preview modal being open, leaving the
    // next line's un-waited getByRole to fail immediately (open-followups §51).
    fireEvent.click(await screen.findByRole("button", { name: /merge selected/i }));
```

- [ ] **Step 3: Check whether `waitFor` is now unused in this file**

Run: `grep -n "waitFor" src/app/use-tasks-dedup.test.tsx`

If zero matches remain, remove `waitFor` from the `@testing-library/react` import line — CI runs `eslint --max-warnings=0` with **no** `argsIgnorePattern`, so an unused import is fatal. If matches remain, leave the import alone.

- [ ] **Step 4: Run the test file**

Run: `npx vitest run src/app/use-tasks-dedup.test.tsx --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/t1.log`

Expected: `EXIT=0`, all tests pass.

★ `--reporter=basic` does not exist in vitest 4.1.8 and errors at startup. Use `--reporter=dot`.

- [ ] **Step 5: Typecheck (vitest never typechecks test files)**

Run: `npx tsc --noEmit > /tmp/tsc1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/tsc1.log`

Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-tasks-dedup.test.tsx
git commit -F - <<'EOF'
test(dedup): wait on the modal itself, not a substring of the trigger's name

/dup/i is a substring of "Deduplicate & unify tasks", so the waitFor gate could
pass without the preview modal open, leaving the next line's un-waited
getByRole to miss immediately. One findByRole makes the wait and the assumption
the same condition.

Fragility fix only — the §51 flake mechanism is still not established.
EOF
```

---

### Task 2: §58 — make the axe gate refuse a stale server

**Files:**
- Modify: `src/app/layout.tsx` (the `<html>` element)
- Modify: `e2e/a11y.spec.ts` (imports + one new guard test)

**Why:** `playwright.config.ts:79` sets `reuseExistingServer: !process.env.CI`, so a local run attaches to whatever answers on the port. This repo is routinely checked out twice, so an 85/85 pass can be evidence about code that is not on your branch. During 0.212.0 this was caught only by hand, with `netstat`.

★ A version match is **necessary but not sufficient** — two worktrees on the same version still agree. This pairs with the `PORT=3100 npm run dev` fresh-port convention; it does not replace it. The guard's failure message must say so.

- [ ] **Step 1: Add the version stamp to the server-rendered `<html>`**

In `src/app/layout.tsx`, add the import beneath the existing `NO_FLASH_THEME_SCRIPT` import:

```tsx
import { APP_VERSION } from "./version";
```

Then add the attribute to the `<html>` element, which currently reads:

```tsx
    <html
      lang="en"
      className={`${titillium.variable} h-full antialiased`}
      suppressHydrationWarning
    >
```

Change it to:

```tsx
    <html
      lang="en"
      className={`${titillium.variable} h-full antialiased`}
      // Lets e2e assert the server it is talking to IS this checkout.
      // playwright.config.ts reuses an existing dev server outside CI, so a run
      // can otherwise scan another worktree's code and pass (open-followups §58).
      // Build-time constant, so SSR and client render it identically.
      data-app-version={APP_VERSION}
      suppressHydrationWarning
    >
```

- [ ] **Step 2: Verify the attribute is actually served**

Run: `npm run dev > /tmp/dev.log 2>&1 &` then wait for it to answer, then:

Run: `curl -s http://localhost:3000/ | grep -o 'data-app-version="[^"]*"' | head -1`

Expected: `data-app-version="0.212.0"`

If empty, the attribute is not reaching the served HTML — STOP and diagnose before writing the guard, or the guard will be vacuous.

- [ ] **Step 3: Write the guard test**

In `e2e/a11y.spec.ts`, add to the import block at the top:

```ts
import { APP_VERSION } from "../src/app/version";
```

Then insert this test immediately after the `comboLabel` definition and before the `seedScript` function:

```ts
// The server under test must BE this checkout. playwright.config.ts sets
// reuseExistingServer outside CI, so a run can silently attach to a dev server
// left over from another worktree and report 85/85 about code that is not on
// this branch (open-followups §58). Necessary but NOT sufficient — two
// worktrees on the same version still agree — so keep pairing this with the
// PORT=3100 fresh-port convention AGENTS.md prescribes.
test("guard: the served app is this checkout", async ({ page }) => {
  await gotoApp(page);
  const served = await page.evaluate(
    () => document.documentElement.getAttribute("data-app-version"),
  );
  expect(
    served,
    `Served app reports version ${served ?? "(absent)"} but this checkout is ${APP_VERSION}. ` +
      `Playwright reused an existing dev server from another worktree. Stop it, or run on a ` +
      `fresh port: PORT=3100 npm run dev (stop with PORT=3100 npm run stop). ` +
      `NOTE: a version MATCH does not prove the right server — two worktrees on the same ` +
      `version agree. The fresh-port convention still applies.`,
  ).toBe(APP_VERSION);
});
```

- [ ] **Step 4: Run the guard against a correct server — it must PASS**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "this checkout" > /tmp/g1.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/g1.log`

Expected: `EXIT=0`, 1 passed.

- [ ] **Step 5: Prove the guard FIRES — perturb the served side**

A guard that has never failed is not known to scan. Temporarily add this line as the FIRST statement inside the guard test body, above `await gotoApp(page)`:

```ts
  await page.addInitScript(() => {
    document.documentElement.setAttribute("data-app-version", "0.0.0-wrong");
  });
```

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "this checkout" > /tmp/g2.log 2>&1; echo "EXIT=$?"; grep -c "0.0.0-wrong" /tmp/g2.log`

Expected: `EXIT=1`, and the failure message contains `0.0.0-wrong` — proving the guard reads the SERVED value and reports it.

★ This perturbs the served attribute, which is the exact variable the guard exists to detect. It does not simulate a whole second server; it proves the assertion path is live rather than vacuous.

Then **remove those three lines** and re-run Step 4 to confirm it passes again.

- [ ] **Step 6: Run the full axe suite on a FRESH port**

Stop any dev server on 3000 first (`npm run stop`), then:

Run: `PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium > /tmp/axe.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/axe.log`

Expected: `EXIT=0`, 86 passed (85 existing checks + the new guard).

Then: `PORT=3100 npm run stop`

★ `layout.tsx` changed, so this must run against a freshly-compiled server — a stale one is exactly what this task exists to catch.

★★ A **cold** server has failed this suite 5/5 and then passed warm: the first navigation pays a one-time Turbopack compile, and views can scan mid-compile. If the run fails on a cold start, re-run once against the now-warm server before treating any violation as real. If `.next/dev/types/*` got corrupted (phantom tsc errors in GENERATED files), `Remove-Item -Recurse -Force .next` — not a source edit.

- [ ] **Step 7: Lint + typecheck**

Run: `npx eslint --max-warnings=0 src/app; echo "EXIT=$?"`
Run: `npx tsc --noEmit > /tmp/tsc2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/tsc2.log`

Expected: `EXIT=0` for both. Read the exit code **unpiped** — `| grep` reports grep's status, not eslint's.

- [ ] **Step 8: Commit**

```bash
git add src/app/layout.tsx e2e/a11y.spec.ts
git commit -F - <<'EOF'
test(a11y): fail the axe gate when it is pointed at a stale dev server

playwright.config.ts reuses an existing server outside CI, so with a dev server
left running from another worktree an 85/85 pass could be evidence about code
that is not on the branch. <html> now carries data-app-version and the suite
asserts it equals this checkout's APP_VERSION.

Necessary but not sufficient: two worktrees on the same version still agree, so
the failure message keeps pointing at the fresh-port convention.

Closes the gate half of open-followups §58.
EOF
```

---

### Task 3: §2a — extract reference data (roles · disciplines · grades)

**Files:**
- Create: `src/app/use-reference-data.ts`
- Modify: `src/app/use-resource-planner.ts`
- Regression net (DO NOT EDIT): `src/app/use-resource-planner.test.tsx`, `src/app/use-resource-planner.undo.test.tsx`

**The 15 handlers to move** — taken from the hook's return object at `use-resource-planner.ts:992-1041`:

`resolveOrCreateRole` · `handleSaveRole` · `handleDeleteRole` · `handleAssignResourceRole` · `handleAssignRoleById` · `handleClearResourceRole` · `handleAddDiscipline` · `handleRenameDiscipline` · `handleAddGrade` · `handleRenameGrade` · `onDeleteDiscipline` · `onDeleteGrade` · `onReorderDisciplines` · `onReorderGrades` · `onReorderRoles`

- [ ] **Step 1: Read the rule that governs this whole task before touching anything**

**This is a MOVE, not a rewrite.** Every handler keeps its body byte-for-byte and keeps its **current** memoization form — if it is a bare `const x = (…) => {}` today it stays bare; if it is `useCallback` today it stays `useCallback`. Do not "harmonise" them.

Two reasons this matters:
- `open-followups.md` §1 records that `ResourcesPanel`'s `memo()` does not bail because several props are fresh identities each render. Changing memoization here changes render identity — a behaviour change wearing a refactor's clothes.
- §2 says to follow `use-storage-file-ops.ts`'s non-memoized convention, but `use-calendar-events.ts` — extracted from *this file*, for *this reason* — uses `useCallback`. Moving verbatim sidesteps a conflict this task has no mandate to settle.

- [ ] **Step 2: Establish the baseline — run the regression net BEFORE changing anything**

Run: `npx vitest run src/app/use-resource-planner.test.tsx src/app/use-resource-planner.undo.test.tsx --reporter=dot > /tmp/rp-before.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/rp-before.log`

Expected: `EXIT=0`. **Record the test counts** — Step 7 must match them exactly. A move-only refactor that changes a test count has changed behaviour.

- [ ] **Step 3: Locate the exact line ranges**

Run: `grep -n "resolveOrCreateRole\|handleSaveRole\|handleDeleteRole\|handleAssignResourceRole\|handleAssignRoleById\|handleClearResourceRole\|handleAddDiscipline\|handleRenameDiscipline\|handleAddGrade\|handleRenameGrade\|onDeleteDiscipline\|onDeleteGrade\|onReorderDisciplines\|onReorderGrades\|onReorderRoles" src/app/use-resource-planner.ts`

Note the first definition line and the last closing line of the contiguous block. §2's recorded range (644–871) is **stale by ~6 lines** — use what you just measured, not the entry.

- [ ] **Step 4: Create the new hook**

Create `src/app/use-reference-data.ts` with this header and shape, then paste the 15 handler bodies in verbatim between the state reads and the return:

```ts
"use client";

// Per-entity CRUD hook for reference data (roles · disciplines · grades).
// Extracted from use-resource-planner.ts, which sat at its file-size ratchet
// baseline with zero slack (open-followups §2), mirroring use-calendar-events.ts
// — the earlier extraction out of that same file, for that same reason.
//
// MOVE ONLY, no behaviour change: each handler keeps the body and the
// memoization form it had in use-resource-planner.ts. Render identity is
// load-bearing here — open-followups §1 tracks the ResourcesPanel memo that
// these handler identities feed.

import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import type { ActivityKind, FieldChange } from "./activity-log";
import type { UndoStackApi } from "./undo/use-undo-stack";
import type { Lang } from "./i18n";

export interface UseReferenceDataArgs {
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  workdayHours: number;
  /** Capture a MULTI-array pre-op snapshot for undo — a role/discipline/grade
   *  delete cascades an edit into a second array. */
  captureComposite?: UndoStackApi["captureComposite"];
  capture?: UndoStackApi["capture"];
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
}

export function useReferenceData(args: UseReferenceDataArgs) {
  const { roles, setRoles, disciplines, setDisciplines, grades, setGrades, resources, setResources } =
    useWorkspace();

  // ── moved verbatim from use-resource-planner.ts ──

  // <paste the 15 handler definitions here, unchanged>

  return {
    resolveOrCreateRole,
    handleSaveRole,
    handleDeleteRole,
    handleAssignResourceRole,
    handleAssignRoleById,
    handleClearResourceRole,
    handleAddDiscipline,
    handleRenameDiscipline,
    handleAddGrade,
    handleRenameGrade,
    onDeleteDiscipline,
    onDeleteGrade,
    onReorderDisciplines,
    onReorderGrades,
    onReorderRoles,
  };
}
```

★ Adjust the `useWorkspace()` destructure and the imports to exactly what the pasted bodies reference — no more (unused = fatal under `--max-warnings=0`), no less. If a moved body reads something `useWorkspace()` does not expose, add it to `UseReferenceDataArgs` and thread it instead.

- [ ] **Step 5: Wire it into `use-resource-planner.ts`**

Delete the 15 moved definitions. Add the import beside the existing `useCalendarEvents` one (line 10):

```ts
import { useReferenceData } from "./use-reference-data";
```

Call it next to the existing `useCalendarEvents` call (currently line 394), mirroring that line's style:

```ts
  const referenceDataApi = useReferenceData({ lang, logActivity: args.logActivity, logActivityChanges: args.logActivityChanges, showToast: args.showToast, workdayHours: args.workdayHours, capture: args.capture, captureComposite: args.captureComposite, captureFieldEdit: args.captureFieldEdit });
```

In the return object, replace the 15 individual keys with a spread placed where they were:

```ts
    ...referenceDataApi,
```

★ Keep the spread's POSITION in the return. Later keys override earlier ones in an object literal; moving a spread past a same-named key silently changes what the caller gets.

- [ ] **Step 6: Lint + typecheck**

Run: `npx eslint --max-warnings=0 src/app; echo "EXIT=$?"`
Run: `npx tsc --noEmit > /tmp/tsc3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/tsc3.log`

Expected: `EXIT=0` for both.

★ The IDE's inline diagnostics are mid-edit snapshots and routinely show phantom "Cannot find module" after a multi-file edit. Trust `tsc`, not the squiggles.

- [ ] **Step 7: Run the regression net — counts must MATCH Step 2**

Run: `npx vitest run src/app/use-resource-planner.test.tsx src/app/use-resource-planner.undo.test.tsx --reporter=dot > /tmp/rp-after.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/rp-after.log`

Expected: `EXIT=0` and **identical** counts to Step 2.

- [ ] **Step 8: Confirm the new file is coverage-gated, not excluded**

Run: `grep -n "coverage" -A 30 vitest.config.ts | grep -n "exclude" -A 20`

Expected: `use-reference-data.ts` appears **nowhere** in `coverage.exclude`. `use-resource-planner.ts` is gated today, so the extraction is coverage-neutral only if the new file stays gated. Do not add an exclusion.

- [ ] **Step 9: Commit**

```bash
git add src/app/use-reference-data.ts src/app/use-resource-planner.ts
git commit -F - <<'EOF'
refactor(resources): extract reference-data CRUD into use-reference-data

Move only — roles, disciplines and grades handlers leave use-resource-planner.ts
with their bodies and their existing memoization form unchanged, mirroring the
earlier use-calendar-events extraction out of the same file.

use-resource-planner.ts sat exactly at its file-size baseline (1043/1043), so
the next line added to it failed the build. First of two extractions needed to
clear the 800-line limit.

Refs open-followups §2.
EOF
```

---

### Task 4: §2b — extract the resource directory

**Files:**
- Create: `src/app/use-resource-directory.ts`
- Modify: `src/app/use-resource-planner.ts`
- Regression net (DO NOT EDIT): `src/app/use-resource-planner.test.tsx`, `src/app/use-resource-planner.undo.test.tsx`

**Why a second extraction is required:** one is not enough. Reference data is ~228 lines; 1043 − 228 = 815, plus the wiring line, still over the 800 limit. Both clusters land the file at roughly 620.

**The 9 exports to move** — from the same return object:

`editingResource` (state) · `handleOpenAddResource` · `handleEditResource` · `handleCloseResourceModal` · `handleSaveResource` · `handleDeleteResource` · `handleBulkEditResources` · `handleBulkDeleteResources` · `handleImportResources`

★ Unlike Task 3 this cluster owns **editing state** (`editingResource`), so the `useState` moves with it — same shape as `use-calendar-events.ts`, which owns its own editing state and returns it.

★ `handleDeleteResource` cascades into absences and shifts via the module-level `recordMatchesRemoved` helper (`use-resource-planner.ts:92`). That helper is used only by this cluster — **move it too**, as a module-level function in the new file, and delete it from the old one. Verify with `grep -n "recordMatchesRemoved" src/app/use-resource-planner.ts` before deleting: if anything outside the moved handlers calls it, export it from the new file and import it back instead.

- [ ] **Step 1: Re-read Task 3, Step 1**

The same move-only rule governs this task: bodies verbatim, memoization form preserved, no harmonising.

- [ ] **Step 2: Baseline the regression net again**

Run: `npx vitest run src/app/use-resource-planner.test.tsx src/app/use-resource-planner.undo.test.tsx --reporter=dot > /tmp/rd-before.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/rd-before.log`

Expected: `EXIT=0`. Record the counts.

- [ ] **Step 3: Locate the exact line ranges**

Run: `grep -n "editingResource\|handleOpenAddResource\|handleEditResource\|handleCloseResourceModal\|handleSaveResource\|handleDeleteResource\|handleBulkEditResources\|handleBulkDeleteResources\|handleImportResources\|recordMatchesRemoved" src/app/use-resource-planner.ts`

§2's recorded range (447–643) is stale — use what you measured.

- [ ] **Step 4: Create the new hook**

Create `src/app/use-resource-directory.ts`:

```ts
"use client";

// Per-entity CRUD hook for the resource directory (create · edit · delete ·
// bulk · import), including its own editing state. Second of the two
// extractions that took use-resource-planner.ts back under the 800-line limit
// (open-followups §2); mirrors use-calendar-events.ts, which owns its editing
// state the same way.
//
// MOVE ONLY, no behaviour change: bodies and memoization forms are unchanged
// from use-resource-planner.ts. Render identity is load-bearing — see
// open-followups §1.

import { useCallback, useState } from "react";
import { useWorkspace } from "./workspace-context";
import type { Resource } from "./types";
import type { ActivityKind, FieldChange } from "./activity-log";
import type { UndoStackApi } from "./undo/use-undo-stack";
import type { Lang } from "./i18n";

export interface UseResourceDirectoryArgs {
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  capture?: UndoStackApi["capture"];
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
}

// <paste recordMatchesRemoved here, verbatim, if grep confirmed this cluster
//  is its only caller>

export function useResourceDirectory(args: UseResourceDirectoryArgs) {
  const { resources, setResources, absences, setAbsences, shifts, setShifts } = useWorkspace();
  const [editingResource, setEditingResource] = useState<Resource | null>(null);

  // ── moved verbatim from use-resource-planner.ts ──

  // <paste the 8 handler definitions here, unchanged>

  return {
    editingResource,
    handleOpenAddResource,
    handleEditResource,
    handleCloseResourceModal,
    handleSaveResource,
    handleDeleteResource,
    handleBulkEditResources,
    handleBulkDeleteResources,
    handleImportResources,
  };
}
```

★ Same rule as Task 3: the `useWorkspace()` destructure and the imports must match exactly what the pasted bodies reference — unused bindings are a fatal lint error.

- [ ] **Step 5: Wire it in**

Delete the moved definitions and the now-unused `editingResource` `useState` from `use-resource-planner.ts`. Add the import beside the other two:

```ts
import { useResourceDirectory } from "./use-resource-directory";
```

Call it beside the other composed hooks:

```ts
  const resourceDirectoryApi = useResourceDirectory({ lang, logActivity: args.logActivity, logActivityChanges: args.logActivityChanges, showToast: args.showToast, capture: args.capture, captureFieldEdit: args.captureFieldEdit });
```

Replace the 9 keys in the return with a spread **in the position they occupied**:

```ts
    ...resourceDirectoryApi,
```

- [ ] **Step 6: Confirm the file is now under the limit**

Run: `wc -l src/app/use-resource-planner.ts`

Expected: roughly **620**, and unconditionally **below 800**. If it is still over 800, a third cluster is needed — stop and report rather than forcing it.

- [ ] **Step 7: Lint + typecheck**

Run: `npx eslint --max-warnings=0 src/app; echo "EXIT=$?"`
Run: `npx tsc --noEmit > /tmp/tsc4.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/tsc4.log`

Expected: `EXIT=0` for both.

- [ ] **Step 8: Regression net — counts must MATCH Step 2**

Run: `npx vitest run src/app/use-resource-planner.test.tsx src/app/use-resource-planner.undo.test.tsx --reporter=dot > /tmp/rd-after.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/rd-after.log`

Expected: `EXIT=0`, identical counts.

- [ ] **Step 9: Full unit suite — this hook reaches the Resources pane, planning grid and undo stack**

Run: `npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log`

Expected: `EXIT=0`.

★★★ Read that exit code **unpiped**. `npm run test:run | tail -8` exits 0 while tests are failing — that is `tail`'s status — and discards the diagnostic.

- [ ] **Step 10: Commit**

```bash
git add src/app/use-resource-directory.ts src/app/use-resource-planner.ts
git commit -F - <<'EOF'
refactor(resources): extract resource-directory CRUD into use-resource-directory

Second of the two extractions open-followups §2 called for; one was arithmetically
insufficient (1043 - 228 = 815, still over the 800 limit). The directory cluster
owns its editing state, mirroring use-calendar-events.

Move only — bodies and memoization forms unchanged. use-resource-planner.ts is
now under the limit with real slack instead of zero.

Refs open-followups §2.
EOF
```

---

### Task 5: Re-baseline the file size so the win cannot silently erode

**Files:**
- Modify: `docs/baselines/file-sizes.json:6`

**Why:** the ratchet fails on *growth of a baselined file*. Shrinking passes, but the baseline still records **1043**, leaving the file free to grow all the way back unnoticed. Re-recording locks the gain.

- [ ] **Step 1: Read how the baseline is regenerated**

Run: `sed -n '1,60p' scripts/check-file-sizes.mjs`

Look for an update/write mode (a `--update` flag or equivalent). If one exists, use it in Step 2. If none exists, edit the JSON by hand.

- [ ] **Step 2: Update the entry to the measured size**

Run: `wc -l src/app/use-resource-planner.ts`

Set `docs/baselines/file-sizes.json` key `"src/app/use-resource-planner.ts"` to exactly that number.

★ Use the real measured number. Do not round, and do not leave headroom "for later" — headroom is the thing this step removes.

- [ ] **Step 3: Verify the ratchet still passes**

Run: `npm run size:check > /tmp/size2.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/size2.log`

Expected: `EXIT=0`, `file-size ratchet ok`.

- [ ] **Step 4: Prove the new baseline BITES**

Append a throwaway line to the file:

Run: `echo "// ratchet proof — delete me" >> src/app/use-resource-planner.ts && npm run size:check > /tmp/size3.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/size3.log`

Expected: `EXIT=1` — the ratchet rejects the growth.

Then revert it — **without `git checkout`:**

Run: `git diff --stat src/app/use-resource-planner.ts`

Expected: exactly `1 insertion(+)`, `0 deletions`. If it shows anything else, STOP — something other than the proof line is uncommitted and a blind revert would destroy it.

Run: `sed -i '$d' src/app/use-resource-planner.ts && git diff --stat src/app/use-resource-planner.ts`

Expected: empty output (no diff). Then re-run `npm run size:check` and expect `EXIT=0`.

★★★ Do **not** revert a mutation check with `git checkout -- <file>`. It discards every uncommitted change in that file, not just the one you added, and it has already cost real work here once. Delete exactly the line you added and prove the diff is empty.

- [ ] **Step 5: Commit**

```bash
git add docs/baselines/file-sizes.json
git commit -F - <<'EOF'
chore(baselines): re-record use-resource-planner at its post-split size

The ratchet only fails on growth of a baselined file, so leaving the baseline at
1043 would let the split's gain erode silently back to where it started.
EOF
```

---

### Task 6: Register hygiene — index rows, §59, and §2's stale numbers

**Files:**
- Modify: `docs/open-followups.md`

★ **Rows only — never renumber.** The file's own rule is that numbers are stable identifiers and closed ones are never reused. They are cited from outside: `rich-text-plain.ts:96` → §24, AGENTS.md → §22 and §28, `docs/CODEMAPS/*` → §4, §7 B4, §8–§10, §13. Renumbering silently redirects every one of those.

- [ ] **Step 1: Add the seven missing index rows**

The summary table (currently lines 52–89) stops at §51 while §52–58 have full sections. Append these rows after the §51 row, matching the existing `| # | Item | Origin | Size | State |` column order:

```markdown
| 52 | `useColumnResize` v1→v2 migration pins defaults for existing users | 0.212.0 (Nayler) | M | open — deliberate; only a tableId bump reaches a v1 payload |
| 53 | ESLint 10 blocked upstream by `eslint-plugin-react` | 0.211.2 | — | open — **not actionable today**, upstream fix required |
| 54 | Prod-only CSP blocks ProseMirror's base CSS | pre-existing, found 0.211.2 | S–M | open — **user-visible in production**, no gate sees it |
| 55 | Fourteen hand-rolled `aria-pressed` toggles are colour-only | 0.212.0 (Nayler) | M | open — a11y, unguarded |
| 56 | `ToggleButton` pressed state near-invisible in all three dark schemes | 0.212.0 (Nayler) | S–M | open — **WCAG 1.4.11**, 1.03–1.22:1 |
| 57 | Four toolbar Outlook enable-toggles carry an untested `auto` guard | 0.212.0 (Nayler) | S | open — storage-layer mask is pinned, the four guards are not |
| 58 | Axe gate can pass against a stale dev server | 0.212.0 (Nayler) | S | **gate half CLOSED** (this slice) — fresh-port convention still required |
```

- [ ] **Step 2: Correct §2's stale numbers in place**

In the `## 2.` section, replace the opening paragraph:

```markdown
**1037 lines.** The baseline records 1038 (`docs/baselines/file-sizes.json`), so it passes CI on one
line of slack — **the next line added to that file fails the build.**
```

with:

```markdown
**1043 lines, and the baseline records 1043** (`docs/baselines/file-sizes.json`) — **zero** slack, so
the next line added to that file fails the build. ★ Corrected 2026-08-03: this entry read "1037 /
1038 / one line of slack" until then; 0.212.0 grew the file and re-baselined it, and the cluster line
ranges below drifted by ~6 lines with it. Re-derive the ranges from the handler names, not from the
numbers in the table.
```

★ If Tasks 3–5 have already landed, ALSO mark the section resolved rather than editing it as still-open — record the achieved size and that the baseline was re-recorded.

- [ ] **Step 3: Add §59**

Append a new section after §58, and add its index row after §58's:

```markdown
## 59. Eye verification owed on 0.212.0 — open

Settings → Integrations changed shape in 0.212.0: the calendar rows became two stacked
`ToggleButton`s, and `ToggleButton`'s `disabled` styling (`disabled:cursor-not-allowed
disabled:opacity-60`) rendered for the first time anywhere — it had been declared since the
primitive shipped and styled nothing, because no call site passed the prop. Neither was looked at
before the release went out.

★★ **The finding is not this release — it is the pattern.** Three consecutive releases now carry
owed eye verification and none has been discharged: §21 (0.209.0), §41 (0.211.0), and this. That is
one process finding, recorded here rather than as its own number: the eye-verify step is not
happening, and filing a fourth entry after 0.213.0 would confirm it rather than fix it.

Settings → General **is** axe-scanned, so structural a11y is covered. What is not covered, and what
these checks are for, is whether the two stacked toggles read as two distinct controls and whether
the disabled row reads as disabled rather than merely faint.
```

```markdown
| 59 | Eye verification owed on 0.212.0 (Settings → Integrations) | 0.212.0 (Nayler) | S | open — ★ third consecutive release with none discharged |
```

- [ ] **Step 4: Verify no renumbering happened**

Run: `grep -c "^## [0-9]" docs/open-followups.md`

Then: `grep -n "^## 2\.\|^## 21\.\|^## 24\.\|^## 28\.\|^## 41\." docs/open-followups.md`

Expected: §2, §21, §24, §28 and §41 all still exist under their original numbers. Those are the externally-cited ones.

- [ ] **Step 5: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs(followups): sync the index table, correct §2, open §59

The summary table stopped at §51 while §52-58 had full sections — seven rows added,
no renumbering (the numbers are cited from rich-text-plain.ts, AGENTS.md and CODEMAPS).

§2 recorded 1037 lines against a 1038 baseline; 0.212.0 made it 1043/1043, i.e. zero
slack rather than one line, and drifted its cluster ranges.

§59 records 0.212.0's owed eye verification and, more usefully, that three
consecutive releases now carry one and none has been discharged.
EOF
```

---

## Final verification — run before calling the slice done

- [ ] Run: `npx eslint --max-warnings=0 src/app; echo "EXIT=$?"` → `EXIT=0`
- [ ] Run: `npx tsc --noEmit > /tmp/final-tsc.log 2>&1; echo "EXIT=$?"` → `EXIT=0`
- [ ] Run: `npm run test:run > /tmp/final-suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/final-suite.log` → `EXIT=0`
- [ ] Run: `npm run test:coverage > /tmp/final-cov.log 2>&1; echo "EXIT=$?"; tail -25 /tmp/final-cov.log` → `EXIT=0`. **Required** — `test:run` does not enforce the coverage floors, and this slice added two coverage-gated `.ts` files. The floors (global lines 92 / funcs 91 / branch 80 / stmts 89, plus per-engine globs) are blocking in CI.
- [ ] Run: `npm run size:check > /tmp/final-size.log 2>&1; echo "EXIT=$?"` → `EXIT=0`
- [ ] Run: `npm run dup:check > /tmp/final-dup.log 2>&1; echo "EXIT=$?"` → `EXIT=0`. The two new files repeat `use-calendar-events.ts`'s hook shape; the duplication gate is blocking.
- [ ] Run on a FRESH port: `PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium > /tmp/final-axe.log 2>&1; echo "EXIT=$?"` → `EXIT=0`, 86 passed. Then `PORT=3100 npm run stop`.

★★★ Every one of these reads its exit code unpiped. A gate read through `| tail` or `| grep` reports the pipe's status, and a defeated gate is worse than no gate — it reports success.

## Out of scope for this slice — do not drift into them

- **§39 / §51 root cause.** Slice 2. Task 1 hardens a matcher and claims nothing more. Do not raise a timeout: 5 s → 15 s already bought nothing, and three subsequent failures ate the 15 s budget to within 24 ms.
- **§1's memo fork.** Tasks 3–4 preserve memoization precisely so this stays undecided.
- **§54, §50, §40.** Slice 3 candidates — user-visible, deliberately deferred by the driver, not by rank.

## Release handling

This slice is refactor + test + docs. Per the repo's convention, refactor-only work takes **no version bump**. §58 adds a `data-app-version` attribute — a real source change, but not a user-facing feature. Decide bump-vs-no-bump with the user before opening an MR; do not push, open an MR, or merge without an explicit instruction.
