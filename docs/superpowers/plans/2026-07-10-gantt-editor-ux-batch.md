# Gantt / Task-Editor UX Batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six independent Gantt/task-editor UX improvements as one batched minor release (0.175.0).

**Architecture:** Each slice is self-contained and independently testable. Pure/novel logic goes in i18n-free modules (`modal-geometry.ts`, editor-buffer + inline-cell hooks); React surfaces mirror existing patterns (`useResizable`, `useColumnResize`, `ResetSizeButton`, `TaskFormModal`, `sanitizeRaidItem`, functional setters). Per-device localStorage only — no new `Workspace` field, no golden regen.

**Tech Stack:** Next.js (forked) + React + TypeScript, Tailwind v4, vitest, Playwright/axe. GitLab CI ratchets: `npx tsc --noEmit`, `npm run lint` (--max-warnings=0), `npm run test:run`, `npm run size:check`, `npm run dup:check`, axe.

**Branch:** `feat/gantt-editor-ux-batch` (already created off main).

**Order (by coupling):** Task 1 Gantt column → Task 2 Modal geometry engine → Task 3 Modal drag wiring → Task 4 AI icon → Task 5 inline cells → Task 6 editor buffer hook → Task 7 RAID-from-editor → Task 8 nested linked-task → Task 9 release.

