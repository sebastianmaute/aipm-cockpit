# Modern Sidebar Layout — Phase 3: Table Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every primary data table the `table.png` treatment — a Dark-Blue header row with white text — sourced from one shared class constant, plus Light-Grey zebra striping on the LOP table.

**Architecture:** Introduce a single `TABLE_HEAD_CLASS` constant (`src/app/table-styles.ts`) and point all 10 `<thead>` blocks that share the identical legacy header string at it. Fix the header *contents* (sort-button hover colors, the shared column-resize handle) so they read on Dark-Blue using only palette colors (white text, green hover). Add an opt-in `isStriped` prop to `TaskRow` for the LOP zebra. Status badges are already palette-compliant (priority pills, health dots, RAID/dep chips) — Phase 3 audits them and changes nothing there.

**Tech Stack:** Next.js 16 (App Router), React, TypeScript, Tailwind v4 (CSS-var tokens), Vitest + React Testing Library.

**Hard color constraint (locked):** Only the 9 Acme brand colors already wired in `globals.css` (`AIPM-dark-grey`, `AIPM-dark-blue`, `AIPM-green`, `AIPM-white`, `AIPM-light-grey`, `AIPM-medium-grey`, `AIPM-blue`, `AIPM-pink`, `AIPM-purple`) plus the semantic tokens (`surface`, `surface-muted`, `line`, `foreground`, `muted-foreground`) and Tailwind `white`. Green is the dominant accent; Dark Blue for headers. **No gradients, no drop shadows, no off-palette colors.** Opacity modifiers on permitted colors (e.g. `bg-white/30`, `bg-surface-muted/40`) are allowed.

**Scope (decided with the user):**
- **Shared sweep** — the LOP table plus the 9 other tables that use the *identical* legacy header string. The 5 divergent tables (`reports.tsx` ×3, `budget-panel.tsx`, `jira-conflicts-modal.tsx`, `roles-modal.tsx`, `resource-calendar.tsx`) are **out of scope** (Phase 4 polish).
- **Zebra striping** — **LOP table only.** Secondary tables get the Dark-Blue header only.

**Swept files (10 `<thead>` blocks across 8 files):** `tasks-section.tsx`, `raid-panel.tsx`, `raid-report-panel.tsx` (×2), `activity-log-panel.tsx`, `resource-directory.tsx`, `resource-workload.tsx`, `resources-panel.tsx` (×2), `resources-report.tsx`.

---

## File Structure

- **Create:** `src/app/table-styles.ts` — exports `TABLE_HEAD_CLASS` (single source of truth for the Dark-Blue sticky header). Tiny, dependency-free.
- **Create:** `src/app/table-styles.test.ts` — asserts the constant's tokens.
- **Create:** `src/app/table-head-sweep.test.ts` — a source-guard test: every swept file imports `TABLE_HEAD_CLASS` and no longer contains the legacy header string. Grown across Tasks 3, 5, 6.
- **Modify:** `src/app/task-manager-ui.tsx` — shared header primitives `SortableTh` + `ColumnResizeHandle` (white text / green hover / white resize-hover). Used only by the LOP table, but `ColumnResizeHandle` is shared by every swept table.
- **Modify:** `src/app/task-manager-ui.test.tsx` — update the hover-class assertion.
- **Modify:** `src/app/tasks-section.tsx` — LOP `<thead>` → `TABLE_HEAD_CLASS`; pass `isStriped` to `TaskRow`.
- **Modify:** `src/app/tasks-section.test.tsx` — assert the rendered `<thead>` is Dark-Blue.
- **Modify:** `src/app/task-row.tsx` — add `isStriped?: boolean`; apply zebra background.
- **Modify:** `src/app/task-row.test.tsx` — assert the zebra class is present/absent.
- **Modify (sweep):** `raid-panel.tsx`, `raid-report-panel.tsx`, `activity-log-panel.tsx`, `resource-directory.tsx`, `resource-workload.tsx`, `resources-panel.tsx`, `resources-report.tsx`.
- **Modify (release):** `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `CHANGELOG.md`.

**Test commands (Windows / PowerShell-safe):**
- Single file: `npx vitest run src/app/table-styles.test.ts`
- Type-check: `npx tsc --noEmit`
- Lint a file: `npx eslint src/app/table-styles.ts` (note: `next lint` was removed in Next 16)
- Full suite: `npx vitest run`

---

## Task 1: Shared `TABLE_HEAD_CLASS` constant

**Files:**
- Create: `src/app/table-styles.ts`
- Test: `src/app/table-styles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/table-styles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TABLE_HEAD_CLASS } from "./table-styles";

