import { describe, test, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourceCalendar } from "./resource-calendar";
import { isoWeekParts } from "./resource-capacity";
import { t } from "./i18n";
import type { Resource } from "./types";
import type { CalendarEvent } from "./calendar-event";
import { expectRowUniqueNames } from "../test/row-unique-names";

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

it("renders the UTC month label, not the runtime zone's", () => {
  // monthLabel got the same timeZone:"UTC" fix as weekdayLabel but no test.
  // 2026-07-01T00:00Z is still 2026-06-30 in America/New_York, so a label
  // derived in the local zone reads "Jun" while the day number says 1.
  // Verified non-vacuous: deleting timeZone:"UTC" from monthLabel makes this fail.
  const originalTz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    render(
      <ResourceCalendar
        lang="en-US"
        rows={[{ key: "anna", display: "Anna", email: "" }]}
        absences={[]}
        today="2026-07-01"
        holidaySet={new Set()}
        onAddAbsence={() => {}}
        onEditAbsence={() => {}}
        resources={[]}
        onEditResource={() => {}}
        onAddResource={() => {}}
        startDate="2026-07-01"
        endDate="2026-07-01"
      />,
    );
    expect(screen.getByText("Jul")).toBeInTheDocument();
    expect(screen.queryByText("Jun")).not.toBeInTheDocument();
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

it("Escape from a keyboard RESIZE announces the resize cancellation, not the move one", () => {
  // justCancelled used to be a bare boolean, so the live region could only
  // ever emit "Move cancelled" — even for an abandoned RESIZE, whose
  // mode-ON announcement already correctly says "Resize mode".
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
  fireEvent.keyDown(grid, { key: "Escape" });
  expect(screen.getByText(/resize cancelled/i)).toBeInTheDocument();
  expect(screen.queryByText(/^move cancelled/i)).not.toBeInTheDocument();
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

it("announces the band's keyboard move through the shared aria-live region", () => {
  // ★ CHAIN test, deliberately at this level. The band owns the gesture but
  // renders a <tbody> and so cannot host a live region; it reports up via
  // onMoveModeChange and THIS component folds it into the one region it
  // already owns for the grid's identical gesture. Both halves are unit-tested
  // in isolation — the band's prop plumbing in resource-calendar-band.test.tsx,
  // the grid's region above — and the wiring between them was covered by
  // neither: deleting both new arms of that ternary left every suite green.
  // Per-hop coverage passing while the chain is dead is a failure mode this
  // repo has already shipped once.
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
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[]}
      calendarEvents={events}
      onEditEvent={() => {}}
      onMoveOccurrence={() => {}}
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
  const chip = container.querySelector<HTMLElement>("[data-band-cell]")!;
  chip.focus();
  expect(screen.queryByText(t("en-US", "calendarMeetingMoveModeOn"))).toBeNull();

  fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
  expect(screen.getByText(t("en-US", "calendarMeetingMoveModeOn"))).toBeInTheDocument();
  // The band's gesture must not borrow the GRID's wording — they are different
  // objects and an exhaustive-map slip would silently announce the wrong one.
  expect(screen.queryByText(t("en-US", "calendarMoveModeOn"))).toBeNull();

  fireEvent.keyDown(chip, { key: "Escape" });
  expect(screen.getByText(t("en-US", "calendarMeetingMoveModeCancelled"))).toBeInTheDocument();
});

it("does not let one gesture's stale announcement mask or misdescribe the other's", () => {
  // ★ The band and the day grid share ONE polite region, and both cancellation
  // states are sticky past the gesture that set them. Untested, that gave two
  // real failures: arming a band move after cancelling a grid one announced
  // nothing at all (the grid branch has priority), and committing a grid move
  // after cancelling a band one announced "Meeting move cancelled" — a false
  // report of lost work immediately after a SUCCESSFUL edit.
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
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
      calendarEvents={events}
      onEditEvent={() => {}}
      onMoveOccurrence={() => {}}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      onMoveAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-29"
    />,
  );
  const grid = screen.getByRole("grid");
  const chip = container.querySelector<HTMLElement>("[data-band-cell]")!;
  const dayCell = container.querySelector<HTMLElement>("[data-cell]")!;

  // Cancel a GRID move, then arm a BAND one: the band must be heard.
  dayCell.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  fireEvent.keyDown(grid, { key: "Escape" });
  expect(screen.getByText(t("en-US", "calendarMoveModeCancelled"))).toBeInTheDocument();

  chip.focus();
  fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
  expect(screen.getByText(t("en-US", "calendarMeetingMoveModeOn"))).toBeInTheDocument();
  expect(screen.queryByText(t("en-US", "calendarMoveModeCancelled"))).toBeNull();

  // Now the mirror: abandon the band gesture, then run a GRID one to
  // completion. The stale "Meeting move cancelled" must not resurface.
  fireEvent.keyDown(chip, { key: "Escape" });
  expect(screen.getByText(t("en-US", "calendarMeetingMoveModeCancelled"))).toBeInTheDocument();

  dayCell.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  expect(screen.getByText(t("en-US", "calendarMoveModeOn"))).toBeInTheDocument();
  expect(screen.queryByText(t("en-US", "calendarMeetingMoveModeCancelled"))).toBeNull();
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(screen.queryByText(t("en-US", "calendarMeetingMoveModeCancelled"))).toBeNull();

  // ★ And again through the RESIZE arm site. There are TWO grid arm sites and
  // they each carry their own mirror; covering only the move one leaves a
  // deletable line — band cancel → grid RESIZE arm → resize commits, and the
  // region still reads "Meeting move cancelled".
  chip.focus();
  fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
  fireEvent.keyDown(chip, { key: "Escape" });
  expect(screen.getByText(t("en-US", "calendarMeetingMoveModeCancelled"))).toBeInTheDocument();

  dayCell.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true, shiftKey: true });
  expect(screen.getByText(t("en-US", "calendarResizeModeOn"))).toBeInTheDocument();
  // ★ Assert AFTER the resize completes, not while it is armed. With a gesture
  // in flight the ternary's first branch masks whatever is stale behind it, so
  // an assertion here passes even with the mirror deleted — the stale string
  // only surfaces once pendingMove clears.
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(screen.queryByText(t("en-US", "calendarMeetingMoveModeCancelled"))).toBeNull();
});

