import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, render, fireEvent, act } from "@testing-library/react";
import { memo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { type Priority } from "./types";
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

  // The person-filter CTA (executeActionCta "open-tasks-for") clears the stale
  // row-HIDING filters before applying its own, but a sort cannot hide a row —
  // wiping it would silently discard an ordering the user deliberately chose.
  test("resetFilterValues clears the filters but PRESERVES a non-default sort", () => {
    const { result } = renderHook(() => useFilters(), { wrapper });

    act(() => {
      result.current.setSearch("hello");
      result.current.setPriorityFilter("High");
      result.current.setAssigneeFilter("Alex Example");
      result.current.setGroupFilter("Auth Migration");
      result.current.setLabelFilter("backend");
      result.current.setHealthFilter("red");
      result.current.setRaidFilterTaskId(42);
      result.current.setSortKey("dueDate");
      result.current.setSortDir("desc");
    });

    act(() => result.current.resetFilterValues());

    expect(result.current.search).toBe("");
    expect(result.current.priorityFilter).toBe("All");
    expect(result.current.assigneeFilter).toBe("All");
    expect(result.current.groupFilter).toBe("All");
    expect(result.current.labelFilter).toBe("All");
    expect(result.current.healthFilter).toBe("all");
    expect(result.current.raidFilterTaskId).toBeNull();
    // The point of the split.
    expect(result.current.sortKey).toBe("dueDate");
    expect(result.current.sortDir).toBe("desc");
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

  test("context value is referentially stable across unrelated parent re-renders", () => {
    let consumerRenders = 0;
    const Consumer = memo(function Consumer() {
      useFilters();
      consumerRenders += 1;
      return null;
    });

    function Harness() {
      const [, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((t) => t + 1)}>tick</button>
          <FiltersProvider>
            <Consumer />
          </FiltersProvider>
        </>
      );
    }

    const { getByText } = render(<Harness />);
    const after = consumerRenders;
    expect(after).toBeGreaterThan(0);

    fireEvent.click(getByText("tick"));
    fireEvent.click(getByText("tick"));
    expect(consumerRenders).toBe(after);
  });

  test("a filter state change still re-renders consumers (counter sanity)", () => {
    let consumerRenders = 0;
    const Consumer = memo(function Consumer() {
      useFilters();
      consumerRenders += 1;
      return null;
    });

    let setPriorityRef: Dispatch<SetStateAction<Priority | "All">> | undefined;
    function CaptureSetter() {
      setPriorityRef = useFilters().setPriorityFilter;
      return null;
    }

    render(
      <FiltersProvider>
        <Consumer />
        <CaptureSetter />
      </FiltersProvider>,
    );
    const after = consumerRenders;

    act(() => setPriorityRef!("High"));
    expect(consumerRenders).toBeGreaterThan(after);
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
