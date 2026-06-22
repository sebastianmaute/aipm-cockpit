import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { loadPanelViews } from "./panel-views";
import { usePanelViews } from "./use-panel-views";

beforeEach(() => localStorage.clear());

const st = { search: "", filters: { status: "All" }, sort: null };

describe("usePanelViews", () => {
  it("scopes views to the requested kind and persists", () => {
    const { result } = renderHook(() => usePanelViews("raid"));
    act(() => result.current.addView("A", st));
    expect(result.current.views.map((v) => v.name)).toEqual(["A"]);
    expect(loadPanelViews()).toHaveLength(1);
  });

  it("a view of another kind is not visible", () => {
    const raid = renderHook(() => usePanelViews("raid"));
    act(() => raid.result.current.addView("R", st));
    const changes = renderHook(() => usePanelViews("changes"));
    expect(changes.result.current.views).toEqual([]);
  });

  it("removeView deletes by id", () => {
    const { result } = renderHook(() => usePanelViews("raid"));
    act(() => result.current.addView("A", st));
    const id = result.current.views[0].id;
    act(() => result.current.removeView(id));
    expect(result.current.views).toEqual([]);
  });
});