**Global rules for every task:**
- Run `npx tsc --noEmit` after any test edit (vitest doesn't typecheck tests).
- i18n: add EN key in `i18n.ts` via Edit; add the DE key in `i18n.de.ts` via a node utf8 write matching a CRLF `\r\n` anchor with real umlauts — never the Edit tool (it corrupts umlauts/quotes). Verify with grep after.
- After editing a component test, run `npx tsc --noEmit`.
- `npm run size:check`; if a baselined file grew legitimately, `node scripts/check-file-sizes.mjs --update` and commit the baseline with the code.
- Commit at the end of each task.

---

## Task 1: Resizable Gantt task-name column + reset

**Files:**
- Modify: `src/app/gantt-engine.ts:125` (turn `LEFT_GUTTER_PX` into a default, add a resolver)
- Modify: `src/app/gantt.tsx` (own the width state + reset), `src/app/gantt-chrome.tsx` (accept width prop, replace constant), `src/app/gantt-rows.tsx` (accept width prop)
- Test: `src/app/gantt-engine.test.ts` (or create), `src/app/gantt.test.tsx`

**Context:** `LEFT_GUTTER_PX = 240` is imported by `gantt-chrome.tsx` (used in ~8 arithmetic sites for the sticky column width AND dependency-arrow x-origins) and `gantt-rows.tsx` (sticky column width). We make the width a runtime value threaded from the orchestrator, defaulting to 240, persisted per-device, resettable from the toolbar.

- [ ] **Step 1: Write the failing engine test** — a persisted-width helper.

In `src/app/gantt-engine.test.ts` add:
```ts
import { clampNameColWidth, GANTT_NAME_COL_MIN, GANTT_NAME_COL_MAX, LEFT_GUTTER_PX } from "./gantt-engine";

describe("clampNameColWidth", () => {
  it("clamps below min and above max, passes through in-range", () => {
    expect(clampNameColWidth(50)).toBe(GANTT_NAME_COL_MIN);
    expect(clampNameColWidth(9999)).toBe(GANTT_NAME_COL_MAX);
    expect(clampNameColWidth(300)).toBe(300);
  });
  it("falls back to the default for a non-finite value", () => {
    expect(clampNameColWidth(Number.NaN)).toBe(LEFT_GUTTER_PX);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`clampNameColWidth` undefined).

Run: `npx vitest run src/app/gantt-engine.test.ts`

- [ ] **Step 3: Implement in `gantt-engine.ts`** (keep `LEFT_GUTTER_PX` exported as the default):
```ts
export const GANTT_NAME_COL_MIN = 140;
export const GANTT_NAME_COL_MAX = 560;
/** Clamp a candidate task-name column width to sane bounds; non-finite → default. */
export function clampNameColWidth(w: number): number {
  if (!Number.isFinite(w)) return LEFT_GUTTER_PX;
  return Math.max(GANTT_NAME_COL_MIN, Math.min(GANTT_NAME_COL_MAX, Math.round(w)));
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Thread the width as a prop.** In `gantt-chrome.tsx` and `gantt-rows.tsx`, add a `nameColWidth: number` prop to every component that currently imports `LEFT_GUTTER_PX`, and replace each `LEFT_GUTTER_PX` occurrence in those files with `nameColWidth`. Keep the `import { LEFT_GUTTER_PX }` only where a default is needed. In `gantt.tsx` (orchestrator), own the state:
```ts
import { clampNameColWidth, LEFT_GUTTER_PX } from "./gantt-engine";
const NAME_COL_KEY = "lop-app:gantt-namecol";
const [nameColWidth, setNameColWidth] = useState<number>(() => {
  try {
    const raw = window.localStorage.getItem(NAME_COL_KEY);
    if (raw) return clampNameColWidth(Number(JSON.parse(raw)));
  } catch { /* ignore */ }
  return LEFT_GUTTER_PX;
});
const persistNameColWidth = useCallback((w: number) => {
  const c = clampNameColWidth(w);
  setNameColWidth(c);
  try { window.localStorage.setItem(NAME_COL_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}, []);
const resetNameColWidth = useCallback(() => {
  setNameColWidth(LEFT_GUTTER_PX);
  try { window.localStorage.removeItem(NAME_COL_KEY); } catch { /* ignore */ }
}, []);
```
Pass `nameColWidth` down to `GanttHeader`/`GanttToolbar`/row components.

- [ ] **Step 6: Add the drag handle.** In the sticky left column of BOTH `GanttHeader` (chrome) and where the column border renders, add a `ColumnResizeHandle` (from `task-manager-ui`, already `print:hidden`) at the column's right edge. Wire an `onMouseDown` that tracks `clientX` on a window `mousemove`, computing `startWidth + (e.clientX - startX)` → `persistNameColWidth`, cleaned up on `mouseup` (mirror `useColumnResize`'s `dragRef` window-listener lifecycle in `use-column-resize.ts`). Simplest: expose a `startNameColResize(e)` from `gantt.tsx` and pass it to the header; on mousedown capture `startX=e.clientX`, `startW=nameColWidth`, attach window `mousemove`/`mouseup`. The handle needs `aria-label={t(lang,"ganttResizeNameCol")}`.

- [ ] **Step 7: Add the reset-size button.** In `GanttToolbar` (`gantt-chrome.tsx`), add a `ResetSizeButton` (from `task-manager-ui`) wired to `resetNameColWidth`, placed LEFT of the existing Print/reset controls. Its `lang` prop supplies the accessible name.

- [ ] **Step 8: Add i18n** `ganttResizeNameCol` (EN "Resize the task name column" / DE "Aufgabenspalte anpassen") to `i18n.ts` (Edit) and `i18n.de.ts` (node utf8, CRLF anchor).

- [ ] **Step 9: Component test** in `gantt.test.tsx`: render Gantt, assert the reset button exists; simulate a resize handle mousedown→window mousemove(+80px)→mouseup and assert `localStorage["lop-app:gantt-namecol"]` updated; click reset and assert the key removed. (jsdom rect=0, so assert on the persisted number, not pixels.)

- [ ] **Step 10:** `npx tsc --noEmit`; `npx vitest run src/app/gantt`; `npm run size:check`; `npm run lint src/app/gantt.tsx src/app/gantt-chrome.tsx src/app/gantt-rows.tsx src/app/gantt-engine.ts`.

- [ ] **Step 11: axe** — Gantt is scanned: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Gantt"`.

- [ ] **Step 12: Commit** `feat(gantt): resizable task-name column with reset`.

---

## Task 2: Modal geometry engine (pure)

**Files:**
- Create: `src/app/modal-geometry.ts`, `src/app/modal-geometry.test.ts`

Pure, i18n-free, DOM-free helpers for Modal drag/resize/persist (Task 3 consumes them).

- [ ] **Step 1: Write the failing test** `src/app/modal-geometry.test.ts`:
```ts
import { clampToViewport, loadGeom, serializeGeom, type ModalGeom } from "./modal-geometry";

const VP = { width: 1000, height: 800 };
describe("clampToViewport", () => {
  it("keeps a fully-visible geom unchanged", () => {
    const g: ModalGeom = { x: 100, y: 80, w: 400, h: 300 };
    expect(clampToViewport(g, VP)).toEqual(g);
  });
  it("pulls an off-right/off-bottom panel back so it stays on screen", () => {
    const g: ModalGeom = { x: 900, y: 700, w: 400, h: 300 };
    const c = clampToViewport(g, VP);
    expect(c.x).toBeLessThanOrEqual(VP.width - 40);   // header stays grabbable
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeLessThanOrEqual(VP.height - 40);
  });
  it("clamps width/height to the viewport", () => {
    const c = clampToViewport({ x: 0, y: 0, w: 5000, h: 5000 }, VP);
    expect(c.w).toBeLessThanOrEqual(VP.width);
    expect(c.h).toBeLessThanOrEqual(VP.height);
  });
});
describe("loadGeom", () => {
  it("returns null for missing/garbage and a valid object otherwise", () => {
    expect(loadGeom(null)).toBeNull();
    expect(loadGeom("not json")).toBeNull();
    expect(loadGeom(serializeGeom({ x: 1, y: 2, w: 300, h: 200 }))).toEqual({ x: 1, y: 2, w: 300, h: 200 });
    expect(loadGeom(JSON.stringify({ x: "a", y: 2, w: 3, h: 4 }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** Run: `npx vitest run src/app/modal-geometry.test.ts`

- [ ] **Step 3: Implement `modal-geometry.ts`:**
```ts
// src/app/modal-geometry.ts
// Pure, DOM-free geometry helpers for the draggable/resizable shared Modal.
export interface ModalGeom { x: number; y: number; w: number; h: number; }
export interface Viewport { width: number; height: number; }

const MIN_VISIBLE = 40; // keep at least this much of the header on-screen/grabbable

/** Clamp size to the viewport, then clamp position so the header stays reachable. */
export function clampToViewport(g: ModalGeom, vp: Viewport): ModalGeom {
  const w = Math.min(Math.max(g.w, 120), vp.width);
  const h = Math.min(Math.max(g.h, 80), vp.height);
  const x = Math.min(Math.max(g.x, MIN_VISIBLE - w), vp.width - MIN_VISIBLE);
  const y = Math.min(Math.max(g.y, 0), vp.height - MIN_VISIBLE);
  return { x, y, w, h };
}

export function serializeGeom(g: ModalGeom): string { return JSON.stringify(g); }

/** Parse+validate a persisted geometry string; null on missing/garbage/invalid. */
export function loadGeom(raw: string | null): ModalGeom | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object") return null;
    const o = p as Record<string, unknown>;
    if (["x", "y", "w", "h"].every((k) => typeof o[k] === "number" && Number.isFinite(o[k] as number))) {
      return { x: o.x as number, y: o.y as number, w: o.w as number, h: o.h as number };
    }
  } catch { /* ignore */ }
  return null;
}
```

- [ ] **Step 4: Run it, expect PASS.** (Adjust the `MIN_VISIBLE`/bounds only if a test assertion needs it — keep the tests as the contract.)

- [ ] **Step 5: Commit** `feat(modal): pure geometry helpers for drag/resize`.

---

## Task 3: Draggable + resizable + reset Modal (wire into `modal.tsx`)

**Files:**
- Modify: `src/app/modal.tsx` (add drag/resize/reset + `persistKey`)
- Modify: `src/app/modal.test.tsx` (new behaviors + re-assert stacking)

**Context:** `Modal` is `fixed inset-0 flex` centered, stacks via a `modalStack` Symbol (topmost-only Escape/Tab), traps focus, and the keydown effect deps `[open]` ALONE with `onClose` via ref (double-fire landmine — DO NOT change). Mobile: below the narrow breakpoint the modal must stay centered/full-screen with drag+resize DISABLED.

- [ ] **Step 1: Write failing tests** in `modal.test.tsx`:
```ts
it("drags the panel by its header and clamps to the viewport", () => {
  render(<Modal open onClose={() => {}} ariaLabel="Test" persistKey="test-modal"><p>body</p></Modal>);
  const handle = screen.getByLabelText(/move dialog/i);
  fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 });
  fireEvent.pointerMove(window, { clientX: 260, clientY: 220 });
  fireEvent.pointerUp(window);
  const geom = JSON.parse(window.localStorage.getItem("lop-app:modal-geom:test-modal")!);
  expect(geom.x).not.toBe(0); // moved
});
it("reset restores the default (clears persisted geometry)", () => {
  window.localStorage.setItem("lop-app:modal-geom:test-modal", JSON.stringify({ x: 50, y: 50, w: 400, h: 300 }));
  render(<Modal open onClose={() => {}} ariaLabel="Test" persistKey="test-modal"><p>body</p></Modal>);
  fireEvent.click(screen.getByLabelText(/reset dialog size/i));
  expect(window.localStorage.getItem("lop-app:modal-geom:test-modal")).toBeNull();
});
```
Keep/extend the existing stacking test — it must still pass unchanged.

- [ ] **Step 2: Run, expect FAIL** (no move-handle). Run: `npx vitest run src/app/modal.test.tsx`

- [ ] **Step 3: Implement.** Add to `modal.tsx`:
  - New optional prop `persistKey?: string` on `ModalProps`.
  - A `useModalDrag` inline hook OR inline logic: hold `geom` in state (lazy-init from `loadGeom(localStorage[key])` clamped to `window` viewport, else `null` = centered default). Render: when `geom` is null keep the current centered flex; when non-null, drop the centering and apply `style={{ position:"fixed", left:geom.x, top:geom.y, width:geom.w, height:geom.h }}` on the dialog.
  - A header bar element (or the existing header region) gets `data-modal-drag`, `aria-label={t(lang,"modalMove")}` ("Move dialog"), `cursor-move`, and an `onPointerDown` that captures `startX/startY` + starting geom (or current centered rect via `getBoundingClientRect`), attaches `pointermove`/`pointerup` on `window`, updates `geom` through `clampToViewport(...,{width:innerWidth,height:innerHeight})`, and on `pointerup` persists `serializeGeom` to `lop-app:modal-geom:<persistKey>` (only when `persistKey` set).
  - Resize: add Tailwind `resize overflow-auto` to the dialog + call `useResizable("lop-app:modal-geom:"+persistKey+":size")` OR fold size into the same geom on the resize-corner pointerup. Simplest and consistent: keep ONE geom object; add a bottom-right resize handle element with its own `onPointerDown` that adjusts `w/h`. Persist the same key.
  - Reset button in the header: `aria-label={t(lang,"modalResetSize")}` ("Reset dialog size"), onClick → `setGeom(null)` + `localStorage.removeItem(key)`.
  - **Mobile guard:** read a narrow-viewport flag (`window.innerWidth < 1024`, recomputed on a `resize` listener, or reuse the app's `useMediaQuery(SIDEBAR_NARROW_QUERY)` if present). When narrow: force `geom=null`, hide the drag handle + resize handle + reset button, keep centered. Never persist while narrow.
  - `Date`/pointer math live in handlers only. Do NOT touch the `[open]`-only keydown effect or the `modalStack` push/pop effect.

- [ ] **Step 4: Run, expect PASS** (both new tests + all existing modal tests, incl. stacking/Escape).

- [ ] **Step 5: i18n** `modalMove` (EN "Move dialog" / DE "Dialog verschieben"), `modalResetSize` (EN "Reset dialog size" / DE "Dialoggröße zurücksetzen") — `i18n.ts` (Edit) + `i18n.de.ts` (node utf8, real ö/ü).

- [ ] **Step 6: Adopt `persistKey` on the real edit modals.** Give the task/RAID/change/stakeholder edit modals a stable `persistKey` (e.g. `task-form`, `raid-edit`, `change-edit`, `stakeholder-edit`) at their `<Modal>`/wrapper call sites. Confirm/alert/type-to-confirm dialogs get NO `persistKey` (drag/resize still work, just no persistence).

- [ ] **Step 7:** `npx tsc --noEmit`; `npx vitest run src/app/modal`; `npm run lint src/app/modal.tsx`; `npm run size:check`.

- [ ] **Step 8: axe** — a scanned view that opens a modal (e.g. RAID edit): `npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"` (default centered → no regression expected).

