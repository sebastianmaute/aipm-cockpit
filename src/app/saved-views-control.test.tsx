import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { FiltersProvider } from "./filters-context";
import { SavedViewsControl } from "./saved-views-control";
import { loadSavedViews, saveSavedViews, type SavedViewPayload } from "./saved-views";

function basePayload(overrides: Partial<SavedViewPayload> = {}): SavedViewPayload {
  return {
    search: "",
    priorityFilter: "All",
    assigneeFilter: "All",
    groupFilter: "All",
    labelFilter: "All",
    sortKey: "id",
    sortDir: "asc",
    hiddenCols: [],
    ...overrides,
  };
}

function renderControl(setHiddenCols = vi.fn()) {
  render(
    <FiltersProvider>
      <SavedViewsControl
        lang="en-US"
        hiddenCols={new Set(["estimate"])}
        setHiddenCols={setHiddenCols}
      />
    </FiltersProvider>,
  );
  return { setHiddenCols };
}

describe("SavedViewsControl", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves the current view, capturing the passed hiddenCols and provider defaults", () => {
    renderControl();

    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "My view" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const views = loadSavedViews();
    const mine = views.find((v) => v.name === "My view");
    expect(mine).toBeTruthy();
    expect(mine?.payload.hiddenCols).toContain("estimate");
    expect(mine?.payload.search).toBe("");
    expect(mine?.payload.priorityFilter).toBe("All");
    expect(mine?.payload.assigneeFilter).toBe("All");
    expect(mine?.payload.sortKey).toBe("id");
    expect(mine?.payload.sortDir).toBe("asc");
  });

  it("applies a selected view, restoring its hiddenCols via setHiddenCols", () => {
    saveSavedViews([
      { id: 1, name: "V", payload: basePayload({ hiddenCols: ["spent"] }) },
    ]);
    const { setHiddenCols } = renderControl();

    fireEvent.change(screen.getByRole("combobox", { name: "Apply a saved view" }), {
      target: { value: "1" },
    });

    expect(setHiddenCols).toHaveBeenCalledWith(new Set(["spent"]));
  });

  it("deletes the selected view", () => {
    saveSavedViews([
      { id: 1, name: "V", payload: basePayload({ hiddenCols: ["spent"] }) },
    ]);
    renderControl();

    fireEvent.change(screen.getByRole("combobox", { name: "Apply a saved view" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete the selected saved view" }));

    expect(loadSavedViews().some((v) => v.id === 1)).toBe(false);
  });

  it("exposes accessible names for the select, save and delete controls", () => {
    renderControl();

    expect(screen.getByRole("combobox", { name: "Apply a saved view" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save current view" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete the selected saved view" })).toBeTruthy();
  });
});
