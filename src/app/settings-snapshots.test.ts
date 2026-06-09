import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_TOKEN_CAP,
  DEFAULT_WEEKLY_TOKEN_CAP,
  defaultExportConfig,
  defaultSnapshotSettings,
  resolveSnapshotSettings,
  sanitizeAiConfig,
  sanitizeExportConfig,
} from "./settings-types";

describe("sanitizeExportConfig", () => {
  it("defaultExportConfig has tasks and raid true, all others false", () => {
    expect(defaultExportConfig.tasks).toBe(true);
    expect(defaultExportConfig.raid).toBe(true);
    expect(defaultExportConfig.changes).toBe(false);
    expect(defaultExportConfig.milestones).toBe(false);
    expect(defaultExportConfig.stakeholders).toBe(false);
    expect(defaultExportConfig.budgets).toBe(false);
    expect(defaultExportConfig.resources).toBe(false);
    expect(defaultExportConfig.roles).toBe(false);
    expect(defaultExportConfig.absences).toBe(false);
    expect(defaultExportConfig.shifts).toBe(false);
    expect(defaultExportConfig.status).toBe(false);
  });

  it("sanitizeExportConfig(undefined) deep-equals defaultExportConfig", () => {
    expect(sanitizeExportConfig(undefined)).toEqual(defaultExportConfig);
  });

  it("sanitizeExportConfig(undefined) returns a fresh copy, not the same reference", () => {
    expect(sanitizeExportConfig(undefined)).not.toBe(defaultExportConfig);
  });

  it("partial { milestones: true } keeps defaults for all other keys", () => {
    const result = sanitizeExportConfig({ milestones: true });
    expect(result.milestones).toBe(true);
    expect(result.tasks).toBe(true);
    expect(result.raid).toBe(true);
    expect(result.changes).toBe(false);
    expect(result.stakeholders).toBe(false);
    expect(result.budgets).toBe(false);
    expect(result.resources).toBe(false);
    expect(result.roles).toBe(false);
    expect(result.absences).toBe(false);
    expect(result.shifts).toBe(false);
    expect(result.status).toBe(false);
  });

  it("non-boolean value for tasks falls back to default true", () => {
    const result = sanitizeExportConfig({ tasks: "yes" });
    expect(result.tasks).toBe(true);
  });

  it("non-boolean value for raid falls back to default true", () => {
    const result = sanitizeExportConfig({ raid: 1 });
    expect(result.raid).toBe(true);
  });

  it("non-boolean value for changes falls back to default false", () => {
    const result = sanitizeExportConfig({ changes: "yes" });
    expect(result.changes).toBe(false);
  });

  it("explicit false overrides a default-true key", () => {
    const result = sanitizeExportConfig({ tasks: false });
    expect(result.tasks).toBe(false);
  });

  it("sanitizeExportConfig(null) deep-equals defaultExportConfig", () => {
    expect(sanitizeExportConfig(null)).toEqual(defaultExportConfig);
  });
});

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