- [ ] **Step 9: Commit** `feat(modal): draggable, resizable, resettable dialogs with per-modal persistence`.

---

## Task 4: "Ask Claude" icon → leading cell, hover/focus reveal

**Files:**
- Modify: `src/app/task-row.tsx` (move the inline-AI trigger to a leading cell; make row a `group`)
- Modify/Test: `src/app/task-row.test.tsx` (or the tasks-section test that renders rows)

**Context:** The inline-AI trigger (`inlineAiEdit`, ~`task-row.tsx:460-470`) is gated `isAiEnabled && !isPopout && !task.jiraKey` via `aiEditEnabled(task)`. Move it to the FIRST cell, hidden until row hover/focus.

- [ ] **Step 1: Failing test** — the AI trigger is in the first cell and carries the reveal classes:
```ts
it("renders the Ask-Claude trigger in a leading, hover-revealed cell", () => {
  // render a row with aiEditEnabled → true, not jira-synced
  const btn = screen.getByRole("button", { name: /ask claude|edit with ai/i });
  const cell = btn.closest("td");
  expect(cell).toBe(within(row).getAllByRole("cell")[0]); // leading cell
  expect(btn.className).toMatch(/opacity-0/);       // hidden by default
  expect(btn.className).toMatch(/group-hover:opacity-100/);
});
it("omits the trigger on a Jira-synced row", () => {
  // aiEditEnabled → false for jiraKey
  expect(screen.queryByRole("button", { name: /ask claude|edit with ai/i })).toBeNull();
});
```

