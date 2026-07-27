import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useRef, useState } from "react";
import { usePopoverDismiss } from "./use-popover-dismiss";

/** Minimal host: a wrapper containing both trigger and panel, exactly the shape
 *  the hook's contract requires. */
function Harness({ onClose }: { onClose: () => void }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  usePopoverDismiss(open, wrapperRef, () => {
    setOpen(false);
    onClose();
  });
  return (
    <div ref={wrapperRef}>
      <button type="button">trigger</button>
      {open && <div role="dialog">panel</div>}
    </div>
  );
}

describe("usePopoverDismiss", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on an outside mousedown but not an inside one", () => {
    const onClose = vi.fn();
    const { getByText } = render(<Harness onClose={onClose} />);
    fireEvent.mouseDown(getByText("trigger"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ★★ This hook backs popovers that render INSIDE edit modals — the ⚙
  // field-visibility button of every one. The shared `Modal` closes on a
  // document-level Escape unless a descendant marked the event handled, so both
  // halves of that protocol matter:
  //
  //   PRODUCER — mark what we consume, or Escape closes the popover AND the
  //   modal and the user's draft goes with it.
  //   CONSUMER — decline what someone nearer the user already claimed, or one
  //   keypress dismisses two layers.
  //
  // ★ stopPropagation cannot substitute: React 19 delegates on `document` (Next
  // hydrates the root there), the same node `Modal` listens on, and
  // stopPropagation does not suppress a listener co-registered on that node.
  it("marks the Escape it consumes", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(esc);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(esc.defaultPrevented).toBe(true);
  });

  it("declines an Escape a descendant already consumed", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    consumed.preventDefault();
    document.dispatchEvent(consumed);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("detaches its listeners once closed", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Now closed: the effect has torn down, so a second Escape reaches nobody.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
