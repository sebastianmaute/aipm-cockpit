import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReportsViews } from "./use-reports-views";
import { loadReportsViews, type ReportsViewState } from "./reports-views";

const state: ReportsViewState = {
  assignee: { filter: "", sort: { key: "total", dir: "desc" } },
  group: { filter: "", sort: null },
  label: { filter: "", sort: null },
};

beforeEach(() => localStorage.clear());

describe("useReportsViews", () => {
  it("adds and persists a view", () => {
    const { result } = renderHook(() => useReportsViews());
    act(() => result.current.addView("A", state));
    expect(result.current.views.map((v) => v.name)).toEqual(["A"]);
    expect(loadReportsViews().map((v) => v.name)).toEqual(["A"]);
  });

  it("removes a view", () => {
    const { result } = renderHook(() => useReportsViews());
    act(() => result.current.addView("A", state));
    const id = result.current.views[0].id;
    act(() => result.current.removeView(id));
    expect(result.current.views).toEqual([]);
  });
});
