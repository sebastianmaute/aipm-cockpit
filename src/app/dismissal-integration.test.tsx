import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOUR_STEPS } from "./app-tour";
import { resetDismissalStack } from "./dismissal-stack";
import { t } from "./i18n";
import { Modal } from "./modal";
import { PopoverPanel } from "./popover-panel";
import { TourOverlay } from "./tour-overlay";
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

/** Stand-in for a document-level popover, hosted on the hook. It exists to keep
 *  the ESCAPE-ordering tests below focused on stack order rather than on a
 *  component's lifecycle — NOT because the real component cannot render here.
 *  ★★ It can: with jsdom's zero rects the measure effect still computes
 *  `right = max(VIEWPORT_MARGIN, innerWidth - 0)` and a `spaceBelow` of
 *  `innerHeight - 0` that clears MIN_SPACE_BELOW (220), so `setPos` fires and
 *  the panel portals. An earlier version of this comment claimed the opposite
 *  and would have pushed the §100 Tab tests onto this stand-in, where a Tab
 *  cycle cannot be exercised at all. */
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

  it("hands Tab to the tour overlay's own trap when it is layered above a modal", () => {
    // ★★ REGRESSION GUARD, REWRITTEN. The DEFECT it guards is unchanged and is
    // still worth guarding: with a `Modal` and the tour co-open, a Tab must end
    // up contained by SOMEBODY. What changed is which surface contains it.
    //
    // The old assertion — focus lands on the MODAL's first button — was
    // correct for its own code and is now wrong. `TourOverlay` used to
    // implement NO Tab trap, so it registered as `layer`; tagged `modal` in
    // that state it won `isTopmostOfKind(token,"modal")` away from the Modal,
    // that Modal stood down and nothing took over, and focus walked out of
    // both into the page behind (WCAG 2.4.3). Hence the rule the old comment
    // stated: containment is never waivable by a layer that contains nothing.
    //
    // The tour now runs a real trap via `useFocusTrap` and registers `modal`,
    // so the premise is retired, not the rule. It pushes SECOND and is
    // topmost, the Modal defers to it — which is `isTopmostOfKind`'s own
    // documented behaviour for a `modal` above a `modal`, and is correct
    // because the one above contains focus itself — and the tour's own
    // membership branch pulls the keypress in: focus is on a node that is not
    // one of the tour card's focusables, so it yanks to the card's first
    // control. `defaultPrevented` still true, focus still inside a trap, and
    // it left neither surface for the page behind. Deleting either the tour's
    // trap or the Modal's stand-down puts focus back in the page.
    //
    // ★ Production cannot reach this screen — the tour and the empty-state
    // modal are mutually exclusive `if/else` branches in `task-manager.tsx`.
    // This is a statement about the STACK, not about a reachable view.
    render(
      <>
        <Modal open onClose={vi.fn()} ariaLabel="Editor">
          <button type="button">modal first</button>
          <button type="button">modal last</button>
        </Modal>
        <TourOverlay
          lang="en-US"
          steps={TOUR_STEPS}
          index={0}
          onBack={vi.fn()}
          onNext={vi.fn()}
          onSkip={vi.fn()}
          onDone={vi.fn()}
          onShowMe={vi.fn()}
        />
      </>,
    );

    const lastBtn = screen.getByRole("button", { name: "modal last" });
    lastBtn.focus();
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      lastBtn.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(true);
    // Step 0 ("welcome") carries no `view` and sits at index 0, so the card
    // renders exactly two controls — Skip then Next — and Skip is its `first`.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: t("en-US", "tourSkip") }),
    );
  });
});

/** Unlike the `Popover` stand-in above, this mounts the REAL PopoverPanel — the
 *  Tab cycle is the thing under test and a hook stand-in cannot exercise it.
 *  jsdom mounts it fine: with zero rects `right` and `spaceBelow` still compute,
 *  so `setPos` fires and the panel portals. The `withRects` helper in
 *  popover-panel.test.tsx is for GEOMETRY assertions, not for mounting. */
