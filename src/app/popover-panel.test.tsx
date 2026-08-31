import { describe, it, expect, vi } from "vitest";
import { useRef, useState, useCallback } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PopoverPanel } from "./popover-panel";

function Harness({
  onClose,
  placement,
}: {
  onClose?: () => void;
  placement?: "bottom-end" | "right-start";
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => { setOpen(false); onClose?.(); }, [onClose]);
  return (
    <div>
      <button ref={btnRef} type="button" onClick={() => setOpen((o) => !o)}>
        trigger
      </button>
      <PopoverPanel open={open} anchorRef={btnRef} onClose={close} placement={placement} role="dialog" ariaLabel="Panel" className="w-64 p-2">
        <input aria-label="field" />
      </PopoverPanel>
    </div>
  );
}

/** jsdom has no layout, so every geometry test stubs the two rects the panel
 *  measures — the anchor (a `<button>`) and the panel itself (a `<span>`). */
function withRects(
  { anchor, panel, innerWidth, innerHeight }:
  { anchor: DOMRect; panel: DOMRect; innerWidth: number; innerHeight: number },
  body: () => void,
) {
  const origW = window.innerWidth, origH = window.innerHeight;
  const btnProto = HTMLButtonElement.prototype.getBoundingClientRect;
  const spanProto = HTMLSpanElement.prototype.getBoundingClientRect;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: innerWidth });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight });
  HTMLButtonElement.prototype.getBoundingClientRect = () => anchor;
  HTMLSpanElement.prototype.getBoundingClientRect = () => panel;
  try {
    body();
  } finally {
    HTMLButtonElement.prototype.getBoundingClientRect = btnProto;
    HTMLSpanElement.prototype.getBoundingClientRect = spanProto;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: origW });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: origH });
  }
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

  // ★★ The fallback branch. A panel whose EVERY candidate is a roving -1 matches
  // the narrow selector nowhere; without the `??` the focus call silently
  // no-ops, and because the panel is PORTALED the next Tab leaves it entirely —
  // the exact failure autoFocus exists to prevent. No shipped consumer has this
  // shape yet (`project-switcher.tsx` renders it but does not use PopoverPanel),
  // so this test is the only thing standing between a future all-menuitem panel
  // and a silent regression.
  it("falls back to a tabindex=-1 control when the panel has NO tab-stop", () => {
    function AllRovingHarness() {
      const [open, setOpen] = useState(false);
      const btnRef = useRef<HTMLButtonElement>(null);
      const close = useCallback(() => setOpen(false), []);
      return (
        <div>
          <button ref={btnRef} type="button" onClick={() => setOpen(true)}>trigger</button>
          <PopoverPanel open={open} anchorRef={btnRef} onClose={close} role="dialog" ariaLabel="Panel">
            {/* An all-`tabIndex={-1}` menu, the shape project-switcher renders. */}
            <div role="menu">
              <button type="button" role="menuitem" tabIndex={-1}>First</button>
              <button type="button" role="menuitem" tabIndex={-1}>Second</button>
            </div>
          </PopoverPanel>
        </div>
      );
    }
    render(<AllRovingHarness />);
    fireEvent.click(screen.getByText("trigger"));
    // Focus must land INSIDE the panel — programmatic .focus() works on a -1
    // element. Asserting "not the trigger" alone would pass if focus went to
    // document.body, which is the very bug.
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "First" }));
  });

  it("renders nothing while closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not arm the close-on-scroll listener until the panel is rendered", () => {
    // §124: the listener used to be registered in the same effect pass that
    // called setPos, i.e. while the panel was still gated behind `open && pos`.
    // A scroll dispatched by the browser to reveal the trigger then closed a
    // panel that had never been in the DOM.
    const realAdd = window.addEventListener;
    let panelPresentWhenArmed: boolean | null = null;
    const spy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type, listener, options) => {
        if (type === "scroll" && panelPresentWhenArmed === null) {
          panelPresentWhenArmed =
            document.body.querySelector('[role="dialog"]') !== null;
        }
        return realAdd.call(window, type, listener, options);
      });
    try {
      render(<Harness />);
      fireEvent.click(screen.getByText("trigger"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(panelPresentWhenArmed).toBe(true);
    } finally {
      spy.mockRestore();
    }
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

  // ★★ `right-start` exists for the COLLAPSED SIDEBAR RAIL, whose flyout must sit
  // BESIDE its trigger rather than under it. It is a second geometry, not a tweak
  // of the default: it drives `left`/`top` where `bottom-end` drives `right` and
  // `top`/`bottom`. Asserting the unused edges are EMPTY is the load-bearing half
  // — a placement that set `left` while leaving a stale `right` behind would
  // stretch the panel across the viewport, and every "did it move?" assertion
  // would still pass.
  describe("placement=right-start", () => {
    it("anchors to the right of the trigger, top-aligned, and sets no other edge", () => {
      // Rail-shaped anchor: a 48px icon button at x 8..56, y 120..152.
      const anchor = { top: 120, bottom: 152, left: 8, right: 56, width: 48, height: 32, x: 8, y: 120 } as DOMRect;
      // Panel as it paints at left = anchor.right + 4 = 60, 176px wide (min-w-44).
      const panel = { top: 120, bottom: 320, left: 60, right: 236, width: 176, height: 200, x: 60, y: 120 } as DOMRect;
      withRects({ anchor, panel, innerWidth: 1280, innerHeight: 800 }, () => {
        render(<Harness placement="right-start" />);
        fireEvent.click(screen.getByText("trigger"));
        const el = screen.getByRole("dialog");
        expect(el.style.left).toBe("60px");
        expect(el.style.top).toBe("120px");
        expect(el.style.right).toBe("");
        expect(el.style.bottom).toBe("");
      });
    });

    it("clamps both axes back inside the viewport", () => {
      // Anchor low on a NARROW viewport: opening at its top/right would paint the
      // panel off the bottom AND off the right edge.
      const anchor = { top: 700, bottom: 732, left: 8, right: 56, width: 48, height: 32, x: 8, y: 700 } as DOMRect;
      const panel = { top: 700, bottom: 900, left: 60, right: 236, width: 176, height: 200, x: 60, y: 700 } as DOMRect;
      withRects({ anchor, panel, innerWidth: 200, innerHeight: 800 }, () => {
        render(<Harness placement="right-start" />);
        fireEvent.click(screen.getByText("trigger"));
        const el = screen.getByRole("dialog");
        // left: innerWidth - width - margin = 200 - 176 - 8
        expect(el.style.left).toBe("16px");
        // top: innerHeight - height - margin = 800 - 200 - 8
        expect(el.style.top).toBe("592px");
      });
    });
  });

  // ★★★ ONE NEGATIVE REMAINS, NOT THREE, and this block used to say otherwise.
  // §297 flipped the resize and ancestor-scroll cases to POSITIVES — focus is
  // still inside the panel on those paths, so the choice was never between the
  // anchor and where the user was, it was between the anchor and `<body>`. The
  // surviving negative is outside-CLICK, which is the whole §146 concern: a
  // real outside click blurs first, so the unmount guard stands down. Named
  // mutant for what is left: drop the `focusInsideRef` check in the unmount
  // cleanup and restore unconditionally — the outside-mousedown test below and
  // "leaves focus alone when the consumer has already moved it" both go red
  // (measured, 2 of 23).
  it("returns focus to the trigger on Escape", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    fireEvent.click(trigger);
    // autoFocus lands on the panel's first control, so focus starts INSIDE.
    expect(screen.getByLabelText("field")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  // ★★★ THE SURVIVING NEGATIVE IS A PAIR, and the `queryByRole` half is the
  // load-bearing one. `not.toHaveFocus()` is an ABSENCE assertion, and an
  // absence passes trivially when the thing under test never ran at all — a
  // `fireEvent` that misses the listener (the capture-phase ancestor-`scroll`
  // one, or the resize guard that only trips on a WIDTH change) leaves the
  // panel open and focus wherever it was, which is indistinguishable from "did
  // not steal focus". `Harness`'s `close` calls `setOpen(false)`, so a real
  // dismiss unmounts the panel. ★ The two flipped tests below no longer need
  // this argument for their focus half — `toHaveFocus()` on the trigger is a
  // POSITIVE, which a listener that never fired cannot satisfy — but they keep
  // the open-then-gone pair for the dismissal half.
  //
  // ★★★ THE PAIR IS OPEN-THEN-GONE, NEVER GONE-ALONE, and an earlier revision
  // of this comment claimed the second half sufficed ("asserting it is gone
  // FIRST proves the path actually fired"). It does not: `toBeNull()` after
  // the dismiss is indistinguishable from a panel that NEVER RENDERED. The
  // panel is gated on `open && pos`, this file stubs `getBoundingClientRect`
  // and `window.innerWidth` elsewhere, and a dispatched click does not move
  // focus in jsdom (measured) — so a positioning change leaving `pos` null
  // would satisfy BOTH assertions in the negative test and hollow out the only
  // detector this behaviour will ever have (axe has no rule for it). The
  // `getByRole` BEFORE the dismiss is what rules that out; it throws.
  // ★★★ §297 SUPERSEDES THE ESCAPE-ONLY RULE, BUT NOT FOR OUTSIDE-CLICK, and
  // the `.blur()` below is what keeps that honest rather than accidental. A real
  // outside mousedown on non-focusable chrome blurs the focused control first,
  // so the unmount guard records focus as having LEFT the panel and stands down
  // — which is the whole §146 concern ("don't yank the user back"). jsdom does
  // NOT implement that side effect of `mousedown` (the comment above says so,
  // measured), so without the explicit blur this test passes for the wrong
  // reason: it would pin focus parked inside a panel the user just clicked away
  // from, a state no browser produces.
  it("does NOT return focus to the trigger on an outside mousedown", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).not.toHaveFocus();
  });

  // ★★★ FLIPPED BY §297 — both of these asserted `not.toHaveFocus()` until the
  // unmount guard landed. Unlike the outside-click above, a resize or an
  // ancestor scroll leaves focus exactly where it was: INSIDE the panel that is
  // about to be destroyed. The old rule read that as "the user did not ask to
  // leave, so don't move them", but the choice was never between the anchor and
  // where they were — it was between the anchor and `<body>`.
  it("returns focus to the trigger on a width resize that closes the panel", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const origWidth = window.innerWidth;
    // ★ try/finally so a leaked 500px viewport cannot reach another test in
    // this file: the geometry tests above take `window.innerWidth` as their own
    // restore baseline, and `test:shuffle` reorders tests WITHIN a file.
    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
      fireEvent(window, new Event("resize"));
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: origWidth });
    }
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("returns focus to the trigger when an ancestor scroller closes the panel", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.scroll(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  /** §297. Closes with a RAW `setOpen(false)`, exactly as export-menu's pick,
   *  template-menus' submit and action-cta-controls' item helper do — a test
   *  written against a memoised `close` would pass against a fix that rewired
   *  `close` and missed those sites. */
  function ActivateHarness() {
    const [open, setOpen] = useState(false);
    const btnRef = useRef<HTMLButtonElement>(null);
    return (
      <div>
        <button ref={btnRef} type="button" onClick={() => setOpen((o) => !o)}>
          trigger
        </button>
        <PopoverPanel open={open} anchorRef={btnRef} onClose={() => setOpen(false)} role="dialog" ariaLabel="Panel" className="w-64 p-2">
          <button type="button" onClick={() => setOpen(false)}>item</button>
        </PopoverPanel>
      </div>
    );
  }

  it("returns focus to the anchor when an item closes the panel", () => {
    render(<ActivateHarness />);
    fireEvent.click(screen.getByText("trigger"));
    const item = screen.getByText("item");
    item.focus();
    fireEvent.click(item);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByText("trigger"));
  });

  it("leaves focus alone when the consumer has already moved it", () => {
    // dashboard-panel restores focus itself, to an element that is NOT the
    // anchor. The containment guard must let it win.
    function ElsewhereHarness() {
      const [open, setOpen] = useState(false);
      const btnRef = useRef<HTMLButtonElement>(null);
      const otherRef = useRef<HTMLButtonElement>(null);
      return (
        <div>
          <button ref={btnRef} type="button" onClick={() => setOpen((o) => !o)}>
            trigger
          </button>
          <button ref={otherRef} type="button">elsewhere</button>
          <PopoverPanel open={open} anchorRef={btnRef} onClose={() => setOpen(false)} role="dialog" ariaLabel="Panel" className="w-64 p-2">
            <button
              type="button"
              onClick={() => { otherRef.current?.focus(); setOpen(false); }}
            >
              item
            </button>
          </PopoverPanel>
        </div>
      );
    }
    render(<ElsewhereHarness />);
    fireEvent.click(screen.getByText("trigger"));
    const item = screen.getByText("item");
    item.focus();
    fireEvent.click(item);
    expect(document.activeElement).toBe(screen.getByText("elsewhere"));
  });
});
