import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { useFocusTrap } from "./use-focus-trap";
import {
  escapeOwner,
  isTopmostOfKind,
  popDismissal,
  pushDismissal,
  resetDismissalStack,
} from "./dismissal-stack";

function buildContainer(): { container: HTMLDivElement; buttons: HTMLButtonElement[] } {
  const container = document.createElement("div");
  const buttons = ["a", "b", "c"].map((label) => {
    const b = document.createElement("button");
    b.textContent = label;
    container.appendChild(b);
    return b;
  });
  document.body.appendChild(container);
  return { container, buttons };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useFocusTrap", () => {
  it("focuses the first focusable element when activated", () => {
    const { container, buttons } = buildContainer();
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement }).current = container;
    renderHook(() => useFocusTrap(ref, true));
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("wraps focus from last to first on Tab and first to last on Shift+Tab", () => {
    const { container, buttons } = buildContainer();
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement }).current = container;
    renderHook(() => useFocusTrap(ref, true));

    // Tab from the last element wraps to the first.
    buttons[2].focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);

    // Shift+Tab from the first element wraps to the last.
    buttons[0].focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("calls onEscape when Escape is pressed", () => {
    const { container } = buildContainer();
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement }).current = container;
    const onEscape = vi.fn();
    renderHook(() => useFocusTrap(ref, true, onEscape));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it("restores focus to the previously-focused element on deactivation", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const { container } = buildContainer();
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement }).current = container;
    const { rerender } = renderHook(({ active }) => useFocusTrap(ref, active), {
      initialProps: { active: true },
    });
    rerender({ active: false });
    expect(document.activeElement).toBe(outside);
  });

  // ★★ Escape goes to whichever layer the dismissal stack says owns it.
  // Consuming it with no `onEscape` to hand it to would swallow the key
  // entirely and leave a modal beneath unclosable. `inline-ai-edit-popover`
  // passes no `onEscape`, so that composition is one step away.
  it("consumes Escape only when there is a handler for it", () => {
    const { container } = buildContainer();
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement }).current = container;
    const onEscape = vi.fn();

    const withHandler = renderHook(() => useFocusTrap(ref, true, onEscape));
    const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(handled);
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(handled.defaultPrevented).toBe(true);
    withHandler.unmount();

    const withoutHandler = renderHook(() => useFocusTrap(ref, true));
    const unhandled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(unhandled);
    // Left for whoever else can act on it — a modal beneath, typically.
    expect(unhandled.defaultPrevented).toBe(false);
    // Unmount: this hook registers a document keydown listener, so leaving it
    // mounted leaks it into every later test in this file.
    withoutHandler.unmount();
  });

  it("does not claim Escape when it has no handler to give it to", () => {
    resetDismissalStack();
    const beneath = Symbol("modal beneath");
    pushDismissal(beneath, "modal");

    const container = document.createElement("div");
    const button = document.createElement("button");
    container.appendChild(button);
    document.body.appendChild(container);
    const ref = { current: container };

    // No onEscape — `inline-ai-edit-popover`'s shape.
    const trap = renderHook(() => useFocusTrap(ref, true));

    // ★ An always-claiming entry that does nothing would swallow the key and
    // leave the modal beneath permanently unclosable.
    expect(escapeOwner()).toBe(beneath);

    trap.unmount();
    popDismissal(beneath);
    document.body.removeChild(container);
  });

  // ★★★ BOTH halves are required and neither alone is worth anything. Against
  // the pre-C1 gate (`if (!active || !hasEscape) return;`) the trap never
  // joined the stack, so `escapeOwner()` returned the layer beneath for the
  // WRONG reason — absence rather than declining — and that assertion passes
  // either way. Only the `isTopmostOfKind` half sees the entry exist.
  it("joins the stack even with no handler, and declines Escape from there", () => {
    resetDismissalStack();
    const beneath = Symbol("modal beneath");
    pushDismissal(beneath, "modal");

    const { container } = buildContainer();
    const ref = { current: container as HTMLElement };
    // No onEscape — `inline-ai-edit-popover`'s shape.
    const trap = renderHook(() => useFocusTrap(ref, true));

    // ★ The trap's token is private and deliberately stays that way, so the
    // entry's EXISTENCE is read structurally: the layer beneath can only stop
    // being the topmost "modal" if something of that kind sits above it.
    expect(isTopmostOfKind(beneath, "modal")).toBe(false);
    // ...and it still hands Escape down, because its `claims` returns false.
    expect(escapeOwner()).toBe(beneath);

    trap.unmount();
    popDismissal(beneath);
  });

  // ★★ Focus OUTSIDE the container matches neither edge, so without the
  // containment term the trap declines to act and Tab walks away — the state a
  // portaled element, or a container node absent from `items`, puts it in.
  it("pulls a Tab arriving from outside the container back inside", () => {
    resetDismissalStack();
    const { container, buttons } = buildContainer();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const ref = { current: container as HTMLElement };
    const trap = renderHook(() => useFocusTrap(ref, true));

    outside.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);

    outside.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(buttons[2]);

    trap.unmount();
  });

  // ★★★ THE STATE THAT SEPARATES MEMBERSHIP FROM CONTAINMENT, and the only
  // test in this file that can see it. `Node.contains` is REFLEXIVE, so a
  // container focused for AT reads as INSIDE itself and a
  // `!container.contains(activeEl)` term stays FALSE — the trap then matches
  // neither edge, declines, and Tab walks out of the surface (§8). That is
  // exactly the state `tour-overlay` is in on open: it passes `cardRef` as
  // BOTH the container and `initialFocusRef`, so focus lands on the card.
  // The test above focuses a node OUTSIDE the container, which a containment
  // term catches just as well, so it is blind to the downgrade.
  it("wraps a Tab pressed while focus sits on the container itself", () => {
    resetDismissalStack();
    const { container, buttons } = buildContainer();
    // `tabIndex = -1` is what makes the container focusable without being a tab
    // stop — the tour card's own shape. It is a non-member twice over:
    // `focusables()` returns DESCENDANTS only, and `FOCUSABLE_SELECTOR`
    // excludes `[tabindex="-1"]` anyway.
    container.tabIndex = -1;
    const ref = { current: container as HTMLElement };
    const trap = renderHook(() => useFocusTrap(ref, true));

    container.focus();
    expect(document.activeElement).toBe(container);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);

    container.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(buttons[2]);

    trap.unmount();
  });

  // ★★ The Tab branch bails on `e.defaultPrevented`, mirroring
  // `popover-panel.tsx`: a consumer that handles Tab itself — closing and
  // re-focusing its trigger, as `sidebar-nav.tsx`'s `onMenuKeyDown` does — must
  // not be overridden from inside the trap. The stand-in consumer listener sits
  // on the CONTAINER, below the hook's own `document` listener in the bubble
  // path, so it runs first; a React `onKeyDown` gets the same ordering
  // (measured — see the hook's comment on this term).
  it("stands down on Tab once a consumer's own handler has called preventDefault", () => {
    resetDismissalStack();
    const { container, buttons } = buildContainer();
    const ref = { current: container as HTMLElement };
    const trap = renderHook(() => useFocusTrap(ref, true));

    container.addEventListener("keydown", (e) => e.preventDefault());

    // From the LAST element on purpose: that is an EDGE, so an ungated trap
    // would preventDefault and wrap to the first. Staying put is the whole
    // observable.
    buttons[2].focus();
    buttons[2].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(buttons[2]);

    trap.unmount();
  });

  // ★★★ THIS is the only shape that can see the `isTopmostOfKind` gate. An
  // assertion on FINAL focus cannot: both traps are `document` keydown
  // listeners firing in REGISTRATION order, so whichever surface opened last
  // silently corrects the other. A non-edge Tab inside the layered-above modal
  // is the one case that modal's own trap deliberately does nothing for, so
  // there is no second handler to paper over an ungated trap beneath — and an
  // ungated one's containment term fires (focus is outside ITS container) and
  // yanks every interior Tab of the modal above into the surface behind it.
  it("leaves a NON-EDGE Tab inside a modal layered above it completely alone", () => {
    resetDismissalStack();
    const { container } = buildContainer();
    const ref = { current: container as HTMLElement };
    const trap = renderHook(() => useFocusTrap(ref, true));

    // The layered-above modal: its own content lives OUTSIDE this trap's
    // container, and its entry is pushed AFTER the hook's, so it is topmost.
    const above = document.createElement("div");
    const aboveButtons = ["x", "y", "z"].map((label) => {
      const b = document.createElement("button");
      b.textContent = label;
      above.appendChild(b);
      return b;
    });
    document.body.appendChild(above);
    const aboveToken = Symbol("modal above");
    pushDismissal(aboveToken, "modal");

    const middle = aboveButtons[1];
    middle.focus();
    const e = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(middle);

    popDismissal(aboveToken);
    trap.unmount();
  });

  it("does nothing while inactive", () => {
    const { container, buttons } = buildContainer();
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement }).current = container;
    buttons[1].focus();
    renderHook(() => useFocusTrap(ref, false));
    // No forced focus move on the first element.
    expect(document.activeElement).toBe(buttons[1]);
  });
});
