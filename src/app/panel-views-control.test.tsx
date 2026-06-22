import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";
import { PanelViewsControl } from "./panel-views-control";
import type { PanelFiltersState } from "./panel-views";

const DEFAULTS: PanelFiltersState = { search: "", filters: { status: "All" }, sort: null };

function Probe() {
  const pf = usePanelFilters();
  return <span data-testid="status">{pf.filters.status}</span>;
}
function FilterSetter() {
  const pf = usePanelFilters();
  return (
    <button onClick={() => pf.setFilter("status", "Open")}>set-open</button>
  );
}
function Resetter() {
  const pf = usePanelFilters();
  return <button onClick={() => pf.reset()}>reset</button>;
}
function Harness() {
  return (
    <PanelFiltersProvider defaults={DEFAULTS}>
      <PanelViewsControl lang="en-US" view="raid" />
      <Probe />
      <FilterSetter />
      <Resetter />
    </PanelFiltersProvider>
  );
}

beforeEach(() => localStorage.clear());

describe("PanelViewsControl", () => {
  it("saves the current state, then re-applies it after the live filter changed", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("set-open"));
    expect(screen.getByTestId("status").textContent).toBe("Open");

    fireEvent.click(screen.getByText("Save current view"));
    fireEvent.change(screen.getByLabelText("View name"), { target: { value: "Open items" } });
    fireEvent.click(screen.getByText("Save"));

    // change live state away from the saved snapshot
    fireEvent.click(screen.getByText("reset"));
    expect(screen.getByTestId("status").textContent).toBe("All");

    // apply the saved view via the select
    const option = screen.getByRole("option", { name: "Open items" }) as HTMLOptionElement;
    fireEvent.change(screen.getByLabelText("Apply a saved view"), { target: { value: option.value } });
    expect(screen.getByTestId("status").textContent).toBe("Open");
  });

  it("disables Delete until a valid view is selected", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Delete the selected saved view")).toBeDisabled();
  });

  it("invokes onApply when a preset is applied", () => {
    let applied = 0;
    function H() {
      return (
        <PanelFiltersProvider defaults={DEFAULTS}>
          <PanelViewsControl lang="en-US" view="raid" onApply={() => { applied += 1; }} />
          <FilterSetter />
        </PanelFiltersProvider>
      );
    }
    render(<H />);
    fireEvent.click(screen.getByText("set-open"));
    fireEvent.click(screen.getByText("Save current view"));
    fireEvent.change(screen.getByLabelText("View name"), { target: { value: "V" } });
    fireEvent.click(screen.getByText("Save"));
    const option = screen.getByRole("option", { name: "V" }) as HTMLOptionElement;
    fireEvent.change(screen.getByLabelText("Apply a saved view"), { target: { value: option.value } });
    expect(applied).toBe(1);
  });
});
