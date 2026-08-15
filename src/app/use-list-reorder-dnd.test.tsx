import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { useListReorderDnd } from "./use-list-reorder-dnd";

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
});
