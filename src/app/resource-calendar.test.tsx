import { describe, test, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourceCalendar } from "./resource-calendar";
import { isoWeekParts } from "./resource-capacity";
import { t } from "./i18n";
import type { Resource } from "./types";
import type { CalendarEvent } from "./calendar-event";

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

it("labels the weekday correctly under a negative UTC offset, matching the UTC day number beneath it", () => {
  // Every sibling field on CalendarDay (dayOfMonth, isoWeek, isWeekend via
  // getUTCDay) is UTC. Without an explicit timeZone, toLocaleDateString
  // falls back to the process's LOCAL zone — invisible in a positive-offset
  // or UTC dev/CI environment, but in a negative offset (e.g. America/New_
  // York, UTC-4 in July) 2026-07-27T00:00:00Z's LOCAL calendar day is still
  // 2026-07-26 — a day early. Pin the zone explicitly rather than relying on
  // whatever the test runner's system zone happens to be, or this would
  // keep passing regardless of whether the fix is present.
  const originalTz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
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
        endDate="2026-07-27"
      />,
    );
    // 2026-07-27 is a UTC Monday — the number "27" and (via isWeekend) the
    // absence of weekend shading both already reflect that. The label must
    // say "Mon" too, not "Sun" (America/New_York's local calendar day for
    // this same UTC instant).
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.queryByText("Sun")).not.toBeInTheDocument();
  } finally {
    if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
  }
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

it("does not swallow a later click on a DIFFERENT cell after a completed drag (the real browser sequence — no click ever follows a drop)", () => {
  // The test above fires drop then click on the SAME element — a sequence
  // that pins the intent but that native HTML5 drag-and-drop never actually
  // produces (unlike the mouse-drag model gantt uses, DnD dispatches no
  // click after a drop at all). This test models the REAL sequence —
  // dragstart -> drop -> dragend, then a later, genuinely separate click on
  // an UNRELATED cell — which is exactly how the leak manifested: every
  // drag armed suppressClickRef and nothing ever cleared it, so the NEXT
  // real interaction anywhere on the grid was silently swallowed.
  const onAddAbsence = vi.fn();
  const onMoveAbsence = vi.fn();
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={onAddAbsence}
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
  const dragged = cells[0].querySelector("button")!; // 07-27, holds the absence
  const other = cells[1].querySelector("button")!; // 07-28, empty
  const dt = { data: {} as Record<string, string>,
    setData(k: string, v: string) { this.data[k] = v; },
    getData(k: string) { return this.data[k] ?? ""; },
    effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(dragged, { dataTransfer: dt });
  fireEvent.drop(dragged, { dataTransfer: dt });
  fireEvent.dragEnd(dragged);
  fireEvent.click(other);
  expect(onAddAbsence).toHaveBeenCalledTimes(1);
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

it("offers a resize handle on the first and last cell of a span only (not every day)", () => {
  // Spec called this "labelled" and originally proposed getAllByLabelText,
  // but the shared DragHandle atom's DECORATIVE mode (mandated so it can't
  // become a second tab stop) carries no aria-label — only a hover title.
  // Query by title instead; that IS the hover-discoverability mechanism.
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-29", type: "vacation" }]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      onMoveAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-31"
    />,
  );
  expect(screen.getAllByTitle(/change start date/i)).toHaveLength(1);
  expect(screen.getAllByTitle(/change end date/i)).toHaveLength(1);
});

it("moves an absence by keyboard without committing on every arrow press", () => {
  const onMoveAbsence = vi.fn();
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
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
  const grid = screen.getByRole("grid");
  const first = screen.getAllByRole("gridcell")[0].querySelector("button")!;
  first.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  // Load-bearing: nothing commits before Enter.
  expect(onMoveAbsence).not.toHaveBeenCalled();
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(onMoveAbsence).toHaveBeenCalledTimes(1);
  expect(onMoveAbsence).toHaveBeenCalledWith(7, { startDate: "2026-07-29", endDate: "2026-07-29" }, "move");
});

it("discards a pending keyboard move on Escape", () => {
  const onMoveAbsence = vi.fn();
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
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
  const grid = screen.getByRole("grid");
  screen.getAllByRole("gridcell")[0].querySelector("button")!.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  fireEvent.keyDown(grid, { key: "Escape" });
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(onMoveAbsence).not.toHaveBeenCalled();
});

it("clamps a keyboard move's target row to the last visible row rather than an out-of-range one", () => {
  // Only 2 rows, but 5 Alt+ArrowDown presses ask for row index 5 — the
  // commit must clamp to row 1 (Ben), not silently drop the gesture or
  // target a row that doesn't exist.
  const onMoveAbsence = vi.fn();
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[
        { key: "anna", display: "Anna", email: "" },
        { key: "ben", display: "Ben", email: "" },
      ]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
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
  const grid = screen.getByRole("grid");
  screen.getAllByRole("gridcell")[0].querySelector("button")!.focus();
  for (let i = 0; i < 5; i++) fireEvent.keyDown(grid, { key: "ArrowDown", altKey: true });
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(onMoveAbsence).toHaveBeenCalledTimes(1);
  expect(onMoveAbsence).toHaveBeenCalledWith(
    7,
    { startDate: "2026-07-27", endDate: "2026-07-27", assignee: "Ben", assigneeEmail: undefined, resourceId: undefined },
    "reassign",
  );
});

it("resizes an absence's end date by keyboard (Alt+Shift+Arrow), not the start date", () => {
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
  const grid = screen.getByRole("grid");
  screen.getAllByRole("gridcell")[0].querySelector("button")!.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true, shiftKey: true });
  // Load-bearing: nothing commits before Enter, same discipline as move.
  expect(onMoveAbsence).not.toHaveBeenCalled();
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(onMoveAbsence).toHaveBeenCalledTimes(1);
  expect(onMoveAbsence).toHaveBeenCalledWith(7, { startDate: "2026-07-27", endDate: "2026-07-29" }, "resize");
});

