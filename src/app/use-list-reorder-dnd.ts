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
