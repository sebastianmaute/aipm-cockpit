import { describe, test, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourceCalendar } from "./resource-calendar";
import { isoWeekParts } from "./resource-capacity";
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

  test("includeExternals=false hides external-backed rows but keeps unlinked + internal rows", () => {
    const ext: Resource = { id: 2, firstName: "Tom", lastName: "Ext", roleId: null, utilizationMode: "percent", utilization: {}, isExternal: true };
    const rows = [
      { key: "Alex Example", display: "Alex Example", email: "" },
      { key: "tom ext", display: "Tom Ext", email: "" },
      { key: "typed contractor", display: "Typed Contractor", email: "" },
    ];
    const { rerender } = render(
      <ResourceCalendar {...baseProps} rows={rows} resources={[Sample, ext]} includeExternals />,
    );
    expect(screen.getByRole("button", { name: "Tom Ext" })).toBeTruthy();
    // Excluding externals drops Tom (backed by an external resource) but keeps
    // the internal Sample and the never-linked typed contractor.
    rerender(<ResourceCalendar {...baseProps} rows={rows} resources={[Sample, ext]} includeExternals={false} />);
    expect(screen.queryByRole("button", { name: "Tom Ext" })).toBeNull();
    expect(screen.getByRole("button", { name: "Alex Example" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Typed Contractor" })).toBeTruthy();
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

it("keeps exactly one day-cell tab stop after the window shrinks (#27 clamp)", () => {
  const props = {
    ...baseProps,
    rows: [
      { key: "a", display: "Aria", email: "" },
      { key: "b", display: "Ben", email: "" },
    ],
    resources: [],
  };
  const { container, rerender } = render(
    <ResourceCalendar {...props} startDate="2026-06-01" endDate="2026-06-30" />,
  );
  const grid = container.querySelector('[role="grid"]') as HTMLElement;
  // Rove focus far into the wide grid.
  (container.querySelector('[data-cell="0-0"]') as HTMLElement).focus();
  for (let i = 0; i < 20; i++) fireEvent.keyDown(grid, { key: "ArrowRight" });
  fireEvent.keyDown(grid, { key: "ArrowDown" });
  // Shrink the window to 3 days; the stored marker (row 1, col ~20) is now off-range.
  rerender(<ResourceCalendar {...props} startDate="2026-06-01" endDate="2026-06-03" />);
  const cells = Array.from(container.querySelectorAll<HTMLElement>("[data-cell]"));
  const tabStops = cells.filter((c) => c.getAttribute("tabindex") === "0");
  // Exactly one cell remains a tab stop (clamped onto a real rendered cell).
  expect(tabStops).toHaveLength(1);
  expect(tabStops[0].getAttribute("data-cell")).toBe("1-2");
});

describe("isoWeekParts", () => {
  it("is exported and gives the ISO week-numbering year and week", () => {
    expect(isoWeekParts(new Date("2026-07-26T00:00:00Z"))).toEqual({ year: 2026, week: 30 });
  });

  it("keeps a January date in the previous ISO year when the week straddles", () => {
    // 2026-12-28 is the Monday of 2026-W53; 2027-01-01 falls inside that same week.
    expect(isoWeekParts(new Date("2026-12-28T00:00:00Z"))).toEqual({ year: 2026, week: 53 });
    expect(isoWeekParts(new Date("2027-01-01T00:00:00Z"))).toEqual({ year: 2026, week: 53 });
  });
});

it("renders a weekday label above each day number", () => {
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-29"
    />,
  );
  // 2026-07-27 is a Monday.
  expect(screen.getByText("Mon")).toBeInTheDocument();
  expect(screen.getByText("Tue")).toBeInTheDocument();
});

it("does not hijack arrow keys from the assignee row-header button (#27)", () => {
  const { container } = render(
    <ResourceCalendar
      {...baseProps}
      rows={[{ key: "a", display: "Aria", email: "" }]}
      resources={[]}
      startDate="2026-06-10"
      endDate="2026-06-12"
    />,
  );
  const grid = container.querySelector('[role="grid"]') as HTMLElement;
  const assignee = screen.getByRole("button", { name: "Aria" });
  assignee.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight" });
  // Focus stays on the row-header button (not yanked into the day grid).
  expect(document.activeElement).toBe(assignee);
});

it("groups day columns under an ISO week band", () => {
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-08-03"
    />,
  );
  // Mon 2026-07-27 .. Sun 2026-08-02 is W31; Mon 2026-08-03 starts W32.
  const w31 = screen.getByText("W31");
  expect(w31).toBeInTheDocument();
  expect(w31.closest("th")).toHaveAttribute("colspan", "7");
  expect(screen.getByText("W32").closest("th")).toHaveAttribute("colspan", "1");
});

it("calls onMoveAbsence with the resolved patch when a range is dragged", () => {
  const onMoveAbsence = vi.fn();
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-28", type: "vacation" }]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      onMoveAbsence={onMoveAbsence}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-31"
    />,
  );
  const cells = screen.getAllByRole("gridcell");
  const dt = { data: {} as Record<string, string>,
    setData(k: string, v: string) { this.data[k] = v; },
    getData(k: string) { return this.data[k] ?? ""; },
    effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(cells[0].querySelector("button")!, { dataTransfer: dt });
  fireEvent.drop(cells[2].querySelector("button")!, { dataTransfer: dt });
  expect(onMoveAbsence).toHaveBeenCalledWith(7, { startDate: "2026-07-29", endDate: "2026-07-30" }, "move");
});

it("does not open the absence editor when a drag ends on the same cell", () => {
  const onEditAbsence = vi.fn();
  const onMoveAbsence = vi.fn();
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={onEditAbsence}
      onMoveAbsence={onMoveAbsence}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-31"
    />,
  );
  const btn = screen.getAllByRole("gridcell")[0].querySelector("button")!;
  const dt = { data: {} as Record<string, string>,
    setData(k: string, v: string) { this.data[k] = v; },
    getData(k: string) { return this.data[k] ?? ""; },
    effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(btn, { dataTransfer: dt });
  fireEvent.drop(btn, { dataTransfer: dt });
  fireEvent.click(btn);
  expect(onMoveAbsence).not.toHaveBeenCalled();
  expect(onEditAbsence).not.toHaveBeenCalled();
});

it("calls onMoveAbsence with a reassign patch when dropped on a different assignee row", () => {
  const onMoveAbsence = vi.fn();
  const bob: Resource = {
    id: 5,
    firstName: "Bob",
    lastName: "",
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    email: "bob@x.io",
  };
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[
        { key: "anna", display: "Anna", email: "" },
        { key: "bob", display: "Bob", email: "bob@x.io" },
      ]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      onMoveAbsence={onMoveAbsence}
      resources={[bob]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-31"
    />,
  );
  const cells = screen.getAllByRole("gridcell");
  const dt = { data: {} as Record<string, string>,
    setData(k: string, v: string) { this.data[k] = v; },
    getData(k: string) { return this.data[k] ?? ""; },
    effectAllowed: "", dropEffect: "" };
  // cells[0] = Anna's first day (2026-07-27, the absence's start); cells[5] =
  // Bob's first day, same date — isolates a pure row change (no date delta).
  fireEvent.dragStart(cells[0].querySelector("button")!, { dataTransfer: dt });
  fireEvent.drop(cells[5].querySelector("button")!, { dataTransfer: dt });
  expect(onMoveAbsence).toHaveBeenCalledWith(
    7,
    { startDate: "2026-07-27", endDate: "2026-07-27", assignee: "Bob", assigneeEmail: "bob@x.io", resourceId: 5 },
    "reassign",
  );
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