- [ ] **Step 2: Run, expect FAIL.** Run: `npx vitest run src/app/task-row.test.tsx`

- [ ] **Step 3: Implement.** Add `group` to the row `<tr>` className. Add a leading `<td>` (first cell, fixed small width e.g. `w-8`) rendering the existing inline-AI trigger button when `aiEditEnabled(task)` — with classes `opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ${INTERACTIVE}` and its existing `aria-label={`${t(lang,"inlineAiEdit")} – ${task.taskName}`}`. Remove the trigger from its old position. Keep space reserved (the cell always renders, the button conditionally) so no layout shift. Do NOT touch the Kanban card path.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5:** `npx tsc --noEmit`; `npm run lint src/app/task-row.tsx`; axe Open Points: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"`.

- [ ] **Step 6: Commit** `feat(tasks): hover-revealed leading Ask-Claude icon`.

---

## Task 5: Inline Open-Points cell editing (name, start, due, assignee, priority)

**Files:**
- Create: `src/app/use-inline-cell-edit.ts`, `src/app/use-inline-cell-edit.test.ts`
- Modify: `src/app/task-row.tsx` (make the 5 cells inline-editable), thread an `onInlinePatch(taskId, patch)` handler from the tasks pane
- Modify: the tasks pane that owns task save (`tasks-section.tsx` / `use-task-submit` / `use-task-row-handlers`) to provide `onInlinePatch`

