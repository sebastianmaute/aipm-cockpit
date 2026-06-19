import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEscapeKey } from "./use-escape-key";

describe("useEscapeKey", () => {
  it("calls onEscape when Escape is pressed", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("removes the listener on unmount", () => {
    const onEscape = vi.fn();
    const { unmount } = renderHook(() => useEscapeKey(onEscape));
    unmount();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onEscape).not.toHaveBeenCalled();
  });
});
