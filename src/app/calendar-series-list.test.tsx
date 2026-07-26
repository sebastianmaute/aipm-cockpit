import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CalendarSeriesList } from "./calendar-series-list";
import type { CalendarEvent } from "./calendar-event";

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
  });

  it("renders no edit affordance when onEdit is omitted (read-only mirror)", () => {
    render(<CalendarSeriesList lang="en-US" events={[makeEvent(1)]} today={today} />);
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });
});
