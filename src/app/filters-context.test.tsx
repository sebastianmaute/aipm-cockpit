import { describe, test, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import { FiltersProvider, useFilters } from "./filters-context";

function wrapper({ children }: { children: ReactNode }) {
  return <FiltersProvider>{children}</FiltersProvider>;
}

describe("FiltersProvider", () => {
  test("exposes the documented defaults", () => {
    const { result } = renderHook(() => useFilters(), { wrapper });
    expect(result.current.search).toBe("");
    expect(result.current.searchDebounced).toBe("");
    expect(result.current.priorityFilter).toBe("All");
    expect(result.current.assigneeFilter).toBe("All");
    expect(result.current.groupFilter).toBe("All");
    expect(result.current.labelFilter).toBe("All");
    expect(result.current.sortKey).toBe("id");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.raidFilterTaskId).toBeNull();
  });

  test("each setter updates the corresponding slice", () => {
    const { result } = renderHook(() => useFilters(), { wrapper });

    act(() => result.current.setSearch("hello"));
    expect(result.current.search).toBe("hello");

    act(() => result.current.setPriorityFilter("High"));
    expect(result.current.priorityFilter).toBe("High");

    act(() => result.current.setAssigneeFilter("Alex Example"));
    expect(result.current.assigneeFilter).toBe("Alex Example");

    act(() => result.current.setGroupFilter("Auth Migration"));
    expect(result.current.groupFilter).toBe("Auth Migration");

    act(() => result.current.setLabelFilter("backend"));
    expect(result.current.labelFilter).toBe("backend");

    act(() => result.current.setSortKey("dueDate"));
    expect(result.current.sortKey).toBe("dueDate");

    act(() => result.current.setSortDir("desc"));
    expect(result.current.sortDir).toBe("desc");

    act(() => result.current.setRaidFilterTaskId(42));
    expect(result.current.raidFilterTaskId).toBe(42);

    act(() => result.current.setRaidFilterTaskId(null));
    expect(result.current.raidFilterTaskId).toBeNull();
  });
});
