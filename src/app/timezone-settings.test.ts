import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultSettings } from "./settings-types";
import { useSettings, writeSettings } from "./use-settings";

beforeEach(() => {
  localStorage.clear();
});

describe("Settings.timezone + additionalTimezones", () => {
  it("timezone defaults to undefined (follow project/browser)", () => {
    expect(defaultSettings.timezone).toBeUndefined();
  });

  it("additionalTimezones defaults to undefined", () => {
    expect(defaultSettings.additionalTimezones).toBeUndefined();
  });

  it("timezone + additionalTimezones round-trip through writeSettings -> load", async () => {
    writeSettings({
      ...defaultSettings,
      timezone: "Asia/Kolkata",
      additionalTimezones: ["America/New_York"],
    });
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.timezone).toBe("Asia/Kolkata");
    expect(result.current.settings.additionalTimezones).toEqual(["America/New_York"]);
  });
});
