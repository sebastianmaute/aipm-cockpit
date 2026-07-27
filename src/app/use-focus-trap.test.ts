import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { useFocusTrap } from "./use-focus-trap";
import {
  escapeOwner,
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
