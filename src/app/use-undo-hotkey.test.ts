import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUndoHotkey } from "./use-undo-hotkey";

function press(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const ev = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...opts });
  document.dispatchEvent(ev);
  return ev;
}

describe("useUndoHotkey", () => {
  it("calls undo on Ctrl+Z and prevents default", () => {
    const undo = vi.fn();
    renderHook(() => useUndoHotkey(undo));
    const ev = press("z");
    expect(undo).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("calls redo (not undo) on Ctrl+Shift+Z and prevents default", () => {
    const undo = vi.fn();
    const redo = vi.fn();
    renderHook(() => useUndoHotkey(undo, redo));
    const ev = press("z", { shiftKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
  });

  it("calls redo on Ctrl+Y", () => {
    const undo = vi.fn();
    const redo = vi.fn();
    renderHook(() => useUndoHotkey(undo, redo));
    press("y");
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+Z is inert (undo not called) when no redo callback is given", () => {
    const undo = vi.fn();
    renderHook(() => useUndoHotkey(undo));
    press("z", { shiftKey: true });
    expect(undo).not.toHaveBeenCalled();
  });

  it("does NOT fire redo while focus is in a text field", () => {
    const undo = vi.fn();
    const redo = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderHook(() => useUndoHotkey(undo, redo));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(redo).not.toHaveBeenCalled();
    input.remove();
  });

  it("does NOT fire while focus is in a text field (native undo wins)", () => {
    const undo = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderHook(() => useUndoHotkey(undo));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(undo).not.toHaveBeenCalled();
    input.remove();
  });
  // AI-04 — the report editor's dialog switches the app undo off: a Ctrl+Z on one of its buttons must
  // not undo a stored report under the open draft.
  it("does NOT fire undo on a button inside [data-app-undo=\"off\"], and still does outside it", () => {
    const undo = vi.fn();
    const zone = document.createElement("div");
    zone.setAttribute("data-app-undo", "off");
    const inside = document.createElement("button");
    zone.appendChild(inside);
    const outside = document.createElement("button");
    document.body.append(zone, outside);
    renderHook(() => useUndoHotkey(undo));
    const evIn = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    inside.dispatchEvent(evIn);
    expect(undo).not.toHaveBeenCalled();
    expect(evIn.defaultPrevented).toBe(false);
    outside.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(undo).toHaveBeenCalledTimes(1);
    zone.remove();
    outside.remove();
  });

  it("does NOT fire redo (Ctrl+Shift+Z or Ctrl+Y) inside [data-app-undo=\"off\"], and still does outside it", () => {
    const undo = vi.fn();
    const redo = vi.fn();
    const zone = document.createElement("div");
    zone.setAttribute("data-app-undo", "off");
    const inside = document.createElement("button");
    zone.appendChild(inside);
    const outside = document.createElement("button");
    document.body.append(zone, outside);
    renderHook(() => useUndoHotkey(undo, redo));
    const shiftZ = { key: "z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true };
    const ctrlY = { key: "y", ctrlKey: true, bubbles: true, cancelable: true };
    inside.dispatchEvent(new KeyboardEvent("keydown", shiftZ));
    inside.dispatchEvent(new KeyboardEvent("keydown", ctrlY));
    expect(redo).not.toHaveBeenCalled();
    outside.dispatchEvent(new KeyboardEvent("keydown", shiftZ));
    outside.dispatchEvent(new KeyboardEvent("keydown", ctrlY));
    expect(redo).toHaveBeenCalledTimes(2);
    expect(undo).not.toHaveBeenCalled();
    zone.remove();
    outside.remove();
  });
});