it("abandons an armed GRID gesture when focus moves to the meetings band", () => {
  // ★ The mirror of the band's own blur cancel, and the reason it cannot be a
  // plain "focus left the table" check: the band is a <tbody> INSIDE this same
  // table, so Shift+Tab from a day cell to a chip never leaves it. Without this,
  // the grid's pendingMove survives, the shared region keeps announcing "Move
  // absence…" while the user composes a MEETING move (the ternary reads
  // pendingMove first), and tabbing back and pressing Enter commits an absence
  // move armed several interactions earlier.
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
  const onMoveAbsence = vi.fn();
  const { container } = render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
      calendarEvents={events}
      onEditEvent={() => {}}
      onMoveOccurrence={() => {}}
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
  const dayCell = container.querySelector<HTMLElement>("[data-cell]")!;
  const chip = container.querySelector<HTMLElement>("[data-band-cell]")!;

  dayCell.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  expect(screen.getByText(t("en-US", "calendarMoveModeOn"))).toBeInTheDocument();

  // Focus crosses into the band — still inside the same <table>.
  fireEvent.blur(grid, { relatedTarget: chip });
  expect(screen.getByText(t("en-US", "calendarMoveModeCancelled"))).toBeInTheDocument();

  // And the abandoned gesture is not committable on return.
  dayCell.focus();
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(onMoveAbsence).not.toHaveBeenCalled();
});