it("does not reschedule the absence when Alt+Shift+Arrow is pressed (the Important-severity defect: it must resize, not move)", () => {
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
  const grid = screen.getByRole("grid");
  screen.getAllByRole("gridcell")[0].querySelector("button")!.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true, shiftKey: true });
  fireEvent.keyDown(grid, { key: "Enter" });
  // A move would have shifted BOTH dates by +1 day (07-28/07-29). The
  // startDate must stay put — only the resize patch (asserted above) is
  // a correct outcome of this key combination.
  expect(onMoveAbsence).toHaveBeenCalledWith(7, expect.objectContaining({ startDate: "2026-07-27" }), "resize");
});

it("discards a pending keyboard resize on Escape without committing", () => {
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
  const grid = screen.getByRole("grid");
  screen.getAllByRole("gridcell")[0].querySelector("button")!.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true, shiftKey: true });
  fireEvent.keyDown(grid, { key: "Escape" });
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(onMoveAbsence).not.toHaveBeenCalled();
});

it("announces resize mode (not move mode) via aria-live while a keyboard resize is pending", () => {
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-28", type: "vacation" }]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      onMoveAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-31"
    />,
  );
  const grid = screen.getByRole("grid");
  screen.getAllByRole("gridcell")[0].querySelector("button")!.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true, shiftKey: true });
  expect(screen.getByText(/resize mode/i)).toBeInTheDocument();
  expect(screen.queryByText(/^move mode/i)).not.toBeInTheDocument();
});

