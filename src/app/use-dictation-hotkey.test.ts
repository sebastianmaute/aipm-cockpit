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
});
