import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportsViewsControl } from "./reports-views-control";
import { type ReportsViewState } from "./reports-views";

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
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    fireEvent.change(screen.getByRole("combobox", { name: "Apply a saved view" }), {
      target: { value: screen.getByRole("option", { name: "Mine" }).getAttribute("value")! },
    });
    expect(onApply).toHaveBeenCalledWith(current);
  });

  it("deletes the selected view", () => {
    render(<ReportsViewsControl lang="en-US" currentState={current} onApply={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Apply a saved view" }), {
      target: { value: screen.getByRole("option", { name: "Mine" }).getAttribute("value")! },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete the selected saved view" }));
    expect(screen.queryByRole("option", { name: "Mine" })).toBeNull();
  });
});
