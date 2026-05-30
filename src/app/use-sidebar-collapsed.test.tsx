import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSidebarCollapsed, SIDEBAR_NARROW_QUERY } from "./use-sidebar-collapsed";

let narrow = false;

beforeEach(() => {
  narrow = false;
  window.localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return query === SIDEBAR_NARROW_QUERY ? narrow : false;
    },
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});

describe("useSidebarCollapsed", () => {
  it("defaults to expanded on a wide viewport", () => {
    narrow = false;
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current.collapsed).toBe(false);
  });

  it("defaults to collapsed on a narrow viewport", () => {
    narrow = true;
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current.collapsed).toBe(true);
  });

  it("toggle flips and persists an explicit preference that wins over the viewport", () => {
    narrow = false;
    const { result } = renderHook(() => useSidebarCollapsed());
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(window.localStorage.getItem("lop-app:sidebar-collapsed")).toBe("1");
  });

  it("hydrates a persisted preference on mount", () => {
    window.localStorage.setItem("lop-app:sidebar-collapsed", "0");
    narrow = true; // viewport says collapse, but the stored pref says expanded
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current.collapsed).toBe(false);
  });
});