**Context:** cells today: name (`task-row.tsx:286`), assignee (`:308`), startDate (`:313`), dueDate (`:317`), priority (`:321`). Name single-click already opens the editor. `onStatusChange`/status select is the a11y precedent (row-unique labels). Route patches through a functional `setTasks(prev=>…)` + `sanitize` on the pane side. Dates are a plain field patch (NOT `applyStatusChange`). Jira-synced rows (`task.jiraKey`) render plain (no inline affordance).

- [ ] **Step 1: Failing hook test** `use-inline-cell-edit.test.ts`:
```ts
import { renderHook, act } from "@testing-library/react";
import { useInlineCellEdit } from "./use-inline-cell-edit";

it("tracks the active cell + draft, commits, and cancels", () => {
  const onCommit = vi.fn();
  const { result } = renderHook(() => useInlineCellEdit(onCommit));
  act(() => result.current.begin("dueDate", "2026-07-01"));
  expect(result.current.editing).toBe("dueDate");
  expect(result.current.draft).toBe("2026-07-01");
  act(() => result.current.setDraft("2026-07-15"));
  act(() => result.current.commit());
  expect(onCommit).toHaveBeenCalledWith("dueDate", "2026-07-15");
  expect(result.current.editing).toBeNull();
});
it("cancel drops the draft without committing", () => {
  const onCommit = vi.fn();
  const { result } = renderHook(() => useInlineCellEdit(onCommit));
  act(() => result.current.begin("priority", "Low"));
  act(() => result.current.cancel());
  expect(onCommit).not.toHaveBeenCalled();
  expect(result.current.editing).toBeNull();
});
```

- [ ] **Step 2: Run, expect FAIL.** Run: `npx vitest run src/app/use-inline-cell-edit.test.ts`

- [ ] **Step 3: Implement `use-inline-cell-edit.ts`:**
```ts
"use client";
import { useCallback, useState } from "react";

export type InlineField = "taskName" | "startDate" | "dueDate" | "assignee" | "priority";

export function useInlineCellEdit(onCommit: (field: InlineField, value: string) => void) {
  const [editing, setEditing] = useState<InlineField | null>(null);
  const [draft, setDraft] = useState("");
  const begin = useCallback((field: InlineField, current: string) => { setEditing(field); setDraft(current); }, []);
  const cancel = useCallback(() => setEditing(null), []);
  const commit = useCallback(() => {
    setEditing((f) => { if (f !== null) onCommit(f, draft); return null; });
  }, [draft, onCommit]);
  return { editing, draft, setDraft, begin, cancel, commit };
}
```
> Note: `commit` reads `draft` via the closure; the functional `setEditing` guards against a double-commit. Keep `onCommit`/`draft` in the dep array (lint).

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Provide `onInlinePatch` on the pane.** In the tasks pane that owns task mutation, add:
```ts
const onInlinePatch = useCallback((taskId: number, patch: Partial<Task>) => {
  setTasks((prev) => prev.map((t) => {
    if (t.id !== taskId || t.jiraKey) return t;            // synced = read-only
    const merged: Task = { ...t, ...patch, localModifiedAt: new Date().toISOString() };
    return sanitizeTask ? (sanitizeTask(merged) ?? merged) : merged; // use the task sanitizer if one exists; else merged
  }));
}, [setTasks]);
```
(If there is no `sanitizeTask`, patch fields are already primitive; clamp `taskName` length via the existing text sanitizer used in the form. Match whatever the task form save uses.) Thread `onInlinePatch` to `TaskRow`.

- [ ] **Step 6: Wire the 5 cells in `task-row.tsx`.** Use `useInlineCellEdit((field,value)=>onInlinePatch(task.id,{[field]:value}))`. For each cell, when `!task.jiraKey`:
  - **taskName:** keep single-click → open editor; add `onDoubleClick={() => begin("taskName", task.taskName)}`. When `editing==="taskName"` render `<input aria-label={`${t(lang,"taskName")} – ${task.taskName}`} value={draft} onChange onBlur={commit} onKeyDown={Enter→commit, Escape→cancel} autoFocus />`.
  - **startDate / dueDate:** `onClick={() => begin(field, task[field] ?? "")}`; when editing render `<input type="date" aria-label={`${t(lang,field==="dueDate"?"dueDate":"startDate")} – ${task.taskName}`} …>` with the same commit/cancel handlers.
  - **assignee:** `onClick` → inline `<input aria-label={`${t(lang,"assignee")} – ${task.taskName}`}>`.
  - **priority:** `onClick` → inline `<select aria-label={`${t(lang,"priority")} – ${task.taskName}`}>` over the priority enum (reuse `priorityLabel`).
  Each editing control carries `${FOCUS_RING} ${TRANSITION}`. Jira-synced rows render the plain display (current behavior).

- [ ] **Step 7: Component test** in `task-row.test.tsx`: double-click name → input appears → type + Enter → `onInlinePatch` called with `{taskName}`; click due cell → date input → change + blur → patch `{dueDate}`; Escape cancels (no patch); a `jiraKey` row shows no inline inputs.

