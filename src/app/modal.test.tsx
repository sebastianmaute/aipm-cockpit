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
