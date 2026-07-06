import { describe, test, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourceCalendar } from "./resource-calendar";
import type { Resource } from "./types";

const Sample: Resource = { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent", utilization: {} };

const baseProps = {
  lang: "en-US" as const,
  absences: [] as never[],
  today: "2026-05-27",
  holidaySet: new Set<string>(),
  onAddAbsence: () => {},
  onEditAbsence: () => {},
  onEditResource: () => {},
  onAddResource: () => {},
  startDate: "2026-05-27",
  endDate: "2026-06-25",
};

describe("ResourceCalendar assignee click", () => {
  test("matched name opens the edit modal with that resource", () => {
    const onEditResource = vi.fn();
    render(
      <ResourceCalendar
        {...baseProps}
        rows={[{ key: "Alex Example", display: "Alex Example", email: "" }]}
        resources={[Sample]}
        onEditResource={onEditResource}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEditResource).toHaveBeenCalledWith(Sample);
  });

  test("unmatched name opens Add Resource prefilled from the display name", () => {
    const onAddResource = vi.fn();
    render(
      <ResourceCalendar
        {...baseProps}
        rows={[{ key: "tom external", display: "Tom External", email: "tom@x.io" }]}
        resources={[]}
        onAddResource={onAddResource}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tom External" }));
    expect(onAddResource).toHaveBeenCalledWith({ firstName: "Tom", lastName: "External", email: "tom@x.io" });
  });
});

it("renders past and future day columns for the given window", () => {
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "a", display: "Aria", email: "" }]}
      absences={[]}
      today="2026-06-15"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-06-10"
      endDate="2026-06-20"
    />,
  );
  expect(screen.getAllByTitle(/2026-06-10/).length).toBeGreaterThan(0);
  expect(screen.getAllByTitle(/2026-06-20/).length).toBeGreaterThan(0);
  expect(screen.getByTitle(/2026-06-15 \(/)).toBeTruthy();
});

it("supports 2-D roving keyboard navigation over day cells (#27)", () => {
  const { container } = render(
    <ResourceCalendar
      {...baseProps}
      rows={[
        { key: "a", display: "Aria", email: "" },
        { key: "b", display: "Ben", email: "" },
      ]}
      resources={[]}
      startDate="2026-06-10"
      endDate="2026-06-12"
    />,
  );
  const grid = container.querySelector('[role="grid"]') as HTMLElement;
  expect(grid).toBeTruthy();
  const cell = (r: number, c: number) =>
    container.querySelector(`[data-cell="${r}-${c}"]`) as HTMLElement;

  // Roving tabindex: exactly the active cell (0,0) is a tab stop.
  expect(cell(0, 0).getAttribute("tabindex")).toBe("0");
  expect(cell(0, 1).getAttribute("tabindex")).toBe("-1");
  expect(cell(1, 0).getAttribute("tabindex")).toBe("-1");

  cell(0, 0).focus();
  fireEvent.keyDown(grid, { key: "ArrowRight" });
  expect(document.activeElement).toBe(cell(0, 1));
  expect(cell(0, 1).getAttribute("tabindex")).toBe("0");
  expect(cell(0, 0).getAttribute("tabindex")).toBe("-1");

  fireEvent.keyDown(grid, { key: "ArrowDown" });
  expect(document.activeElement?.getAttribute("data-cell")).toBe("1-1");

  fireEvent.keyDown(grid, { key: "Home" });
  expect(document.activeElement).toBe(cell(1, 0));

  fireEvent.keyDown(grid, { key: "End" });
  expect(document.activeElement?.getAttribute("data-cell")).toBe("1-2");

  // Ctrl+Home jumps to the grid origin.
  fireEvent.keyDown(grid, { key: "Home", ctrlKey: true });
  expect(document.activeElement).toBe(cell(0, 0));
});

it("scroll-centers today when the window includes it", () => {
  const { container } = render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "a", display: "Aria", email: "" }]}
      absences={[]}
      today="2026-06-15"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-06-01"
      endDate="2026-06-30"
    />,
  );
  const scroller = container.querySelector("[data-calendar-scroll]") as HTMLElement;
  expect(scroller).toBeTruthy();
  expect(typeof scroller.scrollLeft).toBe("number");
});
