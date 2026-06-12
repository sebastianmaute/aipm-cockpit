// src/app/use-modal-visibility.test.tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { useModalVisibility } from "./use-modal-visibility";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

describe("useModalVisibility", () => {
  it("defaults to Advanced (isVisible true for advanced, false for full)", () => {
    const { result } = renderHook(() => useModalVisibility("milestone"), { wrapper });
    expect(result.current.mode).toBe("advanced");
    expect(result.current.isVisible("description")).toBe(true);
    expect(result.current.isVisible("documentLinks")).toBe(false);
  });
  it("setMode('simple') hides advanced fields and persists", () => {
    const { result } = renderHook(() => useModalVisibility("milestone"), { wrapper });
    act(() => result.current.setMode("simple"));
    expect(result.current.mode).toBe("simple");
    expect(result.current.isVisible("description")).toBe(false);
  });
  it("toggleField off makes mode custom; reset returns to Advanced", () => {
    const { result } = renderHook(() => useModalVisibility("milestone"), { wrapper });
    act(() => result.current.toggleField("description"));
    expect(result.current.mode).toBe("custom");
    expect(result.current.isVisible("description")).toBe(false);
    act(() => result.current.reset());
    expect(result.current.mode).toBe("advanced");
    expect(result.current.isVisible("description")).toBe(true);
  });
  it("required field stays visible when toggled", () => {
    const { result } = renderHook(() => useModalVisibility("milestone"), { wrapper });
    act(() => result.current.setMode("simple"));
    act(() => result.current.toggleField("name"));
    expect(result.current.isVisible("name")).toBe(true);
  });
});
