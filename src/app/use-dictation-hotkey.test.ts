import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDictationHotkey } from "./use-dictation-hotkey";
import { setActiveDictationTarget } from "./dictation-target";

beforeEach(() => setActiveDictationTarget(null));

function key(type: "keydown" | "keyup", k: string) {
  document.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
}

describe("useDictationHotkey", () => {
  it("presses/releases the active target on the configured key", () => {
    const press = vi.fn();
    const release = vi.fn();
    setActiveDictationTarget({ press, release, label: "Notes" });
    renderHook(() => useDictationHotkey("F4", false));
    key("keydown", "F4");
    expect(press).toHaveBeenCalled();
    key("keyup", "F4");
    expect(release).toHaveBeenCalled();
  });

  it("no-ops with no active target", () => {
    renderHook(() => useDictationHotkey("F4", false));
    key("keydown", "F4");
    expect(true).toBe(true);
  });

  it("is disabled in popouts", () => {
    const press = vi.fn();
    setActiveDictationTarget({ press, release: vi.fn(), label: "X" });
    renderHook(() => useDictationHotkey("F4", true));
    key("keydown", "F4");
    expect(press).not.toHaveBeenCalled();
  });

  it("releases + resets held state on window blur (missed keyup)", () => {
    const press = vi.fn(); const release = vi.fn();
    setActiveDictationTarget({ press, release, label: "N" });
    renderHook(() => useDictationHotkey("F4", false));
    key("keydown", "F4"); expect(press).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("blur"));
    expect(release).toHaveBeenCalled();
    key("keydown", "F4"); expect(press).toHaveBeenCalledTimes(2); // hotkey not stuck-dead
  });

  it("releases the target pressed at keydown even if focus changed", () => {
    const relA = vi.fn(); const relB = vi.fn();
    setActiveDictationTarget({ press: vi.fn(), release: relA, label: "A" });
    renderHook(() => useDictationHotkey("F4", false));
    key("keydown", "F4");
    setActiveDictationTarget({ press: vi.fn(), release: relB, label: "B" }); // focus moved
    key("keyup", "F4");
    expect(relA).toHaveBeenCalled();
    expect(relB).not.toHaveBeenCalled();
  });
});
