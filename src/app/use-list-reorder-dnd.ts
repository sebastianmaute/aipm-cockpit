"use client";
import { useState, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import { dropEdgeFor as edgeOf, reorderIds } from "./list-reorder";
import { useDragAutoscroll } from "./use-drag-autoscroll";

/** Stable stand-in for a consumer that passes no `scrollRef` — see the call. */
const NO_SCROLLER: RefObject<HTMLElement | null> = { current: null };

interface ListReorderCommon<Id> {
  /** The CURRENT order. The hook is controlled — it never owns the list. */
  ids: readonly Id[];
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

/**
 * ★★★ EXACTLY ONE OF `onReorder` / `onMove`, ENFORCED BY THE TYPE. Both were
 * plain optional members while this docstring already claimed "exactly one", so
 * a consumer supplying NEITHER compiled cleanly and every reorder — drag and
 * arrow-key alike — was silently dropped: `commit` computes the next order and
 * then calls nothing. Nothing else could catch it, because a hook that quietly
 * does nothing renders and tests exactly like one whose list happens not to move.
 * The `?: never` arms also forbid supplying BOTH, which is what makes the claim
 * true in both directions rather than only the dangerous one.
 */
type ListReorderCommit<Id> =
  /** Called with the next order. Not called for a no-op reorder. */
  | { onReorder: (ids: Id[]) => void; onMove?: never }
  /** Called with the PAIR instead of the resulting list. Consumers whose state
   *  is richer than an id list (the dashboard stores a size per tile) commit
   *  through this, so the hook never has to reconstruct their objects. */
  | { onMove: (dragId: Id, targetId: Id) => void; onReorder?: never };

export type ListReorderOptions<Id> = ListReorderCommon<Id> & ListReorderCommit<Id>;

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
  /**
   * Return the hook to rest without a `dragend`.
   *
   * ★★★ NEEDED WHENEVER A DROP UNMOUNTS THE DRAGGED ITEM. `onDragEnd` is wired
   * to the HANDLE, so removing the item detaches the node that owns it and the
   * event never reaches React's root container — the hook's own reset never
   * runs and `dragId` is stuck for the rest of the session. Three things then
   * misbehave at once: `isDragging` stays true (the dashboard shelf's
   * `onDragEnter` tray guard pops open on any stray dragEnter),
   * `useDragAutoscroll` stays active and its `tick` re-arms
   * `requestAnimationFrame` unconditionally (an unbounded rAF loop plus
   * lingering listeners), and — once the removed item is restored — every
   * `itemProps.onDragOver` still calls `preventDefault`, so dropping anything
   * on an item reorders one the user never picked up.
   *
   * ★ A consumer whose drop LEAVES the item mounted needs none of this: the
   * browser fires `dragend` on the handle and the hook resets itself.
   */
  endDrag: () => void;
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

  // ★ Called unconditionally — hooks may not sit behind a branch. The fallback
  // is the module-level NO_SCROLLER rather than a fresh `{ current: null }`
  // literal, which would be a new identity every render and so would tear down
  // and re-run `useDragAutoscroll`'s `[ref, active]` effect on every render of
  // every consumer that passes no `scrollRef`.
  useDragAutoscroll(scrollRef ?? NO_SCROLLER, dragId !== null);

  const endDrag = () => { setDragId(null); setDragOverId(null); };

  const commit = (dragged: Id, target: Id) => {
    const next = reorderIds(ids, dragged, target);
    if (next === ids) return;           // no-op: same id, or one of them absent
    if (onMove) onMove(dragged, target);
    else onReorder?.([...next]);
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
    endDrag,
    dropEdgeFor: (id) => (dragId === null || dragOverId !== id ? null : edgeOf(ids, dragId, id)),
    previewOrder: dragId !== null && dragOverId !== null ? reorderIds(ids, dragId, dragOverId) : ids,
    itemProps: (id) =>
      disabled
        ? {}
        : {
            onDragOver: (e) => {
              e.preventDefault();
              // ★★★ THE DRAGGED ITEM IS ITSELF A DROP TARGET, AND FOR A
              // `previewOrder` CONSUMER THE CURSOR ENDS UP OVER IT BY
              // CONSTRUCTION: rendering the would-be order puts the dragged
              // item in the hovered slot, i.e. under the pointer, so the
              // browser fires `dragover` on it. Adopting it as the target set
              // `dragOverId === dragId`, and `reorderIds(ids, X, X)` returns
              // `ids` BY IDENTITY — the preview snapped back to the stored
              // order, the reflow put the previous target under the cursor
              // again, and the two alternated at dragover rate. That is the
              // dashboard's "flickers strongly / have to wiggle it" report
              // (2026-09-02). Holding the standing target instead is what
              // makes the preview settle.
              if (dragId !== null && id === dragId) return;
              if (dragOverId !== id) setDragOverId(id);
            },
            onDrop: (e) => {
              e.preventDefault();
              // ★★ SAME GEOMETRY, AND THIS HALF SILENTLY DISCARDED THE MOVE: the
              // release lands on the dragged item, `commit(X, X)` is a no-op,
              // and the order the user was looking at was thrown away. Fall
              // back to the standing target, which is exactly what the preview
              // (and an edge marker, which only draws where `dragOverId ===
              // id`) has been showing.
              const target = dragId !== null && id === dragId ? dragOverId : id;
              if (dragId !== null && target !== null) commit(dragId, target);
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
