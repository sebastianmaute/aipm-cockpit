# UI Polish Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution is **inline** (the harness is intermittently fabricating file-read content, so re-Read/Grep each file immediately before editing and adapt to the real content — do NOT trust pre-quoted line numbers blindly; verify by stable anchors like class strings and prop names).

**Goal:** Ship a batch of UI fixes (Groups A–G from the spec) to the lop-app modern layout as v0.37.0.

**Architecture:** Mostly className/JSX tweaks plus three small shared primitives: a `VIEW_PANE_CLASS`/`INNER_TABLE_CLASS` in a new `view-styles.ts` (with a sweep guard), a `fillHeight` prop on `TasksSection`, and an `alwaysOpen` prop on `JiraSettingsSection`. Scoped printing is pure CSS in `globals.css`.

**Tech Stack:** Next.js 16, React 18, TypeScript, Tailwind v4, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-31-ui-polish-batch-design.md`

**Verified anchors (from reliable greps/reads):**
- `export-menu.tsx` dropdown container: `className="absolute right-0 top-full z-20 mt-2 w-72 ..."` (the `role="dialog"`).
- `tasks-section.tsx` root `<section>`: `"relative mb-10 flex h-[560px] min-h-[300px] min-w-[520px] resize flex-col overflow-hidden rounded-xl border border-line bg-surface p-6"`.
- `sidebar.tsx:56`: `{!collapsed && <p className="mt-2">{version}</p>}` — `lang` is in scope.
- `version-menu.tsx`: Version popover already shows a "VERSION" term label (`versionVersion`) — no change needed there.
- `JiraSettingsSection` props `{ lang, config, onChange }`, `const [open, setOpen] = useState(false)`. Used at `settings-view.tsx:91` (modern) and `settings-menu.tsx:143` (classic popover).
- `resource-directory.tsx:218`: existing button `↧ {t(lang, "resourcesImportOutlook")}` gated by `onImportOutlook`.
- `task-manager.tsx:657-660`: `onImportOutlook: integrationsEnabled && !isPopout ? guardEdit(() => { void handleOpenOutlookImport(); }) : undefined`.
- `activity-log-panel.tsx:165` pane `"flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface p-4"`; header at 166 has `ResetColWidthsButton` + Clear.
- `reports.tsx:346` returns `<div className="space-y-6">`; `PrintButton` already imported, used at 349.
- `resources-panel.tsx:327` pane `rounded-xl`; inner table wrappers use `rounded-md border border-line` (e.g. :386).
- `chat-panel.tsx:253` root `<div className="flex h-full min-h-[300px] flex-col">`; inner scroller `flex-1 overflow-y-auto rounded-md border border-line bg-surface-muted p-3`.
- `globals.css:59-88`: existing `@media print` block (A4 @page, ink-strip, sticky reset).
- `PrintButton` lives in `task-manager-ui.tsx`, default onClick `() => window.print()`, has `print:hidden`.

---

### Task 1: Group A — Gantt export dropdown z-index

**Files:** Modify `src/app/export-menu.tsx`; Test `src/app/export-menu.test.tsx` (create if absent, else add a case).

- [ ] **Step 1: Write the failing test** — assert the export dropdown container is stacked above the Gantt frozen column (`z-40`).

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ExportMenu } from "./export-menu";

// Use the project's existing test harness/providers pattern if ExportMenu needs props.
it("stacks the export dropdown above the gantt header (z-40)", () => {
  // open the menu, then:
  const dialog = screen.getByRole("dialog", { name: /export/i });
  expect(dialog.className).toContain("z-40");
  expect(dialog.className).not.toContain("z-20");
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run src/app/export-menu.test.tsx`. Expected: FAIL (`z-20` present).
- [ ] **Step 3: Implement** — in `export-menu.tsx`, change the dropdown container `z-20` → `z-40`. Verify the exact current string by Grep first (`z-20 mt-2 w-72`).
- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Run full suite + tsc** — `npx vitest run && npx tsc --noEmit`. Expected: green.
- [ ] **Step 6: Commit** — `git add src/app/export-menu.tsx src/app/export-menu.test.tsx && git commit -m "fix: raise gantt export dropdown above sticky header (z-40)"`.

---

### Task 2: Group G — Version label prefix in sidebar

**Files:** Modify `src/app/sidebar.tsx`; Test `src/app/sidebar.test.tsx`.

- [ ] **Step 1: Write the failing test** — the sidebar version line includes the "Version" label.

