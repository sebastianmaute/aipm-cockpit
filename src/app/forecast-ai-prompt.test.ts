import { describe, it, expect } from "vitest";
import { buildForecastBlock } from "./forecast-ai-prompt";
import { buildTurnContext } from "./chat-api";
import { VIEW_AI_SCOPE } from "./view-ai-scope";

const ON =
  'FORECAST — get_forecast returns this project\'s Monte Carlo forecast. Every figure it returns is simulated: say so. Call P80 "safe to commit", never a promise or a guarantee. When a column reports status "insufficient", quote its reason instead of estimating dates yourself. Its figures use the app defaults (60-working-day history, tasks unit), not the Forecast view\'s toolbar. You may create or edit a saved scenario (create_forecast_scenario, update_forecast_scenario) but never delete one.';
const OFF =
  'FORECAST — You cannot read this project\'s forecast: its "Use Monte Carlo forecasting" switch is off, so no forecast tool is available. The Forecast view still runs the simulation and shows its dates and chances to the user. If asked for forecast dates or chances, point the user to the Forecast view, or to turning the switch on so you can read it, and never estimate them yourself.';
const TOOL_NAMES = /get_forecast|create_forecast_scenario|update_forecast_scenario/;

function snapshot(forecastView = true, forecastSimulation = false) {
  return {
    today: "2026-08-05",
    language: "en-US",
    holidayCountries: [],
    storageKind: "indexeddb",
    taskCount: 3,
    knownGroups: [],
    knownLabels: [],
    mode: "advanced",
    enabledModules: [],
    currentView: "forecast",
    insights: [],
    forecastView,
    forecastSimulation,
  } as never;
}

describe("buildForecastBlock", () => {
  it("emits the exact quoting rules when the simulation is on and get_forecast is offered", () => {
    expect(buildForecastBlock(new Set(["get_forecast"]), true, true)).toBe(ON);
  });

  it("emits the exact off message when the switch is off, naming no tool", () => {
    const text = buildForecastBlock(new Set(), true, false);
    expect(text).toBe(OFF);
    expect(text).not.toMatch(TOOL_NAMES);
  });

  it("decides on/off from the simulation, not the tool set", () => {
    expect(buildForecastBlock(new Set(["get_forecast"]), true, false)).toBe(OFF);
  });

  // Inline AI edit: the switch is on, but its request carries no forecast tool.
  it("emits nothing when the simulation is on but get_forecast is not offered", () => {
    expect(buildForecastBlock(new Set(), true, true)).toBe("");
  });

  it("emits nothing when the Forecast view is not enabled, whatever the tool set or switch", () => {
    expect(buildForecastBlock(new Set(), false, false)).toBe("");
    expect(buildForecastBlock(new Set(["get_forecast"]), false, true)).toBe("");
  });
});

describe("the volatile prompt carries the forecast block", () => {
  it("says P80 is safe to commit when the forecast tool is on", () => {
    const text = buildTurnContext("en-US", snapshot(true, true), [], false, { forecast: true });
    expect(text).toContain("safe to commit");
    expect(text).not.toContain("switch is off");
  });

  it("says the switch is off, and points to the view, when it is", () => {
    const text = buildTurnContext("en-US", snapshot(), [], false, {});
    expect(text).toContain(OFF);
    expect(text).not.toContain("safe to commit");
  });
});

describe("the volatile prompt with the Forecast view not enabled", () => {
  it("carries no forecast text and no blank line where the block would be", () => {
    const text = buildTurnContext("en-US", snapshot(false), [], false, {});
    expect(text).not.toContain("FORECAST");
    expect(text).not.toMatch(/\n\n/);
  });

  it("does the same when the snapshot never says", () => {
    const snap = { ...(snapshot() as object), forecastView: undefined } as never;
    expect(buildTurnContext("en-US", snap, [], false, {})).not.toContain("FORECAST");
  });
});

describe("forecast view scope", () => {
  it("hints the forecast tool and gates its reading gloss on it", () => {
    const entry = VIEW_AI_SCOPE.forecast;
    expect(entry.toolHints).toEqual(["get_forecast", "list_tasks", "list_milestones"]);
    expect(entry.readingRequiresTool).toBe("get_forecast");
    expect(entry.reading).toBe(
      "get_forecast returns the simulated finish dates, chance on time, milestone chances, saved scenarios and cost this view shows, with the app defaults; the view's own toolbar (history window, unit, What-if) can differ.",
    );
  });

  // ★ The gloss above goes with the tool; the off-state pointer to the view rides the forecast block instead.
  it("off: the view scope drops its gloss and the forecast block points the user to the view", () => {
    const text = buildTurnContext("en-US", snapshot(), [], false, {});
    expect(text).not.toContain(VIEW_AI_SCOPE.forecast.reading);
    expect(text).toContain("point the user to the Forecast view");
  });
});
