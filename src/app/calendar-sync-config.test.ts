import { describe, it, expect } from "vitest";
import { calendarSyncFor } from "./calendar-sync-config";
import { sanitizeOutlookCalendar, type Settings } from "./settings-types";

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
});
