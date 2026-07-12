// src/app/use-workspace-collapsed.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkspaceCollapsed } from "./use-workspace-collapsed";

const WORKSPACE_COLLAPSED_KEY = "aipm-cockpit:workspace-collapsed";

describe("useWorkspaceCollapsed", () => {
  it("workspaceCollapsed is false initially", () => {
    const { result } = renderHook(() => useWorkspaceCollapsed());
    expect(result.current.workspaceCollapsed).toBe(false);
  });

  it("loads true from localStorage when key is '1'", async () => {
    localStorage.setItem(WORKSPACE_COLLAPSED_KEY, "1");
    const { result } = renderHook(() => useWorkspaceCollapsed());
    await act(async () => {});
    expect(result.current.workspaceCollapsed).toBe(true);
  });

  it("setWorkspaceCollapsed(true) persists '1' to localStorage", async () => {
    const { result } = renderHook(() => useWorkspaceCollapsed());
    await act(async () => {});
    act(() => {
      result.current.setWorkspaceCollapsed(true);
    });
    expect(localStorage.getItem(WORKSPACE_COLLAPSED_KEY)).toBe("1");
  });

  it("setWorkspaceCollapsed(false) removes the key from localStorage", async () => {
    localStorage.setItem(WORKSPACE_COLLAPSED_KEY, "1");
    const { result } = renderHook(() => useWorkspaceCollapsed());
    await act(async () => {});
    act(() => {
      result.current.setWorkspaceCollapsed(false);
    });
    expect(localStorage.getItem(WORKSPACE_COLLAPSED_KEY)).toBeNull();
  });
});