it("keeps exactly one tab-reachable day cell even with resize handles rendered", () => {
  const { container } = render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-29", type: "vacation" }]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      onMoveAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-31"
    />,
  );
  // The handles ARE rendered (found via their hover title — see the previous
  // test's note on why this isn't a getByLabelText query)...
  const handleWrappers = [...screen.getAllByTitle(/change start date/i), ...screen.getAllByTitle(/change end date/i)];
  expect(handleWrappers).toHaveLength(2);
  // ...but the roving-tabindex invariant (#27) still holds: exactly ONE
  // element anywhere in the table BODY is tab-reachable. Scoped to the whole
  // tbody (not just [data-cell]) so a handle wrongly rendered in DragHandle's
  // ACCESSIBLE mode (tabIndex=0 lives on ITS OWN inner div, not the title
  // wrapper) would be caught here, not hidden by a too-narrow selector.
  const tabStops = Array.from(container.querySelectorAll('tbody [tabindex="0"]'));
  expect(tabStops).toHaveLength(1);
  // And each handle's actual grip element (DragHandle's rendered div, inside
  // the title-carrying wrapper span) is the DECORATIVE variant: aria-hidden,
  // no role, no tabindex — it can never become a second tab stop.
  for (const wrapper of handleWrappers) {
    const grip = wrapper.querySelector("div")!;
    expect(grip).toHaveAttribute("aria-hidden", "true");
    expect(grip).not.toHaveAttribute("role");
    expect(grip).not.toHaveAttribute("tabindex");
  }
});

it("Alt+Arrow on a cell without an absence does not enter move mode — it just roves like a plain arrow", () => {
  const onMoveAbsence = vi.fn();
  const { container } = render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      onMoveAbsence={onMoveAbsence}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-29"
    />,
  );
  const grid = screen.getByRole("grid");
  const cell = (c: number) => container.querySelector(`[data-cell="0-${c}"]`) as HTMLElement;
  cell(0).focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  expect(document.activeElement).toBe(cell(1));
  expect(onMoveAbsence).not.toHaveBeenCalled();
});

it("announces move-mode start and cancellation via the aria-live region", () => {
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      onMoveAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-31"
    />,
  );
  const grid = screen.getByRole("grid");
  screen.getAllByRole("gridcell")[0].querySelector("button")!.focus();
  expect(screen.queryByText(/move mode/i)).toBeNull();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  expect(screen.getByText(/move mode/i)).toBeInTheDocument();
  fireEvent.keyDown(grid, { key: "Escape" });
  expect(screen.getByText(/move cancelled/i)).toBeInTheDocument();
});

it("renders occurrences of a recurring series in the meetings band", () => {
  const events: CalendarEvent[] = [
    {
      id: 1,
      title: "Standup",
      startDate: "2026-07-27",
      startTime: "09:00",
      durationMinutes: 15,
      recurrence: { freq: "daily", interval: 1 },
    },
  ];
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[]}
      calendarEvents={events}
      onEditEvent={() => {}}
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
  expect(screen.getByText("Meetings")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /Standup/ })).toHaveLength(3);
});

it("gives each occurrence a row-unique accessible name", () => {
  const events: CalendarEvent[] = [
    {
      id: 1,
      title: "Standup",
      startDate: "2026-07-27",
      startTime: "09:00",
      durationMinutes: 15,
      recurrence: { freq: "daily", interval: 1 },
    },
  ];
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[]}
      calendarEvents={events}
      onEditEvent={() => {}}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-28"
    />,
  );
  const names = screen.getAllByRole("button", { name: /Standup/ }).map((b) => b.getAttribute("aria-label"));
  expect(new Set(names).size).toBe(names.length);
});

it("stacks overlapping same-day meetings into separate lanes", () => {
  const events: CalendarEvent[] = [
    { id: 1, title: "Standup", startDate: "2026-07-27", startTime: "09:00", durationMinutes: 15 },
    { id: 2, title: "Retro", startDate: "2026-07-27", startTime: "11:00", durationMinutes: 30 },
  ];
  const { container } = render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[]}
      calendarEvents={events}
      onEditEvent={() => {}}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-27"
    />,
  );
  const bandRows = container.querySelectorAll("[data-calendar-band] tr");
  expect(bandRows).toHaveLength(2);
  expect(screen.getByRole("button", { name: /Standup/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Retro/ })).toBeInTheDocument();
});

