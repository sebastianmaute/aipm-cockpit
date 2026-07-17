import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReportsViewsControl } from "./reports-views-control";
import { type ReportsViewState } from "./reports-views";
import { SETTINGS_KEY } from "./use-settings";

const current: ReportsViewState = {
  assignee: { filter: "alice", sort: { key: "total", dir: "desc" } },
  group: { filter: "", sort: { key: "name", dir: "off" } },
  label: { filter: "", sort: null },
};

beforeEach(() => localStorage.clear());

describe("ReportsViewsControl", () => {
  it("saves the current state and applies it back", () => {
    const onApply = vi.fn();
    render(<ReportsViewsControl lang="en-US" currentState={current} onApply={onApply} />);

    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), { target: { value: "Mine" } });
    // The confirm button now carries an aria-label (unified with the panel/saved
    // controls via SavedViewsMenu) → its accessible name is "Save current view";
    // the toggle is unmounted while saving, so the match stays unambiguous.
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));

    fireEvent.change(screen.getByRole("combobox", { name: "Apply a saved view" }), {
      target: { value: screen.getByRole("option", { name: "Mine" }).getAttribute("value")! },
    });
    expect(onApply).toHaveBeenCalledWith(current);
  });

  it("deletes the selected view", () => {
    render(<ReportsViewsControl lang="en-US" currentState={current} onApply={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), { target: { value: "Mine" } });
    // The confirm button now carries an aria-label (unified with the panel/saved
    // controls via SavedViewsMenu) → its accessible name is "Save current view";
    // the toggle is unmounted while saving, so the match stays unambiguous.
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Apply a saved view" }), {
      target: { value: screen.getByRole("option", { name: "Mine" }).getAttribute("value")! },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete the selected saved view" }));
    expect(screen.queryByRole("option", { name: "Mine" })).toBeNull();
  });

  it("renders null when the global Show-saved-views setting is off", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showSavedViews: false }));
    render(<ReportsViewsControl lang="en-US" currentState={current} onApply={() => {}} />);
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: "Apply a saved view" })).toBeNull(),
    );
  });
});
