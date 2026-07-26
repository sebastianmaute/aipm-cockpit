import { describe, expect, it, vi } from "vitest";
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

describe("useCalendarEvents — activity log + undo", () => {
  function renderWithSpies() {
    const logActivity = vi.fn();
    const logActivityChanges = vi.fn();
    const capture = vi.fn();
    const captureFieldEdit = vi.fn();
    const { result } = renderHook(
      () => useCalendarEvents({ today: "2026-06-20", logActivity, logActivityChanges, capture, captureFieldEdit }),
      { wrapper: Wrapper },
    );
    return { result, logActivity, logActivityChanges, capture, captureFieldEdit };
  }

  it("logs calendarEvent.created on a create", () => {
    const { result, logActivity } = renderWithSpies();
    act(() => { result.current.handleSaveCalendarEvent({ ...base, id: 5, title: "Kickoff" }, true); });
    expect(logActivity).toHaveBeenCalledWith("calendarEvent.created", 5, "Kickoff");
  });

  it("logs calendarEvent.updated with a field diff on an update", () => {
    const { result, logActivityChanges } = renderWithSpies();
    act(() => { result.current.handleSaveCalendarEvent(base, true); });
    act(() => { result.current.handleSaveCalendarEvent({ ...base, title: "Renamed" }, false); });
    expect(logActivityChanges).toHaveBeenCalledWith(
      "calendarEvent.updated",
      expect.arrayContaining([{ field: "title", from: "Standup", to: "Renamed" }]),
      base.id,
      "Renamed",
    );
  });

  it("falls back to logActivity for an update when only logActivity is wired", () => {
    const logActivity = vi.fn();
    const { result } = renderHook(
      () => useCalendarEvents({ today: "2026-06-20", logActivity }),
      { wrapper: Wrapper },
    );
    act(() => { result.current.handleSaveCalendarEvent(base, true); });
    act(() => { result.current.handleSaveCalendarEvent({ ...base, title: "Renamed" }, false); });
    expect(logActivity).toHaveBeenCalledWith("calendarEvent.updated", base.id, "Renamed");
  });

  it("captures a per-field undo entry on an update", () => {
    const { result, captureFieldEdit } = renderWithSpies();
    act(() => { result.current.handleSaveCalendarEvent(base, true); });
    captureFieldEdit.mockClear();
    act(() => { result.current.handleSaveCalendarEvent({ ...base, title: "Renamed" }, false); });
    expect(captureFieldEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "calendarEvent.updated",
        id: base.id,
        before: { title: "Standup" },
        after: { title: "Renamed" },
      }),
    );
  });

  // ★ The item's actual point: de-recurring silently discards every skip and
  // move. The capture must carry them so undo can put them back in ONE step.
  it("captures recurrence AND exceptions together when a series is de-recurred", () => {
    const { result, captureFieldEdit } = renderWithSpies();
    const series: CalendarEvent = {
      ...base,
      recurrence: { freq: "daily", interval: 1 },
      exceptions: [{ date: "2026-06-03", kind: "skip" }, { date: "2026-06-05", kind: "move", toDate: "2026-06-06" }],
    };
    act(() => { result.current.handleSaveCalendarEvent(series, true); });
    captureFieldEdit.mockClear();
    act(() => {
      result.current.handleSaveCalendarEvent({ ...series, recurrence: undefined, exceptions: undefined }, false);
    });
    expect(captureFieldEdit).toHaveBeenCalledTimes(1);
    const arg = captureFieldEdit.mock.calls[0][0];
    expect(arg.before.exceptions).toHaveLength(2);
    expect(arg.before.recurrence).toEqual({ freq: "daily", interval: 1 });
    expect(arg.after.recurrence).toBeUndefined();
    expect(arg.after.exceptions).toBeUndefined();
  });

  it("captures the doomed row and logs on a delete", () => {
    const { result, capture, logActivity } = renderWithSpies();
    act(() => { result.current.handleSaveCalendarEvent(base, true); });
    act(() => { result.current.handleDeleteCalendarEvent(base.id); });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "calendarEvent.deleted",
        removed: [expect.objectContaining({ id: base.id, title: "Standup" })],
        name: "Standup",
      }),
    );
    expect(logActivity).toHaveBeenCalledWith("calendarEvent.deleted", base.id, "Standup");
  });

  it("does not log or capture a delete for an id that isn't there", () => {
    const { result, capture, logActivity } = renderWithSpies();
    act(() => { result.current.handleDeleteCalendarEvent(999); });
    expect(capture).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  // The `setter` handed to the undo stack is an ADAPTER, not the raw workspace
  // setter: the stack's type is non-optional (`readonly T[]`) while the slice is
  // `readonly CalendarEvent[] | undefined`. Every other test here only proves it
  // was PASSED; this one invokes it and checks a restore actually lands.
  //
  // ★ What this does NOT cover: the adapter's `prev ?? []` normalisation. Reaching
  // it needs the slice to be `undefined` at invoke time, and it cannot be — `capture`
  // only fires for a row that already exists, which means the list is populated, and
  // a delete leaves `[]` rather than `undefined`. So the `?? []` is pure defence
  // against a future caller, unreachable through this hook's own API, and asserting
  // "the updater saw an array" here would pass identically without it. Don't mistake
  // this test for coverage of that branch.
  it("hands the undo stack a working setter that a restore can write through", () => {
    const { result, capture } = renderWithSpies();
    act(() => { result.current.handleSaveCalendarEvent(base, true); });
    act(() => { result.current.handleDeleteCalendarEvent(base.id); });

    const setter = capture.mock.calls[0][0].setter as (
      action: (prev: readonly CalendarEvent[]) => readonly CalendarEvent[],
    ) => void;
    const seen: unknown[] = [];
    act(() => {
      setter((prev) => {
        seen.push(prev);
        return [base];
      });
    });

    expect(seen).toHaveLength(1);
    expect(Array.isArray(seen[0])).toBe(true);
    // And the restore actually landed, so the adapter forwards as well as guards.
    expect(result.current.calendarEvents).toEqual([base]);
  });
});
