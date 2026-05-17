import { describe, test, expect } from "vitest";
import { renderHook } from "@testing-library/react";
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
});
