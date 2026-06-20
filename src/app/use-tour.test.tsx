import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTour } from "./use-tour";
import { visibleSteps } from "./app-tour";

const FEATURES = ["dashboard", "milestones", "resources", "raid", "changes", "stakeholders", "budget"] as const;

describe("useTour", () => {
  it("auto-launches once in modern, non-popout, unseen", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: false, features: [...FEATURES], setSettings }));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.index).toBe(0);
  });
  it("does NOT auto-launch in classic / popout / when seen / before hydration", () => {
    const setSettings = vi.fn();
    for (const args of [
      { layout: "classic" as const, isPopout: false, hydrated: true, tourSeen: false },
      { layout: "modern" as const, isPopout: true, hydrated: true, tourSeen: false },
      { layout: "modern" as const, isPopout: false, hydrated: true, tourSeen: true },
      { layout: "modern" as const, isPopout: false, hydrated: false, tourSeen: false },
    ]) {
      const { result } = renderHook(() => useTour({ ...args, features: [...FEATURES], setSettings }));
      expect(result.current.isOpen).toBe(false);
    }
  });
  it("done marks tourSeen via setSettings and closes", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: false, features: [...FEATURES], setSettings }));
    act(() => { result.current.done(); });
    expect(result.current.isOpen).toBe(false);
    const updater = setSettings.mock.calls.at(-1)![0];
    expect(updater({ tourSeen: false }).tourSeen).toBe(true);
  });
  it("next/back clamp within the visible steps", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, features: [...FEATURES], setSettings }));
    act(() => { result.current.start(); });
    act(() => { result.current.back(); });
    expect(result.current.index).toBe(0);
    const last = visibleSteps([...FEATURES]).length - 1;
    for (let k = 0; k < 50; k++) act(() => { result.current.next(); });
    expect(result.current.index).toBe(last);
  });
});
