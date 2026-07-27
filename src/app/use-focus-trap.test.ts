import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { useFocusTrap } from "./use-focus-trap";

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

  // ★★ This listener is CAPTURE-phase, so it runs before the shared Modal's —
  // and Modal now declines an Escape a descendant already consumed
  // (`defaultPrevented`). Consuming Escape with no `onEscape` to hand it to
  // would therefore swallow the key entirely and leave a modal beneath
  // unclosable. `inline-ai-edit-popover` passes no `onEscape`, so that
  // composition is one step away.
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
    // Unmount: this hook registers a document-CAPTURE listener, so leaving it
    // mounted leaks it into every later test in this file.
    withoutHandler.unmount();
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
