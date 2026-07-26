import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { useCalendarEvents } from "./use-calendar-events";
import type { CalendarEvent } from "./calendar-event";

// Mirrors use-stakeholders.test.tsx's wrapper — the real WorkspaceProvider,
// not a mock, so a save/delete round-trips through the actual context state
// (same pattern use-resource-planner.test.tsx already used for these exact
// calendar-event behaviors before the extraction).
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const base: CalendarEvent = {
  id: 1, title: "Standup", startDate: "2026-06-01", startTime: "09:00", durationMinutes: 15,
};

function renderCalendarEvents() {
  return renderHook(() => useCalendarEvents({ today: "2026-06-20" }), { wrapper: Wrapper });
}

describe("useCalendarEvents", () => {
  it("editingCalendarEvent starts null", () => {
    const { result } = renderCalendarEvents();
    expect(result.current.editingCalendarEvent).toBeNull();
  });

  it("handleOpenAddCalendarEvent opens the modal as isNew with a fresh id", () => {
    const { result } = renderCalendarEvents();
    act(() => { result.current.handleSaveCalendarEvent({ ...base, id: 7 }, true); });
    act(() => { result.current.handleOpenAddCalendarEvent(); });
    expect(result.current.editingCalendarEvent!.isNew).toBe(true);
    expect(result.current.editingCalendarEvent!.event.id).toBeGreaterThan(7);
  });

  it("handleEditCalendarEvent opens the modal as isNew=false with the given event", () => {
    const { result } = renderCalendarEvents();
    act(() => { result.current.handleEditCalendarEvent(base); });
    expect(result.current.editingCalendarEvent).toEqual({ event: base, isNew: false });
  });

  it("handleCloseCalendarEventModal clears editingCalendarEvent", () => {
    const { result } = renderCalendarEvents();
    act(() => { result.current.handleOpenAddCalendarEvent(); });
    act(() => { result.current.handleCloseCalendarEventModal(); });
    expect(result.current.editingCalendarEvent).toBeNull();
  });

  it("handleSaveCalendarEvent creates, sanitizes, and closes the modal", () => {
    const { result } = renderCalendarEvents();
    act(() => { result.current.handleEditCalendarEvent(base); });
    act(() => { result.current.handleSaveCalendarEvent({ ...base, title: "  Padded  " }, true); });
    expect(result.current.calendarEvents).toHaveLength(1);
    expect(result.current.calendarEvents?.[0].title).toBe("Padded");
    expect(result.current.editingCalendarEvent).toBeNull();
  });

  it("handleSaveCalendarEvent updates an existing event in place", () => {
    const { result } = renderCalendarEvents();
    act(() => { result.current.handleSaveCalendarEvent(base, true); });
    act(() => { result.current.handleSaveCalendarEvent({ ...base, title: "Renamed" }, false); });
    expect(result.current.calendarEvents).toHaveLength(1);
    expect(result.current.calendarEvents?.[0].title).toBe("Renamed");
  });

  it("handleSaveCalendarEvent rejects an invalid save (blank title) and leaves the modal open", () => {
    const { result } = renderCalendarEvents();
    act(() => { result.current.handleEditCalendarEvent(base); });
    act(() => { result.current.handleSaveCalendarEvent({ ...base, title: "" }, true); });
    expect(result.current.calendarEvents ?? []).toHaveLength(0);
    expect(result.current.editingCalendarEvent).not.toBeNull();
  });

  // The functional-setter landmine (RAID/Changes/Stakeholders' recurring bug
  // class): a plain `setCalendarEvents([...events, x])` reading the stale
  // outer closure would let the second call in this tick clobber the first.
  it("persists both of two saves in a single tick — proves a functional setter, not a stale closure read", () => {
    const { result } = renderCalendarEvents();
    act(() => {
      result.current.handleSaveCalendarEvent({ ...base, id: 101, title: "A" }, true);
      result.current.handleSaveCalendarEvent({ ...base, id: 102, title: "B" }, true);
    });
    const titles = (result.current.calendarEvents ?? []).map((e) => e.title).sort();
    expect(titles).toEqual(["A", "B"]);
  });

  it("handleDeleteCalendarEvent removes the event by id and closes the modal", () => {
    const { result } = renderCalendarEvents();
    const other: CalendarEvent = { ...base, id: 2, title: "Other" };
    act(() => {
      result.current.handleSaveCalendarEvent(base, true);
      result.current.handleSaveCalendarEvent(other, true);
    });
    act(() => { result.current.handleEditCalendarEvent(base); });
    act(() => { result.current.handleDeleteCalendarEvent(base.id); });
    expect(result.current.calendarEvents).toEqual([other]);
    expect(result.current.editingCalendarEvent).toBeNull();
  });
});
