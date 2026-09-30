import { describe, it, expect } from "vitest";
import { calendarSyncFor, withCalendarEnabled } from "./calendar-sync-config";
import { CALENDAR_ENTITY_TYPES, sanitizeOutlookCalendar, type Settings } from "./settings-types";

it("defaults to disabled when unset", () => {
  expect(calendarSyncFor({} as Settings, "task")).toEqual({ enabled: false, auto: false });
});
it("reads a configured entry", () => {
  const s = { outlookCalendar: { task: { enabled: true, auto: true } } } as unknown as Settings;
  expect(calendarSyncFor(s, "task")).toEqual({ enabled: true, auto: true });
});
it("auto is false when the entry is enabled:false even if auto:true", () => {
  const s = { outlookCalendar: { task: { enabled: false, auto: true } } } as unknown as Settings;
  expect(calendarSyncFor(s, "task")).toEqual({ enabled: false, auto: false });
});

describe("sanitizeOutlookCalendar", () => {
  it("returns undefined when absent or non-object", () => {
    expect(sanitizeOutlookCalendar(undefined)).toBeUndefined();
    expect(sanitizeOutlookCalendar("nope")).toBeUndefined();
    expect(sanitizeOutlookCalendar({})).toBeUndefined();
  });
  it("drops unknown keys and coerces flags to booleans", () => {
    const out = sanitizeOutlookCalendar({
      task: { enabled: 1, auto: "yes" },
      bogus: { enabled: true, auto: true },
    });
    expect(out).toEqual({ task: { enabled: false, auto: false } });
  });
  it("keeps configured known entries", () => {
    expect(
      sanitizeOutlookCalendar({ raid: { enabled: true, auto: true } }),
    ).toEqual({ raid: { enabled: true, auto: true } });
  });

  // ★★★ A stored {enabled:false, auto:true} must not survive the load. Four
  //     toolbar enable-toggles read the RAW stored `auto` when switching a row on
  //     (`tasks-section.tsx`, plus raid/change/absence in
  //     `use-calendar-integrations.ts`) — NOT the masked value the UI renders. So
  //     without this mask, one click on "Add to Outlook" would arm unattended
  //     two-way sync. No in-app writer produces that combination today; an
  //     imported or hand-edited settings blob can.
  it("masks a stale auto flag on a disabled entry, so no writer can resurrect it", () => {
    expect(
      sanitizeOutlookCalendar({ task: { enabled: false, auto: true } }),
    ).toEqual({ task: { enabled: false, auto: false } });
  });

  it("leaves auto alone on an enabled entry", () => {
    expect(
      sanitizeOutlookCalendar({ task: { enabled: true, auto: true } }),
    ).toEqual({ task: { enabled: true, auto: true } });
  });
});

// open-followups §57. Every other fixture stubs `auto: false`, so these are the
// only tests that can see the `enabled ? … : false` guard.
describe("withCalendarEnabled (toolbar enable-toggle writer)", () => {
  const armed = (): Settings =>
    ({
      outlookCalendar: Object.fromEntries(CALENDAR_ENTITY_TYPES.map((t) => [t, { enabled: true, auto: true }])),
    }) as unknown as Settings;

  it.each(CALENDAR_ENTITY_TYPES)("switching %s OFF also clears a stored auto:true", (type) => {
    const next = withCalendarEnabled(armed(), type, false);
    expect(next.outlookCalendar?.[type]).toEqual({ enabled: false, auto: false });
  });

  it.each(CALENDAR_ENTITY_TYPES)("switching %s ON keeps the stored auto", (type) => {
    const s = { outlookCalendar: { [type]: { enabled: false, auto: true } } } as unknown as Settings;
    expect(withCalendarEnabled(s, type, true).outlookCalendar?.[type]).toEqual({ enabled: true, auto: true });
    expect(withCalendarEnabled({} as Settings, type, true).outlookCalendar?.[type]).toEqual({ enabled: true, auto: false });
  });

  it("touches only the named type and does not mutate its input", () => {
    const s = armed();
    const next = withCalendarEnabled(s, "raid", false);
    expect(next.outlookCalendar?.task).toEqual({ enabled: true, auto: true });
    expect(s.outlookCalendar?.raid).toEqual({ enabled: true, auto: true });
  });
});
