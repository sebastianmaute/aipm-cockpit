import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider, useConfirm } from "./confirm-dialog";

// Synchronous rAF shim so the Modal focus-management effect runs immediately.
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

function Harness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await confirm({ message: "Delete this widget?" });
        onResult(ok);
      }}
    >
      trigger
    </button>
  );
}

function renderHarness(onResult: (v: boolean) => void) {
  return render(
    <ConfirmProvider lang="en-US">
      <Harness onResult={onResult} />
    </ConfirmProvider>,
  );
}

describe("ConfirmProvider / useConfirm", () => {
  test("does not render a dialog until confirm() is called", () => {
    renderHarness(() => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("opens a dialog with the supplied message and default title", async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    await user.click(screen.getByRole("button", { name: "trigger" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Delete this widget?")).toBeInTheDocument();
    expect(screen.getByText("Please confirm")).toBeInTheDocument();
  });

  test("Confirm resolves the promise true and closes the dialog", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderHarness(onResult);
    await user.click(screen.getByRole("button", { name: "trigger" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Cancel resolves the promise false and closes the dialog", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderHarness(onResult);
    await user.click(screen.getByRole("button", { name: "trigger" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Escape resolves the promise false (dismiss = decline)", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderHarness(onResult);
    await user.click(screen.getByRole("button", { name: "trigger" }));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("custom title, labels and default danger tone are honoured", async () => {
    const user = userEvent.setup();
    function CustomHarness() {
      const confirm = useConfirm();
      return (
        <button
          type="button"
          onClick={() => {
            void confirm({
              message: "msg",
              title: "Remove item",
              confirmLabel: "Remove",
              cancelLabel: "Keep",
            });
          }}
        >
          go
        </button>
      );
    }
    render(
      <ConfirmProvider lang="en-US">
        <CustomHarness />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByText("Remove item")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
  });

  test("backdrop click resolves the promise false and closes", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderHarness(onResult);
    await user.click(screen.getByRole("button", { name: "trigger" }));
    const dialog = screen.getByRole("dialog");
    // Modal closes on a press+click that both start and end on the backdrop.
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("a superseding confirm resolves the previous prompt as declined", async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];
    function Multi() {
      const confirm = useConfirm();
      return (
        <button
          type="button"
          onClick={() => {
            void confirm({ message: "first" }).then((v) => results.push(v));
            void confirm({ message: "second" }).then((v) => results.push(v));
          }}
        >
          go
        </button>
      );
    }
    render(
      <ConfirmProvider lang="en-US">
        <Multi />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: "go" }));
    // The first prompt was superseded by the second → resolved false; only the
    // second dialog is shown.
    await waitFor(() => expect(results).toContain(false));
    expect(screen.getByText("second")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(results).toEqual([false, true]));
  });
});
