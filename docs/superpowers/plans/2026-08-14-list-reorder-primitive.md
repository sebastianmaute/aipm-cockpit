# List Reorder Primitive Implementation Plan (Phase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the drag-to-reorder logic duplicated across four surfaces into one pure engine plus one hook, and fix the missing-`setData` defect that leaves reorder dead in Firefox at three of them.

**Architecture:** A pure i18n-free engine (`list-reorder.ts`) owns the splice and the drop-edge derivation and is testable with no DOM. A thin hook (`use-list-reorder-dnd.ts`) owns the native HTML5 DnD wiring, the `setData` call Firefox requires, the arrow-key fallback, and the auto-scroll hand-off. Four call sites adopt it: `reports.tsx`, `budget-panel.tsx`, and both lists in `roles-editor.tsx`. No user-visible feature is added; reorder starts working in Firefox and roles-editor gains a keyboard path.

**Tech Stack:** TypeScript, React 19, Next 16, vitest + React Testing Library, native HTML5 drag-and-drop (no library).

**Spec:** `docs/superpowers/specs/2026-08-14-dashboard-tile-reorder-design.md` §9

---

## Before you start

Read these, in this order:

1. `AGENTS.md` — the always-loaded constraints file. Pay attention to the "Commands" section: **never read a gate's exit code through a pipe**, and `npm run lint` does not reproduce the CI gate (use `npx eslint --max-warnings=0 src/app`).
2. `src/app/use-drag-autoscroll.ts` — read the whole header comment. It explains why the browser will not auto-scroll for us.
3. `src/app/reports.tsx` — the donor. The comments on `dropEdgeFor` and on the drag handle's `onDragStart` are the two rules this primitive exists to preserve.

**Two facts that will bite you if you skip them:**

- **Firefox will not start a drag at all unless `dragstart` calls `dataTransfer.setData(...)`.** jsdom dispatches the whole drag sequence regardless, so no unit test catches its absence unless the test explicitly spies on `setData`.
- **The four call sites do not agree on splice semantics today.** reports and budget-panel insert at the target's index *before* removal; roles-editor inserts at the target's index *after* removal. On `[A,B,C,D]`, dragging A onto C gives `[B,C,A,D]` in the first two and `[B,A,C,D]` in roles-editor. This plan standardises on the first, so **roles-editor's behaviour changes for downward drags and its tests must be updated to the new expectation.**

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/app/list-reorder.ts` | create | Pure engine — `reorderIds`, `dropEdgeFor`. No React, no DOM, no i18n |
| `src/app/list-reorder.test.ts` | create | Engine unit tests |
| `src/app/use-list-reorder-dnd.ts` | create | The hook — DnD wiring, `setData`, arrow keys, auto-scroll hand-off |
| `src/app/use-list-reorder-dnd.test.tsx` | create | Hook tests against a minimal harness component |
| `src/app/reports.tsx` | modify | Adopt the hook; delete the local `dragId`/`dragOverId`/`onDropOnReport`/`dropEdgeFor`/`moveReport` |
| `src/app/budget-panel.tsx` | modify | Adopt the hook; delete the local `dragId`/`onDropOnBucket`/`moveBucket`. Gains `setData` |
| `src/app/roles-editor.tsx` | modify | Adopt the hook at both lists. Gains `setData` **and** arrow keys; splice semantics change |
| `src/app/roles-editor.test.tsx` | modify | Update to the new splice expectation; add the `setData` spy test |

`list-reorder.ts` is a new name — verify no `list-reorder.tsx` exists first, because a bare `./list-reorder` import resolves `.ts` ahead of `.tsx` and would silently hijack a component.

---

### Task 1: Pure engine — `reorderIds`

**Files:**
- Create: `src/app/list-reorder.ts`
- Test: `src/app/list-reorder.test.ts`

- [ ] **Step 1: Confirm the filename is free**

Run:
```bash
ls src/app/list-reorder.* 2>/dev/null; echo "EXIT=$?"
```
Expected: no files listed. If `list-reorder.tsx` exists, stop and rename this module.

- [ ] **Step 2: Write the failing test**

Create `src/app/list-reorder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reorderIds } from "./list-reorder";

