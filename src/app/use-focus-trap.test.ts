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
