// src/app/forecast-simulation.test.ts
// The per-project "show simulation" policy override (§502): off is ABSENCE.

import { describe, it, expect } from "vitest";
import { isSimulationOn, withSimulation } from "./forecast-simulation";
import { hasAnyOverride, sanitizeSettingsOverrides } from "./settings-overrides";
import type { SettingsOverrides } from "./settings-types";

describe("isSimulationOn", () => {
  it("is false when there is no override or no forecast key", () => {
    expect(isSimulationOn(undefined)).toBe(false);
    expect(isSimulationOn({})).toBe(false);
  });

  it("is true only for an explicit true", () => {
    expect(isSimulationOn({ forecast: { showSimulation: true } })).toBe(true);
    expect(isSimulationOn({ forecast: { showSimulation: false } })).toBe(false);
    expect(isSimulationOn({ forecast: {} })).toBe(false);
  });
});

describe("withSimulation", () => {
  it("turns the switch on from nothing", () => {
    expect(withSimulation(undefined, true)).toEqual({ forecast: { showSimulation: true } });
  });

  it("turning it off deletes the key and folds an empty override to undefined", () => {
    expect(withSimulation({ forecast: { showSimulation: true } }, false)).toBeUndefined();
  });

  it("turning it off keeps other override keys", () => {
    const o: SettingsOverrides = {
      timezone: { timezone: "Europe/Berlin" },
      forecast: { showSimulation: true },
    };
    expect(withSimulation(o, false)).toEqual({ timezone: { timezone: "Europe/Berlin" } });
  });

  it("turning it on keeps other override keys and does not mutate the input", () => {
    const o: SettingsOverrides = { timezone: { timezone: "Europe/Berlin" } };
    expect(withSimulation(o, true)).toEqual({
      timezone: { timezone: "Europe/Berlin" },
      forecast: { showSimulation: true },
    });
    expect(o).toEqual({ timezone: { timezone: "Europe/Berlin" } });
  });

  it("turning off an already-off override is a no-op", () => {
    expect(withSimulation(undefined, false)).toBeUndefined();
  });
});

describe("sanitizeSettingsOverrides — forecast", () => {
  it("drops a non-boolean showSimulation", () => {
    expect(sanitizeSettingsOverrides({ forecast: { showSimulation: "yes" } })).toEqual({});
  });

  it("drops an explicit false (off is stored as absence)", () => {
    expect(sanitizeSettingsOverrides({ forecast: { showSimulation: false } })).toEqual({});
  });

  it("keeps showSimulation: true", () => {
    expect(sanitizeSettingsOverrides({ forecast: { showSimulation: true } })).toEqual({
      forecast: { showSimulation: true },
    });
  });

  it("hasAnyOverride sees the forecast key", () => {
    expect(hasAnyOverride({ forecast: { showSimulation: true } })).toBe(true);
  });
});