```tsx
// In sidebar.test.tsx, render <Sidebar ... version="0.37.0" collapsed={false} lang="en" .../>
// Assert the version text reads "Version 0.37.0" (EN label from versionVersion).
expect(screen.getByText(/Version 0\.37\.0/)).toBeTruthy();
```

(Confirm the EN value of `versionVersion` via Grep in `i18n.ts` — likely "Version". If the i18n value already contains "Version", the rendered string is "Version 0.37.0".)

- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** — in `sidebar.tsx:56`, change `<p className="mt-2">{version}</p>` to `<p className="mt-2">{t(lang, "versionVersion")} {version}</p>`. (`t` and `lang` are already imported/in scope.)
- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Full suite + tsc green.**
- [ ] **Step 6: Commit** — `git add src/app/sidebar.tsx src/app/sidebar.test.tsx && git commit -m "feat: prefix sidebar version with the Version label"`.

---

### Task 3: Group C infra — shared view-pane styles + guard

**Files:** Create `src/app/view-styles.ts`; Create `src/app/view-pane-sweep.test.ts`.

- [ ] **Step 1: Create the constants module.**

```ts
// src/app/view-styles.ts
/** The standard view-pane chrome — a rounded, bordered surface card. Matches the
 *  Open Points (tasks) pane so every primary view reads consistently. */
export const VIEW_PANE_CLASS =
  "rounded-xl border border-line bg-surface";

/** Standard inner scroll-area chrome for tables inside a view pane. Keeps the
 *  resources sub-views visually identical to the tasks table (no divergent
 *  rounded-md inset card). */
export const INNER_TABLE_CLASS =
  "min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface";
```

- [ ] **Step 2: Write the sweep guard test** (runs after Task 4 wires consumers; write it now expecting the files list, mark which already comply).

```ts
// src/app/view-pane-sweep.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src", "app");

// Files that must source their primary pane from VIEW_PANE_CLASS.
const PANE_FILES = [
  "reports.tsx",
  "raid-panel.tsx",
  "budget-panel.tsx",
  "chat-panel.tsx",
];

// Forbidden: a divergent rounded-md inset card on the resources inner tables.
const INNER_FILES = [
  "resources-panel.tsx",
  "resource-directory.tsx",
  "resource-workload.tsx",
];

describe("view-pane sweep", () => {
  it("view-styles.ts exports the shared classes", () => {
    const src = readFileSync(join(ROOT, "view-styles.ts"), "utf8");
    expect(src).toContain("VIEW_PANE_CLASS");
    expect(src).toContain("INNER_TABLE_CLASS");
  });
  for (const f of PANE_FILES) {
    it(`${f} uses VIEW_PANE_CLASS`, () => {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src).toContain("VIEW_PANE_CLASS");
    });
  }
  for (const f of INNER_FILES) {
    it(`${f} uses INNER_TABLE_CLASS (no divergent rounded-md inset card)`, () => {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src).toContain("INNER_TABLE_CLASS");
    });
  }
});
```

- [ ] **Step 3: Run it, verify it fails** (consumers not wired yet). Expected: FAIL.
- [ ] **Step 4: Commit the infra** — `git add src/app/view-styles.ts src/app/view-pane-sweep.test.ts && git commit -m "feat: add shared VIEW_PANE_CLASS/INNER_TABLE_CLASS + sweep guard (red)"`.

---

### Task 4: Group C apply — wrap paneless views, flatten resources inner, fix chat padding

**Files:** Modify `src/app/reports.tsx`, `src/app/raid-panel.tsx`, `src/app/budget-panel.tsx`, `src/app/chat-panel.tsx`, `src/app/resources-panel.tsx`, `src/app/resource-directory.tsx`, `src/app/resource-workload.tsx`. Tests: the sweep guard (Task 3) + targeted render checks.

For EACH file: Grep the real wrapper first, then edit by anchor.

