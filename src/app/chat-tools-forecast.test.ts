import { describe, it, expect, vi } from "vitest";
import { entityToken } from "./ai-entity-token";
import { toolNamesFor, toolsFor } from "./chat-api";
import { TOKEN_REQUIRED_TOOLS } from "./chat-proposal-apply";
import { runTool } from "./chat-tools";
import { ConcurrencyTokenError } from "./chat-tools-updates";
import { FORECAST_OFF_MESSAGE, NOT_FORECAST_TOOL, runForecastTool, type ForecastToolDispatcher } from "./chat-tools-forecast";
import { FORECAST_TOOL_DEFS } from "./chat-tool-defs-forecast";
import { DEFAULT_HISTORY_WINDOW, MAX_HORIZON_WORKING_DAYS } from "./forecast/constants";
import { MAX_FORECAST_SCENARIOS, type ForecastScenario } from "./forecast-scenarios";

const FORECAST_NAMES = ["get_forecast", "create_forecast_scenario", "update_forecast_scenario"];

const row: ForecastScenario = {
  id: 3,
  name: "Hire two",
  changes: [{ kind: "scope", tasks: 5, on: "2026-11-02" }],
};

const result = { id: 3, name: "Hire two", expectedToken: "t", changes: row.changes };

function makeDispatcher(over: Partial<ForecastToolDispatcher> = {}): ForecastToolDispatcher {
  return {
    isForecastEnabled: vi.fn(() => true),
    getForecast: vi.fn(() => ({}) as ReturnType<ForecastToolDispatcher["getForecast"]>),
    getForecastScenarioRow: vi.fn((id: number) => (id === 3 ? row : null)),
    createForecastScenario: vi.fn(() => result),
    updateForecastScenario: vi.fn(() => result),
    ...over,
  };
}

describe("the forecast tool variant bit", () => {
  it("offers none of the three unless forecast is true", () => {
    for (const flags of [{}, { historySearch: true, chatSearch: true }, { forecast: false }]) {
      const names = toolNamesFor(flags);
      for (const n of FORECAST_NAMES) expect(names.has(n)).toBe(false);
    }
  });

  it("offers all three when forecast is true", () => {
    const names = toolNamesFor({ forecast: true });
    for (const n of FORECAST_NAMES) expect(names.has(n)).toBe(true);
  });

  it("keeps one array identity per combination", () => {
    expect(toolsFor({ forecast: true })).toBe(toolsFor({ forecast: true }));
    expect(toolsFor({ forecast: true })).not.toBe(toolsFor({}));
  });

  it("declares the update token as required", () => {
    expect(TOKEN_REQUIRED_TOOLS.has("update_forecast_scenario")).toBe(true);
  });
});

describe("the model-facing texts", () => {
  const description = (name: string) => FORECAST_TOOL_DEFS.find((d) => d.name === name)?.description ?? "";

  // ★ The Forecast view runs the simulation whatever the switch says, so the refusal must not claim
  //   forecasting itself is off; it sends the user to the view instead.
  it("the off refusal points to the Forecast view and never says forecasting is off", () => {
    expect(FORECAST_OFF_MESSAGE).toBe(
      'The assistant cannot read or write this project\'s forecast: the project\'s "Use Monte Carlo forecasting" switch is off, or the Forecast view is hidden. While the view is shown it still displays the simulation to the user; point them there, and never estimate forecast dates yourself. Nothing was read or written.',
    );
  });

  it("templates the constants into the descriptions", () => {
    expect(description("get_forecast")).toContain(`(${DEFAULT_HISTORY_WINDOW}-working-day history, tasks unit)`);
    expect(description("get_forecast")).toContain('"beyond" means past the 1,300-working-day horizon');
    expect(MAX_HORIZON_WORKING_DAYS).toBe(1300);
    expect(description("create_forecast_scenario")).toContain(`(at most ${MAX_FORECAST_SCENARIOS} per project)`);
  });

  it("states when cost is null or unavailable, and when weeklyChange is null", () => {
    const text = description("get_forecast");
    expect(text).toContain(
      "cost is null when the Budget module is off, the project has no budget buckets, or the simulation switch is off; cost is {unavailable: reason} when a cost exists but cannot be simulated yet",
    );
    expect(text).not.toContain("cost basis");
    expect(text).toContain('weeklyChange is null when asIs is "insufficient"');
  });

  it("describes the decision reads: target, what it would take, proposal and P80 history (§502 part 4)", () => {
    const text = description("get_forecast");
    expect(text).toContain("targetConfidence (50, 80 or 95) is the project's goal for a chance");
    expect(text).toContain(
      'whatItTakes holds planEnd (null when asIs has no plan-end chance) and one entry per milestone whose chance is below targetConfidence; it is empty when asIs is "insufficient", and {omitted: "whatIf"} on a call with whatIf (it does not depend on the draft: call without whatIf to read it)',
    );
    expect(text).toContain('state "inert" with a reason (needs-booked-hours, no-open-tasks, too-few-tasks)');
    expect(text).toContain("proposal is {id, name} of the scenario the user proposed, or null");
    expect(text).toContain("p80History is the last 26 recorded entries, oldest first");
  });

  it("says what removedRows counts", () => {
    expect(description("update_forecast_scenario")).toContain(
      "removedRows: stored rows not kept unchanged (an edited row counts as removed and re-added)",
    );
  });
});