describe("reorderIds", () => {
  it("moves a dragged id into the target's pre-removal slot when dragging down", () => {
    // A dragged onto C: A takes C's slot, i.e. lands AFTER C.
    expect(reorderIds(["A", "B", "C", "D"], "A", "C")).toEqual(["B", "C", "A", "D"]);
  });

  it("moves a dragged id before the target when dragging up", () => {
    expect(reorderIds(["A", "B", "C", "D"], "D", "B")).toEqual(["A", "D", "B", "C"]);
  });

  it("returns the original array reference when drag and target are the same", () => {
    const ids = ["A", "B", "C"];
    expect(reorderIds(ids, "B", "B")).toBe(ids);
  });

  it("returns the original array reference when either id is absent", () => {
    const ids = ["A", "B", "C"];
    expect(reorderIds(ids, "Z", "B")).toBe(ids);
    expect(reorderIds(ids, "A", "Z")).toBe(ids);
  });

  it("does not mutate its input", () => {
    const ids = ["A", "B", "C", "D"];
    reorderIds(ids, "A", "C");
    expect(ids).toEqual(["A", "B", "C", "D"]);
  });

  it("works with numeric ids", () => {
    expect(reorderIds([1, 2, 3, 4], 1, 3)).toEqual([2, 3, 1, 4]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run:
```bash
npx vitest run src/app/list-reorder.test.ts --reporter=dot > /tmp/lr.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/lr.log
```
Expected: `EXIT=1`, failure text naming `Failed to resolve import "./list-reorder"`.

Note the redirect-then-read shape. Piping into `tail` would report `tail`'s exit code and hide the failure.

- [ ] **Step 4: Write the implementation**

Create `src/app/list-reorder.ts`:

```ts
/**
 * Pure list-reorder arithmetic shared by every drag-to-reorder surface.
 *
 * NO React, NO DOM, NO i18n — this file must stay importable from a bare node
 * process so it can be property-tested and reused without a jsdom environment.
 *
 * ★★ THE SPLICE SEMANTICS ARE LOAD-BEARING AND WERE NOT UNIFORM BEFORE THIS
 * EXISTED. The dragged id is removed FIRST and then inserted at the index the
 * target held BEFORE that removal, so the dragged item takes the target's slot:
 * dropping on a LATER item lands after it, dropping on an EARLIER item lands
 * before it. `roles-editor.tsx` used to compute the insert index on the ALREADY
 * FILTERED array, which always lands before the target; that behaviour was
 * dropped in favour of this one when it adopted this module.
 */

/** Reorder `ids` by moving `dragId` into `targetId`'s slot. Returns the SAME
 *  array reference on a no-op, so callers can skip a commit cheaply. */
export function reorderIds<Id>(ids: readonly Id[], dragId: Id, targetId: Id): Id[] | readonly Id[] {
  if (dragId === targetId) return ids;
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, dragId);
  return next;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
npx vitest run src/app/list-reorder.test.ts --reporter=dot > /tmp/lr.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/lr.log
```
Expected: `EXIT=0`, 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/app/list-reorder.ts src/app/list-reorder.test.ts
git commit -m "feat(list-reorder): add pure reorderIds engine"
```

---

### Task 2: Pure engine — `dropEdgeFor`

**Files:**
- Modify: `src/app/list-reorder.ts`
- Test: `src/app/list-reorder.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/list-reorder.test.ts`:

```ts
import { dropEdgeFor } from "./list-reorder";

describe("dropEdgeFor", () => {
  const ids = ["A", "B", "C", "D"];

  it("reports 'after' when the target sits later than the dragged id", () => {
    // Matches reorderIds: dragging A onto C lands A after C.
    expect(dropEdgeFor(ids, "A", "C")).toBe("after");
  });

  it("reports 'before' when the target sits earlier than the dragged id", () => {
    expect(dropEdgeFor(ids, "D", "B")).toBe("before");
  });

  it("reports null for the dragged id itself", () => {
    expect(dropEdgeFor(ids, "B", "B")).toBeNull();
  });

  it("reports null when either id is absent", () => {
    expect(dropEdgeFor(ids, "Z", "B")).toBeNull();
    expect(dropEdgeFor(ids, "A", "Z")).toBeNull();
  });

  it("agrees with reorderIds in both directions", () => {
    // The edge is a CLAIM about where reorderIds will put the item. Pin the two
    // together so they cannot drift apart.
    for (const [drag, target] of [["A", "C"], ["D", "B"], ["B", "D"], ["C", "A"]] as const) {
      const edge = dropEdgeFor(ids, drag, target);
      const next = reorderIds(ids, drag, target) as string[];
      const landedAt = next.indexOf(drag);
      const targetAt = next.indexOf(target);
      expect(edge).toBe(landedAt > targetAt ? "after" : "before");
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
npx vitest run src/app/list-reorder.test.ts --reporter=dot > /tmp/lr.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/lr.log
```
Expected: `EXIT=1`, `"dropEdgeFor" is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `src/app/list-reorder.ts`:

```ts
/**
 * Which edge of `targetId` a drop will land on, or null when the pair is not a
 * valid drop.
 *
 * ★★ DERIVED FROM THE SPLICE, never chosen for looks. Because `reorderIds`
 * removes the dragged id BEFORE inserting at the target's original index, every
 * index above the target shifts down by one: dropping on a LATER item lands
 * after it, dropping on an EARLIER item lands before it. Marking one fixed edge
 * would be correct in one direction and a lie in the other.
 */
export function dropEdgeFor<Id>(
  ids: readonly Id[],
  dragId: Id,
  targetId: Id,
): "before" | "after" | null {
  if (dragId === targetId) return null;
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return null;
  return from < to ? "after" : "before";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/app/list-reorder.test.ts --reporter=dot > /tmp/lr.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/lr.log
```
Expected: `EXIT=0`, 11 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/list-reorder.ts src/app/list-reorder.test.ts
git commit -m "feat(list-reorder): derive dropEdgeFor from the splice"
```

---

### Task 3: The hook — drag wiring and the `setData` guarantee

**Files:**
- Create: `src/app/use-list-reorder-dnd.ts`
- Test: `src/app/use-list-reorder-dnd.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/use-list-reorder-dnd.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { useListReorderDnd } from "./use-list-reorder-dnd";

/** Minimal consumer: a list of three items with a handle each. */
function Harness({ onReorder, keyboard = true }: { onReorder: (ids: string[]) => void; keyboard?: boolean }) {
  const [ids, setIds] = useState(["A", "B", "C"]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dnd = useListReorderDnd<string>({
    ids,
    onReorder: (next) => { setIds(next); onReorder(next); },
    scrollRef,
    keyboard,
  });
  return (
    <div ref={scrollRef}>
      {ids.map((id) => (
        <div key={id} data-testid={`item-${id}`} data-drop-edge={dnd.dropEdgeFor(id) ?? undefined} {...dnd.itemProps(id)}>
          <button type="button" aria-label={`Move ${id}`} {...dnd.handleProps(id)}>grip</button>
        </div>
      ))}
    </div>
  );
}

/** Renders previewOrder so the live-reflow contract is observable. */
function PreviewHarness() {
  const ids = ["A", "B", "C"];
  const dnd = useListReorderDnd<string>({ ids, onReorder: () => {} });
  return (
    <div>
      <output data-testid="preview">{dnd.previewOrder.join(",")}</output>
      {ids.map((id) => (
        <div key={id} data-testid={`item-${id}`} {...dnd.itemProps(id)}>
          <button type="button" aria-label={`Move ${id}`} {...dnd.handleProps(id)}>grip</button>
        </div>
      ))}
    </div>
  );
}

/** Supplies onMove instead of onReorder. */
function PairHarness({ onMove, onReorder }: { onMove: (a: string, b: string) => void; onReorder: (ids: string[]) => void }) {
  const ids = ["A", "B", "C"];
  const dnd = useListReorderDnd<string>({ ids, onMove, onReorder });
  return (
    <div>
      {ids.map((id) => (
        <div key={id} data-testid={`item-${id}`} {...dnd.itemProps(id)}>
          <button type="button" aria-label={`Move ${id}`} {...dnd.handleProps(id)}>grip</button>
        </div>
      ))}
    </div>
  );
}

const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: "" });

describe("useListReorderDnd", () => {
  it("calls setData on dragstart — Firefox will not start a drag without it", () => {
    // ★ This assertion is the entire reason the hook owns dragstart. jsdom
    // dispatches the drag sequence whether or not setData was called, so a test
    // that only checked the resulting order would pass on a broken build.
    render(<Harness onReorder={() => {}} />);
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByLabelText("Move A"), { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalled();
  });

  it("reorders on drop using the target's pre-removal slot", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    fireEvent.dragStart(screen.getByLabelText("Move A"), { dataTransfer: dataTransfer() });
    fireEvent.dragOver(screen.getByTestId("item-C"));
    fireEvent.drop(screen.getByTestId("item-C"));
    expect(onReorder).toHaveBeenCalledWith(["B", "C", "A"]);
  });

  it("exposes the drop edge while dragging over a target", () => {
    render(<Harness onReorder={() => {}} />);
    fireEvent.dragStart(screen.getByLabelText("Move A"), { dataTransfer: dataTransfer() });
    fireEvent.dragOver(screen.getByTestId("item-C"));
    expect(screen.getByTestId("item-C")).toHaveAttribute("data-drop-edge", "after");
    expect(screen.getByTestId("item-B")).not.toHaveAttribute("data-drop-edge");
  });

  it("clears drag state on dragend so no edge survives a cancelled drag", () => {
    render(<Harness onReorder={() => {}} />);
    const handle = screen.getByLabelText("Move A");
    fireEvent.dragStart(handle, { dataTransfer: dataTransfer() });
    fireEvent.dragOver(screen.getByTestId("item-C"));
    fireEvent.dragEnd(handle);
    expect(screen.getByTestId("item-C")).not.toHaveAttribute("data-drop-edge");
  });

  it("moves an item with ArrowUp and ArrowDown when keyboard is enabled", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    fireEvent.keyDown(screen.getByLabelText("Move C"), { key: "ArrowUp" });
    expect(onReorder).toHaveBeenCalledWith(["A", "C", "B"]);
  });

  it("ignores arrow keys at the ends of the list", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    fireEvent.keyDown(screen.getByLabelText("Move A"), { key: "ArrowUp" });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("wires no key handler when keyboard is disabled", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} keyboard={false} />);
    fireEvent.keyDown(screen.getByLabelText("Move C"), { key: "ArrowUp" });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("exposes previewOrder as the order a release would produce", () => {
    // ★ For a consumer that reflows live (the dashboard's dense grid), where an
    // edge marker would point at the wrong slot.
    render(<PreviewHarness />);
    expect(screen.getByTestId("preview").textContent).toBe("A,B,C");
    fireEvent.dragStart(screen.getByLabelText("Move A"), { dataTransfer: dataTransfer() });
    fireEvent.dragOver(screen.getByTestId("item-C"));
    expect(screen.getByTestId("preview").textContent).toBe("B,C,A");
  });

  it("calls onMove with the pair instead of onReorder when given", () => {
    const onMove = vi.fn();
    const onReorder = vi.fn();
    render(<PairHarness onMove={onMove} onReorder={onReorder} />);
    fireEvent.dragStart(screen.getByLabelText("Move A"), { dataTransfer: dataTransfer() });
    fireEvent.dragOver(screen.getByTestId("item-C"));
    fireEvent.drop(screen.getByTestId("item-C"));
    expect(onMove).toHaveBeenCalledWith("A", "C");
    expect(onReorder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
npx vitest run src/app/use-list-reorder-dnd.test.tsx --reporter=dot > /tmp/lrh.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/lrh.log
```
Expected: `EXIT=1`, `Failed to resolve import "./use-list-reorder-dnd"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/use-list-reorder-dnd.ts`:

```ts
"use client";
import { useState, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import { dropEdgeFor as edgeOf, reorderIds } from "./list-reorder";
import { useDragAutoscroll } from "./use-drag-autoscroll";

export interface ListReorderOptions<Id> {
  /** The CURRENT order. The hook is controlled — it never owns the list. */
  ids: readonly Id[];
  /** Called with the next order. Not called for a no-op reorder. Optional only
   *  when `onMove` is supplied instead. */
  onReorder?: (ids: Id[]) => void;
  /** Called with the PAIR instead of the resulting list. Consumers whose state
   *  is richer than an id list (the dashboard stores a size per tile) commit
   *  through this, so the hook never has to reconstruct their objects. Exactly
   *  one of `onReorder` / `onMove` must be supplied. */
  onMove?: (dragId: Id, targetId: Id) => void;
  /** Scroller to edge-auto-scroll during a drag. Omit for none. */
  scrollRef?: RefObject<HTMLElement | null>;
  /** ArrowUp/ArrowDown reorder on the handle. Default true. Pass false when the
   *  consumer offers its own keyboard path (e.g. a menu) and a second one would
   *  be redundant. */
  keyboard?: boolean;
  /** Disable the whole interaction (e.g. a sorted view, where dragging would
   *  fight the sort). Default false. */
  disabled?: boolean;
}

export interface ListReorderDnd<Id> {
  dragId: Id | null;
  isDragging: boolean;
  /** Which edge of `id` a drop would land on right now, or null. */
  dropEdgeFor: (id: Id) => "before" | "after" | null;
  /** The order as it WOULD be if the drag were released now; `ids` unchanged
   *  when no drag is in flight. A consumer whose layout reflows (a dense grid)
   *  renders this instead of an edge marker — see the hook docstring. */
  previewOrder: readonly Id[];
  /** Spread onto the DROP TARGET element for `id`. */
  itemProps: (id: Id) => {
    onDragOver?: (e: DragEvent<HTMLElement>) => void;
    onDrop?: (e: DragEvent<HTMLElement>) => void;
  };
  /** Spread onto the DRAG HANDLE for `id`. */
  handleProps: (id: Id) => {
    draggable?: boolean;
    onDragStart?: (e: DragEvent<HTMLElement>) => void;
    onDragEnd?: () => void;
    onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  };
}

/**
 * Native HTML5 drag-to-reorder for a list of ids.
 *
 * ★★ IT OWNS `dataTransfer.setData` AND THAT IS THE POINT. Firefox will not
 * START a drag at all unless `dragstart` sets some transfer data. The payload is
 * never read back — the reorder uses `dragId` from state — but without the call
 * reorder is simply dead in Firefox. jsdom dispatches the whole sequence
 * regardless, so only a test that spies on `setData` can catch its absence, and
 * three of this hook's four original call sites had shipped without it.
 *
 * ★ Touch does not fire native HTML5 drag events at all. Consumers that must
 * work on touch need a different mechanism (Pointer Events); see the spec's
 * roadmap. The arrow-key path works everywhere.
 *
 * ★★ TWO WAYS TO SHOW WHERE A DROP WILL LAND, and they are not interchangeable.
 * `dropEdgeFor` marks an edge on the target and suits a list whose items do not
 * move until release. `previewOrder` is the whole resulting order, for a
 * consumer that reflows live — in a `grid-auto-flow: dense` grid an edge marker
 * would routinely point at a slot the item does not end up in, because dense
 * backfill re-places everything after the move.
 */
export function useListReorderDnd<Id>({
  ids,
  onReorder,
  onMove,
  scrollRef,
  keyboard = true,
  disabled = false,
}: ListReorderOptions<Id>): ListReorderDnd<Id> {
  const [dragId, setDragId] = useState<Id | null>(null);
  const [dragOverId, setDragOverId] = useState<Id | null>(null);

  // ★ A ref object is permanently stable, so passing `undefined` through is
  // safe: the hook below no-ops on a null current. Called unconditionally —
  // hooks may not sit behind a branch.
  useDragAutoscroll(scrollRef ?? { current: null }, dragId !== null);

  const endDrag = () => { setDragId(null); setDragOverId(null); };

  const commit = (dragged: Id, target: Id) => {
    const next = reorderIds(ids, dragged, target);
    if (next === ids) return;           // no-op: same id, or one of them absent
    if (onMove) onMove(dragged, target);
    else onReorder?.(next as Id[]);
  };

  const move = (id: Id, delta: number) => {
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    commit(id, ids[j]);
  };

  return {
    dragId,
    isDragging: dragId !== null,
    dropEdgeFor: (id) => (dragId === null || dragOverId !== id ? null : edgeOf(ids, dragId, id)),
    previewOrder: dragId !== null && dragOverId !== null ? reorderIds(ids, dragId, dragOverId) : ids,
    itemProps: (id) =>
      disabled
        ? {}
        : {
            onDragOver: (e) => {
              e.preventDefault();
              if (dragOverId !== id) setDragOverId(id);
            },
            onDrop: (e) => {
              e.preventDefault();
              if (dragId !== null) commit(dragId, id);
              endDrag();
            },
          },
    handleProps: (id) =>
      disabled
        ? {}
        : {
            draggable: true,
            onDragStart: (e) => {
              // Firefox will not start a drag without transfer data. Optional
              // chaining because a test may dispatch without a dataTransfer.
              e.dataTransfer?.setData("text/plain", String(id));
              if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
              setDragId(id);
            },
            onDragEnd: endDrag,
            onKeyDown: keyboard
              ? (e) => {
                  if (e.key === "ArrowUp") { e.preventDefault(); move(id, -1); }
                  else if (e.key === "ArrowDown") { e.preventDefault(); move(id, 1); }
                }
              : undefined,
          },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/app/use-list-reorder-dnd.test.tsx --reporter=dot > /tmp/lrh.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/lrh.log
```
Expected: `EXIT=0`, 9 passed.

- [ ] **Step 5: Prove the `setData` test can actually fail**

Temporarily delete the `e.dataTransfer?.setData(...)` line in `use-list-reorder-dnd.ts`, then run:
```bash
npx vitest run src/app/use-list-reorder-dnd.test.tsx --reporter=dot > /tmp/lrh.log 2>&1; echo "EXIT=$?"; grep -c "FAIL\|×" /tmp/lrh.log
```
Expected: `EXIT=1` and exactly the `setData` test failing. **Restore the line and re-run to green before continuing.**

A test that cannot fail is worth nothing, and this specific one guards a defect that shipped three times. Do not skip this step.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/list-reorder.ts src/app/use-list-reorder-dnd.ts src/app/use-list-reorder-dnd.test.tsx; echo "EXIT=$?"
```
Expected: `EXIT=0` for both. An unused import or variable is FATAL under `--max-warnings=0`.

- [ ] **Step 7: Commit**

```bash
git add src/app/use-list-reorder-dnd.ts src/app/use-list-reorder-dnd.test.tsx
git commit -m "feat(list-reorder): add useListReorderDnd hook owning the Firefox setData rule"
```

---

### Task 4: Adopt in `reports.tsx`

The donor. Its behaviour must not change at all — its existing tests are the proof.

**Files:**
- Modify: `src/app/reports.tsx`

- [ ] **Step 1: Record the current test state**

```bash
npx vitest run src/app/reports.test.tsx --reporter=dot > /tmp/rep-before.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/rep-before.log
```
Expected: `EXIT=0`. Note the passing count — it must be identical after the migration.

- [ ] **Step 2: Replace the local state and handlers**

In `src/app/reports.tsx`, delete these declarations (currently just below the sort/filter state, near the top of the component): `const [dragId, setDragId]`, `const [dragOverId, setDragOverId]`, `const endDrag`, `const onDropOnReport`, the `dropEdgeFor` function with its comment block, and `const moveReport`.

Keep `cardsScrollRef` — it is still the scroller. Remove the now-unused `useDragAutoscroll` import; the hook calls it internally.

Add in their place:

```tsx
const reorder = useListReorderDnd<AddableReportId>({
  ids: extraReports,
  onReorder: (ids) => onChangeExtraReports?.(ids),
  scrollRef: cardsScrollRef,
});
```

Add the import:

```tsx
import { useListReorderDnd } from "./use-list-reorder-dnd";
```

- [ ] **Step 3: Rewire the card element**

In the `visibleExtra.map` block, replace `const dropEdge = dropEdgeFor(id);` with:

```tsx
const dropEdge = reorder.dropEdgeFor(id);
```

Replace the card `<div>`'s `onDragOver` and `onDrop` props with a spread, leaving every other prop untouched:

```tsx
{...reorder.itemProps(id)}
```

In the same element's `className` array, replace `dragId != null && dragId !== id ? "opacity-70" : ""` with:

```tsx
reorder.isDragging && reorder.dragId !== id ? "opacity-70" : "",
```

- [ ] **Step 4: Rewire the drag handle**

On the handle `<button>`, delete `draggable`, `onDragStart`, `onDragEnd` and `onKeyDown`, and spread the hook's props instead. Keep `type`, `tabIndex`, `aria-label`, `title` and `className` exactly as they are — the row-unique `aria-label` is load-bearing for WCAG 2.4.6 and axe cannot see its absence.

```tsx
<button
  type="button"
  tabIndex={0}
  {...reorder.handleProps(id)}
  aria-label={`${t(lang, "reportReorderHandle")} – ${t(lang, meta.titleKey)}`}
  title={t(lang, "reportReorderHandle")}
  className="cursor-grab touch-none select-none rounded px-1 py-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green print:hidden"
>
  ⠿
</button>
```

- [ ] **Step 5: Run the reports tests — the count must match Step 1**

```bash
npx vitest run src/app/reports.test.tsx --reporter=dot > /tmp/rep-after.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/rep-after.log
```
Expected: `EXIT=0` and the **same** number of passing tests as Step 1. A drop in count means a test silently stopped running, not that it passed.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/reports.tsx; echo "EXIT=$?"
```
Expected: `EXIT=0` for both. A leftover `useDragAutoscroll` or `useState` import is fatal here.

- [ ] **Step 7: Commit**

```bash
git add src/app/reports.tsx
git commit -m "refactor(reports): adopt useListReorderDnd"
```

---

### Task 5: Adopt in `budget-panel.tsx` — gains `setData`

**Files:**
- Modify: `src/app/budget-panel.tsx`

Its splice semantics already match the primitive, so the only behaviour change is that dragging starts working in Firefox.

- [ ] **Step 1: Record the current test state**

```bash
npx vitest run src/app/budget-panel.test.tsx --reporter=dot > /tmp/bud-before.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/bud-before.log
```
Expected: `EXIT=0`. Note the count.

- [ ] **Step 2: Replace the local state and handlers**

Delete the `dragId` state, `onDropOnBucket` and `moveBucket` (keeping the comment above `moveBucket` is not needed — the hook documents it). Add:

```tsx
const bucketOrder = useListReorderDnd<number>({
  ids: sortedBucketIds(),
  onReorder: applyBucketOrder,
});
```

and the import:

```tsx
import { useListReorderDnd } from "./use-list-reorder-dnd";
```

**Check `sortedBucketIds()` first.** If it is a function computing a fresh array each render, calling it inline here is correct but means `ids` has a new identity every render. That is harmless for this hook (it holds no memo on `ids`), but if it is expensive, hoist it to a `useMemo` and pass that.

- [ ] **Step 3: Rewire the bucket row element**

Replace the row's `onDragOver`/`onDrop` props with:

```tsx
{...bucketOrder.itemProps(br.bucketId)}
```

- [ ] **Step 4: Rewire the handle**

Replace `draggable`, `onDragStart`, `onDragEnd` and the `onKeyDown` arrow-key block with:

```tsx
{...bucketOrder.handleProps(br.bucketId)}
```

Leave the handle's `aria-label`, `title` and `className` exactly as they are.

- [ ] **Step 5: Add the `setData` regression test**

Append to `src/app/budget-panel.test.tsx`, adapting the existing render helper in that file to seed at least two buckets:

```tsx
it("sets drag transfer data — Firefox will not start a drag without it", () => {
  // ★ Was missing before the primitive: onDragStart took no event argument at
  // all, so bucket reorder was dead in Firefox with no test able to see it.
  renderBudgetPanel();                       // use this file's existing helper
  const handles = screen.getAllByRole("button", { name: /reorder/i });
  const setData = vi.fn();
  fireEvent.dragStart(handles[0], { dataTransfer: { setData, effectAllowed: "" } });
  expect(setData).toHaveBeenCalled();
});
```

If the handle's accessible name does not match `/reorder/i`, read the current `aria-label` in `budget-panel.tsx` and use that string — do not change the label to suit the test.

- [ ] **Step 6: Run the budget tests**

```bash
npx vitest run src/app/budget-panel.test.tsx --reporter=dot > /tmp/bud-after.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/bud-after.log
```
Expected: `EXIT=0`, count = Step 1's count **+ 1**.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/budget-panel.tsx src/app/budget-panel.test.tsx; echo "EXIT=$?"
git add src/app/budget-panel.tsx src/app/budget-panel.test.tsx
git commit -m "fix(budget): set drag transfer data so bucket reorder works in Firefox"
```

---

### Task 6: Adopt in `roles-editor.tsx` — both lists, with a behaviour change

**Files:**
- Modify: `src/app/roles-editor.tsx`
- Modify: `src/app/roles-editor.test.tsx`

**This task changes behaviour.** roles-editor inserted at the target's index in the *filtered* array (always landing before the target); the primitive lands the item in the target's slot. On `[A,B,C,D]`, dragging A onto C changes from `[B,A,C,D]` to `[B,C,A,D]`. Its tests must be updated to the new expectation — do not bend the primitive.

- [ ] **Step 1: Record the current test state and find the order assertions**

```bash
npx vitest run src/app/roles-editor.test.tsx --reporter=dot > /tmp/roles-before.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/roles-before.log
grep -n "onReorder\|toEqual\|toHaveBeenCalledWith" src/app/roles-editor.test.tsx
```
Expected: `EXIT=0`. The grep lists every assertion that may encode the old splice.

- [ ] **Step 2: Migrate the roles table**

Replace `draggedRoleIdRef` and the four inline drag handlers on the `<tr>`. Add near the other hooks in that component:

```tsx
const roleOrder = useListReorderDnd<number>({
  ids: sortedRoles.map((r) => r.id),
  onReorder: onReorderRoles,
  disabled: !!sort,          // dragging a sorted view would fight the sort
});
```

The `reorderable` local becomes `!sort` as before; keep it for the `≡` glyph's conditional render. On the `<tr>`, replace the four conditional handlers with:

```tsx
{...roleOrder.itemProps(r.id)}
{...roleOrder.handleProps(r.id)}
```

Both spreads go on the `<tr>` because this list has no separate handle element — the whole row is the drag source, which is why `disabled` exists on the hook rather than the caller re-implementing the `reorderable ? … : undefined` pattern on every prop.

- [ ] **Step 3: Migrate the sub-list**

In the list component holding `draggedIdRef` (the `<ul>` of renameable items), delete the ref and the four handlers, and add:

```tsx
const itemOrder = useListReorderDnd<number>({
  ids: items.map((it) => it.id),
  onReorder,
});
```

On each `<li>`, replace the four handlers with:

```tsx
{...itemOrder.itemProps(it.id)}
{...itemOrder.handleProps(it.id)}
```

- [ ] **Step 4: Give the `≡` glyphs an accessible name**

Both lists render `≡` as `aria-hidden` decoration, and the drag source is now keyboard-focusable via the hook's `onKeyDown`. A keyboard user needs to reach it and hear what it does. Change both glyph spans to real handles:

```tsx
<span
  role="button"
  tabIndex={0}
  aria-label={`${t(lang, "reorderHint")} – ${disciplineName} / ${gradeName}`}
  title={t(lang, "reorderHint")}
  className="mr-1 cursor-move select-none text-muted-foreground"
>≡</span>
```

and in the sub-list:

```tsx
<span
  role="button"
  tabIndex={0}
  aria-label={`${t(lang, "reorderHint")} – ${it.name}`}
  title={t(lang, "reorderHint")}
  className="cursor-move select-none px-1 text-muted-foreground"
>≡</span>
```

The name must be row-unique. N identical "Reorder" labels is a WCAG 2.4.6 failure that **axe cannot detect at any seed size** — the test in Step 6 is the only detector.

- [ ] **Step 5: Update the existing order assertions**

For every assertion the Step 1 grep surfaced that encodes a drag result, recompute the expectation under the new semantics: the dragged id lands in the target's slot. If a test drags downward, its expected array changes; if it drags upward, it does not.

- [ ] **Step 6: Add the two regression tests**

Append to `src/app/roles-editor.test.tsx`:

```tsx
it("sets drag transfer data — Firefox will not start a drag without it", () => {
  // ★ Was missing at BOTH drag sites in this file. The pre-existing test's
  // dataTransfer stub happened to include a setData, so it passed regardless.
  renderRolesEditor();                       // use this file's existing helper
  const rows = screen.getAllByRole("row").slice(1);   // drop the header row
  const setData = vi.fn();
  fireEvent.dragStart(rows[0], { dataTransfer: { setData, effectAllowed: "" } });
  expect(setData).toHaveBeenCalled();
});

it("gives every reorder handle a row-unique accessible name", () => {
  // ★ Two rows minimum, or the collision cannot render and the test is vacuous.
  renderRolesEditor();
  const names = screen.getAllByRole("button", { name: /reorder/i }).map((el) => el.getAttribute("aria-label"));
  expect(names.length).toBeGreaterThan(1);
  expect(new Set(names).size).toBe(names.length);
});
```

Both helpers must seed **at least two roles**. Check the existing fixture; if it seeds one, extend it.

- [ ] **Step 7: Run the tests**

```bash
npx vitest run src/app/roles-editor.test.tsx --reporter=dot > /tmp/roles-after.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/roles-after.log
```
Expected: `EXIT=0`, count = Step 1's count **+ 2**.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/roles-editor.tsx src/app/roles-editor.test.tsx; echo "EXIT=$?"
git add src/app/roles-editor.tsx src/app/roles-editor.test.tsx
git commit -m "fix(roles): adopt useListReorderDnd — Firefox drag, keyboard reorder, unique handle names"
```

---

### Task 7: Verify in a real Firefox

The whole defect is invisible to jsdom. This is the only step that actually proves the fix.

- [ ] **Step 1: Start a dev server on an isolated port**

```bash
PORT=3100 npm run dev
```

- [ ] **Step 2: Check each surface in Firefox**

Open `http://localhost:3100` in Firefox and confirm drag-reorder works on:
- Reports — add two extra report cards, drag one onto the other
- Budget — drag a bucket onto another
- Settings → roles editor — drag a role row, and drag a sub-list item

- [ ] **Step 3: Record what you found**

If a surface still fails, the `setData` rule is not the whole story and the comment in `use-list-reorder-dnd.ts` needs correcting — investigate before claiming the fix. If all four work, note it in the commit message of the next task.

- [ ] **Step 4: Stop the server**

```bash
PORT=3100 npm run stop
```

---

### Task 8: Full gate run

- [ ] **Step 1: Full unit suite, unpiped**

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```
Expected: `EXIT=0`.

- [ ] **Step 2: Shuffled suite — the only local reproduction of the CI gate**

```bash
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
```
Expected: `EXIT=0`. This adds tests, so this gate is mandatory before pushing.

- [ ] **Step 3: Coverage — the new engine files are gated**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep -E "ERROR|threshold" /tmp/cov.log
```
Expected: `EXIT=0`. `list-reorder.ts` and `use-list-reorder-dnd.ts` are both coverage-gated `.ts` files. If a floor fails, add the missing branch test — do not add either file to `coverage.exclude`; they are logic, not glue.

- [ ] **Step 4: Duplication gate — should improve**

```bash
npm run dup:check > /tmp/dup.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/dup.log
```
Expected: `EXIT=0`, and the total duplicated-line percentage lower than before this branch. Removing three copies of the reorder is the point.

- [ ] **Step 5: File-size ratchet**

```bash
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/size.log
```
Expected: `EXIT=0`. All four modified files should have shrunk.

- [ ] **Step 6: Lint and typecheck, both unpiped**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```
Expected: `EXIT=0` for both.

- [ ] **Step 7: Axe on the two scanned views this touched**

Reports and Budget are both in `A11Y_VIEWS`. Warm the route first, and use one worker.

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Reports|Budget" --workers=1 > /tmp/axe.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/axe.log
```
Expected: `EXIT=0`. A `Test timeout of 60000ms exceeded` is contention or a cold compile, not a violation — a real violation names a rule id and an impact.

- [ ] **Step 8: Commit any fixes and finish**

```bash
git add -A
git commit -m "test(list-reorder): satisfy coverage and gate runs"
```

---

## Definition of done

- One pure engine and one hook, both tested, the `setData` test mutation-proved
- Four call sites migrated; reports' behaviour byte-identical, budget-panel gains Firefox support, roles-editor gains Firefox support + keyboard + unique handle names
- roles-editor's splice behaviour change is reflected in its tests, deliberately
- Drag verified by hand in a real Firefox on all four surfaces
- Every gate green, each read from an unpiped exit code