- [ ] **Step 1: Reports** — wrap the returned `<div className="space-y-6">` body so the outer element is `` `${VIEW_PANE_CLASS} p-6` `` (keep `space-y-6` on an inner div, or merge: `` `${VIEW_PANE_CLASS} space-y-6 p-6` ``). Import `VIEW_PANE_CLASS`.
- [ ] **Step 2: RAID panel** — find the root returned element; ensure it carries `` `${VIEW_PANE_CLASS} ...` `` matching the activity/resources pane pattern (`flex h-full min-h-0 flex-col overflow-hidden ${VIEW_PANE_CLASS} p-4`). Import the constant.
- [ ] **Step 3: Budget panel** — same: wrap its root in `` `${VIEW_PANE_CLASS} p-6` `` (preserve existing flex/scroll classes). Import the constant.
- [ ] **Step 4: Chat panel** — change root `<div className="flex h-full min-h-[300px] flex-col">` to add the pane + padding: `` `flex h-full min-h-[300px] flex-col ${VIEW_PANE_CLASS} p-6` ``. The inner scroller already has its own border; confirm it now sits inset with breathing room (item 10). Import the constant.
- [ ] **Step 5: Resources inner tables** — in `resources-panel.tsx`, `resource-directory.tsx`, `resource-workload.tsx`, replace inner table wrappers `"min-h-0 flex-1 overflow-auto rounded-md border border-line"` with `INNER_TABLE_CLASS`. Grep each occurrence (`rounded-md border border-line`) and confirm it's the table wrapper (not a chip/badge) before swapping. Import the constant.
- [ ] **Step 6: Run the sweep guard** — `npx vitest run src/app/view-pane-sweep.test.ts`. Expected: PASS.
- [ ] **Step 7: Run the affected component tests** — `npx vitest run src/app/reports.test.tsx src/app/raid-panel.test.tsx src/app/budget-panel.test.tsx src/app/resources-panel.test.tsx` and fix any class-based assertions that broke.
- [ ] **Step 8: Full suite + tsc green.**
- [ ] **Step 9: Commit** — `git add src/app/view-styles.ts src/app/reports.tsx src/app/raid-panel.tsx src/app/budget-panel.tsx src/app/chat-panel.tsx src/app/resources-panel.tsx src/app/resource-directory.tsx src/app/resource-workload.tsx src/app/view-pane-sweep.test.ts && git commit -m "feat: unify view panes onto VIEW_PANE_CLASS; flatten resources inner; pad chat"`.

> Gantt is intentionally NOT swept (full-bleed horizontal scroll). Do not add it to PANE_FILES.

---

### Task 5: Group B1 — Open Points fills available height (modern)

**Files:** Modify `src/app/tasks-section.tsx`, `src/app/task-manager.tsx`; Test `src/app/tasks-section.test.tsx`.

- [ ] **Step 1: Write the failing test** — `TasksSection` with `fillHeight` renders `h-full` and omits `resize`/`h-[560px]`; without it keeps the resizable box.

```tsx
// Render TasksSection via the existing test harness with fillHeight, then:
const section = container.querySelector("section");
expect(section?.className).toContain("h-full");
expect(section?.className).not.toContain("resize");
expect(section?.className).not.toContain("h-[560px]");
```

- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** — add `fillHeight?: boolean` to `TasksSectionProps`. Compute the root className:
  - `fillHeight` → `"relative mb-10 flex h-full min-h-0 min-w-[520px] flex-col overflow-hidden rounded-xl border border-line bg-surface p-6"`
  - else → the existing `"relative mb-10 flex h-[560px] min-h-[300px] min-w-[520px] resize flex-col overflow-hidden rounded-xl border border-line bg-surface p-6"`
- [ ] **Step 4: Wire modern** — in `task-manager.tsx`, the modern tree's `tasksSectionEl` should pass `fillHeight`. Grep for `tasksSectionEl` and the `<TasksSection` usage; if `tasksSectionEl` is shared between classic and modern, create a modern-specific instance or pass `fillHeight={settings.layout === "modern"}` (classic must NOT get fillHeight). Verify by reading the real definition first (harness-unreliable file — use Grep + small targeted reads).
- [ ] **Step 5: Run the test, verify it passes.**
- [ ] **Step 6: Run `task-manager.shell.test.tsx` + tasks tests** and fix fallout.
- [ ] **Step 7: Full suite + tsc green.**
- [ ] **Step 8: Commit** — `git add src/app/tasks-section.tsx src/app/task-manager.tsx src/app/tasks-section.test.tsx && git commit -m "feat: open-points table fills available height in modern layout"`.

---

### Task 6: Group B2 — Classic layout fits the viewport (footer always visible)

**Files:** Modify `src/app/task-manager.tsx` (legacyTree wrapper) and possibly `src/app/app-modals.tsx` (footer placement). Test: `src/app/task-manager.shell.test.tsx` or a focused test.

- [ ] **Step 1: Read the real legacyTree + footer** (Grep `legacyTree`, `mx-auto w-full max-w-[1536px]`, the `<footer` in app-modals). Confirm structure before editing.
- [ ] **Step 2: Write the failing test** — the classic (non-popout) root carries viewport-height flex-column classes.

