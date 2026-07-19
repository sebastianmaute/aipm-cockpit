// src/app/settings-overrides.test.ts
// Unit tests for sanitizeSettingsOverrides / hasAnyOverride — the per-project
// policy-override validator. Every sub-key is a PARTIAL of the matching global
// config: only valid, provided fields survive; junk is dropped; the function
// never throws.

import { describe, it, expect } from "vitest";
import { sanitizeSettingsOverrides, hasAnyOverride } from "./settings-overrides";

describe("sanitizeSettingsOverrides — object guard", () => {
  it("returns {} for non-object / garbage input", () => {
    for (const junk of [null, undefined, 42, "str", true, [1, 2, 3]]) {
      expect(sanitizeSettingsOverrides(junk)).toEqual({});
    }
  });

  it("returns {} when no sub-key holds a valid field", () => {
    expect(sanitizeSettingsOverrides({ nextActions: {}, notifications: {}, timezone: {} })).toEqual({});
    expect(sanitizeSettingsOverrides({ bogus: 1 })).toEqual({});
  });

  it("NEVER throws on hostile / malformed shapes", () => {
    const shapes: unknown[] = [
      { nextActions: 5 },
      { notifications: "x" },
      { timezone: [] },
      { nextActions: null, notifications: 0, timezone: false },
      { timezone: { additionalTimezones: "not-an-array" } },
      { nextActions: { scopePendingRed: {} } },
      Symbol("x"),
      () => 1,
    ];
    for (const s of shapes) {
      expect(() => sanitizeSettingsOverrides(s)).not.toThrow();
    }
  });
});

describe("sanitizeSettingsOverrides — nextActions", () => {
  it("coerces an out-of-bounds weight via NEXT_ACTIONS_FIELD_COERCE", () => {
    // scheduleSpiWarn is a ratio (0 < v <= 2); 9 is out of bounds -> default 0.9.
    const out = sanitizeSettingsOverrides({ nextActions: { scheduleSpiWarn: 9, scopePendingRed: 8 } });
    expect(out.nextActions).toEqual({ scheduleSpiWarn: 0.9, scopePendingRed: 8 });
  });

  it("keeps ONLY provided keys and drops unknown keys", () => {
    const out = sanitizeSettingsOverrides({ nextActions: { scopePendingRed: 12, bogusKey: 1 } });
    expect(out.nextActions).toEqual({ scopePendingRed: 12 });
    expect(Object.keys(out.nextActions ?? {})).toEqual(["scopePendingRed"]);
  });

  it("drops the nextActions sub-key entirely when it holds no valid field", () => {
    expect(sanitizeSettingsOverrides({ nextActions: { bogusKey: 1 } }).nextActions).toBeUndefined();
  });
});

describe("sanitizeSettingsOverrides — notifications", () => {
  it("keeps only valid provided scalar fields", () => {
    const out = sanitizeSettingsOverrides({ notifications: { dueSoonWorkdays: 5 } });
    expect(out.notifications).toEqual({ dueSoonWorkdays: 5 });
  });

  it("keeps a valid channel override", () => {
    const out = sanitizeSettingsOverrides({ notifications: { birthday: { enabled: false, leadDays: 10 } } });
    expect(out.notifications).toEqual({ birthday: { enabled: false, leadDays: 10 } });
  });

  it("drops an invalid scalar field", () => {
    expect(sanitizeSettingsOverrides({ notifications: { dueSoonWorkdays: -3 } }).notifications).toBeUndefined();
  });
});

describe("sanitizeSettingsOverrides — timezone", () => {
  it("drops an invalid timezone string", () => {
    expect(sanitizeSettingsOverrides({ timezone: { timezone: "Not/AZone" } }).timezone).toBeUndefined();
  });

  it("keeps a valid timezone and dedupes/validates additionalTimezones", () => {
    const out = sanitizeSettingsOverrides({
      timezone: {
        timezone: "Europe/Berlin",
        additionalTimezones: ["UTC", "UTC", "Bad/Zone", "America/New_York"],
      },
    });
    expect(out.timezone).toEqual({
      timezone: "Europe/Berlin",
      additionalTimezones: ["UTC", "America/New_York"],
    });
  });
});

describe("sanitizeSettingsOverrides — a fully valid partial survives", () => {
  it("round-trips a mixed override", () => {
    const out = sanitizeSettingsOverrides({
      nextActions: { staticPenalty: 30 },
      notifications: { raidReviewIntervalDays: 21 },
      timezone: { timezone: "Asia/Tokyo" },
    });
    expect(out).toEqual({
      nextActions: { staticPenalty: 30 },
      notifications: { raidReviewIntervalDays: 21 },
      timezone: { timezone: "Asia/Tokyo" },
    });
  });
});

describe("hasAnyOverride", () => {
  it("is false for undefined / empty", () => {
    expect(hasAnyOverride(undefined)).toBe(false);
    expect(hasAnyOverride({})).toBe(false);
  });

  it("is true when any sub-key is present", () => {
    expect(hasAnyOverride({ nextActions: { scopePendingRed: 5 } })).toBe(true);
    expect(hasAnyOverride({ timezone: { timezone: "UTC" } })).toBe(true);
  });
});
