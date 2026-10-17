import { describe, it, expect } from "vitest";
import { buildForecastBlock } from "./forecast-ai-prompt";
import { buildTurnContext } from "./chat-api";
import { VIEW_AI_SCOPE } from "./view-ai-scope";

const ON =
  'FORECAST — get_forecast returns this project\'s Monte Carlo forecast. Every figure it returns is simulated: say so. Call P80 "safe to commit", never a promise or a guarantee. When a column reports status "insufficient", quote its reason instead of estimating dates yourself. Its figures use the app defaults (60-working-day history, tasks unit), not the Forecast view\'s toolbar. You may create or edit a saved scenario (create_forecast_scenario, update_forecast_scenario) but never delete one.';
const OFF =
  "FORECAST — Monte Carlo forecasting is off for this project (the Forecast view is hidden or the project's switch is off), so no forecast tool is available. If asked for forecast dates or chances, say forecasting is off and never estimate them.";

function snapshot(forecastView = true) {
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
  } as never;
}

describe("buildForecastBlock", () => {
  it("emits the exact quoting rules when get_forecast is offered", () => {
    expect(buildForecastBlock(new Set(["get_forecast"]), true)).toBe(ON);
  });

  it("emits the exact off message when it is not, naming no tool", () => {
    const text = buildForecastBlock(new Set(), true);
    expect(text).toBe(OFF);
    expect(text).not.toMatch(/get_forecast|create_forecast_scenario|update_forecast_scenario/);
  });

  it("emits nothing when the Forecast view is not enabled, whatever the tool set", () => {
    expect(buildForecastBlock(new Set(), false)).toBe("");
    expect(buildForecastBlock(new Set(["get_forecast"]), false)).toBe("");
  });
});

describe("the volatile prompt carries the forecast block", () => {
  it("says P80 is safe to commit when the forecast tool is on", () => {
    const text = buildTurnContext("en-US", snapshot(), [], false, { forecast: true });
    expect(text).toContain("safe to commit");
    expect(text).not.toContain("forecasting is off");
  });

  it("says forecasting is off when it is not", () => {
    const text = buildTurnContext("en-US", snapshot(), [], false, {});
    expect(text).toContain("forecasting is off");
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
});
