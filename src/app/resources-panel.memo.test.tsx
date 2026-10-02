import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { ResourcesPanel } from "./resources-panel";
import { defaultSettings } from "./settings-types";
import type { CalendarEvent } from "./calendar-event";
import type { Task } from "./types";

// §1 — ResourceCalendar is memo()'d. It can only bail if a ResourcesPanel re-render that
// changes nothing the calendar reads hands it shallow-equal props. Mocked so every prop
// set it receives is captured; the real memo compares exactly what is compared here. The
// re-render changes `overAllocatedPct`, which only the workload view reads.
const calendarMock = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./resource-calendar", () => ({
  ResourceCalendar: (p: Record<string, unknown>) => {
    calendarMock.props.push(p);
    return null;
  },
}));
vi.mock("./use-settings", () => ({
  useSettings: () => ({ settings: defaultSettings, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" as const }),
}));

const noop = () => {};
const base = {
  lang: "en-US" as const,
  view: "calendar" as const,
  tasks: [] as Task[],
  absences: [] as never[],
  shifts: [] as never[],
  raid: [] as never[],
  raidEnabled: true,
  resources: [],
  today: "2026-05-23",
  holidaySet: new Set<string>(),
  onAddAbsence: noop,
  onEditAbsence: noop,
  onMoveAbsence: noop,
  onEditShift: noop,
  onEditCalendarEvent: noop,
  onSaveCalendarEvent: noop,
  roles: [] as never[],
  disciplines: [] as never[],
  grades: [] as never[],
  setResources: noop,
  plan: { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" as const },
  workdayHours: 8,
  onSetUtilization: noop,
  overAllocatedPct: 100,
  onReassignTask: noop,
  onRescheduleTask: noop,
  onSetAllUtilizationMode: noop,
  onSetAbsenceOverride: noop,
  onSetPlanWindow: noop,
  onEditResource: noop,
  onAddResource: noop,
};

function expectShallowEqual(before: Record<string, unknown>, after: Record<string, unknown>) {
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  for (const k of Object.keys(after)) expect(after[k], k).toBe(before[k]);
}

describe("§1 — ResourceCalendar's props survive an unrelated ResourcesPanel re-render", () => {
  test("with calendar events: onMoveOccurrence keeps its identity", () => {
    calendarMock.props.length = 0;
    const events: CalendarEvent[] = [];
    const { rerender } = render(<ResourcesPanel {...base} calendarEvents={events} />);
    const before = calendarMock.props.at(-1)!;
    expect(typeof before.onMoveOccurrence).toBe("function"); // anti-vacuity: the drag is armed
    rerender(<ResourcesPanel {...base} calendarEvents={events} overAllocatedPct={80} />);
    expect(calendarMock.props.length).toBeGreaterThan(1); // the panel did re-render
    expectShallowEqual(before, calendarMock.props.at(-1)!);
  });

  test("with calendarEvents omitted: the default list keeps its identity", () => {
    calendarMock.props.length = 0;
    const { rerender } = render(<ResourcesPanel {...base} />);
    const before = calendarMock.props.at(-1)!;
    rerender(<ResourcesPanel {...base} overAllocatedPct={80} />);
    expectShallowEqual(before, calendarMock.props.at(-1)!);
  });
});