```tsx
// Render TaskManager in classic layout (localStorage settings layout: "classic"), then:
// assert the outer classic wrapper has "h-screen" and "flex" and "flex-col".
```

- [ ] **Step 3: Implement** — wrap the non-popout `legacyTree` so the outer is `"flex h-screen flex-col"`, the header is `shrink-0`, the scrolling content region (workspace + tasks) is `"flex-1 min-h-0 overflow-auto"`, and the footer is a `shrink-0` sibling at the bottom (move the `app-modals.tsx` footer out of the scroll region if needed, behind the existing `!isPopout` guard). Keep `max-w-[1536px] mx-auto` on the inner content. Popout path unchanged.
- [ ] **Step 4: Run the test, verify it passes.**
- [ ] **Step 5: Run shell/app-modals tests** and fix fallout (e.g. `app-modals.test.tsx` footer-visibility test).
- [ ] **Step 6: Full suite + tsc green.**
- [ ] **Step 7: Commit** — `git add src/app/task-manager.tsx src/app/app-modals.tsx src/app/*.test.tsx && git commit -m "feat: classic layout fits viewport with always-visible footer"`.

> If wrapping the legacy tree turns out to break the popout or report layouts, STOP and report — do not force it.

---

### Task 7: Group D — Scoped printing + Activity print button

**Files:** Modify `src/app/globals.css`, `src/app/reports.tsx`, `src/app/raid-report-panel.tsx`, `src/app/resources-report.tsx`, `src/app/activity-log-panel.tsx`. Tests: targeted render checks.

- [ ] **Step 1: Write failing tests** — each printable container has `print-root`; Activity header renders a PrintButton.

```tsx
// reports/raid-report/resources-report/activity: assert the root print container className contains "print-root".
// activity-log-panel: expect a button with the printHint accessible name to exist.
```

- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Add the `print-root` class** to the outer container of Reports, RAID Report, Resources Report, and the Activity pane.
- [ ] **Step 4: Add the Activity PrintButton** — import `PrintButton` from `./task-manager-ui` and place it in the Activity header next to `ResetColWidthsButton` (reuses `printHint`).
- [ ] **Step 5: Extend `globals.css` `@media print`** — inside the existing block add:

```css
  /* Scope printing to the report node only — hide everything else. */
  body * { visibility: hidden; }
  .print-root, .print-root * { visibility: visible; }
  .print-root { position: absolute; inset: 0; width: 100%; }
```