function ModalWithRealPopover({ closeModal }: { closeModal: () => void }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal open onClose={closeModal} ariaLabel="Editor">
      <button type="button">modal first</button>
      <button ref={btnRef} type="button" onClick={() => setPopoverOpen(true)}>
        field
      </button>
      <PopoverPanel
        open={popoverOpen}
        anchorRef={btnRef}
        onClose={() => setPopoverOpen(false)}
        role="dialog"
        ariaLabel="Fields"
        className="w-64 p-2"
      >
        <button type="button">panel first</button>
        <button type="button">panel last</button>
      </PopoverPanel>
      <button type="button">modal last</button>
    </Modal>
  );
}

function pressTab(from: HTMLElement, shiftKey = false): KeyboardEvent {
  from.focus();
  const e = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    from.dispatchEvent(e);
  });
  return e;
}

/** The INVERSE nesting: a real `Modal` opened from inside a real
 *  `PopoverPanel`.
 *  ★ Both surfaces open from a trigger CLICK rather than rendering already
 *  open: `dismissal-stack.ts` assumes open order equals nesting order, and
 *  mounting a child and its parent in one commit runs the CHILD's effect
 *  first, inverting the stack. */
function PopoverWithModal() {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={btnRef} type="button" onClick={() => setPopoverOpen(true)}>
        menu
      </button>
      <PopoverPanel
        open={popoverOpen}
        anchorRef={btnRef}
        onClose={() => setPopoverOpen(false)}
        role="dialog"
        ariaLabel="Menu"
        className="w-64 p-2"
      >
        <button type="button" onClick={() => setModalOpen(true)}>
          about
        </button>
      </PopoverPanel>
      {modalOpen && (
        <Modal open onClose={() => setModalOpen(false)} ariaLabel="About">
          <button type="button">inner first</button>
          <button type="button">inner middle</button>
          <button type="button">inner last</button>
        </Modal>
      )}
    </div>
  );
}

function openPopoverThenModal(): void {
  render(<PopoverWithModal />);
  fireEvent.click(screen.getByRole("button", { name: "menu" }));
  fireEvent.click(screen.getByRole("button", { name: "about" }));
}

describe("Tab containment across a portaled popover", () => {
  beforeEach(() => resetDismissalStack());

  it("cycles Tab inside the popover instead of ejecting to the modal", () => {
    render(<ModalWithRealPopover closeModal={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "field" }));
    pressTab(screen.getByRole("button", { name: "panel last" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "panel first" }),
    );
    expect(screen.getByRole("dialog", { name: "Fields" })).toBeInTheDocument();
  });

  it("wraps Shift+Tab from the first control to the last", () => {
    render(<ModalWithRealPopover closeModal={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "field" }));
    pressTab(screen.getByRole("button", { name: "panel first" }), true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "panel last" }),
    );
  });

  it("pulls a Tab arriving from outside into the popover", () => {
    render(<ModalWithRealPopover closeModal={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "field" }));
    pressTab(screen.getByRole("button", { name: "modal last" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "panel first" }),
    );
  });

  it("stands down when a modal is opened from inside the popover", () => {
    openPopoverThenModal();
    pressTab(screen.getByRole("button", { name: "inner last" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "inner first" }),
    );
  });

  it("leaves a NON-EDGE Tab inside the layered-above modal completely alone", () => {
    // ★★★ THIS is the test that pins the `isTopmostOfKind` gate, and the
    // sibling above is NOT — measured by mutation, not reasoned. Deleting the
    // gate leaves that one GREEN, because both handlers sit on `document` and
    // fire in REGISTRATION order: the modal opened second, so it registered
    // second and runs LAST, silently correcting whatever an ungated popover
    // did. Every assertion on FINAL focus is therefore blind to the gate.
    //
    // A non-edge Tab is the one case the modal's own trap deliberately does
    // NOTHING for — focus is inside its container and not at either end, so it
    // returns without preventing, letting the browser advance naturally. There
    // is no second handler to paper over the popover, so an ungated popover's
    // `!panel.contains(active)` branch fires and hijacks the keypress: every
    // interior Tab of a modal layered above a popover would yank focus into the
    // popover behind it.
    openPopoverThenModal();
    const middle = screen.getByRole("button", { name: "inner middle" });
    const e = pressTab(middle);
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(middle);
  });
});
