# UI Polish Batch (0.13.0 "Bradbury") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 16 UI polish items, two bug fixes, and the task-effort feature across resources, roles & rates, budget, tasks, modals, and voice — without regressing 0.12.0.

**Architecture:** Zero-dependency drag (pointer events for modal windows, native HTML5 DnD for the bucket list); a shared `ModalHeader` (title + drag handle + voice mic + close) that all 6 modals adopt; task effort stored as canonical minutes with a small `duration.ts` parse/format helper (Jira basis 1w=5d, 1d=8h).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Vitest + Testing Library. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-05-27-ui-polish-batch-design.md`

**Branch:** `feat/0.13.0-ui-polish-batch` (already created off `main`).

**Conventions to follow (read before coding):**
- Tooltips = native `title={t(lang, "key")}` (no Tooltip component).
- Icons = inline SVG functions, `aria-hidden="true"`, `className="h-4 w-4"` (see `task-manager-ui.tsx:71-98`). No icon library.
- i18n: add EN keys in `src/app/i18n.ts` AND DE keys in `src/app/i18n.de.ts` (same key set; `i18n.de.ts` is coverage-excluded).
- Immutable updates only (spread); no mutation.
- Optional new fields on persisted types stay OPTIONAL (`?`) to keep `tsc` clean — same lesson as `budgets?`/`fxRates?` in v6. No schema-version bump for additive optional fields.
- Run gates after each task: `npm run lint`, `npx tsc --noEmit`, `npm test`.

---

## File Structure

**New files:**
- `src/app/duration.ts` — parse/format Jira-style durations (`w/d/h/m` ↔ minutes). Pure.
- `src/app/duration.test.ts` — unit tests for the above.
- `src/app/use-draggable.ts` — pointer-drag hook returning `{ offset, handleProps, reset }`.
- `src/app/use-draggable.test.ts` — unit tests for clamp/reset logic (pure helper).
- `src/app/modal-header.tsx` — shared modal header (title + drag handle + voice mic + close).

**Modified files:**
- `src/app/modal.tsx` — (no change expected; panel transform lives in each modal).
- `src/app/task-form-modal.tsx`, `absence-edit-modal.tsx`, `shift-edit-modal.tsx`, `resource-edit-modal.tsx`, `roles-modal.tsx`, `jira-conflicts-modal.tsx` — adopt `ModalHeader` + draggable panel.
- `src/app/workspace-section.tsx` — tab order.
- `src/app/resource-directory.tsx` — discipline/grade placeholder.
- `src/app/roles-modal.tsx` — divider + sortable columns (in addition to ModalHeader).
- `src/app/resources-panel.tsx` — menu icons, rollup tooltips, utilization tooltip, weeks-view fix.
- `src/app/resource-capacity.ts` — (no signature change; weeks fix is in the panel wiring).
- `src/app/resource-workload.tsx`, `task-row.tsx` — assignee hover.
- `src/app/budget-panel.tsx` — ECB button restyle, bucket remove, bucket drag-reorder.
- `src/app/budget-report.ts` — verify removal/reorder behavior (likely no change).
- `src/app/types.ts` — `BudgetBucket.order?`, `Task.originalEstimateMinutes?`, `Task.timeSpentMinutes?`.
- `src/app/sanitize.ts` — sanitize new fields.
- `src/app/storage.ts` — CSV/MD columns for `order` + effort fields.
- `src/app/i18n.ts`, `src/app/i18n.de.ts` — new keys.
- `src/app/version.ts`, `CHANGELOG.md`, `README.md`, `docs/CODEMAPS/*` — release.

---

## Task 1: `useDraggable` hook

**Files:**
- Create: `src/app/use-draggable.ts`
- Test: `src/app/use-draggable.test.ts`

Pointer-drag for a floating panel. Exposes a pure `clampOffset` helper (unit-tested) and the hook (used by modals). Resets to centered (`{x:0,y:0}`) when `open` goes false→true.

- [ ] **Step 1: Write the failing test** (`src/app/use-draggable.test.ts`)

```ts
import { describe, expect, test } from "vitest";
import { clampOffset } from "./use-draggable";

describe("clampOffset", () => {
  // viewport 1000x800; panel rect at left=300 top=100 w=400 h=500.
  const vp = { w: 1000, h: 800 };
  const rect = { left: 300, top: 100, width: 400, height: 500 };

  test("passes through an offset that keeps the panel on-screen", () => {
    expect(clampOffset({ x: 50, y: 50 }, rect, vp)).toEqual({ x: 50, y: 50 });
  });

  test("clamps leftward drag so the panel's right edge keeps a margin on screen", () => {
    // Dragging far left; panel must keep at least MARGIN (24) visible on the right.
    const out = clampOffset({ x: -10000, y: 0 }, rect, vp);
    expect(rect.left + out.x).toBeLessThan(0); // moved left
    expect(rect.left + rect.width + out.x).toBeGreaterThanOrEqual(24); // still grabbable
  });

  test("clamps upward drag so the header stays below the top edge", () => {
    const out = clampOffset({ x: 0, y: -10000 }, rect, vp);
    expect(rect.top + out.y).toBeGreaterThanOrEqual(0);
  });

  test("clamps downward drag so the header stays above the bottom edge", () => {
    const out = clampOffset({ x: 0, y: 10000 }, rect, vp);
    expect(rect.top + out.y).toBeLessThanOrEqual(vp.h - 24);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/use-draggable.test.ts`
Expected: FAIL — `clampOffset` is not exported / module missing.

- [ ] **Step 3: Implement** (`src/app/use-draggable.ts`)

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Offset {
  x: number;
  y: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Viewport {
  w: number;
  h: number;
}

/** Minimum px of the panel that must remain on-screen so it stays grabbable. */
const MARGIN = 24;