it("keeps exactly one roving DAY-CELL tab stop with the meetings band rendered — band chips and row headers stay natively focusable OUTSIDE that roving set, not a regression", () => {
  const events: CalendarEvent[] = [
    {
      id: 1,
      title: "Standup",
      startDate: "2026-07-27",
      startTime: "09:00",
      durationMinutes: 15,
      recurrence: { freq: "daily", interval: 1 },
    },
  ];
  const { container } = render(
    <ResourceCalendar
      lang="en-US"
      rows={[
        { key: "anna", display: "Anna", email: "" },
        { key: "ben", display: "Ben", email: "" },
      ]}
      absences={[]}
      calendarEvents={events}
      onEditEvent={() => {}}
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
  const chips = screen.getAllByRole("button", { name: /Standup/ });
  expect(chips).toHaveLength(3);
  // The class of regression Task 6's narrower [data-cell]-only test missed:
  // a band cell must never carry data-cell (which the roving grid indexes
  // by row/column) — only its own data-band-cell.
  for (const chip of chips) {
    expect(chip).not.toHaveAttribute("data-cell");
    expect(chip).toHaveAttribute("data-band-cell");
  }
  const table = container.querySelector('[role="grid"]') as HTMLElement;
  // The real roving invariant is scoped to the DAY-CELL matrix only: exactly
  // one [data-cell] element is ever in the tab order. Checked via the
  // resolved `.tabIndex` IDL property (not a `[tabindex="0"]` ATTRIBUTE
  // selector) — a native <button> with no explicit `tabindex` attribute
  // still has `.tabIndex === 0` (it genuinely IS in the tab order), so an
  // attribute-only query is blind to every natively-focusable element below
  // and would pass unchanged even if this invariant broke.
  const dayCells = Array.from(table.querySelectorAll<HTMLElement>("[data-cell]"));
  const dayCellTabStops = dayCells.filter((c) => c.tabIndex === 0);
  expect(dayCellTabStops).toHaveLength(1);
  expect(dayCellTabStops[0]).toHaveAttribute("data-cell");
  // Full inventory of everything genuinely reachable by Tab in this table:
  // the one roving day cell, both row-header edit buttons, and all 3 chips
  // — chips and row headers are DELIBERATELY outside the roving set (see
  // resource-calendar-band.tsx's header comment), not folded into it. This
  // pins the real count so a future regression — a chip silently dropped
  // from the tab order, or an extra stop sneaking in (e.g. a mis-wired
  // ariaLabel'd grip) — shows up as a count change here, which the old
  // attribute-only query could never have caught either way.
  const allFocusable = Array.from(table.querySelectorAll<HTMLElement>("button, [tabindex]"))
    .filter((el) => el.tabIndex >= 0);
  expect(allFocusable).toHaveLength(6); // 1 day cell + 2 row headers + 3 chips
});

it("surfaces a perceivable warning when the band's occurrence search is truncated, even with an empty band", () => {
  // A daily series begun in 1900 exhausts expandOccurrences' MAX_ITERATIONS
  // cap long before its walk ever reaches a 2026 window — the exact "renders
  // nothing after March" failure mode: an empty band alone is indistinguishable
  // from "no meetings", which isn't the truth here.
  const events: CalendarEvent[] = [
    {
      id: 1,
      title: "Ancient standup",
      startDate: "1900-01-01",
      startTime: "09:00",
      durationMinutes: 15,
      recurrence: { freq: "daily", interval: 1 },
    },
  ];
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[]}
      calendarEvents={events}
      onEditEvent={() => {}}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-27"
    />,
  );
  // No chip renders — the search never reached this window.
  expect(screen.queryByRole("button", { name: /Ancient standup/ })).not.toBeInTheDocument();
  // But the band is not silently absent: a warning is genuinely perceivable
  // (real text content, not merely a hover-only title or a colour swap).
  const warning = screen.getByText(t("en-US", "calendarBandTruncated"));
  expect(warning).toBeInTheDocument();
  // WCAG AA: text-ui-pink on bg-surface-muted is 4.05:1 (fails); the
  // -strong variant is 5.26:1. Calendar isn't in the axe-scanned view list,
  // so this is the only guard against silently reverting to the plain token.
  // Exact token match (not a substring/regex check) — "text-ui-pink-strong"
  // itself contains "text-ui-pink" as a substring, so a naive check would
  // pass either way and prove nothing.
  const tdClasses = (warning.closest("td")?.className ?? "").split(/\s+/);
  expect(tdClasses).toContain("text-ui-pink-strong");
  expect(tdClasses).not.toContain("text-ui-pink");
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