- [ ] **Step 8:** `npx tsc --noEmit`; `npx vitest run src/app/task-row src/app/use-inline-cell-edit`; `npm run lint` (changed files); `npm run size:check`.

- [ ] **Step 9: axe** Open Points (row-unique labels): `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"`.

- [ ] **Step 10: Commit** `feat(tasks): inline editing of name, dates, assignee, priority in Open Points`.

---

## Task 6: Shared task-editor buffer hook

**Files:**
- Create: `src/app/use-task-editor-buffer.ts`, `src/app/use-task-editor-buffer.test.ts`

Holds create-mode staged RAID + links; `flush(parentId)` applies them once the parent id exists; `discard()` drops them. Used by Tasks 7 + 8.

- [ ] **Step 1: Failing test** `use-task-editor-buffer.test.ts`:
```ts
import { renderHook, act } from "@testing-library/react";
import { useTaskEditorBuffer } from "./use-task-editor-buffer";

it("stages raid + links and flushes them against the resolved parent id", () => {
  const applyRaid = vi.fn();
  const applyLink = vi.fn();
  const { result } = renderHook(() => useTaskEditorBuffer({ applyRaid, applyLink }));
  act(() => result.current.stageRaid({ category: "R", title: "Risk A" }));
  act(() => result.current.stageLink({ childId: 42, direction: "predecessor", type: "FS" }));
  act(() => result.current.flush(7));
  expect(applyRaid).toHaveBeenCalledWith(7, { category: "R", title: "Risk A" });
  expect(applyLink).toHaveBeenCalledWith(7, { childId: 42, direction: "predecessor", type: "FS" });
  expect(result.current.pendingRaid).toHaveLength(0);
  expect(result.current.pendingLinks).toHaveLength(0);
});
it("discard drops the buffer without applying", () => {
  const applyRaid = vi.fn(); const applyLink = vi.fn();
  const { result } = renderHook(() => useTaskEditorBuffer({ applyRaid, applyLink }));
  act(() => result.current.stageRaid({ category: "A", title: "x" }));
  act(() => result.current.discard());
  expect(applyRaid).not.toHaveBeenCalled();
  expect(result.current.pendingRaid).toHaveLength(0);
});
```

- [ ] **Step 2: Run, expect FAIL.** Run: `npx vitest run src/app/use-task-editor-buffer.test.ts`

- [ ] **Step 3: Implement `use-task-editor-buffer.ts`:**
```ts
"use client";
import { useCallback, useState } from "react";
import type { RaidCategory } from "./types"; // adjust to the real category type name

export interface RaidSpec { category: RaidCategory | string; title: string; }
export interface LinkSpec { childId: number; direction: "predecessor" | "successor"; type: string; }

interface Deps {
  applyRaid: (parentId: number, spec: RaidSpec) => void;
  applyLink: (parentId: number, spec: LinkSpec) => void;
}

export function useTaskEditorBuffer({ applyRaid, applyLink }: Deps) {
  const [pendingRaid, setPendingRaid] = useState<RaidSpec[]>([]);
  const [pendingLinks, setPendingLinks] = useState<LinkSpec[]>([]);
  const stageRaid = useCallback((s: RaidSpec) => setPendingRaid((p) => [...p, s]), []);
  const stageLink = useCallback((s: LinkSpec) => setPendingLinks((p) => [...p, s]), []);
  const discard = useCallback(() => { setPendingRaid([]); setPendingLinks([]); }, []);
  const flush = useCallback((parentId: number) => {
    setPendingRaid((raid) => { raid.forEach((s) => applyRaid(parentId, s)); return []; });
    setPendingLinks((links) => { links.forEach((s) => applyLink(parentId, s)); return []; });
  }, [applyRaid, applyLink]);
  return { pendingRaid, pendingLinks, stageRaid, stageLink, discard, flush };
}
```
> Applying side-effects inside the functional updater is acceptable here because `flush` runs once from an event handler (task-save), not render; but to avoid strict-mode double-invoke of the updater applying twice, prefer reading the current arrays via a ref. Safer version: keep `pendingRaid`/`pendingLinks` mirrored in a `useRef`, and in `flush` read the ref, call apply\*, then `setPending*([])`. Use the ref version to be strict-mode-safe (mirror the `undo/use-undo-stack.ts` stackRef pattern).

- [ ] **Step 4:** Rewrite `flush`/`discard` to read from refs (strict-mode-safe):
```ts
const raidRef = useRef<RaidSpec[]>([]); const linkRef = useRef<LinkSpec[]>([]);
// keep refs in sync in stageRaid/stageLink/discard/flush setters
```
Re-run the test, expect PASS.

- [ ] **Step 5: Commit** `feat(tasks): editor buffer hook for create-mode RAID/links`.

---

## Task 7: Create RAID from the task editor

**Files:**
- Create: `src/app/task-editor-raid-mini.tsx` (shared inline mini-form + pending list)
- Modify: `src/app/task-edit-view.tsx`, `src/app/task-form-modal.tsx` (mount the mini-form)
- Modify: `src/app/task-manager.tsx` (provide `applyRaid` + buffer wiring)
- Test: `src/app/task-editor-raid-mini.test.tsx`

