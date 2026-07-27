import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useRef, useState } from "react";
import { Modal } from "./modal";
import { usePopoverDismiss } from "./use-popover-dismiss";

// ★★★ INTEGRATION test for the Escape protocol, and the ONLY shape that proves
// it. Both `Modal` and the popovers attach NATIVE `document` keydown listeners,
// so two things decide the outcome and the unit tests can see neither:
//
//  1. ORDER. Listeners on the same node fire in REGISTRATION order, and the
//     modal opens first — so its handler runs BEFORE a popover opened inside
//     it. A popover that only calls preventDefault in the bubble phase marks
//     the event too late; the modal has already closed.
//  2. TOPOLOGY. A `KeyboardEvent` dispatched directly on `document` is an
//     AT-TARGET dispatch, where capture and bubble listeners both fire in plain
//     registration order. Real keystrokes target the focused ELEMENT, so a
//     capture listener on `document` runs first. Dispatching on `document` —
//     which every unit test here does — therefore cannot reproduce production.
//
// So: render a real popover inside a real modal and fire Escape from a focused
// element INSIDE the panel, the way a user does.
// ★ Hosted on `usePopoverDismiss` because that is the half that OWNS the
// listener, so it exercises exactly the capture-vs-bubble ordering under test
// with no positioning machinery in the way. `PopoverPanel` registers
// identically and carries a comment pointing here.
// ★★ NOT because the panel cannot render — an earlier version of this comment
// claimed jsdom's zero rects prevent it, which is false: `popover-panel.test.tsx`
// renders it and queries `getByRole("dialog")` throughout, because `pos` is
// still assigned from zero rects. That wrong reason is what justified settling
// for a registration-spy on the panel when a behavioural test was available;
// covering the panel behaviourally here is the open follow-up.
function Popover({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(true, wrapperRef, onClose);
  return (
    <div ref={wrapperRef}>
      <div role="dialog" aria-label="Field options">{children}</div>
    </div>
  );
}

function Harness({ onModalClose }: { onModalClose: () => void }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  return (
    <Modal open onClose={onModalClose} ariaLabel="Edit something">
      <button type="button" onClick={() => setPopoverOpen(true)}>open popover</button>
      {popoverOpen && (
        <Popover onClose={() => setPopoverOpen(false)}>
          <button type="button">a field toggle</button>
        </Popover>
      )}
    </Modal>
  );
}

describe("Escape on a popover inside a modal", () => {
  it("closes only the popover, leaving the modal and the user's draft alone", () => {
    const onModalClose = vi.fn();
    render(<Harness onModalClose={onModalClose} />);
    fireEvent.click(screen.getByText("open popover"));
    expect(screen.getByRole("dialog", { name: "Field options" })).toBeInTheDocument();

    // Fire from inside the panel, as a real keystroke would.
    const inside = screen.getByText("a field toggle");
    inside.focus();
    fireEvent.keyDown(inside, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Field options" })).toBeNull();
    expect(onModalClose).not.toHaveBeenCalled();
  });

  it("closes the modal once no popover is open", () => {
    const onModalClose = vi.fn();
    render(<Harness onModalClose={onModalClose} />);
    const inside = screen.getByText("open popover");
    inside.focus();
    fireEvent.keyDown(inside, { key: "Escape" });
    expect(onModalClose).toHaveBeenCalledTimes(1);
  });
});
