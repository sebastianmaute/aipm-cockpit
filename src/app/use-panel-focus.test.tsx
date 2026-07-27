import { act, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
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

function Panel({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  usePanelInitialFocus(ref, open);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-label="Panel" tabIndex={-1} data-testid="panel">
      <button type="button">chrome</button>
    </div>
  );
}

/** ★★ `help-menu`'s shape: the panel is gated on a `pos` that a SIBLING effect
 *  sets a tick after open, so the node does not exist when this hook's effect
 *  runs — only by the time its deferred frame fires. A harness that mounts the
 *  node synchronously on `open` cannot reproduce it, which is exactly why the
 *  first version of this hook captured a permanently-null root here and nothing
 *  caught it. */
function DeferredPanel({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<number | null>(null);
  usePanelInitialFocus(ref, open && pos !== null);
  useEffect(() => {
    // ★ Resolved in an async callback, never a synchronous effect-body
    // setState — `react-hooks/set-state-in-effect` is BANNED here and CI
    // rejects it. Same reason `tour-overlay` measures its anchor inside a rAF.
    let live = true;
    if (!open) {
      Promise.resolve().then(() => { if (live) setPos(null); });
      return () => { live = false; };
    }
    Promise.resolve().then(() => { if (live) setPos(0); });
    return () => { live = false; };
  }, [open]);
  if (!open || pos === null) return null;
  return (
    <div ref={ref} role="dialog" aria-label="Deferred" tabIndex={-1} data-testid="deferred">
      <button type="button">chrome</button>
    </div>
  );
}

/** A panel whose root NEVER unmounts — only the `rendered` flag flips. No real
 *  consumer is shaped this way today (both fully unmount), but the hook's
 *  `stillInside` branch is unreachable without it: removing a focused node
 *  drops `activeElement` to `body`, which routes every unmounting panel through
 *  `focusLost` instead. Kept so the branch has real coverage and so a future
 *  panel that hides rather than unmounts is already specified. */
function StickyHarness({ rendered }: { rendered: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  usePanelInitialFocus(ref, rendered);
  return (
    <>
      <button type="button">trigger</button>
      <div ref={ref} role="dialog" aria-label="Sticky" tabIndex={-1} data-testid="sticky">
        <button type="button">sticky chrome</button>
      </div>
    </>
  );
}

function Harness({
  open,
  deferred = false,
}: {
  open: boolean;
  deferred?: boolean;
}) {
  return (
    <>
      <button type="button">trigger</button>
      <button type="button">elsewhere</button>
      {deferred ? <DeferredPanel open={open} /> : <Panel open={open} />}
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

  it("focuses a panel that mounts a tick after open", async () => {
    const { rerender } = render(<Harness open={false} deferred />);
    rerender(<Harness open deferred />);
    await act(async () => {});
    expect(document.activeElement).toBe(screen.getByTestId("deferred"));
  });

  it("restores focus when the panel still owns it and did not unmount", async () => {
    // ★★★ This is the ONLY test that reaches the `stillInside` branch, and it
    // needs a root that STAYS MOUNTED to do it. Removing a focused node — root
    // or child — resets `document.activeElement` to `body` in jsdom (and in
    // browsers), so for a panel that unmounts on close the `focusLost` branch
    // is unconditionally true and `stillInside` is never consulted. Both real
    // consumers (`notes-window`, `help-menu`) unmount, so an earlier version of
    // this test used one of them and passed with `stillInside` hard-coded to
    // `false` — it asserted the branch it never exercised.
    // Verified: forcing `stillInside = false` fails THIS test and no other.
    const { rerender } = render(<StickyHarness rendered={false} />);
    const trigger = screen.getByRole("button", { name: "trigger" });
    trigger.focus();
    rerender(<StickyHarness rendered />);
    await act(async () => {});
    expect(document.activeElement).toBe(screen.getByTestId("sticky"));

    // Move focus to a child, still inside the panel, then flip the flag off
    // WITHOUT unmounting. `activeElement` is a live node inside the root, so
    // only `stillInside` can authorise the restore.
    screen.getByRole("button", { name: "sticky chrome" }).focus();
    rerender(<StickyHarness rendered={false} />);
    await act(async () => {});
    expect(document.activeElement).toBe(trigger);
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
