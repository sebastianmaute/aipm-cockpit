import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { useListReorderDnd, type ListReorderOptions } from "./use-list-reorder-dnd";

/** Minimal consumer: a list of three items with a handle each. */
function Harness({ onReorder, keyboard = true, disabled = false }: { onReorder: (ids: string[]) => void; keyboard?: boolean; disabled?: boolean }) {
  const [ids, setIds] = useState(["A", "B", "C"]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dnd = useListReorderDnd<string>({
    ids,
    onReorder: (next) => { setIds(next); onReorder(next); },
    scrollRef,
    keyboard,
    disabled,
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
function PreviewHarness({ onReorder = () => {} }: { onReorder?: (ids: string[]) => void } = {}) {
  const ids = ["A", "B", "C"];
  const dnd = useListReorderDnd<string>({ ids, onReorder });
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

/**
 * Supplies onMove AND onReorder, to pin `commit`'s precedence.
 *
 * ★★ THE DOUBLE CAST IS DELIBERATE AND MUST NOT BE REMOVED BY "FIXING" THE TYPE.
 * `ListReorderOptions` is a discriminated union whose arms carry `?: never`, so
 * passing both is a build error — exactly what that union exists to say, and
 * `as ListReorderOptions<string>` alone is rejected too (TS2352: the shapes do
 * not overlap). The runtime branch it guards (`if (onMove) … else
 * onReorder?.()`) is still defensive code an untyped/`any` caller can reach, so
 * this pins it from OUTSIDE the contract rather than deleting the only coverage
 * it has. Loosening the union to "at least one" would let this compile as
 * written — and would give back the "both" footgun the union exists to close.
 */
function PairHarness({ onMove, onReorder }: { onMove: (a: string, b: string) => void; onReorder: (ids: string[]) => void }) {
  const ids = ["A", "B", "C"];
  const dnd = useListReorderDnd<string>(
    { ids, onMove, onReorder } as unknown as ListReorderOptions<string>,
  );
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

/**
 * A consumer whose drop REMOVES the dragged item, so the handle that owns
 * `onDragEnd` unmounts and that event can never reach React's root container.
 * This is the dashboard's shelf-drop shape, and without `endDrag` the hook has
 * no way back to a resting state.
 */
function RemoveOnDropHarness({ callEndDrag }: { callEndDrag: boolean }) {
  const [ids, setIds] = useState(["A", "B", "C"]);
  const dnd = useListReorderDnd<string>({ ids, onReorder: setIds });
  return (
    <div>
      <output data-testid="dragging">{String(dnd.isDragging)}</output>
      <output data-testid="order">{ids.join(",")}</output>
      <button type="button" onClick={() => setIds((prev) => (prev.includes("A") ? prev : [...prev, "A"]))}>
        restore A
      </button>
      <div
        data-testid="sink"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (dnd.dragId === null) return;
          setIds((prev) => prev.filter((i) => i !== dnd.dragId));
          if (callEndDrag) dnd.endDrag();
        }}
      >
        sink
      </div>
      {ids.map((id) => (
        <div key={id} data-testid={`item-${id}`} data-drop-edge={dnd.dropEdgeFor(id) ?? undefined} {...dnd.itemProps(id)}>
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

  it("wires neither a drag source nor a drop target when disabled", () => {
    // ★ `disabled` is what keeps a drag from fighting an active column sort
    // (roles-editor passes `disabled: !!sort`). Both prop bags go empty, so
    // there is nothing to assert POSITIVELY about the drop — the guard against
    // a vacuous pass is `draggable`/`setData`, which the enabled tests above
    // exercise on the very same harness with the same sequence.
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} disabled />);
    const handle = screen.getByLabelText("Move A");
    expect(handle).not.toHaveAttribute("draggable");
    const dt = dataTransfer();
    fireEvent.dragStart(handle, { dataTransfer: dt });
    fireEvent.dragOver(screen.getByTestId("item-C"));
    fireEvent.drop(screen.getByTestId("item-C"));
    expect(dt.setData).not.toHaveBeenCalled();
    expect(screen.getByTestId("item-C")).not.toHaveAttribute("data-drop-edge");
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("wires no arrow-key reorder when disabled", () => {
    // ★ Separate from the drag path: `keyboard` defaults to true, so a
    // `disabled` that only stripped the drag props would leave ArrowUp live.
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} disabled />);
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

  it("ends a drag from OUTSIDE, for a consumer whose drop unmounts the handle", () => {
    // ★★★ `onDragEnd` lives on the HANDLE. A drop that removes the dragged item
    // detaches that node, and a detached node's events never reach React's root
    // container — so the hook's own `endDrag` never runs and the drag state is
    // stuck true for the rest of the session. `endDrag` is the escape hatch.
    render(<RemoveOnDropHarness callEndDrag />);
    fireEvent.dragStart(screen.getByLabelText("Move A"), { dataTransfer: dataTransfer() });
    fireEvent.dragOver(screen.getByTestId("item-C"));
    expect(screen.getByTestId("dragging").textContent).toBe("true");

    fireEvent.drop(screen.getByTestId("sink"));
    expect(screen.queryByTestId("item-A")).toBeNull();     // the handle really did unmount
    expect(screen.getByTestId("dragging").textContent).toBe("false");
  });

  it("does not reorder on a LATER drop once the drag was ended from outside", () => {
    // ★★★ The worst consequence of a stuck `dragId`, and the only one still
    // reachable after the removed item comes back: `itemProps.onDragOver`
    // unconditionally calls `preventDefault`, so every item stays a drop target
    // for any drag. While the item is gone `commit` is a safe no-op — but once
    // the user restores it, dropping ANYTHING on an item reorders one the user
    // never picked up.
    // ★ A version of this test that asserted `previewOrder` and `dropEdgeFor`
    // straight after the sink drop was written first and DISCARDED: with the
    // dragged id absent from `ids`, both return the resting value whether or not
    // the drag was ended, so it passed against the unfixed hook.
    render(<RemoveOnDropHarness callEndDrag />);
    fireEvent.dragStart(screen.getByLabelText("Move A"), { dataTransfer: dataTransfer() });
    fireEvent.drop(screen.getByTestId("sink"));
    fireEvent.click(screen.getByText("restore A"));
    expect(screen.getByTestId("order").textContent).toBe("B,C,A");

    fireEvent.dragOver(screen.getByTestId("item-B"));
    fireEvent.drop(screen.getByTestId("item-B"));
    expect(screen.getByTestId("order").textContent).toBe("B,C,A");
  });

  it("stays stuck when the consumer does NOT call endDrag — the defect this closes", () => {
    // ★★ The positive observable for the two tests above: the same harness with
    // the call omitted keeps `isDragging` true forever, which is what makes them
    // non-vacuous. Without this, both would pass against a hook that resets its
    // state on any re-render.
    render(<RemoveOnDropHarness callEndDrag={false} />);
    fireEvent.dragStart(screen.getByLabelText("Move A"), { dataTransfer: dataTransfer() });
    fireEvent.drop(screen.getByTestId("sink"));
    expect(screen.queryByTestId("item-A")).toBeNull();
    expect(screen.getByTestId("dragging").textContent).toBe("true");
  });
});

describe("useListReorderDnd — the dragged item sits under the cursor once the consumer reflows", () => {
  // ★★★ A PREVIEW-RENDERING CONSUMER PUTS THE DRAGGED ITEM WHERE THE CURSOR IS,
  // AND THE BROWSER THEN FIRES `dragover` ON IT. `dashboard-panel.tsx` renders
  // `previewOrder`, so the instant the preview moves the dragged tile into the
  // hovered slot, the element under the pointer IS the dragged tile. Treating
  // that as an ordinary target set `dragOverId` to the dragged id, and
  // `reorderIds(ids, A, A)` returns `ids` BY IDENTITY — so the preview reverted
  // to the stored order, the reflow put the old target back under the cursor,
  // and the two states alternated at dragover rate. Reported 2026-09-02 as
  // "it flickers strongly" and "I have to wiggle it before it snaps".
  // ★★ jsdom has NO LAYOUT, so nothing here can prove the reflow puts the tile
  // under the pointer — that half was established by reading the grid. What
  // these pin is the hook's response to the EVENT SEQUENCE a browser produces
  // once it does, which is the half that was wrong.
  it("keeps the standing preview when dragover fires on the dragged item itself", () => {
    render(<PreviewHarness />);
    fireEvent.dragStart(screen.getByLabelText("Move A"));
    fireEvent.dragOver(screen.getByTestId("item-C"));
    expect(screen.getByTestId("preview").textContent).toBe("B,C,A");
    fireEvent.dragOver(screen.getByTestId("item-A"));
    expect(screen.getByTestId("preview").textContent).toBe("B,C,A");
  });

  // ★★ THE SAME GEOMETRY MAKES THE RELEASE LAND ON THE DRAGGED ITEM. Committing
  // the pair (A, A) is a no-op, so the move the user was looking at was
  // discarded on drop — the other half of "I have to wiggle it".
  it("commits the standing preview when the drop lands on the dragged item", () => {
    const onReorder = vi.fn();
    render(<PreviewHarness onReorder={onReorder} />);
    fireEvent.dragStart(screen.getByLabelText("Move A"));
    fireEvent.dragOver(screen.getByTestId("item-C"));
    fireEvent.drop(screen.getByTestId("item-A"));
    expect(onReorder).toHaveBeenCalledWith(["B", "C", "A"]);
  });

  // The positive observable. Without it, a guard that ignored EVERY dragover
  // and every drop would satisfy both assertions above.
  it("still tracks an ordinary target and commits the one dropped on", () => {
    const onReorder = vi.fn();
    render(<PreviewHarness onReorder={onReorder} />);
    fireEvent.dragStart(screen.getByLabelText("Move A"));
    fireEvent.dragOver(screen.getByTestId("item-B"));
    expect(screen.getByTestId("preview").textContent).toBe("B,A,C");
    fireEvent.drop(screen.getByTestId("item-C"));
    expect(onReorder).toHaveBeenCalledWith(["B", "C", "A"]);
  });
});