**Context:** Reuse `sanitizeRaidItem` (the single validator, enforces enums/dates/status defaults per category) + `nextRaidId(raid)` + functional `setRaid`. `RaidItem.linkedTaskIds` links to tasks. Edit-mode → apply immediately; create-mode → stage in the buffer, flush on save.

- [ ] **Step 1: Failing test** — the mini-form stages/creates a RAID:
```ts
it("adds a RAID spec via category+title and calls onAdd", () => {
  const onAdd = vi.fn();
  render(<TaskEditorRaidMini lang="en-US" onAdd={onAdd} pending={[]} />);
  fireEvent.click(screen.getByRole("button", { name: /create raid/i }));
  fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "R" } });
  fireEvent.change(screen.getByLabelText(/raid title/i), { target: { value: "New risk" } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(onAdd).toHaveBeenCalledWith({ category: "R", title: "New risk" });
});
```

- [ ] **Step 2: Run, expect FAIL.** Run: `npx vitest run src/app/task-editor-raid-mini.test.tsx`

- [ ] **Step 3: Implement `task-editor-raid-mini.tsx`** — a collapsible `+ Create RAID` button revealing `[category select][title input][Add]`; on Add, call `onAdd({category,title})` and clear the title. Props: `{ lang, onAdd, pending }`. Render `pending` (RaidSpec[]) as a small "pending" list with the category+title (so create-mode staging is visible). Category options from the RAID category enum; row-unique/labeled controls (`aria-label` "RAID category", "RAID title"). Use `INTERACTIVE`/`FOCUS_RING`.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Provide `applyRaid` in task-manager:**
```ts
const applyRaidFromTask = useCallback((taskId: number, spec: RaidSpec) => {
  setRaid((prev) => {
    const id = nextRaidId(prev);
    const raw = { id, category: spec.category, title: spec.title, linkedTaskIds: [taskId] } as RaidItem;
    const clean = sanitizeRaidItem(raw) ?? raw;
    return [...prev, clean];
  });
}, [setRaid]);
```
Instantiate `useTaskEditorBuffer({ applyRaid: applyRaidFromTask, applyLink: applyLinkFromTask /* Task 8 */ })` in task-manager (above the editor).

- [ ] **Step 6: Wire into both editor surfaces.** Mount `<TaskEditorRaidMini>` in `TaskEditView` and `TaskFormModal` (thread `onAdd` + `pending`). `onAdd`: if the task being edited has an id → `applyRaidFromTask(id, spec)` immediately; else → `buffer.stageRaid(spec)`. On the task-save commit path, after the parent id is known, call `buffer.flush(parentId)`; on cancel, `buffer.discard()`.

- [ ] **Step 7: i18n** `taskEditorCreateRaid` ("Create RAID"/"RAID anlegen"), `raidTitle` (if not present), `raidCategory` — EN + DE.

- [ ] **Step 8:** `npx tsc --noEmit`; `npx vitest run src/app/task-editor-raid-mini`; `npm run lint` (changed files); `npm run size:check`.

- [ ] **Step 9: Commit** `feat(tasks): create RAID items from the task editor`.

---

## Task 8: Nested "create linked task"

**Files:**
- Modify: `src/app/task-edit-view.tsx`, `src/app/task-form-modal.tsx` (add the "+ New linked task" button + direction toggle in the nested modal)
- Modify: `src/app/task-manager.tsx` (nested-modal state + `applyLink` + child creation)
- Test: nested-create behavior in `task-manager` test or a focused component test

**Context:** The nested editor is a `TaskFormModal` layered on top (rides `modalStack` — topmost Escape closes only it). `TaskDependency.taskId` is the PREDECESSOR. Direction: predecessor → `parent.dependencies += {taskId: child, type}`; successor → `child.dependencies += {taskId: parent, type}`. Child is created immediately on nested-save (real id); the parent-side link is applied now if the parent has an id, else buffered.

- [ ] **Step 1: Failing test** — applying a link wires the correct task's dependencies:
```ts
// unit-test the pure link applier
import { applyTaskLink } from "./task-link";
it("predecessor: child becomes a dependency of the parent", () => {
  const tasks = [{ id: 1, dependencies: [] }, { id: 2, dependencies: [] }] as any;
  const out = applyTaskLink(tasks, 1, { childId: 2, direction: "predecessor", type: "FS" });
  expect(out.find((t)=>t.id===1).dependencies).toEqual([{ taskId: 2, type: "FS" }]);
});
it("successor: parent becomes a dependency of the child", () => {
  const tasks = [{ id: 1, dependencies: [] }, { id: 2, dependencies: [] }] as any;
  const out = applyTaskLink(tasks, 1, { childId: 2, direction: "successor", type: "FS" });
  expect(out.find((t)=>t.id===2).dependencies).toEqual([{ taskId: 1, type: "FS" }]);
});
it("does not duplicate an existing dependency", () => {
  const tasks = [{ id: 1, dependencies: [{ taskId: 2, type: "FS" }] }, { id: 2, dependencies: [] }] as any;
  const out = applyTaskLink(tasks, 1, { childId: 2, direction: "predecessor", type: "FS" });
  expect(out.find((t)=>t.id===1).dependencies).toHaveLength(1);
});
```

