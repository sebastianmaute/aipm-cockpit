# Deep-Link Row Scroll + Highlight (#10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `requestOpen(view,id)` lands, scroll the target row into view and briefly outline it, alongside the existing editor-open — across RAID, milestones, changes, stakeholders, tasks.

**Architecture:** One shared hook `use-deeplink-row-flash.ts` reads `pendingOpen`; on a view+id match it sets `flashId`, scrolls the `[data-deeplink-row="<id>"]` element into view, and clears after 1800ms. Each panel attaches `containerRef` to its scroll container and adds `data-deeplink-row={id}` + an `outline-AIPM-green` class to its rows. Does not clear `pendingOpen` (panels' own effects do).

**Tech Stack:** Next.js 16 (forked) / React 19 / TypeScript / Tailwind (AIPM brand tokens) / vitest + RTL.

Full design: `docs/superpowers/specs/2026-06-22-deeplink-row-flash-design.md`.

---

### Task 1: Shared hook `use-deeplink-row-flash.ts` (TDD)

**Files:**
- Create: `src/app/use-deeplink-row-flash.ts`
- Test: `src/app/use-deeplink-row-flash.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/app/use-deeplink-row-flash.test.tsx`. Render a probe component inside `WorkspaceTabProvider` (import from `./workspace-tab-context`; check its real export name + props — it wraps children and exposes `useWorkspaceTab`). The probe calls `useDeepLinkRowFlash("changes")`, renders a `<div ref={containerRef}>` containing `<tr data-deeplink-row="5">` (wrap in a `<table><tbody>` so the `<tr>` is valid), and exposes a button calling `requestOpen("changes", 5)` from `useWorkspaceTab()`. Stub `Element.prototype.scrollIntoView = vi.fn()` in `beforeEach` (jsdom has no layout). Assertions:
- After clicking the trigger: `flashId === 5` (assert via a rendered text node) and `scrollIntoView` called with `{ block: "center", behavior: "auto" }`.
- `useDeepLinkRowFlash("raid")` probe + `requestOpen("changes",5)` → `flashId` stays `null`, `scrollIntoView` not called.
- Sentinel: `requestOpen("changes", -1)` → `flashId` stays `null`.
- With `vi.useFakeTimers()`: advance `DEEPLINK_FLASH_MS` → `flashId` back to `null` (wrap timer advance + assertion in `act`).
- `flashOutlineClass(true)` contains `outline-AIPM-green`; `flashOutlineClass(false) === ""`.

Use `requestAnimationFrame` stub if needed (jsdom supports rAF; if flaky, `vi.stubGlobal("requestAnimationFrame", (cb) => { cb(0); return 0; })`).

- [ ] **Step 2: Run test, verify it fails**

Run: `npm run test:run -- use-deeplink-row-flash`
Expected: FAIL (module not found / export missing).

- [ ] **Step 3: Implement the hook**

Create `src/app/use-deeplink-row-flash.ts` exactly as in the design doc's "New module" code block (`DEEPLINK_FLASH_MS = 1800`, `FLASH_CLASS`, `flashOutlineClass`, `useDeepLinkRowFlash`). The effect deps are `[pendingOpen, view]`; early-return on `pendingOpen?.view !== view` and on `id < 0`; `setFlashId(id)`; rAF → `containerRef.current?.querySelector(...)?.scrollIntoView({block:"center",behavior:"auto"})`; `setTimeout(..., DEEPLINK_FLASH_MS)`; cleanup cancels both.

- [ ] **Step 4: Run test, verify it passes**

Run: `npm run test:run -- use-deeplink-row-flash` → PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit` and `npm run lint`. Both clean (no unused vars; `--max-warnings=0`). Fix the `RefObject<HTMLDivElement | null>` typing if tsc complains (React 19 `useRef<T | null>(null)` returns `RefObject<T | null>`).

- [ ] **Step 6: Commit**

```bash
git add src/app/use-deeplink-row-flash.ts src/app/use-deeplink-row-flash.test.tsx
git commit -m "feat: shared useDeepLinkRowFlash hook (scroll + flash a deep-linked row)"
```

---

### Task 2: Wire all five panels + one panel integration test

**Files (modify):**
- `src/app/raid-panel.tsx`
- `src/app/milestones-panel.tsx`
- `src/app/change-panel.tsx`
- `src/app/stakeholders-panel.tsx`
- `src/app/tasks-section.tsx`
- `src/app/task-row.tsx`
- Test: `src/app/change-panel.test.tsx` (add a case)

For each panel the wiring is identical in shape; apply per the design's "Per-panel wiring":

- [ ] **Step 1: RAID** — in `raid-panel.tsx`: `import { useDeepLinkRowFlash, flashOutlineClass } from "./use-deeplink-row-flash";`. Add `const { flashId, containerRef } = useDeepLinkRowFlash("raid");`. Attach `ref={containerRef}` to the `overflow-auto` scroll container (~line 431). On the row `<tr key={item.id}>` (~line 503): add `data-deeplink-row={item.id}` and append `flashOutlineClass(flashId === item.id)` to its `className` (combine with existing class string; do not drop existing classes).

- [ ] **Step 2: Milestones** — `milestones-panel.tsx`: same with view `"milestones"`; scroll container ~line 223; row `<tr key={m.id}>` ~line 272 → `data-deeplink-row={m.id}` + `flashOutlineClass(flashId === m.id)`.

- [ ] **Step 3: Changes** — `change-panel.tsx`: view `"changes"`; the `overflow-auto` container around the table; row `<tr key={item.id}>` ~line 363 → `data-deeplink-row={item.id}` + `flashOutlineClass(flashId === item.id)`.

- [ ] **Step 4: Stakeholders** — `stakeholders-panel.tsx`: view `"stakeholders"`; container ~line 221; row `<tr key={item.id}>` ~line 341 → `data-deeplink-row={item.id}` + `flashOutlineClass(flashId === item.id)`.

- [ ] **Step 5: Tasks** — `tasks-section.tsx`: view `"open-points"`; attach `containerRef` to the tasks table's `overflow-auto` container; in `visibleRows.map`, pass `isFlashed={flashId === task.id}` to `<TaskRow ... />`. In `task-row.tsx`: add `isFlashed?: boolean` to the props type; on the `<tr>` (~line 183) add `data-deeplink-row={task.id}` and append `flashOutlineClass(isFlashed)` to the className (keep `bg-*` stateClass). Import `flashOutlineClass`. `TaskRow` stays `memo` (boolean prop compares fine).

- [ ] **Step 6: Panel integration test** — in `change-panel.test.tsx` add a test: render the changes panel (follow the existing render harness in that file — it already mounts inside the workspace-tab context, or add a `WorkspaceTabProvider`). Stub `scrollIntoView`. Trigger `requestOpen("changes", <an existing change id>)`. Assert the matching `<tr>` has attribute `data-deeplink-row="<id>"` and (while flashed) its className contains `outline-AIPM-green`. (If driving `requestOpen` from the test is awkward, assert at minimum that every change row renders `data-deeplink-row`.)

- [ ] **Step 7: Verify**

Run: `npm run test:run` (full suite green), `npx tsc --noEmit`, `npm run lint`.

- [ ] **Step 8: a11y gate (no regression expected)**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"` and `-g "Milestones"` (sample the scanned views touched). Outline is decorative — expect green.

- [ ] **Step 9: Commit**

```bash
git add src/app/raid-panel.tsx src/app/milestones-panel.tsx src/app/change-panel.tsx src/app/stakeholders-panel.tsx src/app/tasks-section.tsx src/app/task-row.tsx src/app/change-panel.test.tsx
git commit -m "feat: deep-link scroll + flash target row across the five deep-linkable panels"
```

---

### Task 3: Release 0.125.0 "Brunner" + i18n + docs

**Files (modify):**
- `src/app/version.ts`
- `src/app/i18n.ts`
- `src/app/i18n.de.ts` (via node utf8 write — Edit tool corrupts umlauts/quotes here)
- `CHANGELOG.md`
- `README.md` (badge)
- `package.json`
- `AGENTS.md`

- [ ] **Step 1: version.ts** — set `APP_VERSION = "0.125.0"`, `APP_MILESTONE = "Brunner"`, `APP_BUILD_DATE = "2026-06-22"`, append `"versionHighlightDeepLinkFlash"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: i18n EN** — in `src/app/i18n.ts` add key `versionHighlightDeepLinkFlash: "Deep-links now scroll to and highlight the target row in its list"` (place beside the other `versionHighlight*` keys).

- [ ] **Step 3: i18n DE** — add the same key to `src/app/i18n.de.ts` via a node utf8 write script (NOT the Edit tool). Value e.g. `"Deep-Links scrollen jetzt zur Zielzeile in ihrer Liste und heben sie hervor"`. Match the file's CRLF line endings (`\r\n` anchors) and real umlauts. Verify EN/DE key parity holds (`npx tsc --noEmit` enforces).

- [ ] **Step 4: CHANGELOG** — add a `## [0.125.0] - 2026-06-22 "Brunner"` entry describing the deep-link row scroll + highlight across the five panels (note the tasks-modern-full-page no-op caveat).

- [ ] **Step 5: README badge + package.json** — bump version badge to 0.125.0 and `package.json` `"version": "0.125.0"`.

- [ ] **Step 6: AGENTS.md** — add the "Deep-link row flash (v0.125.0)" pointer per the design doc's AGENTS.md section (shared hook, per-panel `data-deeplink-row` + `outline-AIPM-green`, fires alongside editor-open, doesn't clear `pendingOpen`, ★ tasks-full-page no-op caveat).

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` (i18n parity), `npm run lint`, `npm run test:run`. Then `npm run build` (prebuild + highlight-key checks). Confirm no stray generated-file diffs (`git status`); `git checkout --` any CRLF-only touch to generated files.

- [ ] **Step 8: Commit**

```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md README.md package.json AGENTS.md
git commit -m "release: 0.125.0 \"Brunner\" — deep-link row scroll + highlight"
```

---

## Self-review

- Spec coverage: hook (Task 1), all five panels (Task 2), release + i18n + AGENTS.md (Task 3). ✓
- Type consistency: `flashId: number | null`, `flashOutlineClass(isFlashed: boolean)`, `data-deeplink-row={id}` (numeric → string attr), view literals match `AppView` (`open-points` for tasks). ✓
- No placeholders. ✓
