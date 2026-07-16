import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { FiltersProvider } from "./filters-context";
import { SavedViewsControl } from "./saved-views-control";
import { loadSavedViews, saveSavedViews, type SavedViewPayload } from "./saved-views";
import { SETTINGS_KEY } from "./use-settings";

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
    // The confirm button reuses the "Save current view" accessible name
    // (visible text "Save"); after entering save mode it is the only one.
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));

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

  it("disables Delete when the selected view is evicted by a cap-reaching save", () => {
    // Seed MAX_SAVED_VIEWS views; saving one more drops the oldest (id 1).
    const seeded = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      name: `V${i + 1}`,
      payload: basePayload(),
    }));
    saveSavedViews(seeded);
    renderControl();

    // Select the oldest view (id 1) — the one that will be evicted.
    fireEvent.change(screen.getByRole("combobox", { name: "Apply a saved view" }), {
      target: { value: "1" },
    });
    expect(
      (screen.getByRole("button", { name: "Delete the selected saved view" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    // Save a new view → id 1 is evicted, leaving the selection stale.
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "New" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));

    // Stale selection → Delete disabled, select shows the placeholder.
    expect(
      (screen.getByRole("button", { name: "Delete the selected saved view" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect((screen.getByRole("combobox", { name: "Apply a saved view" }) as HTMLSelectElement).value).toBe(
      "",
    );
  });

  it("exposes accessible names for the select, save and delete controls", () => {
    renderControl();

    expect(screen.getByRole("combobox", { name: "Apply a saved view" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save current view" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete the selected saved view" })).toBeTruthy();
  });

  it("renders by default (Show saved views on)", () => {
    renderControl();
    expect(screen.getByRole("combobox", { name: "Apply a saved view" })).toBeTruthy();
  });

  it("renders null when the global Show-saved-views setting is off", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showSavedViews: false }));
    renderControl();
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: "Apply a saved view" })).toBeNull(),
    );
  });
});
