// src/app/forecast-simulation.test.ts
// The per-project "Use Monte Carlo forecasting" policy override (§502): off is ABSENCE.

import { afterEach, describe, it, expect, vi } from "vitest";
import { isSimulationActive, isSimulationOn, keepSimulationSwitch, withForecastObject, withSimulation } from "./forecast-simulation";
import { withAiSwitch } from "./ai-project-switches";
import { showForecastView } from "../test/forecast-view";
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

  it("turning it off keeps the target and the proposal (§502)", () => {
    expect(withSimulation({ forecast: { showSimulation: true, targetConfidence: 95 } }, false)).toEqual({
      forecast: { targetConfidence: 95 },
    });
    expect(withSimulation({ forecast: { showSimulation: true, proposalScenarioId: 2 } }, false)).toEqual({
      forecast: { proposalScenarioId: 2 },
    });
  });

  it("turning it on keeps the target and the proposal (§502)", () => {
    expect(withSimulation({ forecast: { targetConfidence: 50, proposalScenarioId: 2 } }, true)).toEqual({
      forecast: { showSimulation: true, targetConfidence: 50, proposalScenarioId: 2 },
    });
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

// §502 — the Forecast view being hidden takes every simulation surface with it.
describe("isSimulationActive", () => {
  const ON: SettingsOverrides = { forecast: { showSimulation: true } };
  afterEach(() => vi.restoreAllMocks());

  it("follows the stored switch while the forecast view is shown", () => {
    showForecastView();
    expect(isSimulationActive(ON, [])).toBe(true);
    expect(isSimulationActive(undefined, [])).toBe(false);
  });

  it("is false while the forecast view is held back, even with the switch stored on", () => {
    expect(isSimulationActive(ON, [])).toBe(false);
    // The raw stored read is untouched, so re-enabling restores the choice.
    expect(isSimulationOn(ON)).toBe(true);
  });
});

// §502 — a restore keeps the CURRENT switch: it is a viewing choice, not project data.
describe("keepSimulationSwitch", () => {
  const ON: SettingsOverrides = { forecast: { showSimulation: true } };
  const TZ: SettingsOverrides = { timezone: { timezone: "Europe/Berlin" } };

  it("turns the switch on in a target that has it off or absent", () => {
    expect(keepSimulationSwitch(TZ, ON)).toEqual({ ...TZ, ...ON });
    expect(keepSimulationSwitch(undefined, ON)).toEqual(ON);
  });

  it("turns the switch off in a target that has it on, keeping the other overrides", () => {
    expect(keepSimulationSwitch({ ...TZ, ...ON }, undefined)).toEqual(TZ);
    expect(keepSimulationSwitch({ ...TZ, ...ON }, TZ)).toEqual(TZ);
  });

  it("folds an override holding only the switch to undefined when it goes off", () => {
    expect(keepSimulationSwitch(ON, undefined)).toBeUndefined();
  });

  it("returns the target itself when the switch already agrees", () => {
    expect(keepSimulationSwitch(TZ, undefined)).toBe(TZ);
    const both = { ...TZ, ...ON };
    expect(keepSimulationSwitch(both, ON)).toBe(both);
    expect(keepSimulationSwitch(undefined, undefined)).toBeUndefined();
  });
});

// The in-memory overrides must serialise exactly as the reloaded ones: the writers keep the sanitiser's key order
// at the top level (nextActions, notifications, timezone, forecast, ai) and inside `forecast`.
describe("the override's key order after a forecast write", () => {
  const roundTrip = (o: unknown) => JSON.stringify(sanitizeSettingsOverrides(JSON.parse(JSON.stringify(o))));
  it("an AI switch, then the simulation switch, matches the sanitised round trip", () => {
    let o = withAiSwitch(undefined, "reviewAllWrites", true);
    o = withSimulation(o, true);
    expect(Object.keys(o!)).toEqual(["forecast", "ai"]);
    expect(JSON.stringify(o)).toBe(roundTrip(o));
  });
  it("a forecast object given in any order is stored in canonical order", () => {
    const o = withForecastObject(withAiSwitch(undefined, "ratesWithheld", true), { proposalScenarioId: 2, targetConfidence: 95, showSimulation: true });
    expect(JSON.stringify(o)).toBe(roundTrip(o));
  });
});

// An override key this build does not know (written by a newer client) is kept, after the canonical keys, by both
// writers; dropping it would erase another client's setting on the next toggle.
describe("the canonical order keeps keys it does not know", () => {
  const withUnknown = { future: { x: 1 }, forecast: { showSimulation: true } } as unknown as SettingsOverrides;
  it("withAiOverrideFlag keeps an unknown key, after the canonical ones", () => {
    const o = withAiSwitch(withUnknown, "reviewAllWrites", true) as unknown as Record<string, unknown>;
    expect(Object.keys(o)).toEqual(["forecast", "ai", "future"]);
    expect(o.future).toEqual({ x: 1 });
  });
  it("withForecastObject keeps an unknown key too", () => {
    const o = withForecastObject(withUnknown, { targetConfidence: 95 }) as unknown as Record<string, unknown>;
    expect(Object.keys(o)).toEqual(["forecast", "future"]);
    expect(o.future).toEqual({ x: 1 });
  });
});

// A key unknown INSIDE `forecast`, and several unknown top-level keys: both kept, in their existing order.
describe("the canonical order keeps nested and several unknown keys in order", () => {
  const rich = {
    zeta: 1, forecast: { later: "x", showSimulation: true, alpha: "y" }, alpha: 2,
  } as unknown as SettingsOverrides;
  it("withAiOverrideFlag: known keys first, then zeta and alpha as they were; forecast keeps later and alpha", () => {
    const o = withAiSwitch(rich, "ratesWithheld", true) as unknown as Record<string, Record<string, unknown>>;
    expect(Object.keys(o)).toEqual(["forecast", "ai", "zeta", "alpha"]);
    expect(Object.keys(o.forecast)).toEqual(["showSimulation", "later", "alpha"]);
  });
  it("withForecastObject: an unknown key inside the forecast object it is given is kept too", () => {
    const o = withForecastObject(rich, { showSimulation: true, later: "x", targetConfidence: 95 } as never) as unknown as Record<string, Record<string, unknown>>;
    expect(Object.keys(o)).toEqual(["forecast", "zeta", "alpha"]);
    expect(Object.keys(o.forecast)).toEqual(["showSimulation", "targetConfidence", "later"]);
  });
});