/**
 * Clamp a desired drag offset so the panel (at `rect`, before offset) keeps at
 * least MARGIN px reachable inside the viewport on every edge. Pure + testable.
 */
export function clampOffset(desired: Offset, rect: Rect, vp: Viewport): Offset {
  // Allowed translate range on X: panel right edge >= MARGIN, left edge <= vp.w - MARGIN.
  const minX = MARGIN - (rect.left + rect.width);
  const maxX = vp.w - MARGIN - rect.left;
  // On Y: header (top) stays within [0, vp.h - MARGIN].
  const minY = -rect.top;
  const maxY = vp.h - MARGIN - rect.top;
  return {
    x: Math.min(Math.max(desired.x, minX), maxX),
    y: Math.min(Math.max(desired.y, minY), maxY),
  };
}

/**
 * Draggable floating panel. Attach `handleProps` to the drag handle (the modal
 * header). The panel element gets `style={{ transform: translate(offset) }}`.
 * Offset resets to {0,0} (centered) each time `open` transitions false→true.
 */
export function useDraggable(open: boolean) {
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; base: Offset; rect: Rect } | null>(null);

  const reset = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  // Reset to centered whenever the modal opens.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) setOffset({ x: 0, y: 0 });
    wasOpen.current = open;
  }, [open]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Only left button / primary pointer; ignore clicks that bubbled from buttons.
      if (e.button !== 0) return;
      const panel = (e.currentTarget.closest("[data-modal-panel]") as HTMLElement | null) ?? e.currentTarget;
      const r = panel.getBoundingClientRect();
      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        base: offset,
        // rect WITHOUT the current offset, so clamp math uses the un-translated position.
        rect: { left: r.left - offset.x, top: r.top - offset.y, width: r.width, height: r.height },
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [offset],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = dragState.current;
    if (!s) return;
    const desired = { x: s.base.x + (e.clientX - s.startX), y: s.base.y + (e.clientY - s.startY) };
    setOffset(clampOffset(desired, s.rect, { w: window.innerWidth, h: window.innerHeight }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    dragState.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  return {
    offset,
    reset,
    handleProps: { onPointerDown, onPointerMove, onPointerUp },
  };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/app/use-draggable.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/use-draggable.ts src/app/use-draggable.test.ts
git commit -m "feat(modal): add useDraggable hook with on-screen clamping"
```

---

## Task 2: `ModalHeader` component

**Files:**
- Create: `src/app/modal-header.tsx`
- Reference: `src/app/task-form-modal.tsx:105-131` (header markup to preserve), `src/app/voice-button.tsx:26-112` (`VoiceCommandButton`).

A shared header: drag handle (the `<header>` element), title `h2`, voice mic, close button. The mic and close stop pointer propagation so they never start a drag.

- [ ] **Step 1: Implement** (`src/app/modal-header.tsx`)

```tsx
"use client";

import { type Lang, t } from "./i18n";
import { type Command } from "./voice";
import { VoiceCommandButton } from "./voice-button";

interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
}

interface ModalHeaderProps {
  lang: Lang;
  title: string;
  titleId?: string;
  onClose: () => void;
  /** Pointer handlers from useDraggable; the header acts as the drag handle. */
  dragHandleProps?: DragHandleProps;
  /** When provided, a voice-command mic is shown and routes to this handler. */
  onVoiceCommand?: (cmd: Command, originalText: string) => void;
  onVoiceError?: (msg: string) => void;
}

/** Stop a pointerdown on interactive controls from initiating a window drag. */
function stopDrag(e: React.PointerEvent) {
  e.stopPropagation();
}

export function ModalHeader({
  lang,
  title,
  titleId,
  onClose,
  dragHandleProps,
  onVoiceCommand,
  onVoiceError,
}: ModalHeaderProps) {
  return (
    <header
      {...dragHandleProps}
      className={`sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-AIPM-light-grey bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950 ${
        dragHandleProps ? "cursor-move touch-none select-none" : ""
      }`}
    >
      <h2 id={titleId} className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {title}
      </h2>
      <div className="flex items-center gap-1" onPointerDown={stopDrag}>
        {onVoiceCommand && (
          <VoiceCommandButton
            lang={lang}
            onCommand={onVoiceCommand}
            onError={onVoiceError ?? (() => {})}
          />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t(lang, "alertModalClose")}
          title={t(lang, "alertModalClose")}
          className="rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
            <path
              fillRule="evenodd"
              d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: 0 errors. (No standalone unit test — behavior is exercised via the modal migration in Task 3 and existing modal tests.)

- [ ] **Step 3: Commit**

```bash
git add src/app/modal-header.tsx
git commit -m "feat(modal): add shared ModalHeader with drag handle and voice mic"
```

---

## Task 3: Migrate the 6 modals to `ModalHeader` + draggable panel

**Files (modify):** `task-form-modal.tsx`, `absence-edit-modal.tsx`, `shift-edit-modal.tsx`, `resource-edit-modal.tsx`, `roles-modal.tsx`, `jira-conflicts-modal.tsx`.

For EACH modal apply this pattern (read the file first; the header block to replace looks like `task-form-modal.tsx:105-131`):

1. Import: `import { ModalHeader } from "./modal-header";` and `import { useDraggable } from "./use-draggable";`
2. Inside the component, after existing hooks: `const { offset, handleProps } = useDraggable(open);` (use the modal's existing `open`/visibility boolean; for modals that mount only when open, pass `true`).
3. On the panel `<div>` (the `relative flex w-… resize flex-col …` element): add `data-modal-panel` and `style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}`.
4. Replace the hand-built `<header>…</header>` with:

```tsx
<ModalHeader
  lang={lang}
  title={/* the same expression the old <h2> used */}
  onClose={/* the same handler the old X button used */}
  dragHandleProps={handleProps}
  onVoiceCommand={onVoiceCommand}
  onVoiceError={(msg) => onShowToast("error", msg)}
/>
```

- [ ] **Step 1: Determine the voice command handler to thread in**

Read `src/app/app-header.tsx` and the app shell to find the existing `handleCommand`/`onCommand` passed to the toolbar `VoiceCommandButton`, plus the toast function. Thread the SAME handler + toast down to each modal as props (`onVoiceCommand`, `onShowToast`). If a modal has no access to the toast, pass `onVoiceError={() => {}}`.

Note: `task-form-modal.tsx` already receives `onShowToast` (used by `InlineMicButton`). Reuse it.

- [ ] **Step 2: Migrate `task-form-modal.tsx`**

Replace lines `105-131` (the `<header>`) with the `<ModalHeader …/>` above, `title={isEditing ? t(lang,"tabEditTask",editingId!) : t(lang,"tabNewTask")}`, `onClose={onCancel}`. Add `data-modal-panel` + transform style to the `<div ref={modalRef} className="relative flex w-[700px] …">`. Add the `useDraggable` + imports.

- [ ] **Step 3: Migrate the other 5 modals**

Apply the same pattern. For modals NOT currently receiving a voice handler/toast, either thread them from the parent (preferred) or omit `onVoiceCommand` for that modal if the parent genuinely has no command handler in scope — but the spec requires voice in ALL modals, so thread the handler. Document any modal where threading is impractical and escalate instead of silently omitting.

- [ ] **Step 4: Run gates + existing modal tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run src/app/task-form-modal* src/app/roles-modal* src/app/absence-edit* src/app/shift-edit* src/app/resource-edit* src/app/jira-conflicts*`
Expected: tsc 0, lint clean, existing modal tests still pass (close button still labelled `alertModalClose`).

- [ ] **Step 5: Commit**

```bash
git add src/app/*modal*.tsx
git commit -m "feat(modal): draggable modals with shared header + in-modal voice (all 6)"
```

---

## Task 4: Navigation & visual polish bundle

**Files:** `workspace-section.tsx`, `resource-directory.tsx`, `roles-modal.tsx`, `resources-panel.tsx`, `budget-panel.tsx`.

Five small, independent edits. Read each file region first.

- [ ] **Step 1: Tab order** — In `workspace-section.tsx` move the `budget` `<TabButton>` block (currently after `activity`, ~line 224) to sit BETWEEN the `resources` tab (~line 200) and the `activity` tab (~line 212). Order becomes: chat, reports, gantt, raid, resources, **budget**, activity.

- [ ] **Step 2: Discipline/Grade placeholder** — In `resource-directory.tsx`, change the two placeholder options:

```tsx
// line ~71  (discipline)
<option value="">—</option>
// line ~88  (grade)
<option value="">—</option>
```
(Replace `{t(lang, "rolesDiscipline")}` / `{t(lang, "rolesGrade")}` text with the em dash `—`.)

- [ ] **Step 3: Roles & rates divider** — In `roles-modal.tsx`, between the rate-card table (ends ~line 102) and the add-combo `<div>` (starts ~line 103) insert:

```tsx
<hr className="my-3 border-t border-zinc-200 dark:border-zinc-800" />
```

- [ ] **Step 4: Resources menu icons** — In `resources-panel.tsx` (~lines 222–237) add inline-SVG icons before the "Manage roles" and "Report" labels. Add icon helper functions near the top of the file (mirroring `task-manager-ui.tsx:71-98`) and render them inside the buttons, e.g.:

```tsx
function GearIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.53 1.53 0 01-2.29.95c-1.37-.84-2.94.73-2.1 2.1.54.88.07 2.04-.95 2.29-1.56.38-1.56 2.6 0 2.98.99.24 1.49 1.41.95 2.29-.84 1.37.73 2.94 2.1 2.1.88-.54 2.04-.07 2.29.95.38 1.56 2.6 1.56 2.98 0a1.53 1.53 0 012.29-.95c1.37.84 2.94-.73 2.1-2.1a1.53 1.53 0 01.95-2.29c1.56-.38 1.56-2.6 0-2.98a1.53 1.53 0 01-.95-2.29c.84-1.37-.73-2.94-2.1-2.1a1.53 1.53 0 01-2.29-.95zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  );
}
function ReportIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
      <path d="M15.5 2A1.5 1.5 0 0117 3.5v13A1.5 1.5 0 0115.5 18h-11A1.5 1.5 0 013 16.5v-13A1.5 1.5 0 014.5 2h11zM7 14a1 1 0 10-2 0 1 1 0 002 0zm0-3.5a1 1 0 10-2 0 1 1 0 002 0zM14 6.5A.5.5 0 0013.5 6h-7a.5.5 0 000 1h7a.5.5 0 00.5-.5z" />
    </svg>
  );
}
```
Then add `inline-flex items-center gap-1.5` to each button's className (if not present) and render `<GearIcon />` / `<ReportIcon />` before the label text.

- [ ] **Step 5: ECB refresh button restyle** — In `budget-panel.tsx` (~lines 101–107) change the button to match the Jira-sync style (`tasks-section.tsx:273-298`). Use the `loading` flag from `useFxRates()` (already in scope as it drives refresh):

```tsx
<button
  type="button"
  onClick={props.onRefreshFx}
  disabled={props.fxLoading}
  className="inline-flex items-center gap-1.5 rounded-md border border-AIPM-dark-blue bg-white px-3 py-1.5 text-sm font-medium text-AIPM-dark-blue shadow-sm hover:bg-AIPM-light-grey disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900 dark:hover:bg-zinc-800"
>
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={`h-4 w-4 ${props.fxLoading ? "animate-spin" : ""}`}>
    <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
  </svg>
  {t(lang, "budgetFxRefresh")}
</button>
```
If the `loading` state isn't currently passed into `budget-panel.tsx`, thread it from the `useFxRates()` call site as a new prop `fxLoading: boolean` (wire through the same parent that supplies `onRefreshFx`).

- [ ] **Step 6: Gates + commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.
```bash
git add src/app/workspace-section.tsx src/app/resource-directory.tsx src/app/roles-modal.tsx src/app/resources-panel.tsx src/app/budget-panel.tsx
git commit -m "feat(ui): tab reorder, dash placeholders, roles divider, menu icons, ECB button restyle"
```

---

## Task 5: Assignee hover consistency

**Files:** `resource-workload.tsx:64-76`, `task-row.tsx:237`.

Reference effect (`resource-directory.tsx:252-258`): button with `border border-transparent … hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800` + `title`.

- [ ] **Step 1: Workload assignee** — In `resource-workload.tsx`, replace the button className `rounded px-1 py-0.5 text-left hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-dark-blue` with:

```tsx
className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-dark-blue dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
```
Add `title={row.display}` if no title is present.

- [ ] **Step 2: Task assignee** — In `task-row.tsx:237`, wrap the assignee value in a `<span>` carrying the reference hover classes (the cell already has a `title`):

```tsx
{!hiddenCols.has("assignee") && (
  <Td title={`${t(lang, "assignee")}: ${task.assignee || "—"}`}>
    {task.assignee && (
      <span className="rounded-md border border-transparent px-2 py-0.5 hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800">
        {task.assignee}
      </span>
    )}
  </Td>
)}
```

- [ ] **Step 3: Gates + commit**

Run: `npx tsc --noEmit && npm run lint`
```bash
git add src/app/resource-workload.tsx src/app/task-row.tsx
git commit -m "feat(ui): match workload & task assignee hover to directory"
```

---

## Task 6: Planning tooltips (rollup + utilization)

**Files:** `resources-panel.tsx`, `i18n.ts`, `i18n.de.ts`.

- [ ] **Step 1: Add i18n keys** — In `i18n.ts` (and `i18n.de.ts` with German text) add:

```ts
resourcesUtilizationHint: "Planned utilization for this period (percent or hours, per the mode).",
resourcesCapacityDaysHint: "Total planned capacity in person-days across the window.",
resourcesInternalCostHint: "Planned hours × internal rate, summed across the window.",
resourcesExternalCostHint: "Planned hours × external (billable) rate, summed across the window.",
resourcesMarginHint: "External cost minus internal cost (planned contribution).",
```
DE equivalents in `i18n.de.ts` (same keys).

- [ ] **Step 2: Utilization input tooltip** — In `resources-panel.tsx:323-327` add `title={t(lang, "resourcesUtilizationHint")}` to the utilization `<input>` (the sibling of the absence input that already has `resourcesAbsenceOverrideHint`).

- [ ] **Step 3: Rollup header tooltips** — On the four total `<th>` headers (`resources-panel.tsx` ~299–302) add `title={t(lang, "resourcesCapacityDaysHint")}` etc. respectively (Capacity Days, Internal Cost, External Cost, Margin).

- [ ] **Step 4: Gates + commit**

Run: `npx tsc --noEmit && npm run lint`
```bash
git add src/app/resources-panel.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(resources): explanatory tooltips on rollup totals and utilization input"
```

---

## Task 7: Weeks-view fix (derive weeks from month entry)

**Files:** `resources-panel.tsx`. (Engine `resource-capacity.ts` already supports coarse→fine borrow — no change.)

Root cause: `resources-panel.tsx:311` passes `plan.granularity` for BOTH the canonical and display granularity args of `displayCapacityHours`, so the week view reads non-existent week keys. Fix: introduce a separate **view granularity** (component state); `plan.granularity` is the canonical/entry granularity.

- [ ] **Step 1: Add a behavior test** (`src/app/resource-capacity.test.ts` — append, or create a focused test)

```ts
import { describe, expect, test } from "vitest";
import { generatePeriods, displayCapacityHours } from "./resource-capacity";
import type { Resource } from "./types";

describe("month-entry → week-view borrow", () => {
  test("each week of a month inherits the month's utilization %", () => {
    const monthPeriods = generatePeriods("2026-05-01", "2026-05-31", "month");
    const weekPeriods = generatePeriods("2026-05-01", "2026-05-31", "week");
    const r: Resource = {
      id: 1, firstName: "A", lastName: "B", email: undefined, roleId: null,
      utilizationMode: "percent", utilization: { [monthPeriods[0].key]: 100 },
    };
    const noHolidays = new Set<string>();
    const total = weekPeriods.reduce(
      (s, p) => s + displayCapacityHours(p, monthPeriods, r, [], 8, noHolidays, "month", "week"),
      0,
    );
    expect(total).toBeGreaterThan(0); // weeks are NOT empty when only month data exists
  });
});
```

- [ ] **Step 2: Run to confirm it passes at the ENGINE level** (proves the engine is fine; the bug is wiring)

Run: `npx vitest run src/app/resource-capacity.test.ts -t "borrow"`
Expected: PASS — confirming the panel wiring is the only defect.

- [ ] **Step 3: Add view-granularity state in `resources-panel.tsx`**

In the planning view block (`{view === "planning" && (() => {`), add local state near the top of the component:
```tsx
const [viewGranularity, setViewGranularity] = useState<PlanGranularity>(plan.granularity);
```
(Import `useState` and `PlanGranularity` if not already imported.) Keep `viewGranularity` in sync if the stored plan granularity changes: `useEffect(() => setViewGranularity(plan.granularity), [plan.granularity]);` — but do NOT call `onSetPlanGranularity` from the SegmentedControl anymore (see Step 4).

- [ ] **Step 4: Drive the SegmentedControl from view granularity**

Change the planning SegmentedControl (`resources-panel.tsx:280-289`): `value={viewGranularity}` and `onChange={setViewGranularity}` (instead of `plan.granularity` / `onSetPlanGranularity`). Generate periods from the view: `const periods = generatePeriods(plan.startDate, plan.endDate, viewGranularity);`

- [ ] **Step 5: Fix the capacity call to pass canonical + display**

Hoist the canonical periods above the rows map, then pass canonical + view:
```tsx
const canonicalPeriods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
// ...inside the per-resource map:
const totalHours = periods.reduce((sum, p) =>
  sum + displayCapacityHours(p, canonicalPeriods, r, resAbs, workdayHours, holidaySet, plan.granularity, viewGranularity), 0);
```

- [ ] **Step 6: Read-only week inputs when view is finer than entry**

Compute `const derived = viewGranularity !== plan.granularity;`. On the utilization `<input>` (`:323-327`) and absence override `<input>` (`:328-334`), set `readOnly={derived}` and a dimmed class when derived. When derived, display the borrowed value (`displayCapacityHours(...)` formatted) instead of the raw `r.utilization[p.key]`. Keep editable behavior unchanged when `!derived`.

- [ ] **Step 7: Gates + manual check**

Run: `npx tsc --noEmit && npm run lint && npx vitest run src/app/resource-capacity.test.ts`
Manual: load sample workspace → Resources → Planning → toggle to "week": the grid now shows borrowed values (not empty), week inputs read-only.

- [ ] **Step 8: Commit**

```bash
git add src/app/resources-panel.tsx src/app/resource-capacity.test.ts
git commit -m "fix(resources): weeks view derives from month entry (was empty)"
```

---

## Task 8: Sortable roles & rates columns

**Files:** `roles-modal.tsx`.

Make Discipline, Grade, Internal, External column headers clickable to sort asc/desc.

- [ ] **Step 1: Add sort state** — In `roles-modal.tsx`, add:
```tsx
type SortKey = "discipline" | "grade" | "internal" | "external";
const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
function toggleSort(key: SortKey) {
  setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
}
```

- [ ] **Step 2: Apply sort** — Replace the current `sortedRoles` (alphabetical-by-label, ~line 49) with a memo that respects `sort` when set, else keeps the existing alphabetical default:
```tsx
const sortedRoles = useMemo(() => {
  const arr = [...roles];
  if (!sort) return arr.sort((a, b) => roleLabel(a, disciplines, grades).localeCompare(roleLabel(b, disciplines, grades)));
  const val = (r: Role): string | number => {
    switch (sort.key) {
      case "discipline": return disciplines.find((d) => d.id === r.disciplineId)?.name ?? "";
      case "grade": return grades.find((g) => g.id === r.gradeId)?.name ?? "";
      case "internal": return r.internalRate ?? 0;
      case "external": return r.externalRate ?? 0;
    }
  };
  return arr.sort((a, b) => {
    const av = val(a), bv = val(b);
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sort.dir === "asc" ? cmp : -cmp;
  });
}, [roles, disciplines, grades, sort]);
```
(Confirm the exact `Role` rate field names — `internalRate`/`externalRate` — against `types.ts` while implementing; use the real names.)

- [ ] **Step 3: Clickable headers** — Turn the four `<th>` cells into buttons that call `toggleSort("…")` and render a ▲/▼ indicator when active:
```tsx
<th className="px-2 py-1.5">
  <button type="button" onClick={() => toggleSort("discipline")} className="inline-flex items-center gap-1 hover:text-AIPM-dark-blue">
    {t(lang, "rolesDiscipline")}{sort?.key === "discipline" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
  </button>
</th>
```
(Repeat for grade/internal/external with their existing header labels.)

- [ ] **Step 4: Gates + commit**

Run: `npx tsc --noEmit && npm run lint`
```bash
git add src/app/roles-modal.tsx
git commit -m "feat(roles): sortable discipline/grade/internal/external columns"
```

---

## Task 9: Remove budget bucket

**Files:** `budget-panel.tsx`; verify `budget-report.ts`.

- [ ] **Step 1: Add an engine test for removal semantics** (`src/app/budget-report.test.ts` — append)

```ts
test("removing a predecessor zeroes the successor's spillover", () => {
  // Build two buckets where A (closed) spills into B; then remove A and assert
  // B's report has zero spilloverInValue/hours.
  // Use the existing fixture builders in this file to construct the buckets,
  // then call computeBudgetReport on the array WITHOUT A and with B.successorId
  // left as-is OR nulled — assert the B report's incoming spillover is 0.
});
```

- [ ] **Step 2: Run to confirm current behavior**

Run: `npx vitest run src/app/budget-report.test.ts -t "removing a predecessor"`
Expected: PASS (the engine defaults absent spillover to 0). If it FAILS, fix `computeSpillover` in `budget-report.ts` to skip successors whose predecessor is not present in the bucket array.

- [ ] **Step 3: Add the remove handler + UI** — In `budget-panel.tsx`, add near `updateBucket`/`addBucket`:
```tsx
function removeBucket(id: number) {
  props.onChangeBuckets(
    props.buckets
      .filter((b) => b.id !== id)
      .map((b) => (b.successorId === id ? { ...b, successorId: null, localModifiedAt: stamp() } : b)),
  );
}
```
Add a trash button to each bucket card that calls a confirm (use the app's existing alert/confirm modal — check how other destructive actions confirm, e.g. activity-log clear) then `removeBucket(bucket.id)`. New i18n keys `budgetRemoveBucket` (label/title) and `budgetRemoveBucketConfirm` (EN+DE).

- [ ] **Step 4: Gates + commit**

Run: `npx tsc --noEmit && npm run lint && npx vitest run src/app/budget-report.test.ts`
```bash
git add src/app/budget-panel.tsx src/app/budget-report.ts src/app/budget-report.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(budget): remove bucket (un-links successors; calculations fall to 0)"
```

---

## Task 10: Reorder budget buckets by drag + persist `order`

**Files:** `types.ts`, `budget-panel.tsx`, `budget-report.ts`, `sanitize.ts`, `storage.ts`, plus storage tests.

- [ ] **Step 1: Add the field** — In `types.ts` `BudgetBucket`, add `order?: number;` (optional, after `localModifiedAt?`).

- [ ] **Step 2: Sort by order in report** — In `budget-report.ts` `computeBudgetReport`, iterate buckets sorted by `(a.order ?? a.id) - (b.order ?? b.id)` before mapping. Add a test asserting two buckets with `order` 1 and 0 report in reversed array order.

- [ ] **Step 3: Sanitize round-trip test** (`src/app/storage-budget-csv.test.ts` — append)
```ts
test("bucket order survives sanitize + CSV round-trip", () => {
  // build a bucket with order: 3, serialize to CSV, parse back, expect order === 3.
});
```

- [ ] **Step 4: Implement persistence**
  - `sanitize.ts` `sanitizeBudgetBucket`: read `order` as a non-negative integer when present (else `undefined`).
  - `storage.ts`: add `order` to `BUDGETS_CSV_COLUMNS` and the field encode/decode; add it to the Markdown budgets section serializer/parser. JSON is automatic.

- [ ] **Step 5: Drag-reorder UI** — In `budget-panel.tsx`, render buckets sorted by `(a.order ?? a.id)`. Make each bucket card `draggable`, with `onDragStart` storing the dragged id (a `useState<number|null>`), `onDragOver` (preventDefault) and `onDrop` computing the new index, then reassign contiguous `order` (0..n) across all buckets and call `onChangeBuckets`.

- [ ] **Step 6: Gates + manual check**

Run: `npx tsc --noEmit && npm run lint && npx vitest run src/app/budget-report.test.ts src/app/storage-budget-csv.test.ts`
Manual: drag a bucket, reload → order preserved; export CSV/MD → reorder reflected.

- [ ] **Step 7: Commit**

```bash
git add src/app/types.ts src/app/budget-panel.tsx src/app/budget-report.ts src/app/sanitize.ts src/app/storage.ts src/app/*budget*test*
git commit -m "feat(budget): drag-reorder buckets with persisted order field"
```

---

## Task 11: `duration.ts` (parse/format)

**Files:**
- Create: `src/app/duration.ts`, `src/app/duration.test.ts`

- [ ] **Step 1: Write the failing tests** (`src/app/duration.test.ts`)

```ts
import { describe, expect, test } from "vitest";
import { parseDuration, formatDuration } from "./duration";

describe("parseDuration (1w=5d, 1d=8h, 1h=60m)", () => {
  test("parses a single unit", () => {
    expect(parseDuration("3h")).toBe(180);
    expect(parseDuration("2d")).toBe(2 * 8 * 60);
    expect(parseDuration("1w")).toBe(5 * 8 * 60);
    expect(parseDuration("45m")).toBe(45);
  });
  test("parses combinations and is case/space tolerant", () => {
    expect(parseDuration("2w 3d 4h")).toBe((2 * 5 + 3) * 8 * 60 + 4 * 60);
    expect(parseDuration("1W2D")).toBe((5 + 2) * 8 * 60);
  });
  test("empty → null (unset)", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("   ")).toBeNull();
  });
  test("invalid → null", () => {
    expect(parseDuration("banana")).toBeNull();
    expect(parseDuration("3x")).toBeNull();
    expect(parseDuration("1.5h")).toBeNull();
  });
});

describe("formatDuration", () => {
  test("formats minutes back into w/d/h/m, omitting zero units", () => {
    expect(formatDuration((2 * 5 + 3) * 8 * 60 + 4 * 60)).toBe("2w 3d 4h");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(0)).toBe("");
  });
  test("round-trips parse∘format", () => {
    const m = parseDuration("1w 2d 3h 30m")!;
    expect(parseDuration(formatDuration(m))).toBe(m);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/duration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`src/app/duration.ts`)

```ts
/** Jira-style working-time basis. */
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 8;
export const DAYS_PER_WEEK = 5;

const MIN_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;
const MIN_PER_WEEK = DAYS_PER_WEEK * MIN_PER_DAY;
const UNIT_MIN: Record<string, number> = { w: MIN_PER_WEEK, d: MIN_PER_DAY, h: MINUTES_PER_HOUR, m: 1 };

/** Parse "2w 3d 4h 30m" → total minutes. Empty → null. Invalid → null. */
export function parseDuration(input: string): number | null {
  const s = (input ?? "").trim().toLowerCase();
  if (!s) return null;
  // Whole string must be a sequence of <integer><unit> tokens, space-optional.
  if (!/^(\d+\s*[wdhm]\s*)+$/.test(s)) return null;
  let total = 0;
  for (const m of s.matchAll(/(\d+)\s*([wdhm])/g)) {
    total += parseInt(m[1], 10) * UNIT_MIN[m[2]];
  }
  return total;
}

/** Format minutes → "2w 3d 4h"; omit zero units; 0 → "". */
export function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return "";
  let rem = Math.round(minutes);
  const parts: string[] = [];
  for (const [unit, size] of [["w", MIN_PER_WEEK], ["d", MIN_PER_DAY], ["h", MINUTES_PER_HOUR], ["m", 1]] as const) {
    const n = Math.floor(rem / size);
    if (n > 0) parts.push(`${n}${unit}`);
    rem -= n * size;
  }
  return parts.join(" ");
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/app/duration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/duration.ts src/app/duration.test.ts
git commit -m "feat(tasks): duration parse/format helper (Jira basis)"
```

---

## Task 12: Task effort field (type, form, columns, persistence)

**Files:** `types.ts`, `task-form-modal.tsx`, `task-row.tsx` (+ column config), `sanitize.ts`, `storage.ts`, `i18n.ts`, `i18n.de.ts`, storage tests.

- [ ] **Step 1: Add fields to `Task`** — In `types.ts` add `originalEstimateMinutes?: number;` and `timeSpentMinutes?: number;` to `Task`.

- [ ] **Step 2: i18n keys** — Add (EN + DE): `taskOriginalEstimate: "Original estimate"`, `taskTimeSpent: "Time spent"`, `taskEffortHint: "e.g. 2w 3d 4h"`, `taskEffortInvalid: "Use w/d/h/m, e.g. 2w 3d 4h"`, plus short column headers `colEstimate: "Est."`, `colSpent: "Spent"`.

- [ ] **Step 3: Form fields** — In `task-form-modal.tsx`, import `parseDuration, formatDuration` from `./duration`. Add two `<Field>` text inputs (initialized from `formatDuration(form.originalEstimateMinutes ?? 0)` etc.). On change, keep the raw string in local state; on blur parse it: if `parseDuration` returns a number, store it; if it returns null AND the field is non-empty, show `taskEffortInvalid` inline and don't commit. Persist `originalEstimateMinutes`/`timeSpentMinutes` into the task form state used at submit.

- [ ] **Step 4: Table columns** — Add `"estimate"` and `"spent"` to the column id union / `ALL_COLUMNS` config and to the default-hidden set (so they start hidden). In `task-row.tsx`, render two `<Td>` cells gated on `!hiddenCols.has("estimate")` / `"spent"`, showing `formatDuration(task.originalEstimateMinutes ?? 0)` and `formatDuration(task.timeSpentMinutes ?? 0)`. Wire both into the table's existing sort mechanism, sorting numerically by the minute value. (Find the column header/sort definitions used by other numeric columns and mirror them.)

- [ ] **Step 5: Persistence + round-trip test** — Extend `sanitizeTask` (`sanitize.ts`) to read both fields as non-negative integers (else `undefined`). Add CSV columns + Markdown fields in `storage.ts`. Add a test (`storage-serialization.test.ts` or the task CSV test) asserting both fields survive a JSON/CSV/MD round-trip.

- [ ] **Step 6: Gates + manual check**

Run: `npx tsc --noEmit && npm run lint && npx vitest run src/app/duration.test.ts src/app/sanitize* src/app/storage*`
Manual: add a task with estimate "2w" and spent "3d 4h" → reopen shows the same; enable the two columns → values shown and sortable; export/import round-trips.

- [ ] **Step 7: Commit**

```bash
git add src/app/types.ts src/app/task-form-modal.tsx src/app/task-row.tsx src/app/sanitize.ts src/app/storage.ts src/app/i18n.ts src/app/i18n.de.ts src/app/*test*
git commit -m "feat(tasks): optional effort fields (original estimate / time spent) with w/d/h/m"
```

---

## Task 13: Release (0.13.0 "Bradbury")

**Files:** `version.ts`, `CHANGELOG.md`, `README.md`, `docs/CODEMAPS/*`.

- [ ] **Step 1: Version** — In `version.ts` set `APP_VERSION = "0.13.0"`, build date `2026-05-27`, milestone `"Bradbury"`. Add a highlight key (e.g. `versionHighlightPolish`) to `APP_HIGHLIGHT_KEYS`, and define it in `i18n.ts` + `i18n.de.ts`.

- [ ] **Step 2: CHANGELOG** — Add a `## 0.13.0 "Bradbury" — 2026-05-27` section summarizing: draggable modals + in-modal voice, tab reorder, assignee hover consistency, planning tooltips + weeks-view fix, sortable rate cards, removable + reorderable budget buckets, ECB button restyle, dash placeholders, menu icons, and task effort tracking.

- [ ] **Step 3: README** — Add a bullet for task effort tracking and budget bucket management under the relevant feature sections (EN; mirror in the DE help block if one exists).

- [ ] **Step 4: Codemaps** — Update `docs/CODEMAPS/data.md` (new `BudgetBucket.order`, `Task.originalEstimateMinutes`/`timeSpentMinutes`, `duration.ts`) and `docs/CODEMAPS/frontend.md` (`ModalHeader`, `use-draggable`, draggable modals, weeks view-granularity, sortable roles, bucket remove/reorder).

- [ ] **Step 5: Gates + commit**

Run: `npx tsc --noEmit && npm run lint && npm run test:coverage`
Expected: all green (≥70% scoped floor).
```bash
git add src/app/version.ts CHANGELOG.md README.md docs/CODEMAPS src/app/i18n.ts src/app/i18n.de.ts
git commit -m "docs(release): 0.13.0 Bradbury — version, changelog, README, codemaps"
```

---

## Final review

After all tasks: dispatch a final code-reviewer over the whole branch diff (`git diff main...HEAD`), confirm gates (`lint`, `tsc`, `test:coverage`) are green, then use `superpowers:finishing-a-development-branch` to merge into `main`.

---

## Self-Review (author)

**Spec coverage** — every spec item maps to a task:
- Modal draggable (A2) → T1+T3; ModalHeader (A1) → T2; voice in modals (A4) → T2+T3.
- Tab order (B1) → T4; placeholder (B2) → T4; divider (B3) → T4; menu icons (B4) → T4; ECB restyle (B5) → T4.
- Workload hover (C1) + task hover (C2) → T5.
- Rollup tooltips (D1) + utilization tooltip (D2) → T6; weeks-view (D3) → T7; roles sorting (D4) → T8.
- Bucket remove (E1) → T9; bucket reorder + order persistence (E2) → T10.
- duration.ts (F1) → T11; Task type/form/columns/persistence (F2–F5) → T12.
- Release → T13.

**Placeholder scan** — code blocks are concrete. Two spots intentionally instruct the implementer to confirm exact existing names against source while implementing (the `Role.internalRate`/`externalRate` field names in T8, and the column-config mechanism in T12) rather than guessing — flagged explicitly, not left vague.

**Type consistency** — `useDraggable(open)` returns `{ offset, handleProps, reset }`; `ModalHeader` consumes `dragHandleProps` (= `handleProps`) and `onVoiceCommand`/`onVoiceError`. `clampOffset` signature matches its test. `parseDuration`/`formatDuration` signatures match T11 tests and T12 usage. `BudgetBucket.order?` used consistently in T2/T10. `originalEstimateMinutes`/`timeSpentMinutes` consistent across T1/T12.
