import { describe, test, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

describe("WorkspaceProvider", () => {
  test("exposes empty defaults", () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    expect(result.current.tasks).toEqual([]);
    expect(result.current.uniqueAssignees).toEqual([]);
    expect(result.current.uniqueGroups).toEqual([]);
    expect(result.current.uniqueLabels).toEqual([]);
    expect(result.current.tasksById.size).toBe(0);
    expect(result.current.taskSearchIndex.size).toBe(0);
    expect(result.current.filteredSortedTasks).toEqual([]);
  });
});
