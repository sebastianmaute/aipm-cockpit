import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelInitialFocus } from "./use-panel-focus";

// jsdom queues requestAnimationFrame on a real frame, so a focus effect that
// defers one frame never runs inside `act`. Same synchronous shim modal.test.tsx
// installs for its own focus management.
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

function Panel({
  open,
  withPreferred = false,
}: {
  open: boolean;
  withPreferred?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  usePanelInitialFocus(ref, open);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-label="Panel" tabIndex={-1} data-testid="panel">
      <button type="button">chrome</button>
      {withPreferred && (
        <input aria-label="composer" data-panel-initial-focus />
      )}
    </div>
  );
}

function Harness({
  open,
  withPreferred = false,
}: {
  open: boolean;
  withPreferred?: boolean;
}) {
  return (
    <>
      <button type="button">trigger</button>
      <button type="button">elsewhere</button>
      <Panel open={open} withPreferred={withPreferred} />
    </>
  );
}

describe("usePanelInitialFocus", () => {
  it("moves focus to the panel root on open", async () => {
    const { rerender } = render(<Harness open={false} />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(<Harness open />);
    await act(async () => {});

    // ★ The root, NOT the first focusable child ("chrome") — landing on a
    // control the user did not ask for is worse than a neutral surface.
    expect(document.activeElement).toBe(screen.getByTestId("panel"));
  });

  it("prefers a marked target over the root", async () => {
    const { rerender } = render(<Harness open={false} withPreferred />);
    rerender(<Harness open withPreferred />);
    await act(async () => {});
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "composer" }));
  });

  it("hands focus back to the opener when the panel closes while focused", async () => {
    const { rerender } = render(<Harness open={false} />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    trigger.focus();
    rerender(<Harness open />);
    await act(async () => {});
    expect(document.activeElement).toBe(screen.getByTestId("panel"));

    rerender(<Harness open={false} />);
    await act(async () => {});
    expect(document.activeElement).toBe(trigger);
  });

  it("does NOT steal focus back when the user moved on", async () => {
    const { rerender } = render(<Harness open={false} />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    trigger.focus();
    rerender(<Harness open />);
    await act(async () => {});

    // The user goes back to work somewhere else — the panel is NON-MODAL and
    // stays open, so closing it must not yank focus out of where they are now.
    const elsewhere = screen.getByRole("button", { name: "elsewhere" });
    elsewhere.focus();
    rerender(<Harness open={false} />);
    await act(async () => {});
    expect(document.activeElement).toBe(elsewhere);
  });

  it("does nothing while closed", async () => {
    render(<Harness open={false} />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    trigger.focus();
    await act(async () => {});
    expect(document.activeElement).toBe(trigger);
  });
});
