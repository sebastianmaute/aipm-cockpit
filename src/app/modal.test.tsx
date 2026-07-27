import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { Modal } from "./modal";

// jsdom doesn't implement requestAnimationFrame on the global; install a
// synchronous shim so focus-management effects don't sit on a queued frame.
beforeEach(() => {
  vi.stubGlobal(
    "requestAnimationFrame",
    (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    },
  );
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

describe("Modal", () => {
  test("renders nothing when open=false", () => {
    render(
      <Modal open={false} onClose={() => {}} ariaLabel="Test dialog">
        <p>panel</p>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("panel")).not.toBeInTheDocument();
  });

  test("renders a dialog with aria-modal and the supplied label", () => {
    render(
      <Modal open onClose={() => {}} ariaLabel="Edit absence">
        <p>panel</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Edit absence" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  test("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} ariaLabel="Test dialog">
        <p>panel</p>
      </Modal>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("leaves an Escape a descendant already consumed", () => {
    // ★★ The ONLY way an inner widget (a combobox dropdown, a popover) can
    // swallow Escape without closing the modal and discarding the user's draft.
    // stopPropagation cannot do it: React 19 delegates events on `document` —
    // the same node this handler is registered on — and stopPropagation does
    // not suppress a listener co-registered on the same node. So the protocol
    // is preventDefault + this bail. Dropping it silently re-breaks every
    // dropdown inside every edit modal, and no RTL test would notice, because
    // RTL renders into a div under body where propagation genuinely does stop.
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} ariaLabel="Test dialog">
        <p>panel</p>
      </Modal>,
    );
    const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    consumed.preventDefault();
    document.dispatchEvent(consumed);
    expect(onClose).not.toHaveBeenCalled();

    // An unconsumed Escape still closes it.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("calls onClose on backdrop click but not on inside-panel click", async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} ariaLabel="Test dialog">
        <div data-testid="panel">
          <button type="button">Save</button>
        </div>
      </Modal>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = screen.getByRole("dialog");
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("does not close when a press starts inside the panel and releases on the backdrop", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} ariaLabel="Test">
        <div data-testid="panel"><button>inside</button></div>
      </Modal>,
    );
    const backdrop = screen.getByRole("dialog");
    fireEvent.mouseDown(screen.getByTestId("panel")); // press starts inside the panel (like grabbing a resize corner)
    fireEvent.click(backdrop);                          // release/click resolves to the backdrop
    expect(onClose).not.toHaveBeenCalled();
  });

  test("focuses the first focusable child when no initialFocusRef is given", () => {
    render(
      <Modal open onClose={() => {}} ariaLabel="Test">
        <div>
          <button type="button" data-testid="first">First</button>
          <button type="button" data-testid="second">Second</button>
        </div>
      </Modal>,
    );
    // Focus must land on a real control (visible ring), not the tabIndex=-1
    // dialog root (un-ringed backdrop — WCAG 2.4.7).
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  test("focuses initialFocusRef on open", () => {
    function Harness() {
      const ref = useRef<HTMLInputElement | null>(null);
      return (
        <Modal open onClose={() => {}} ariaLabel="Test" initialFocusRef={ref}>
          <input ref={ref} data-testid="first" />
          <input data-testid="second" />
        </Modal>
      );
    }
    render(<Harness />);
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  test("restores focus to the previously-active element on close", () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button type="button" data-testid="opener">
            Open
          </button>
          <Modal open={open} onClose={() => {}} ariaLabel="Test">
            <input data-testid="field" />
          </Modal>
        </>
      );
    }
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByTestId("opener");
    act(() => opener.focus());
    expect(opener).toHaveFocus();

    rerender(<Harness open={true} />);
    rerender(<Harness open={false} />);
    expect(opener).toHaveFocus();
  });

  // The focus-trap handler relies on `preventDefault` stopping the browser's
  // default Tab behavior — userEvent.tab() runs its own focus shift on top
  // of dispatching the event, which mutes preventDefault and gives the wrong
  // signal. fireEvent.keyDown dispatches the event only, exercising the
  // handler in isolation (which is what a real browser would do once
  // preventDefault is honored).

  test("Tab wraps from last to first focusable element", () => {
    render(
      <Modal open onClose={() => {}} ariaLabel="Test">
        <button type="button" data-testid="b1">
          first
        </button>
        <button type="button" data-testid="b2">
          last
        </button>
      </Modal>,
    );
    const first = screen.getByTestId("b1");
    const last = screen.getByTestId("b2");
    act(() => last.focus());
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();
  });

  test("Shift+Tab wraps from first to last focusable element", () => {
    render(
      <Modal open onClose={() => {}} ariaLabel="Test">
        <button type="button" data-testid="b1">
          first
        </button>
        <button type="button" data-testid="b2">
          last
        </button>
      </Modal>,
    );
    const first = screen.getByTestId("b1");
    const last = screen.getByTestId("b2");
    act(() => first.focus());
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });
});

// Nested modals (e.g. the backend setup wizard opened from inside the
// create-project modal). Only the TOPMOST open modal may respond to Escape /
// Tab — guards the topmost-only regression that re-shipped twice. (Ownership
// moved from Modal's own private stack to the shared `dismissal-stack`.)
describe("Modal — nested stacking", () => {
  test("Escape closes only the topmost (last-opened) modal", () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <>
        <Modal open onClose={outerClose} ariaLabel="Outer">
          <p>outer</p>
        </Modal>
        <Modal open onClose={innerClose} ariaLabel="Inner">
          <p>inner</p>
        </Modal>
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  test("topmost stays correct after the parent modal re-renders with a NEW onClose identity", () => {
    // Reproduces the original bug: typing in the nested wizard re-renders the
    // parent, handing it a fresh onClose closure. The stack must NOT re-order.
    const innerClose = vi.fn();
    function Harness({ outerClose }: { outerClose: () => void }) {
      return (
        <>
          <Modal open onClose={outerClose} ariaLabel="Outer">
            <p>outer</p>
          </Modal>
          <Modal open onClose={innerClose} ariaLabel="Inner">
            <p>inner</p>
          </Modal>
        </>
      );
    }
    const { rerender } = render(<Harness outerClose={vi.fn()} />);
    const outerClose2 = vi.fn();
    rerender(<Harness outerClose={outerClose2} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose2).not.toHaveBeenCalled();
  });

  test("after the topmost closes, the next modal becomes topmost for Escape", () => {
    const outerClose = vi.fn();
    function Harness({ innerOpen }: { innerOpen: boolean }) {
      return (
        <>
          <Modal open onClose={outerClose} ariaLabel="Outer">
            <p>outer</p>
          </Modal>
          <Modal open={innerOpen} onClose={() => {}} ariaLabel="Inner">
            <p>inner</p>
          </Modal>
        </>
      );
    }
    const { rerender } = render(<Harness innerOpen />);
    rerender(<Harness innerOpen={false} />); // inner unmounts → pops the stack
    fireEvent.keyDown(document, { key: "Escape" });
    expect(outerClose).toHaveBeenCalledTimes(1);
  });

  test("keeps Tab containment when a popover layers above it", async () => {
    const { pushDismissal, popDismissal, resetDismissalStack } = await import(
      "./dismissal-stack"
    );
    resetDismissalStack();
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} ariaLabel="Editor">
        <button type="button">first</button>
        <button type="button">last</button>
      </Modal>,
    );
    // A popover opens on top of the modal. It owns Escape...
    const popover = Symbol("popover");
    pushDismissal(popover, "layer");

    const first = screen.getByRole("button", { name: "first" });
    first.focus();
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    first.dispatchEvent(escape);
    expect(onClose).not.toHaveBeenCalled();

    // ...but Tab containment is NOT waivable by a layer above (WCAG 2.4.3).
    const last = screen.getByRole("button", { name: "last" });
    last.focus();
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    popDismissal(popover);
  });
});
