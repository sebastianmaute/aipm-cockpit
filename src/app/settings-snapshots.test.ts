import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_TOKEN_CAP,
  DEFAULT_WEEKLY_TOKEN_CAP,
  defaultSnapshotSettings,
  resolveSnapshotSettings,
  sanitizeAiConfig,
} from "./settings-types";

describe("snapshot settings", () => {
  it("defaults to enabled + weekly", () => {
    expect(defaultSnapshotSettings).toEqual({ enabled: true, cadence: "weekly" });
  });
  it("resolves undefined to the default (fresh copy)", () => {
    const a = resolveSnapshotSettings(undefined);
    expect(a).toEqual({ enabled: true, cadence: "weekly" });
    expect(a).not.toBe(defaultSnapshotSettings);
  });
  it("preserves a valid cadence and enabled flag", () => {
    expect(resolveSnapshotSettings({ enabled: false, cadence: "daily" })).toEqual({ enabled: false, cadence: "daily" });
  });
  it("falls back to weekly for an invalid cadence and true for a non-boolean enabled", () => {
    expect(resolveSnapshotSettings({ enabled: "yes", cadence: "yearly" })).toEqual({ enabled: true, cadence: "weekly" });
  });
});

describe("sanitizeAiConfig", () => {
  it("fills sessionTokenCap and weeklyTokenCap with defaults when missing", () => {
    const result = sanitizeAiConfig({});
    expect(result.sessionTokenCap).toBe(DEFAULT_SESSION_TOKEN_CAP);
    expect(result.weeklyTokenCap).toBe(DEFAULT_WEEKLY_TOKEN_CAP);
  });

  it("preserves a valid positive sessionTokenCap", () => {
    const result = sanitizeAiConfig({ sessionTokenCap: 50_000 });
    expect(result.sessionTokenCap).toBe(50_000);
  });

  it("preserves a valid positive weeklyTokenCap", () => {
    const result = sanitizeAiConfig({ weeklyTokenCap: 500_000 });
    expect(result.weeklyTokenCap).toBe(500_000);
  });

  it("replaces a zero sessionTokenCap with the default", () => {
    const result = sanitizeAiConfig({ sessionTokenCap: 0 });
    expect(result.sessionTokenCap).toBe(DEFAULT_SESSION_TOKEN_CAP);
  });

  it("replaces a negative weeklyTokenCap with the default", () => {
    const result = sanitizeAiConfig({ weeklyTokenCap: -1 });
    expect(result.weeklyTokenCap).toBe(DEFAULT_WEEKLY_TOKEN_CAP);
  });

  it("replaces a string sessionTokenCap with the default", () => {
    const result = sanitizeAiConfig({ sessionTokenCap: "bogus" });
    expect(result.sessionTokenCap).toBe(DEFAULT_SESSION_TOKEN_CAP);
  });

  it("replaces NaN weeklyTokenCap with the default", () => {
    const result = sanitizeAiConfig({ weeklyTokenCap: NaN });
    expect(result.weeklyTokenCap).toBe(DEFAULT_WEEKLY_TOKEN_CAP);
  });

  it("handles null/undefined input and fills all defaults", () => {
    expect(sanitizeAiConfig(null).sessionTokenCap).toBe(DEFAULT_SESSION_TOKEN_CAP);
    expect(sanitizeAiConfig(undefined).weeklyTokenCap).toBe(DEFAULT_WEEKLY_TOKEN_CAP);
  });

  it("defaults constants have expected values", () => {
    expect(DEFAULT_SESSION_TOKEN_CAP).toBe(200_000);
    expect(DEFAULT_WEEKLY_TOKEN_CAP).toBe(2_000_000);
  });
});
