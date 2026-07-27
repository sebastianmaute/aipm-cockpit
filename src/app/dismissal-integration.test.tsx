import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDismissalStack } from "./dismissal-stack";
import { Modal } from "./modal";
import { useClaimsWhenFocusWithin, useDismissable } from "./use-dismissable";

/** ★★ Dispatch from a FOCUSED ELEMENT, never `document.dispatchEvent`. The
 *  latter is an AT-TARGET dispatch where capture and bubble listeners both fire
 *  in plain registration order, so it cannot tell a phase fix from a no-op and
 *  a test built on it lies.
 *  ★ `act` flushes whatever the dismissal commits (unmounting a layer pops it
 *  from the stack in an effect cleanup), so the NEXT Escape sees the settled
 *  stack rather than a stale one. */
function pressEscape(from: HTMLElement): KeyboardEvent {
  from.focus();
  const e = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    from.dispatchEvent(e);
  });
  return e;
}

/** Stand-in for a document-level popover (PopoverPanel / usePopoverDismiss).
 *  jsdom reports every rect as zero so the real portal never positions itself,
 *  which is why these are hosted on the hook rather than the component. */
function Popover({ onClose, label }: { onClose: () => void; label: string }) {
  useDismissable({ open: true, kind: "layer", onDismiss: onClose });
  return <button type="button">{label}</button>;
}

/** Stand-in for a combobox picker: an ELEMENT-scoped React handler that marks
 *  the event, exactly as entity-link-picker and the four siblings do. It is
 *  deliberately NOT in the stack. */
function Combobox({ onDismiss }: { onDismiss: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <input
      aria-label="picker"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          setOpen(false);
          onDismiss();
        }
      }}
    />
  );
}

/** A modal whose popover opens on a click, one commit AFTER the modal mounted.
 *
 *  ★★ The trigger is load-bearing, not scenery. `dismissal-stack.ts` asserts as
 *  a PRECONDITION that open order equals nesting order, which holds because a
 *  popover opens in response to a user action and never in its parent's commit.
 *  Mount both together and React runs the CHILD's effect first, so the parent
 *  modal lands on top of its own popover and wins the Escape — the inversion
 *  that comment describes. Do not "simplify" this harness to render the popover
 *  open from the start: it would pin the inverted behaviour as if it were
 *  correct. */
function ModalWithPopover({
  closeModal,
  onPopoverClose,
}: {
  closeModal: () => void;
  onPopoverClose: () => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  return (
    <Modal open onClose={closeModal} ariaLabel="Editor">
      <button type="button" onClick={() => setPopoverOpen(true)}>
        field
      </button>
      {popoverOpen && (
        <Popover
          label="popover item"
          onClose={() => {
            setPopoverOpen(false);
            onPopoverClose();
          }}
        />
      )}
    </Modal>
  );
}

describe("Escape dismissal across surfaces", () => {
  beforeEach(() => resetDismissalStack());

  it("closes a popover inside a modal without closing the modal", () => {
    const closeModal = vi.fn();
    const closePopover = vi.fn();
    render(
      <ModalWithPopover closeModal={closeModal} onPopoverClose={closePopover} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "field" }));
    pressEscape(screen.getByRole("button", { name: "popover item" }));
    expect(closePopover).toHaveBeenCalledTimes(1);
    expect(closeModal).not.toHaveBeenCalled();
  });

  it("closes the modal on the second Escape, once the popover is gone", () => {
    const closeModal = vi.fn();
    render(<ModalWithPopover closeModal={closeModal} onPopoverClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "field" }));
    pressEscape(screen.getByRole("button", { name: "popover item" }));
    expect(closeModal).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "popover item" }),
    ).not.toBeInTheDocument();
    pressEscape(screen.getByRole("button", { name: "field" }));
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  it("closes only the dropdown when a combobox sits inside a popover", () => {
    // ★★ The hazard capture phase introduced: React delegates onKeyDown at
    // BUBBLE, so a capture-phase popover listener ran BEFORE the combobox's own
    // handler and took both layers down with one keypress.
    const closePopover = vi.fn();
    const closeDropdown = vi.fn();
    function Harness() {
      useDismissable({ open: true, kind: "layer", onDismiss: closePopover });
      return <Combobox onDismiss={closeDropdown} />;
    }
    render(<Harness />);
    pressEscape(screen.getByRole("textbox", { name: "picker" }));
    expect(closeDropdown).toHaveBeenCalledTimes(1);
    expect(closePopover).not.toHaveBeenCalled();
  });

  it("closes the modal when a floating panel above it declines", () => {
    // The claims walk. The panel is topmost but focus is in the modal, so it
    // declines — and the layer beneath must act. Without the walk, nobody would.
    const closeModal = vi.fn();
    const closePanel = vi.fn();
    function FloatingPanel({ onClose }: { onClose: () => void }) {
      const panelRef = useRef<HTMLDivElement | null>(null);
      const claimsFocusWithin = useClaimsWhenFocusWithin(panelRef);
      useDismissable({
        open: true,
        kind: "layer",
        onDismiss: onClose,
        claims: claimsFocusWithin,
      });
      return (
        <div ref={panelRef}>
          <button type="button">note</button>
        </div>
      );
    }
    render(
      <>
        <Modal open onClose={closeModal} ariaLabel="Editor">
          <button type="button">field</button>
        </Modal>
        <FloatingPanel onClose={closePanel} />
      </>,
    );
    pressEscape(screen.getByRole("button", { name: "field" }));
    expect(closeModal).toHaveBeenCalledTimes(1);
    expect(closePanel).not.toHaveBeenCalled();
  });

  it("closes the inner modal only, when modals nest", () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    render(
      <>
        <Modal open onClose={closeOuter} ariaLabel="Create project">
          <button type="button">outer field</button>
        </Modal>
        <Modal open onClose={closeInner} ariaLabel="Setup wizard">
          <button type="button">inner field</button>
        </Modal>
      </>,
    );
    pressEscape(screen.getByRole("button", { name: "inner field" }));
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });
});