describe("TABLE_HEAD_CLASS", () => {
  it("is a Dark-Blue, white-text, sticky header on the AIPM palette", () => {
    expect(TABLE_HEAD_CLASS).toContain("bg-AIPM-dark-blue");
    expect(TABLE_HEAD_CLASS).toContain("text-white");
    expect(TABLE_HEAD_CLASS).toContain("sticky");
    expect(TABLE_HEAD_CLASS).toContain("top-0");
    expect(TABLE_HEAD_CLASS).toContain("uppercase");
  });

  it("drops the old muted-grey header tokens", () => {
    expect(TABLE_HEAD_CLASS).not.toContain("bg-surface-muted");
    expect(TABLE_HEAD_CLASS).not.toContain("text-muted-foreground");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/table-styles.test.ts`
Expected: FAIL — `Failed to resolve import "./table-styles"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/table-styles.ts`:

```ts
/**
 * Shared header styling for every primary data table (the `table.png`
 * treatment): a sticky Dark-Blue header row with white, uppercase, tracked
 * labels. Single source of truth — change the table header look here.
 *
 * Palette note: Dark Blue (#004159) header + White (#FFFFFF) text are both
 * permitted AIPM brand colors; button/sort hovers inside the header use the
 * Green accent (see SortableTh / per-table header buttons).
 */
export const TABLE_HEAD_CLASS =
  "sticky top-0 z-10 bg-AIPM-dark-blue text-xs uppercase tracking-wide text-white";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/table-styles.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/table-styles.ts src/app/table-styles.test.ts
git commit -m "feat: add shared TABLE_HEAD_CLASS (Dark-Blue table header)"
```

---

## Task 2: LOP header primitives — white text, green hover

The LOP table's `SortableTh` and the shared `ColumnResizeHandle` live in `task-manager-ui.tsx`. Their current hover/active colors (`text-foreground`, `hover:bg-AIPM-dark-blue/40`) disappear on a Dark-Blue header. Recolor to white-inherited text with a Green hover, and a white resize-hover. `ColumnResizeHandle` is imported by **every** swept table, so this one edit fixes the resize affordance everywhere.

**Files:**
- Modify: `src/app/task-manager-ui.tsx` (`ColumnResizeHandle` ~line 186-192; `SortableTh` button ~line 233-243)
- Test: `src/app/task-manager-ui.test.tsx` (~line 15)

- [ ] **Step 1: Update the failing test first**

In `src/app/task-manager-ui.test.tsx`, change the assertion on line 15 from:

```ts
    expect(btn.className).toContain("hover:text-foreground");
```

to:

```ts
    expect(btn.className).toContain("hover:text-AIPM-green");
    expect(btn.className).not.toContain("text-foreground");
```

Also update the test title on line 7 from `"...the resources-matching hover class"` to `"...a Sort by <label> tooltip and a green hover for the Dark-Blue header"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/task-manager-ui.test.ts`
Expected: FAIL — current button className still contains `hover:text-foreground` and not `hover:text-AIPM-green`.

- [ ] **Step 3: Implement the recolor**

In `src/app/task-manager-ui.tsx`, update `ColumnResizeHandle`'s `className` (the `<div>` inside it) from:

```tsx
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-AIPM-dark-blue/40 dark:hover:bg-AIPM-blue/40 print:hidden"
```

to:

```tsx
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-white/30 print:hidden"
```

Then update the `SortableTh` button `className` from:

```tsx
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground ${isActive ? "text-foreground" : ""}`}
```

to:

```tsx
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-AIPM-green ${isActive ? "text-AIPM-green" : ""}`}
```

(Leave `Th`, `TabButton`, the icon components, `ResetColWidthsButton`, and `PrintButton` unchanged — `Th`'s plain children inherit the header's white text automatically.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/task-manager-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-manager-ui.tsx src/app/task-manager-ui.test.tsx
git commit -m "feat: recolor LOP header primitives for Dark-Blue header (white/green)"
```

---

## Task 3: LOP table header → Dark-Blue

Point the LOP `<thead>` at the shared constant, and seed the source-guard test.

**Files:**
- Modify: `src/app/tasks-section.tsx` (import + `<thead>` ~line 451)
- Modify: `src/app/tasks-section.test.tsx` (add a render assertion)
- Create: `src/app/table-head-sweep.test.ts`

- [ ] **Step 1: Write the failing render assertion**

In `src/app/tasks-section.test.tsx`, add this test inside the `describe("TasksSection", ...)` block (after the existing `"renders table when..."` test, ~line 177):

```tsx
  it("renders a Dark-Blue sticky table header", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    const { container } = render(<TasksSection {...makeProps()} />);
    const thead = container.querySelector("thead");
    expect(thead?.className).toContain("bg-AIPM-dark-blue");
    expect(thead?.className).not.toContain("bg-surface-muted");
  });
```

- [ ] **Step 2: Write the failing source-guard test**

Create `src/app/table-head-sweep.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The exact legacy header string every swept <thead> used before Phase 3.
const LEGACY_HEAD =
  "bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground";

// Files swept so far. Grown in Tasks 5 and 6.
const SWEPT_FILES = ["tasks-section.tsx"];

describe("table header sweep", () => {
  for (const file of SWEPT_FILES) {
    it(`${file} uses TABLE_HEAD_CLASS, not the legacy muted header`, () => {
      const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(src).not.toContain(LEGACY_HEAD);
      expect(src).toContain("TABLE_HEAD_CLASS");
    });
  }
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run src/app/tasks-section.test.ts src/app/table-head-sweep.test.ts`
Expected: FAIL — `tasks-section.tsx` still has the muted header and no `TABLE_HEAD_CLASS` import.

- [ ] **Step 4: Implement the swap**

In `src/app/tasks-section.tsx`, add the import near the other local imports (after the `task-manager-ui` import block, ~line 20):

```tsx
import { TABLE_HEAD_CLASS } from "./table-styles";
```

Then change the `<thead>` opening tag (~line 451) from:

```tsx
            <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
```

to:

```tsx
            <thead className={TABLE_HEAD_CLASS}>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/tasks-section.test.ts src/app/table-head-sweep.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/tasks-section.tsx src/app/tasks-section.test.tsx src/app/table-head-sweep.test.ts
git commit -m "feat: Dark-Blue header on the LOP table; add header-sweep guard test"
```

---

## Task 4: LOP zebra striping

Add Light-Grey alternating rows to the LOP table via an opt-in `isStriped` prop on `TaskRow`. Striping yields to the existing per-row states (editing/selected) and composes with the completed-row dimming, preserving current precedence.

**Files:**
- Modify: `src/app/task-row.tsx` (`TaskRowProps` ~line 124-131; `TaskRowImpl` signature + `<tr>` ~line 133-160)
- Modify: `src/app/tasks-section.tsx` (the `filteredSortedTasks.map(...)` ~line 495-505)
- Test: `src/app/task-row.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/app/task-row.test.tsx`, add this `describe` block after the existing `describe("TaskRow", ...)` block (after line 175):

```tsx
describe("TaskRow zebra striping", () => {
  test("striped row carries the alternating background", () => {
    const ctx = makeContext();
    const { container } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 2 })}
            isSelected={false}
            isEditing={false}
            isExpanded={false}
            isPushing={false}
            raidRefs={undefined}
            isStriped
          />
        ),
      }),
    );
    const tr = container.querySelector("tbody tr");
    expect(tr?.className).toContain("bg-surface-muted/40");
  });

  test("unstriped default row has no alternating background", () => {
    const ctx = makeContext();
    const { container } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 3 })}
            isSelected={false}
            isEditing={false}
            isExpanded={false}
            isPushing={false}
            raidRefs={undefined}
            isStriped={false}
          />
        ),
      }),
    );
    const tr = container.querySelector("tbody tr");
    expect(tr?.className).not.toContain("bg-surface-muted/40");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/task-row.test.tsx`
Expected: FAIL — `isStriped` is not a known prop / no `bg-surface-muted/40` class.

- [ ] **Step 3: Implement the prop**

In `src/app/task-row.tsx`, add `isStriped` to `TaskRowProps` (after `raidRefs`, ~line 130):

```tsx
interface TaskRowProps {
  task: Task;
  isSelected: boolean;
  isEditing: boolean;
  isExpanded: boolean;
  isPushing: boolean;
  raidRefs: RaidItem[] | undefined;
  isStriped?: boolean;
}
```

Add it to the destructured signature of `TaskRowImpl` (~line 133-140):

```tsx
function TaskRowImpl({
  task,
  isSelected,
  isEditing,
  isExpanded,
  isPushing,
  raidRefs,
  isStriped = false,
}: TaskRowProps) {
```

Replace the `<tr>` opening tag (~line 158-160) — currently:

```tsx
    <tr
      className={`align-top ${isEditing ? "bg-AIPM-purple/10 dark:bg-AIPM-purple/15" : isSelected ? "bg-surface-muted" : isComplete ? "opacity-60" : ""}`}
    >
```

with (compute the class above the `return` for readability — place it right after the `label` const, ~line 156):

```tsx
  const stateClass = isEditing
    ? "bg-AIPM-purple/10 dark:bg-AIPM-purple/15"
    : isSelected
      ? "bg-surface-muted"
      : isComplete
        ? `opacity-60${isStriped ? " bg-surface-muted/40" : ""}`
        : isStriped
          ? "bg-surface-muted/40"
          : "";

  return (
    <tr className={`align-top ${stateClass}`}>
```

This preserves the original precedence exactly (editing → purple, selected → muted, completed → dim) and only adds the Light-Grey zebra tint to otherwise-default and completed rows.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/task-row.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire striping from `tasks-section.tsx`**

In `src/app/tasks-section.tsx`, change the row map (~line 495-505) from:

```tsx
              {filteredSortedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isSelected={selectedIds.has(task.id)}
                  isEditing={editingId === task.id}
                  isExpanded={expandedNotes.has(task.id)}
                  isPushing={pushingIds.has(task.id)}
                  raidRefs={raidByTask.get(task.id)}
                />
              ))}
```

to (add the index and pass `isStriped`):

```tsx
              {filteredSortedTasks.map((task, i) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isSelected={selectedIds.has(task.id)}
                  isEditing={editingId === task.id}
                  isExpanded={expandedNotes.has(task.id)}
                  isPushing={pushingIds.has(task.id)}
                  raidRefs={raidByTask.get(task.id)}
                  isStriped={i % 2 === 1}
                />
              ))}
```

- [ ] **Step 6: Run the related suites + type-check**

Run: `npx vitest run src/app/task-row.test.tsx src/app/tasks-section.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 7: Commit**

```bash
git add src/app/task-row.tsx src/app/task-row.test.tsx src/app/tasks-section.tsx
git commit -m "feat: Light-Grey zebra striping on the LOP table"
```

---

## Task 5: Sweep the RAID tables

Swap the RAID `<thead>` blocks to `TABLE_HEAD_CLASS` and recolor their header sort-buttons from the now-invisible `hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey` (and `hover:text-foreground`) to a Green hover.

**Files:**
- Modify: `src/app/raid-panel.tsx` (`<thead>` line 454; 7 header buttons lines 457-493)
- Modify: `src/app/raid-report-panel.tsx` (two `<thead>` blocks lines 243 & 289; `SortTh` button line 344)
- Modify: `src/app/table-head-sweep.test.ts` (extend `SWEPT_FILES`)

- [ ] **Step 1: Extend the guard test (RED)**

In `src/app/table-head-sweep.test.ts`, change `SWEPT_FILES` to:

```ts
const SWEPT_FILES = ["tasks-section.tsx", "raid-panel.tsx", "raid-report-panel.tsx"];
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `npx vitest run src/app/table-head-sweep.test.ts`
Expected: FAIL — `raid-panel.tsx` and `raid-report-panel.tsx` still contain the legacy header and no `TABLE_HEAD_CLASS`.

- [ ] **Step 3: Sweep `raid-panel.tsx`**

Add the import near the top with the other `./` imports:

```tsx
import { TABLE_HEAD_CLASS } from "./table-styles";
```

Change the `<thead>` (line 454) from:

```tsx
          <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
```

to:

```tsx
          <thead className={TABLE_HEAD_CLASS}>
```

Then replace **all 7** occurrences of the exact substring `hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey` (lines 457, 463, 469, 475, 481, 487, 493 — all are header sort buttons) with `hover:text-AIPM-green`. Use a replace-all on that exact string.

Verify none remain: `npx eslint src/app/raid-panel.tsx` and a grep — `Select-String -Path src/app/raid-panel.tsx -Pattern "AIPM-dark-blue dark:hover"` should return nothing.

- [ ] **Step 4: Sweep `raid-report-panel.tsx`**

Add the import:

```tsx
import { TABLE_HEAD_CLASS } from "./table-styles";
```

Change **both** `<thead>` opening tags (lines 243 and 289), each currently:

```tsx
        <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
```

to:

```tsx
        <thead className={TABLE_HEAD_CLASS}>
```

Then in the `SortTh` helper (line 344), change the button `className` from:

```tsx
        className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""} hover:text-foreground`}
```

to:

```tsx
        className={`inline-flex items-center gap-1 ${active ? "text-AIPM-green" : ""} hover:text-AIPM-green`}
```

- [ ] **Step 5: Run the guard + type-check**

Run: `npx vitest run src/app/table-head-sweep.test.ts`
Expected: PASS (3 files).
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Run the RAID suites for regression**

Run: `npx vitest run src/app/raid-panel.test.tsx src/app/raid-report-panel.test.tsx`
Expected: PASS (existing tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/app/raid-panel.tsx src/app/raid-report-panel.tsx src/app/table-head-sweep.test.ts
git commit -m "feat: Dark-Blue headers on the RAID + RAID-report tables"
```

---

## Task 6: Sweep the Activity + Resources tables

Swap the remaining swept `<thead>` blocks and recolor their header buttons. `resource-workload`, `resources-panel`, and `resources-report` have plain-text headers (no buttons) — header-string swap only. `activity-log-panel` and `resource-directory` have sort buttons to recolor.

**Files:**
- Modify: `src/app/activity-log-panel.tsx` (`<thead>` line 246; 3 buttons lines 256, 271, 286)
- Modify: `src/app/resource-directory.tsx` (`<thead>` line 233; 8 buttons lines 236-278)
- Modify: `src/app/resource-workload.tsx` (`<thead>` line 67)
- Modify: `src/app/resources-panel.tsx` (two `<thead>` blocks lines 387 & 533)
- Modify: `src/app/resources-report.tsx` (`<thead>` line 223)
- Modify: `src/app/table-head-sweep.test.ts` (extend `SWEPT_FILES`)

- [ ] **Step 1: Extend the guard test (RED)**

In `src/app/table-head-sweep.test.ts`, change `SWEPT_FILES` to the full set:

```ts
const SWEPT_FILES = [
  "tasks-section.tsx",
  "raid-panel.tsx",
  "raid-report-panel.tsx",
  "activity-log-panel.tsx",
  "resource-directory.tsx",
  "resource-workload.tsx",
  "resources-panel.tsx",
  "resources-report.tsx",
];
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `npx vitest run src/app/table-head-sweep.test.ts`
Expected: FAIL — the 5 newly-listed files still carry the legacy header.

- [ ] **Step 3: Sweep `activity-log-panel.tsx`**

Add `import { TABLE_HEAD_CLASS } from "./table-styles";`. Change the `<thead>` (line 246) to `<thead className={TABLE_HEAD_CLASS}>`. Replace **all 3** occurrences of `hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey` (lines 256, 271, 286) with `hover:text-AIPM-green`.

- [ ] **Step 4: Sweep `resource-directory.tsx`**

Add `import { TABLE_HEAD_CLASS } from "./table-styles";`. Change the `<thead>` (line 233) to `<thead className={TABLE_HEAD_CLASS}>`. Replace **all 8** occurrences of the button class `hover:text-foreground` (lines 236, 242, 248, 254, 260, 266, 272, 278 — all header sort buttons) with `hover:text-AIPM-green`. (Confirm with `Select-String -Path src/app/resource-directory.tsx -Pattern "hover:text-foreground"` returning nothing afterward.)

- [ ] **Step 5: Sweep `resource-workload.tsx`**

Add `import { TABLE_HEAD_CLASS } from "./table-styles";`. Change the `<thead>` (line 67) to `<thead className={TABLE_HEAD_CLASS}>`. (Plain-text headers; no button recolor needed.)

- [ ] **Step 6: Sweep `resources-panel.tsx`**

Add `import { TABLE_HEAD_CLASS } from "./table-styles";`. Change **both** `<thead>` tags (lines 387 and 533) to `<thead className={TABLE_HEAD_CLASS}>`. (Plain-text headers.)

- [ ] **Step 7: Sweep `resources-report.tsx`**

Add `import { TABLE_HEAD_CLASS } from "./table-styles";`. Change the `<thead>` (line 223, inside `ReportTableShell`) to `<thead className={TABLE_HEAD_CLASS}>`. (Plain-text headers.)

- [ ] **Step 8: Run the guard + type-check + regression**

Run: `npx vitest run src/app/table-head-sweep.test.ts`
Expected: PASS (8 files).
Run: `npx tsc --noEmit`
Expected: clean.
Run: `npx vitest run src/app/activity-log-panel.test.tsx src/app/resource-directory.test.tsx src/app/resources-panel.test.tsx`
Expected: PASS for any that exist (skip names with no test file).

- [ ] **Step 9: Commit**

```bash
git add src/app/activity-log-panel.tsx src/app/resource-directory.tsx src/app/resource-workload.tsx src/app/resources-panel.tsx src/app/resources-report.tsx src/app/table-head-sweep.test.ts
git commit -m "feat: Dark-Blue headers on the Activity + Resources tables"
```

---

## Task 7: Badge audit + release 0.31.0 "Leckie"

Confirm status badges are already palette-compliant (no code change expected), then bump the version, add the highlight key, and update the changelog and project memory.

**Files:**
- Verify only: `src/app/task-row.tsx`, `src/app/raid-panel.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: Audit status/priority badges (verification, no edit)**

Run these greps and confirm every badge color is an AIPM token (allowed) — expect **no** off-palette colors (no raw `red-`, `amber-`, `yellow-`, `slate-`, `gray-`, `indigo-`, hex codes, gradients, or shadows in badge spans):

```
Select-String -Path src/app/task-row.tsx,src/app/raid-panel.tsx -Pattern "bg-(red|amber|yellow|slate|gray|indigo|emerald|sky)-|drop-shadow|shadow-|gradient"
```

Expected: no matches. The priority pills (`priorityStyle`: Low=muted, Medium=AIPM-blue, High=AIPM-purple, Urgent=AIPM-pink), health dots, RAID category chips, and dependency chips are already on the palette — **make no changes.** This satisfies the spec's "palette-only status badges (only adds treatment where missing)."

- [ ] **Step 2: Add the highlight i18n key (EN)**

In `src/app/i18n.ts`, add next to the other `versionHighlight*` keys:

```ts
  versionHighlightTableRestyle: "Table restyle — Dark-Blue headers across the data tables, zebra rows on the LOP list",
```

- [ ] **Step 3: Add the highlight i18n key (DE)**

In `src/app/i18n.de.ts`, add the matching key. **DE-edit hazard:** this file is prone to ASCII→curly-quote corruption — use straight ASCII `"` delimiters and verify after. The string has no inner quotes, so it is low-risk:

```ts
  versionHighlightTableRestyle: "Tabellen-Redesign — dunkelblaue Kopfzeilen in den Datentabellen, Zebrazeilen in der LOP-Liste",
```

After editing, verify the file still parses: `npx tsc --noEmit` (clean) and grep the key exists in both files.

- [ ] **Step 4: Register the highlight key**

In `src/app/version.ts`, append to `APP_HIGHLIGHT_KEYS` (after `"versionHighlightFullPageEdit"`):

```ts
  "versionHighlightTableRestyle",
```

- [ ] **Step 5: Bump version + milestone comment**

In `src/app/version.ts`:
- Prepend a milestone comment block at the very top (above the `0.30.0 "Liu"` comment):

```ts
// 0.31.0 "Leckie" is Phase 3 of the modern layout: a table restyle. Every
// primary data table (Open Points, RAID + RAID Report, Activity, Resource
// Directory/Workload/Planning/Rollup, Resources Report) now has a Dark-Blue
// header row with white labels, sourced from one shared TABLE_HEAD_CLASS; the
// LOP list also gains Light-Grey zebra striping. Status badges were already on
// the AIPM palette and are unchanged. Header sort-buttons hover green.
```

- Change `APP_VERSION` to `"0.31.0"`.
- Change `APP_BUILD_DATE` to `"2026-05-30"; // Leckie milestone`.

- [ ] **Step 6: Add the changelog entry**

In `CHANGELOG.md`, insert above the `## [0.30.0]` entry:

```markdown
## [0.31.0] — 2026-05-30 "Leckie"

### Changed
- **Table restyle (Dark-Blue headers).** Every primary data table — Open Points, RAID and the RAID Report, the Activity log, the Resource Directory / Workload / Planning / Rollup grids, and the Resources Report — now has a Dark-Blue header row with white, uppercase labels (the `table.png` treatment), sourced from one shared style so the look stays consistent. Header sort buttons highlight in green on hover.
- **Zebra striping on the Open Points list.** The LOP table now alternates a Light-Grey tint on every other row for easier scanning. Selected, in-edit, and completed rows keep their existing emphasis. This is Phase 3 of the sidebar-layout redesign.
```

- [ ] **Step 7: Full verification**

Run: `npx tsc --noEmit`
Expected: clean.
Run: `npx vitest run`
Expected: all pass (the existing suite plus the new `table-styles`, `table-head-sweep`, and zebra/header tests).

- [ ] **Step 8: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/version.ts CHANGELOG.md
git commit -m "release: 0.31.0 — table restyle (Dark-Blue headers + LOP zebra)"
```

- [ ] **Step 9: Update project memory**

Update `~/.claude/projects/C--Projects-lop-app/memory/modern-layout-roadmap.md`: mark Phase 3 COMPLETE (v0.31.0 "Leckie"), record the `TABLE_HEAD_CLASS` single-source-of-truth decision, the LOP-only-zebra decision, the swept-files list, and that the 5 divergent tables (reports ×3, budget, jira-conflicts, roles, calendar) plus optional multi-section edit view remain for Phase 4. (No git commit needed — memory lives outside the repo.)

---

## Self-Review

**1. Spec coverage** (`docs/superpowers/specs/2026-05-29-modern-sidebar-layout-design.md` § "Table restyle (Phase 3)"):
- "Dark-Blue header row (white text)" → `TABLE_HEAD_CLASS` (Task 1) applied across all swept tables (Tasks 3, 5, 6). ✓
- "Light-Grey alternating rows" → LOP zebra (Task 4); user scoped zebra to the LOP table. ✓
- "palette-only status badges" → audit confirms already compliant (Task 7); no off-palette change. ✓
- "Applied to the LOP `TasksSection` table first, then other data tables" → Tasks 3 (LOP) then 5–6 (others). ✓
- "audits what is already palette-compliant and only adds the header/zebra/badge treatment where missing — does not redo completed palette work" → only header + zebra changed; badge work untouched. ✓
- Testing § "table header/zebra/badge classes present; no off-palette colors introduced" → constant test + render assertions + zebra test + source-guard + badge grep. ✓
- "Regression: existing panel and popout tests stay green" → each sweep task re-runs the panel suites; Task 7 runs the full suite. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to"/"write tests for the above" — every code step shows the exact before/after. ✓

**3. Type consistency:** `TABLE_HEAD_CLASS` (string) imported identically everywhere; `isStriped?: boolean` defined in `TaskRowProps`, defaulted in `TaskRowImpl`, passed from `tasks-section.tsx`; new i18n key `versionHighlightTableRestyle` added in EN, DE, and `APP_HIGHLIGHT_KEYS`; `stateClass` consistent in `task-row.tsx`. ✓

**Out of scope (Phase 4):** `reports.tsx` (×3), `budget-panel.tsx`, `jira-conflicts-modal.tsx`, `roles-modal.tsx`, `resource-calendar.tsx`; responsive sidebar collapse; real Settings view; optional multi-section edit view.
