import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import { FiltersProvider, useFilters } from "./filters-context";

function wrapper({ children }: { children: ReactNode }) {
  return <FiltersProvider>{children}</FiltersProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

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

  test("resetFilters returns every slice to its default", () => {
    const { result } = renderHook(() => useFilters(), { wrapper });

    act(() => {
      result.current.setSearch("hello");
      result.current.setPriorityFilter("High");
      result.current.setAssigneeFilter("Alex Example");
      result.current.setGroupFilter("Auth Migration");
      result.current.setLabelFilter("backend");
      result.current.setSortKey("dueDate");
      result.current.setSortDir("desc");
      result.current.setRaidFilterTaskId(42);
    });

    act(() => result.current.resetFilters());

    expect(result.current.search).toBe("");
    expect(result.current.priorityFilter).toBe("All");
    expect(result.current.assigneeFilter).toBe("All");
    expect(result.current.groupFilter).toBe("All");
    expect(result.current.labelFilter).toBe("All");
    expect(result.current.sortKey).toBe("id");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.raidFilterTaskId).toBeNull();
  });

  test("searchDebounced lags search by 150 ms", () => {
    const { result } = renderHook(() => useFilters(), { wrapper });
    expect(result.current.searchDebounced).toBe("");

    act(() => result.current.setSearch("hello"));
    // Same tick — searchDebounced has not yet caught up.
    expect(result.current.search).toBe("hello");
    expect(result.current.searchDebounced).toBe("");

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(result.current.searchDebounced).toBe("");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.searchDebounced).toBe("hello");
  });

  test("useFilters() outside a FiltersProvider throws a documented error", () => {
    // React logs the rendering error to console.error in dev; silence it
    // so the test output stays clean. Restore after to avoid hiding
    // unrelated noise from later tests.
    const original = console.error;
    console.error = () => {};
    try {
      expect(() => renderHook(() => useFilters())).toThrow(
        "useFilters must be used within FiltersProvider",
      );
    } finally {
      console.error = original;
    }
  });
});
