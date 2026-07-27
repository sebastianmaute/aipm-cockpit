import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDismissalStack } from "./dismissal-stack";
import { useClaimsWhenFocusWithin, useDismissable } from "./use-dismissable";

/** Dispatch Escape from a FOCUSED ELEMENT, never `document`.
 *  ★★ `document.dispatchEvent` is an AT-TARGET dispatch, where capture and
 *  bubble listeners both fire in plain registration order — so it cannot tell
 *  a phase fix from a no-op, and a test built on it lies. */
function pressEscape(from: HTMLElement): KeyboardEvent {
  from.focus();
  const e = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  from.dispatchEvent(e);
  return e;
}

function Panel({
  open,
  onDismiss,
  gated = false,
  label,
}: {
  open: boolean;
  onDismiss: () => void;
  gated?: boolean;
  label: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Called unconditionally (hooks rule); the RESULT is what is conditional.
  const claimsFocusWithin = useClaimsWhenFocusWithin(panelRef);
  useDismissable({
    open,
    kind: "layer",
    onDismiss,
    claims: gated ? claimsFocusWithin : undefined,
  });
  return (
    <div ref={panelRef}>
      <button type="button">{label}</button>
    </div>
  );
}

describe("useDismissable", () => {
  beforeEach(() => resetDismissalStack());

  it("dismisses on Escape and marks the event handled", () => {
    const onDismiss = vi.fn();
    render(<Panel open onDismiss={onDismiss} label="inside" />);
    const e = pressEscape(screen.getByRole("button", { name: "inside" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // ★★ Assert defaultPrevented — a property of the EVENT. Asserting "some
    // other listener did not fire" is a property of RTL's div-under-body
    // topology, which the real app (root === document) never has.
    expect(e.defaultPrevented).toBe(true);
  });

  it("does nothing while closed", () => {
    const onDismiss = vi.fn();
    render(<Panel open={false} onDismiss={onDismiss} label="inside" />);
    const e = pressEscape(document.body as HTMLElement);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("gives Escape to the layer opened last", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Panel open onDismiss={outer} label="outer" />
        <Panel open onDismiss={inner} label="inner" />
      </>,
    );
    pressEscape(screen.getByRole("button", { name: "inner" }));
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("passes Escape down when a gated panel does not have focus", () => {
    const ungated = vi.fn();
    const gated = vi.fn();
    render(
      <>
        <Panel open onDismiss={ungated} label="ungated" />
        <Panel open gated onDismiss={gated} label="gated" />
      </>,
    );
    // Focus sits in the FIRST panel, so the gated panel above it declines and
    // the layer beneath must act. Without the top-down walk, nobody would.
    pressEscape(screen.getByRole("button", { name: "ungated" }));
    expect(gated).not.toHaveBeenCalled();
    expect(ungated).toHaveBeenCalledTimes(1);
  });

  it("lets a gated panel claim Escape when focus is inside it", () => {
    const ungated = vi.fn();
    const gated = vi.fn();
    render(
      <>
        <Panel open onDismiss={ungated} label="ungated" />
        <Panel open gated onDismiss={gated} label="gated" />
      </>,
    );
    pressEscape(screen.getByRole("button", { name: "gated" }));
    expect(gated).toHaveBeenCalledTimes(1);
    expect(ungated).not.toHaveBeenCalled();
  });

  it("keeps a lower layer in place when its onDismiss identity changes", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    function Harness({ nonce }: { nonce: number }) {
      return (
        <>
          {/* A fresh arrow identity every render — the shape that re-ran the
              effect and re-pushed the token to the top in modal.tsx.
              ★★ The unstable handler must sit on the LOWER layer. With it on
              the topmost panel this test passes under its own mutation: only
              that panel's effect re-runs, so it pops and re-pushes ITSELF back
              to the top and the order never changes. "Both unstable" fails to
              detect it too — cleanups and effects run in tree order, so the
              stack re-forms as [outer, inner] and inner is topmost again. Only
              a lower layer re-pushing ABOVE a stable layer above it exposes the
              bug. */}
          <Panel open onDismiss={() => outer(nonce)} label="outer" />
          <Panel open onDismiss={inner} label="inner" />
        </>
      );
    }
    const { rerender } = render(<Harness nonce={1} />);
    rerender(<Harness nonce={2} />);
    rerender(<Harness nonce={3} />);
    pressEscape(screen.getByRole("button", { name: "inner" }));
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("reads the latest onDismiss rather than the one captured at push time", () => {
    const spy = vi.fn();
    function Harness({ nonce }: { nonce: number }) {
      return <Panel open onDismiss={() => spy(nonce)} label="only" />;
    }
    const { rerender } = render(<Harness nonce={1} />);
    rerender(<Harness nonce={2} />);
    rerender(<Harness nonce={3} />);
    pressEscape(screen.getByRole("button", { name: "only" }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(3);
  });

  it("releases its claim on unmount", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    function Harness({ showInner }: { showInner: boolean }) {
      return (
        <>
          <Panel open onDismiss={outer} label="outer" />
          {showInner && <Panel open onDismiss={inner} label="inner" />}
        </>
      );
    }
    const { rerender } = render(<Harness showInner />);
    rerender(<Harness showInner={false} />);
    pressEscape(screen.getByRole("button", { name: "outer" }));
    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).not.toHaveBeenCalled();
  });
});
