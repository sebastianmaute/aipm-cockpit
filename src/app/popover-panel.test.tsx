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

  // ★★ Popovers render INSIDE edit modals — ModalFieldControls puts one behind
  // the tier-labelled trigger (a cog icon beside the active tier) in every edit
  // modal's header — and the shared Modal closes on a document-level
  // Escape unless a descendant marked the event handled. Both halves of that
  // protocol are pinned here: without the preventDefault, Escape closed the
  // popover AND the modal and the user's draft went with it.
  it("marks the Escape it consumes, so an enclosing modal does not also close", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("trigger"));
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
  });

  // ★★ Pins OWNERSHIP, which replaced the phase assertion this test used to
  // make. The old version asserted `addEventListener("keydown", fn, true)`
  // because capture was load-bearing: `Modal` listens on the same node and,
  // having opened first, won the bubble phase. The dismissal stack removed that
  // premise — ownership is decided by open order now, so the meaningful
  // invariant is that this panel stands down for a layer opened above it and
  // takes the key back when that layer closes. Phase is no longer part of the
  // contract and must not be re-pinned.
  it("yields Escape to a layer opened above it, and takes it back", async () => {
    const { pushDismissal, popDismissal } = await import("./dismissal-stack");
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText("trigger"));

    const above = Symbol("layer above");
    // ★ try/finally: a mid-test throw would otherwise leave this token on the
    // module-level stack, where it silently outranks every later test in this
    // file. Same leak class as an unrestored global stub.
    try {
      pushDismissal(above, "layer");
      const shielded = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      document.dispatchEvent(shielded);
      expect(onClose).not.toHaveBeenCalled();

      popDismissal(above);
      const own = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      document.dispatchEvent(own);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      popDismissal(above);
    }
  });

  it("declines an Escape a descendant already consumed", () => {
    // Something nearer the user claimed it first (a combobox dismissing its own
    // dropdown). Closing on top of that dismisses two layers with one keypress.
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText("trigger"));
    const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    consumed.preventDefault();
    document.dispatchEvent(consumed);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // ★★★ Autofocus must SKIP a non-tab-stop. The selector used to be
  // `input,button,[tabindex]`, which matches a `tabindex="-1"` element — and a
  // roving-tabindex radiogroup (`SegmentedControl`) renders every unchecked
  // radio at -1. So opening the field-visibility popover at the default
  // Advanced tier landed focus on the FIRST radio, "Simple", while "Advanced"
  // was checked. The radios are real `<button>`s with their own `onClick`, so
  // Enter or Space there SELECTED Simple — silently changing the tier, and in
  // custom mode discarding a hand-picked field set. A screen reader also
  // announced "Simple, radio, not checked" for an Advanced modal.
  // ★ `querySelector` with a comma list returns the first match in DOCUMENT
  // order, not selector order, so this lands on the checked radio wherever it
  // sits. When NOTHING is checked the first radio IS the tab-stop
  // (`hasSelection` fallback), so focus correctly stays there.
  it("focuses the first TAB-STOP, skipping a roving tabindex=-1 control", () => {
    function RovingHarness() {
      const [open, setOpen] = useState(false);
      const btnRef = useRef<HTMLButtonElement>(null);
      const close = useCallback(() => setOpen(false), []);
      return (
        <div>
          <button ref={btnRef} type="button" onClick={() => setOpen(true)}>trigger</button>
          <PopoverPanel open={open} anchorRef={btnRef} onClose={close} role="dialog" ariaLabel="Panel">
            {/* Mirrors SegmentedControl's roving tabindex: only the checked
                radio is a tab-stop, and it is NOT first in document order. */}
            <div role="radiogroup" aria-label="Tier">
              <button type="button" role="radio" aria-checked={false} tabIndex={-1}>Simple</button>
              <button type="button" role="radio" aria-checked tabIndex={0}>Advanced</button>
              <button type="button" role="radio" aria-checked={false} tabIndex={-1}>Full</button>
            </div>
          </PopoverPanel>
        </div>
      );
    }
    render(<RovingHarness />);
    fireEvent.click(screen.getByText("trigger"));
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Advanced" }));
  });

  it("still focuses the first control when it IS a tab-stop", () => {
    // The no-op half: every ordinary panel is unaffected.
    render(<Harness />);
    fireEvent.click(screen.getByText("trigger"));
    expect(document.activeElement).toBe(screen.getByLabelText("field"));
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