it("abandons an armed grid gesture if the absence moved underneath it", () => {
  // ★ A day cell is DRAGGABLE. An HTML5 drag fires no click and no focus
  // change, so onGridBlur never sees it and the armed gesture survives a MOUSE
  // drag that has already relocated the absence. Enter then applied the delta to
  // the DROPPED date — the absence silently jumps one further day — and the
  // editor the user pressed Enter for did not open either, because the branch
  // had already preventDefault'd. The meetings band revalidates before its
  // commit for exactly this reason; the grid did not.
  // ★ MULTI-DAY, and only the START moves. A single-day fixture whose two ends
  // shift together cannot tell `moving.startDate` from `moving.endDate`, so the
  // move/resize field pairing was mutation-survivable: collapsing the guard to
  // either field, or arming the wrong one, passed.
  const onMoveAbsence = vi.fn();
  function Harness({ start }: { start: string }) {
    return (
      <ResourceCalendar
        lang="en-US"
        rows={[{ key: "anna", display: "Anna", email: "" }]}
        absences={[{ id: 7, assignee: "Anna", startDate: start, endDate: "2026-07-31", type: "vacation" }]}
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
      />
    );
  }
  const { container, rerender } = render(<Harness start="2026-07-27" />);
  const grid = screen.getByRole("grid");
  container.querySelector<HTMLElement>("[data-cell]")!.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  expect(screen.getByText(t("en-US", "calendarMoveModeOn"))).toBeInTheDocument();

  // A drag relocates the same absence while the gesture is still armed.
  rerender(<Harness start="2026-07-29" />);
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(onMoveAbsence).not.toHaveBeenCalled();
  expect(screen.getByText(t("en-US", "calendarMoveModeCancelled"))).toBeInTheDocument();
});

it("commits a keyboard move on a MULTI-DAY absence", () => {
  // ★ The happy path that distinguishes the two guard fields. The bail tests
  // cannot: the move gesture arms on startDate, so a guard mutated to read
  // endDate differs from the armed value immediately and bails for the WRONG
  // reason — passing the bail test while silently making every multi-day move
  // impossible. Only a successful commit exposes that.
  const onMoveAbsence = vi.fn();
  const { container } = render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-30", type: "vacation" }]}
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
  container.querySelector<HTMLElement>("[data-cell]")!.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(onMoveAbsence).toHaveBeenCalledTimes(1);
});

it("abandons an armed grid RESIZE if the absence's end moved underneath it", () => {
  // The resize arm/commit pair keys on endDate, the move pair on startDate. No
  // test rerendered during a pending RESIZE at all, so nothing distinguished
  // them — this drives the other half of the pairing.
  const onMoveAbsence = vi.fn();
  function Harness({ end }: { end: string }) {
    return (
      <ResourceCalendar
        lang="en-US"
        rows={[{ key: "anna", display: "Anna", email: "" }]}
        absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: end, type: "vacation" }]}
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
      />
    );
  }
  const { container, rerender } = render(<Harness end="2026-07-28" />);
  const grid = screen.getByRole("grid");
  container.querySelector<HTMLElement>("[data-cell]")!.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true, shiftKey: true });
  expect(screen.getByText(t("en-US", "calendarResizeModeOn"))).toBeInTheDocument();

  // Only the END moves — startDate is untouched, so a start-only guard passes.
  rerender(<Harness end="2026-07-30" />);
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(onMoveAbsence).not.toHaveBeenCalled();
  expect(screen.getByText(t("en-US", "calendarResizeModeCancelled"))).toBeInTheDocument();
});