- [ ] **Step 2: Run, expect FAIL.** Run: `npx vitest run src/app/task-link.test.ts`

- [ ] **Step 3: Implement pure `src/app/task-link.ts`:**
```ts
import type { Task } from "./types";
import type { LinkSpec } from "./use-task-editor-buffer";

/** Wire a predecessor/successor dependency between a parent task and a child. Pure. */
export function applyTaskLink(tasks: readonly Task[], parentId: number, link: LinkSpec): Task[] {
  const targetId = link.direction === "predecessor" ? parentId : link.childId;
  const depId = link.direction === "predecessor" ? link.childId : parentId;
  return tasks.map((t) => {
    if (t.id !== targetId) return t;
    const deps = t.dependencies ?? [];
    if (deps.some((d) => d.taskId === depId)) return t;
    return { ...t, dependencies: [...deps, { taskId: depId, type: link.type as Task["dependencies"][number]["type"] }] };
  });
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: task-manager wiring.**
  - `applyLinkFromTask(parentId, spec)` = `setTasks((prev) => applyTaskLink(prev, parentId, spec))`.
  - Nested-modal state: `nestedTaskDraft` (open/closed + a fresh empty draft). "+ New linked task" in the editor opens it; on nested-save, create the child (`nextTaskId` + functional `setTasks` + the SAME create path the normal task create uses, routed through `applyStatusChange` for status per the status model), capture its id, then: if the parent has an id → `applyLinkFromTask(parentId, {childId, direction, type})`; else → `buffer.stageLink({childId, direction, type})`.
  - Direction toggle: a small `predecessor|successor` segmented control in the nested modal footer; default `predecessor`, default `type: "FS"`.
- [ ] **Step 6:** Mount the "+ New linked task" button in both `TaskEditView` and `TaskFormModal`; the nested `TaskFormModal` opens with `zIndex` above the parent (Modal stacking already handles topmost Escape). Parent stays mounted.

- [ ] **Step 7: i18n** `taskEditorNewLinkedTask` ("New linked task"/"Neue verknüpfte Aufgabe"), `taskLinkAsPredecessor` ("Predecessor"/"Vorgänger"), `taskLinkAsSuccessor` ("Successor"/"Nachfolger") — EN + DE (umlaut ä/ä/ü via node write).

- [ ] **Step 8: Component test** — opening the nested modal from an editor, saving a child with direction=successor, asserts the child's dependencies include the parent; new-parent path stages a link and flush wires it after save. Assert the nested modal is topmost (Escape closes only it).

- [ ] **Step 9:** `npx tsc --noEmit`; `npx vitest run src/app/task-link src/app/task-manager`; `npm run lint` (changed files); `npm run size:check` (task-manager may grow → `--update` if legit).

- [ ] **Step 10: Commit** `feat(tasks): create and link a task from within the task editor`.

---

## Task 9: Release 0.175.0

**Files:** `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: Full gate.** `npx tsc --noEmit`; `npm run lint`; `npm run test:run`; `npm run size:check`; `npm run dup:check`; the four axe greps above.
- [ ] **Step 2: Bump** `version.ts` APP_VERSION → `0.175.0`, APP_BUILD_DATE comment, APP_MILESTONE → an unused SF-author surname; no new `APP_HIGHLIGHT_KEYS` (UX polish, not a new top-level feature area).
- [ ] **Step 3: CHANGELOG** `## [0.175.0] - <date> "<name>"` with Added/Changed entries for the six slices.
- [ ] **Step 4: Commit** `chore(release): 0.175.0 "<name>" — Gantt/task-editor UX batch`.
- [ ] **Step 5:** Do NOT push/MR/merge until the user says "release"/"merge" (per standing rule).

---

## Self-review notes (author)

- **Spec coverage:** Slice 1→Task 1; Slice 2→Tasks 2+3; Slice 5→Task 4; Slice 6→Task 5; shared buffer→Task 6; Slice 3→Task 7; Slice 4→Task 8. All covered.
- **Type consistency:** `RaidSpec`/`LinkSpec` defined in Task 6, reused in 7/8; `applyTaskLink` signature stable; `useInlineCellEdit`/`InlineField` stable.
- **Known adjustable points the implementer must verify against live code (not placeholders — verify + match):** the exact task-create path + status routing in Task 8 (use the same `applyStatusChange` create path the normal editor uses); whether a `sanitizeTask` exists for Task 5 (if not, clamp `taskName` with the same text sanitizer the form uses); the exact RAID category type name for `RaidSpec`. These are "match the existing pattern", with the pattern named.