describe("runForecastTool", () => {
  it("returns the sentinel for a name that is not a forecast tool", () => {
    expect(runForecastTool("list_tasks", {}, makeDispatcher())).toBe(NOT_FORECAST_TOOL);
  });

  it("refuses every forecast tool while the simulation is off, touching nothing", () => {
    for (const name of FORECAST_NAMES) {
      const d = makeDispatcher({ isForecastEnabled: () => false });
      expect(() => runForecastTool(name, { id: 3, expectedToken: "x" }, d)).toThrow(FORECAST_OFF_MESSAGE);
      expect(d.getForecast).not.toHaveBeenCalled();
      expect(d.getForecastScenarioRow).not.toHaveBeenCalled();
      expect(d.createForecastScenario).not.toHaveBeenCalled();
      expect(d.updateForecastScenario).not.toHaveBeenCalled();
    }
  });

  it("reads with no whatIf as null", () => {
    const d = makeDispatcher();
    runForecastTool("get_forecast", {}, d);
    expect(d.getForecast).toHaveBeenCalledWith(null);
  });

  it("prefixes a bad whatIf row's error", () => {
    const d = makeDispatcher();
    expect(() =>
      runForecastTool("get_forecast", { whatIf: [{ kind: "scope", tasks: "3", on: "2026-11-02" }] }, d),
    ).toThrow("whatIf changes[0]: tasks must be a number");
    expect(d.getForecast).not.toHaveBeenCalled();
  });

  it("creates through the dispatcher with parsed changes", () => {
    const d = makeDispatcher();
    runForecastTool("create_forecast_scenario", { name: "A", changes: row.changes }, d);
    expect(d.createForecastScenario).toHaveBeenCalledWith("A", row.changes);
  });

  it("refuses a create without a string name", () => {
    expect(() => runForecastTool("create_forecast_scenario", { name: 4, changes: [] }, makeDispatcher())).toThrow(
      "name must be a string",
    );
  });

  describe("update_forecast_scenario", () => {
    it("reports an unknown id as not found before any token check", () => {
      expect(() => runForecastTool("update_forecast_scenario", { id: 9 }, makeDispatcher())).toThrow(
        "forecast scenario 9 not found",
      );
    });

    it("refuses a missing token", () => {
      const d = makeDispatcher();
      expect(() => runForecastTool("update_forecast_scenario", { id: 3, name: "x" }, d)).toThrow(
        ConcurrencyTokenError,
      );
      expect(d.updateForecastScenario).not.toHaveBeenCalled();
    });

    it("refuses a wrong token", () => {
      const d = makeDispatcher();
      expect(() =>
        runForecastTool("update_forecast_scenario", { id: 3, expectedToken: "nope", name: "x" }, d),
      ).toThrow(ConcurrencyTokenError);
      expect(d.updateForecastScenario).not.toHaveBeenCalled();
    });

    it("needs name or changes once the token holds", () => {
      const d = makeDispatcher();
      const expectedToken = entityToken("forecastScenario", row);
      expect(() => runForecastTool("update_forecast_scenario", { id: 3, expectedToken }, d)).toThrow(
        "send name, changes, or both",
      );
    });

    it("renames with a valid token and passes only the fields sent", () => {
      const d = makeDispatcher();
      const expectedToken = entityToken("forecastScenario", row);
      runForecastTool("update_forecast_scenario", { id: 3, expectedToken, name: "B" }, d);
      expect(d.updateForecastScenario).toHaveBeenCalledWith(3, { name: "B" });
    });

    it("replaces changes with a valid token", () => {
      const d = makeDispatcher();
      const expectedToken = entityToken("forecastScenario", row);
      runForecastTool("update_forecast_scenario", { id: 3, expectedToken, changes: [] }, d);
      expect(d.updateForecastScenario).toHaveBeenCalledWith(3, { changes: [] });
    });
  });
});

describe("runTool routing", () => {
  it("routes a forecast name to the gate before the unknown-tool throw", async () => {
    const d = makeDispatcher({ isForecastEnabled: () => false });
    await expect(runTool(d as never, "get_forecast", {})).rejects.toThrow(FORECAST_OFF_MESSAGE);
  });
});
