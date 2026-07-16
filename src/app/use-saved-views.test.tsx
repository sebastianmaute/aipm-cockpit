import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { loadSavedViews, saveSavedViews, type SavedViewPayload } from "./saved-views";
import { useSavedViews } from "./use-saved-views";

function mkPayload(over: Partial<SavedViewPayload> = {}): SavedViewPayload {
  return {
    search: "",
    priorityFilter: "All",
    assigneeFilter: "",
    groupFilter: "",
    labelFilter: "",
    healthFilter: "all",
    sortKey: "id",
    sortDir: "asc",
    hiddenCols: [],
    ...over,
  };
}

describe("useSavedViews", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads existing saved views on mount", () => {
    saveSavedViews([{ id: 1, name: "A", payload: mkPayload() }]);

    const { result } = renderHook(() => useSavedViews());

    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0]).toMatchObject({ id: 1, name: "A" });
  });

  it("adds a view to state and persists it", () => {
    const { result } = renderHook(() => useSavedViews());

    act(() => {
      result.current.addView("B", mkPayload({ search: "foo" }));
    });

    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0]).toMatchObject({ name: "B" });

    const persisted = loadSavedViews();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ name: "B", payload: mkPayload({ search: "foo" }) });
  });

  it("removes a view from state and storage", () => {
    saveSavedViews([
      { id: 1, name: "A", payload: mkPayload() },
      { id: 2, name: "B", payload: mkPayload() },
    ]);

    const { result } = renderHook(() => useSavedViews());

    act(() => {
      result.current.removeView(1);
    });

    expect(result.current.views.map((v) => v.id)).toEqual([2]);
    expect(loadSavedViews().map((v) => v.id)).toEqual([2]);
  });

  it("renames a view in state and storage", () => {
    saveSavedViews([{ id: 1, name: "A", payload: mkPayload() }]);

    const { result } = renderHook(() => useSavedViews());

    act(() => {
      result.current.renameView(1, "X");
    });

    expect(result.current.views[0]).toMatchObject({ id: 1, name: "X" });
    expect(loadSavedViews()[0]).toMatchObject({ id: 1, name: "X" });
  });
});
