import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { useCurrentWorkspace } from "./use-current-workspace";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

describe("useCurrentWorkspace", () => {
  it("returns a builder that assembles a full Workspace snapshot", () => {
    const { result } = renderHook(() => useCurrentWorkspace(), { wrapper });
    const ws = result.current();
    expect(ws).toHaveProperty("tasks");
    expect(ws).toHaveProperty("fieldVisibility");
    expect(Array.isArray(ws.tasks)).toBe(true);
  });
});
