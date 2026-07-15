import { describe, it, expect, vi } from "vitest";
import { useRef, useState, useCallback } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PopoverPanel } from "./popover-panel";

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => { setOpen(false); onClose?.(); }, [onClose]);
  return (
    <div>
      <button ref={btnRef} type="button" onClick={() => setOpen((o) => !o)}>
        trigger
      </button>
      <PopoverPanel open={open} anchorRef={btnRef} onClose={close} role="dialog" ariaLabel="Panel" className="w-64 p-2">
        <input aria-label="field" />
      </PopoverPanel>
    </div>
  );
}

describe("PopoverPanel", () => {
  it("portals the panel to document.body as a fixed layer (escapes overflow clipping)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("trigger"));
    const panel = screen.getByRole("dialog");
    expect(panel.parentElement).toBe(document.body);
    expect(panel).toHaveClass("fixed");
  });

  it("stays open when clicking inside the portaled panel", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("trigger"));
    fireEvent.mouseDown(screen.getByLabelText("field"));
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("closes on an outside mousedown", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText("trigger"));
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("trigger"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders nothing while closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does NOT close when a scrollable child INSIDE the panel scrolls (nested picker regression)", () => {
    const onClose = vi.fn();
    function ScrollHarness() {
      const [open, setOpen] = useState(false);
      const btnRef = useRef<HTMLButtonElement>(null);
      const close = useCallback(() => { setOpen(false); onClose(); }, []);
      return (
        <div>
          <button ref={btnRef} type="button" onClick={() => setOpen(true)}>trigger</button>
          <PopoverPanel open={open} anchorRef={btnRef} onClose={close} role="dialog" ariaLabel="Panel">
            <div data-testid="inner-scroll" className="overflow-y-auto">content</div>
          </PopoverPanel>
        </div>
      );
    }
    render(<ScrollHarness />);
    fireEvent.click(screen.getByText("trigger"));
    // Capture-phase window scroll listener sees inner scrolls too; must be ignored.
    fireEvent.scroll(screen.getByTestId("inner-scroll"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("closes when an ancestor scroller (outside the panel) scrolls", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText("trigger"));
    fireEvent.scroll(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("flips above and clamps left for a low, left-positioned anchor (mocked rects)", () => {
    // jsdom returns all-zero rects, so mock the anchor + panel geometry: a trigger
    // near the bottom-left of a narrow viewport must open ABOVE (bottom set) and
    // not paint off the left edge.
    const origW = window.innerWidth, origH = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    // Anchor: x 20..90, near the bottom (top 660, bottom 680) → little room below.
    const anchorRect = { top: 660, bottom: 680, left: 20, right: 90, width: 70, height: 20, x: 20, y: 660 } as DOMRect;
    // Panel: 288px wide (w-72), tall — measured after paint for the left clamp.
    const panelRect = { top: 0, bottom: 200, left: -198, right: 90, width: 288, height: 200, x: -198, y: 0 } as DOMRect;
    const btnProto = HTMLButtonElement.prototype.getBoundingClientRect;
    const spanProto = HTMLSpanElement.prototype.getBoundingClientRect;
    HTMLButtonElement.prototype.getBoundingClientRect = () => anchorRect;
    HTMLSpanElement.prototype.getBoundingClientRect = () => panelRect;
    try {
      render(<Harness />);
      fireEvent.click(screen.getByText("trigger"));
      const panel = screen.getByRole("dialog");
      // Opened above → bottom set, top unset.
      expect(panel.style.bottom).not.toBe("");
      expect(panel.style.top).toBe("");
      // Left-clamped: right shrunk so left edge (innerWidth - right - width) >= margin.
      const right = parseFloat(panel.style.right);
      expect(375 - right - 288).toBeGreaterThanOrEqual(8 - 0.5);
    } finally {
      HTMLButtonElement.prototype.getBoundingClientRect = btnProto;
      HTMLSpanElement.prototype.getBoundingClientRect = spanProto;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: origW });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: origH });
    }
  });
});
