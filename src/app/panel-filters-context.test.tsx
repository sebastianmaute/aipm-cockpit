import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { PanelFiltersState } from "./panel-views";
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";

const DEFAULTS: PanelFiltersState = { search: "", filters: { status: "All" }, sort: null };
const wrap = (defaults: PanelFiltersState) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <PanelFiltersProvider defaults={defaults}>{children}</PanelFiltersProvider>
  );
  return Wrapper;
};

describe("panel-filters-context", () => {
  it("seeds from defaults", () => {
    const { result } = renderHook(() => usePanelFilters(), { wrapper: wrap(DEFAULTS) });
    expect(result.current.search).toBe("");
    expect(result.current.filters.status).toBe("All");
    expect(result.current.sort).toBeNull();
  });

  it("setFilter updates one key immutably", () => {
    const { result } = renderHook(() => usePanelFilters(), { wrapper: wrap(DEFAULTS) });
    act(() => result.current.setFilter("status", "Open"));
    expect(result.current.filters.status).toBe("Open");
  });

  it("setSearch and setSort work", () => {
    const { result } = renderHook(() => usePanelFilters(), { wrapper: wrap(DEFAULTS) });
    act(() => result.current.setSearch("hi"));
    act(() => result.current.setSort({ key: "name", dir: "desc" }));
    expect(result.current.search).toBe("hi");
    expect(result.current.sort).toEqual({ key: "name", dir: "desc" });
  });

  it("applyState replaces wholesale; reset returns to defaults", () => {
    const { result } = renderHook(() => usePanelFilters(), { wrapper: wrap(DEFAULTS) });
    act(() => result.current.applyState({ search: "x", filters: { status: "Closed" }, sort: { key: "date", dir: "asc" } }));
    expect(result.current.filters.status).toBe("Closed");
    act(() => result.current.reset());
    expect(result.current.search).toBe("");
    expect(result.current.filters.status).toBe("All");
    expect(result.current.sort).toBeNull();
  });

  it("resetFilters clears search + filters but KEEPS the active sort", () => {
    const { result } = renderHook(() => usePanelFilters(), { wrapper: wrap(DEFAULTS) });
    act(() => result.current.setSearch("q"));
    act(() => result.current.setFilter("status", "Open"));
    act(() => result.current.setSort({ key: "name", dir: "desc" }));
    act(() => result.current.resetFilters());
    expect(result.current.search).toBe("");
    expect(result.current.filters.status).toBe("All");
    expect(result.current.sort).toEqual({ key: "name", dir: "desc" });
  });
});
