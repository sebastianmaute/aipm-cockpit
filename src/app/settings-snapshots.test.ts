import { describe, expect, it } from "vitest";
import { defaultSnapshotSettings, resolveSnapshotSettings } from "./settings-types";

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