it("abandons an armed grid move if the absence was reassigned underneath it", () => {
  // A drag can reassign to another person on the SAME date, changing neither
  // startDate nor endDate — so a date-only guard passes and Enter re-applies the
  // armed rowDelta, silently undoing the drag.
  const onMoveAbsence = vi.fn();
  function Harness({ who }: { who: string }) {
    return (
      <ResourceCalendar
        lang="en-US"
        rows={[
          { key: "anna", display: "Anna", email: "" },
          { key: "bo", display: "Bo", email: "" },
        ]}
        absences={[{ id: 7, assignee: who, startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
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
      />
    );
  }
  const { container, rerender } = render(<Harness who="Anna" />);
  const grid = screen.getByRole("grid");
  container.querySelector<HTMLElement>("[data-cell]")!.focus();
  fireEvent.keyDown(grid, { key: "ArrowDown", altKey: true });
  expect(screen.getByText(t("en-US", "calendarMoveModeOn"))).toBeInTheDocument();

  rerender(<Harness who="Bo" />);
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(onMoveAbsence).not.toHaveBeenCalled();
});

it("clears a leftover band mode when a grid gesture arms, whatever its value", () => {
  // ★ The mirror must be UNCONDITIONAL. A chip removed without firing blur (the
  // band's own comment concedes that happens) leaves bandMoveMode stuck on
  // "armed"; narrowing the mirror to only clear "cancelled" then lets the
  // ternary fall through after a SUCCESSFUL absence move and announce "Move
  // meeting…" about it. Driving only the cancelled path cannot tell the two
  // shapes apart, which is why this drives the armed one.
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
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
      calendarEvents={events}
      onEditEvent={() => {}}
      onMoveOccurrence={() => {}}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      onMoveAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-29"
    />,
  );
  const grid = screen.getByRole("grid");
  const chip = container.querySelector<HTMLElement>("[data-band-cell]")!;
  const dayCell = container.querySelector<HTMLElement>("[data-cell]")!;

  // Band left ARMED (not cancelled), then a grid gesture arms and commits.
  chip.focus();
  fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
  expect(screen.getByText(t("en-US", "calendarMeetingMoveModeOn"))).toBeInTheDocument();

  dayCell.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  fireEvent.keyDown(grid, { key: "Enter" });
  // After a successful absence move the region must not describe a meeting.
  expect(screen.queryByText(t("en-US", "calendarMeetingMoveModeOn"))).toBeNull();
});

it("keeps an armed grid gesture alive while focus stays on day cells", () => {
  // The blur guard must not fire for movement WITHIN the day-cell matrix, or
  // the gesture would die the moment the user did anything.
  const onMoveAbsence = vi.fn();
  const { container } = render(
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
      endDate="2026-07-29"
    />,
  );
  const grid = screen.getByRole("grid");
  const cells = container.querySelectorAll<HTMLElement>("[data-cell]");
  cells[0].focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  fireEvent.blur(grid, { relatedTarget: cells[1] });
  expect(screen.getByText(t("en-US", "calendarMoveModeOn"))).toBeInTheDocument();
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
  expectRowUniqueNames({ minRows: 5 });
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
  // The band runs its own roving group, so all 3 chips contribute exactly ONE
  // tab stop — the whole point of band-roving.ts. Same `.tabIndex` IDL check
  // as above, and for the same reason: an attribute-only query cannot tell a
  // roving `tabindex="-1"` chip from a natively-tabbable one.
  const chipTabStops = chips.filter((c) => (c as HTMLElement).tabIndex === 0);
  expect(chipTabStops).toHaveLength(1);

  // Full inventory of everything genuinely reachable by Tab in this table:
  // the one roving day cell, both row-header edit buttons, and the one roving
  // chip. Row headers are DELIBERATELY outside both roving sets (they were
  // tab stops long before the band existed). This pins the real count so a
  // future regression — the band silently reverting to one stop per chip, or
  // an extra stop sneaking in (e.g. a mis-wired ariaLabel'd grip) — shows up
  // as a count change here, which an attribute-only query could never catch.
  const allFocusable = Array.from(table.querySelectorAll<HTMLElement>("button, [tabindex]"))
    .filter((el) => el.tabIndex >= 0);
  expect(allFocusable).toHaveLength(4); // 1 day cell + 2 row headers + 1 roving chip
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
