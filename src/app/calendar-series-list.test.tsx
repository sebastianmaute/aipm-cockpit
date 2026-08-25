import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CalendarSeriesList } from "./calendar-series-list";
import type { CalendarEvent } from "./calendar-event";
import { expectRowUniqueNames } from "../test/row-unique-names";

const today = "2026-08-01";

function makeEvent(id: number, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    title: `Series ${id}`,
    startDate: "2026-01-05",
    startTime: "09:00",
    durationMinutes: 30,
    ...overrides,
  };
}

describe("CalendarSeriesList", () => {
  it("lists every series regardless of its occurrence dates, including ones the visible calendar window would never show", () => {
    const events = [
      makeEvent(1, { title: "Far in the past", startDate: "2020-01-01" }),
      makeEvent(2, { title: "Far in the future", startDate: "2040-01-01" }),
      makeEvent(3, { title: "Weekly grind", recurrence: { freq: "weekly", interval: 1 } }),
    ];
    render(<CalendarSeriesList lang="en-US" events={events} today={today} onEdit={() => {}} />);
    expect(screen.getByText("Far in the past")).toBeInTheDocument();
    expect(screen.getByText("Far in the future")).toBeInTheDocument();
    expect(screen.getByText("Weekly grind")).toBeInTheDocument();
  });

  it("shows the next occurrence, and the 'no further occurrences' fallback for a series with none in the future", () => {
    const events = [
      makeEvent(1, { title: "One-off, already past", startDate: "2020-01-01" }),
      makeEvent(2, { title: "Weekly from July", startDate: "2026-07-27", recurrence: { freq: "weekly", interval: 1 } }),
    ];
    render(<CalendarSeriesList lang="en-US" events={events} today={today} onEdit={() => {}} />);
    // 2026-07-27 is a Monday; weekly (no byDay) steps 7 days, so the first
    // occurrence at-or-after "today" (2026-08-01) is 2026-08-03.
    expect(screen.getByText("2026-08-03 09:00")).toBeInTheDocument();
    expect(screen.getByText(/no further occurrences/i)).toBeInTheDocument();
  });

  it("shows a distinct 'unknown' fallback (not the plain no-further-occurrences text) when the search is genuinely truncated", () => {
    // Unlike export-sections.ts's firstOccurrenceLabel (windowStart always
    // equals the event's own startDate, so truncation there is provably
    // unreachable — see that file's comment), THIS caller passes `today`,
    // independent of the event's own startDate: a daily series begun in
    // 1900, viewed on 2026-08-01, genuinely exhausts expandOccurrences'
    // iteration cap before the walk ever reaches "today".
    const events = [
      makeEvent(1, { title: "Ancient standup", startDate: "1900-01-01", recurrence: { freq: "daily", interval: 1 } }),
    ];
    render(<CalendarSeriesList lang="en-US" events={events} today={today} onEdit={() => {}} />);
    expect(screen.queryByText(/no further occurrences/i)).not.toBeInTheDocument();
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
  });

  it("calls the edit handler with the right series when its edit button is clicked", () => {
    const events = [makeEvent(1, { title: "Alpha" }), makeEvent(2, { title: "Beta" })];
    const onEdit = vi.fn();
    render(<CalendarSeriesList lang="en-US" events={events} today={today} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: /edit.*beta/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(events[1]);
  });

  it("renders the empty state, not a table, when there are no series", () => {
    render(<CalendarSeriesList lang="en-US" events={[]} today={today} onEdit={() => {}} />);
    expect(screen.getByText(/no meetings yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("gives each row's edit button a row-unique accessible name", () => {
    const events = [makeEvent(1, { title: "Standup" }), makeEvent(2, { title: "Retro" })];
    render(<CalendarSeriesList lang="en-US" events={events} today={today} onEdit={() => {}} />);
    const buttons = screen.getAllByRole("button", { name: /edit/i });
    expect(buttons).toHaveLength(2);
    const names = buttons.map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toContain("Standup");
    expect(names[1]).toContain("Retro");
    expectRowUniqueNames({ minRows: 4 });
  });

  it("renders no edit affordance when onEdit is omitted (read-only mirror)", () => {
    render(<CalendarSeriesList lang="en-US" events={[makeEvent(1)]} today={today} />);
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  describe("sorting", () => {
    /** Titles in rendered row order — the only thing a sort can be observed by. */
    function renderedTitles(): string[] {
      return screen
        .getAllByRole("row")
        .slice(1) // drop the header row
        .map((r) => r.querySelector("td")?.textContent ?? "");
    }

    it("leaves rows in workspace order until a header is clicked", () => {
      const events = [makeEvent(1, { title: "Charlie" }), makeEvent(2, { title: "Alpha" })];
      render(<CalendarSeriesList lang="en-US" events={events} today={today} />);
      expect(renderedTitles()).toEqual(["Charlie", "Alpha"]);
    });

    it("cycles Title asc -> desc -> back to workspace order on repeated clicks", () => {
      const events = [
        makeEvent(1, { title: "Charlie" }),
        makeEvent(2, { title: "Alpha" }),
        makeEvent(3, { title: "Bravo" }),
      ];
      render(<CalendarSeriesList lang="en-US" events={events} today={today} />);
      const header = screen.getByRole("button", { name: /^title/i });

      fireEvent.click(header);
      expect(renderedTitles()).toEqual(["Alpha", "Bravo", "Charlie"]);

      fireEvent.click(header);
      expect(renderedTitles()).toEqual(["Charlie", "Bravo", "Alpha"]);

      // "off" is a real third state, not a no-op: the original order carries
      // information (it is the workspace's own) and must be recoverable.
      fireEvent.click(header);
      expect(renderedTitles()).toEqual(["Charlie", "Alpha", "Bravo"]);
    });

    it("sorts Next by the occurrence date, not by its rendered label", () => {
      // Label-order and date-order disagree here only if something sorts the
      // formatted string of a DIFFERENT column; the real point of this test is
      // that the comparable value is the resolved date, so a series whose next
      // occurrence is later sorts later regardless of title or list position.
      const events = [
        makeEvent(1, { title: "Later", startDate: "2026-09-15" }),
        makeEvent(2, { title: "Sooner", startDate: "2026-08-05" }),
      ];
      render(<CalendarSeriesList lang="en-US" events={events} today={today} />);
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
      expect(renderedTitles()).toEqual(["Sooner", "Later"]);
    });

    it("keeps series with no resolvable next occurrence last in BOTH sort directions", () => {
      // The sentinel trap: any placeholder value that sinks a row ascending
      // floats it descending. A series with nothing coming up is UNKNOWN for
      // this column, not "very early" or "very late", so it is held out of the
      // comparison and appended — the same rule useSortableFilter's `isUnknown`
      // encodes for the report tables.
      const events = [
        makeEvent(1, { title: "Nothing left", startDate: "2020-01-01" }),
        makeEvent(2, { title: "Later", startDate: "2026-09-15" }),
        makeEvent(3, { title: "Sooner", startDate: "2026-08-05" }),
      ];
      render(<CalendarSeriesList lang="en-US" events={events} today={today} />);
      const header = screen.getByRole("button", { name: /next/i });

      fireEvent.click(header);
      expect(renderedTitles()).toEqual(["Sooner", "Later", "Nothing left"]);

      fireEvent.click(header);
      expect(renderedTitles()).toEqual(["Later", "Sooner", "Nothing left"]);
    });

    it("offers no sort affordance on columns that cannot sort meaningfully", () => {
      const events = [makeEvent(1, { title: "Standup" })];
      render(<CalendarSeriesList lang="en-US" events={events} today={today} onEdit={() => {}} />);
      // Exactly two sortable columns, and WHICH two — a bare count of 2 would
      // pass just as happily if Recurs became sortable and Next stopped being.
      const headerRow = screen.getAllByRole("row")[0];
      const sortButtons = Array.from(headerRow.querySelectorAll("button"));
      expect(sortButtons.map((b) => b.textContent?.replace(/[↑↓]/g, "").trim()))
        .toEqual(["Title", "Next occurrence"]);
    });

    it("renders no column-resize grip, since this list stores no widths", () => {
      // The point of passing SortResizeTh no `onResize`. A grip cannot be
      // caught by counting buttons: ColumnResizeHandle renders DragHandle in
      // its decorative mode — an aria-hidden <div> with no role — so a
      // button-count assertion is structurally blind to one reappearing.
      //
      // ★ Nor can it be caught by counting aria-hidden nodes, which is what
      // this asserted first: the header legitimately contains other decorative
      // markup (the sort arrow is aria-hidden now that the <th>'s aria-sort
      // carries that state), so the count was only ever incidentally zero.
      // Target the grip's own `cursor-col-resize` — the class that makes it
      // LOOK draggable, i.e. the false affordance this test exists to prevent.
      const events = [makeEvent(1, { title: "Standup" })];
      render(<CalendarSeriesList lang="en-US" events={events} today={today} onEdit={() => {}} />);
      const headerRow = screen.getAllByRole("row")[0];
      expect(headerRow.querySelectorAll(".cursor-col-resize")).toHaveLength(0);
    });

    it("marks the active column with a direction indicator", () => {
      const events = [makeEvent(1, { title: "Standup" }), makeEvent(2, { title: "Retro" })];
      render(<CalendarSeriesList lang="en-US" events={events} today={today} />);
      const header = screen.getByRole("button", { name: /^title/i });
      expect(header.textContent).not.toMatch(/[↑↓]/);
      fireEvent.click(header);
      expect(header.textContent).toMatch(/↑/);
      fireEvent.click(header);
      expect(header.textContent).toMatch(/↓/);
    });
  });
});