Keep the existing A4 @page, ink-strip, and sticky-reset rules. (Place the visibility rules so they don't clobber the existing `[class*="bg-surface"]` ink rules — order them before, since visibility and background are independent.)

- [ ] **Step 6: Run the tests, verify they pass.**
- [ ] **Step 7: Full suite + tsc green.**
- [ ] **Step 8: Commit** — `git add src/app/globals.css src/app/reports.tsx src/app/raid-report-panel.tsx src/app/resources-report.tsx src/app/activity-log-panel.tsx src/app/*.test.tsx && git commit -m "feat: scope report printing to the report node; add Activity print button"`.

---

### Task 8: Group E — Jira section always open in modern settings

**Files:** Modify `src/app/jira-settings.tsx`, `src/app/settings-view.tsx`; Test `src/app/jira-settings.test.tsx`.

- [ ] **Step 1: Write the failing test** — with `alwaysOpen`, the section body is visible and no collapse toggle renders; without it, it starts collapsed.

```tsx
import { render, screen } from "@testing-library/react";
import { JiraSettingsSection } from "./jira-settings";
// alwaysOpen: assert a body field (e.g. site URL input) is present and the
// expand/collapse toggle button is absent.
// default: assert the body is collapsed (toggle present, body field absent).
```

- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** — add `alwaysOpen?: boolean` to the `JiraSettingsSection` props. When `alwaysOpen`, treat `open` as always true and do not render the collapse toggle (`const isOpen = alwaysOpen || open;` and guard the toggle button with `{!alwaysOpen && (...)}`).
- [ ] **Step 4: Wire modern** — in `settings-view.tsx:91`, pass `alwaysOpen` to `<JiraSettingsSection .../>`. Leave `settings-menu.tsx:143` (classic popover) unchanged.
- [ ] **Step 5: Run the test, verify it passes.**
- [ ] **Step 6: Run `jira-settings.test.tsx` + `settings-view.test.tsx`** (the latter mocks the section — verify the mock still matches).
- [ ] **Step 7: Full suite + tsc green.**
- [ ] **Step 8: Commit** — `git add src/app/jira-settings.tsx src/app/settings-view.tsx src/app/jira-settings.test.tsx && git commit -m "feat: Jira settings always expanded in the modern settings view"`.

---

### Task 9: Group F — Rename Import→Sync + show in address-book pop-out

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/task-manager.tsx`, possibly `src/app/resource-directory.tsx`. Tests: `src/app/resource-directory.test.tsx`.

- [ ] **Step 1: Verify the read-only constraint FIRST** — Grep `guardEdit`, `makeEditGuard`, `isPopout` to confirm whether an Outlook import triggered from a pop-out can persist. If it cannot (pop-out is a read-only mirror that never persists/broadcasts), the pop-out button would be a no-op — STOP and report this to the user with options before proceeding to Step 4. Steps 2–3 (rename) are safe regardless.
- [ ] **Step 2: Rename label** — change the EN string `resourcesImportOutlook` value to "Sync with Outlook" in `i18n.ts`. Update the DE value in `i18n.de.ts` to "Mit Outlook synchronisieren". **After editing `i18n.de.ts`, Grep it for curly quotes (`"` `"`) to confirm the Edit tool didn't corrupt ASCII quotes.**
- [ ] **Step 3: Run i18n/string tests** — confirm no snapshot/string test broke.
- [ ] **Step 4: Show in pop-out (only if Step 1 confirmed it persists)** — change `task-manager.tsx:657-660` gating from `integrationsEnabled && !isPopout` to `integrationsEnabled` so the pop-out address book also gets the handler. Verify the directory button renders in the pop-out.
- [ ] **Step 5: Update the directory test** — `resource-directory.test.tsx` already covers "renders Import from Outlook only when onImportOutlook is provided"; update its expected label to "Sync with Outlook".
- [ ] **Step 6: Run the directory tests, verify pass.**
- [ ] **Step 7: Full suite + tsc green.**
- [ ] **Step 8: Commit** — `git add src/app/i18n.ts src/app/i18n.de.ts src/app/task-manager.tsx src/app/resource-directory.tsx src/app/resource-directory.test.tsx && git commit -m "feat: rename Outlook import to Sync; surface it in the address-book pop-out"`.

---

### Task 10: Release — version bump, changelog, memory

**Files:** Modify `src/app/version.ts`, `CHANGELOG.md`, memory files.

- [ ] **Step 1: Pick codename** — `git grep -i` candidate sci-fi/fantasy author surnames (e.g. Kowal, Chambers, Bujold, Tchaikovsky) to confirm UNUSED; pick the first free one.
- [ ] **Step 2: Bump** — `APP_VERSION = "0.37.0"`, `APP_BUILD_DATE = "2026-05-31"` (codename comment), and prepend a milestone comment block summarizing Groups A–G. Add any new `APP_HIGHLIGHT_KEYS` only if you also add the matching i18n strings (optional; skip if not adding highlights).
- [ ] **Step 3: CHANGELOG.md** — add a `0.37.0` entry describing the seven groups.
- [ ] **Step 4: Full suite + tsc green** (final, in the same turn).
- [ ] **Step 5: Commit** — `git add src/app/version.ts CHANGELOG.md && git commit -m "release: 0.37.0 — UI polish batch (<codename>)"`.
- [ ] **Step 6: Update memory** — append a paragraph to `~/.claude/projects/C--Projects-lop-app/memory/modern-layout-roadmap.md` + the `MEMORY.md` index line (v0.37.0, groups A–G, real SHAs only — never fabricate).

---

## Finishing

After all tasks: use superpowers:finishing-a-development-branch — verify the full suite is green, then present merge/PR options. Per user workflow: merge to `main` locally; push only on explicit request. Never `git add -A`/`.`; never touch README.md or public/*.png.

## Self-review notes
- **Spec coverage:** A→T1, G→T2, C(4/10/11)→T3+T4, B1(5)→T5, B2(2)→T6, D(6/8)→T7, E(7)→T8, F(9)→T9, release→T10. All seven groups covered.
- **Known risk:** Task 9 Step 1 read-only gate (pop-out persistence) and Task 6 legacy-tree wrap are the two spots most likely to need a STOP-and-report. Both are flagged inline.
- **Harness caveat:** `task-manager.tsx` and `i18n.ts` reads have been fabricating content — verify by Grep + small targeted reads, never trust large pre-quoted blocks.
