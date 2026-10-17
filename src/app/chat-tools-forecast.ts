// src/app/chat-tools-forecast.ts — routing, input handling and the gate for the three forecast tools (§502).
// The dispatcher members are implemented in use-chat-dispatcher.ts; this module owns the guards in front
// of them, like chat-tools-documents.ts.

import type { ForecastReport } from "./forecast-ai-report";
import { parseToolChanges } from "./forecast-scenario-tool-input";
import type { ForecastScenario, ScenarioChange } from "./forecast-scenarios";
import { requireToken } from "./chat-tools-updates";

export type ForecastScenarioResult = {
  id: number;
  name: string;
  expectedToken: string;
  changes: readonly ScenarioChange[];
};

export type ForecastToolDispatcher = {
  /** Is Monte Carlo forecasting live for this project? ★ The executor must ask, not just the tool list:
   *  `runTool` is reached by NAME, and replayed history carries a template of a succeeded call. */
  isForecastEnabled(): boolean;
  getForecast(whatIf: readonly ScenarioChange[] | null): ForecastReport;
  getForecastScenarioRow(id: number): ForecastScenario | null;
  /** All three throw `Error(<refusal>)` on refusal. */
  createForecastScenario(name: string, changes: readonly ScenarioChange[]): ForecastScenarioResult;
  updateForecastScenario(
    id: number,
    patch: { name?: string; changes?: readonly ScenarioChange[] },
  ): ForecastScenarioResult & { removedRows?: number };
};

/** Returned by `runForecastTool` for a name that is not one of the three. */
export const NOT_FORECAST_TOOL = Symbol("not-forecast-tool");

export const FORECAST_OFF_MESSAGE =
  'Monte Carlo forecasting is off for this project (the Forecast view is hidden or the project\'s "Use Monte Carlo forecasting" switch is off). Nothing was read or written.';

// ★ A LOCAL literal, not derived from FORECAST_TOOL_DEFS (import-cycle reasoning as chat-tools-documents.ts).
const FORECAST_TOOLS = new Set(["get_forecast", "create_forecast_scenario", "update_forecast_scenario"]);

function requireChanges(raw: unknown, prefix = ""): ScenarioChange[] {
  const parsed = parseToolChanges(raw);
  if (!parsed.ok) throw new Error(`${prefix}${parsed.error}`);
  return parsed.changes;
}

function requireId(input: Record<string, unknown>): number {
  const id = Number(input.id);
  if (!Number.isFinite(id)) throw new Error("id must be a number");
  return id;
}

export function runForecastTool(
  name: string,
  input: Record<string, unknown>,
  d: ForecastToolDispatcher,
): unknown {
  if (!FORECAST_TOOLS.has(name)) return NOT_FORECAST_TOOL;
  if (!d.isForecastEnabled()) throw new Error(FORECAST_OFF_MESSAGE);

  switch (name) {
    case "get_forecast":
      return d.getForecast(input.whatIf === undefined ? null : requireChanges(input.whatIf, "whatIf "));

    case "create_forecast_scenario": {
      if (typeof input.name !== "string") throw new Error("name must be a string");
      return d.createForecastScenario(input.name, requireChanges(input.changes));
    }

    default: {
      const id = requireId(input);
      const row = d.getForecastScenarioRow(id);
      if (!row) throw new Error(`forecast scenario ${id} not found`);
      requireToken("forecastScenario", row, input, `forecast scenario ${id}`);
      if (input.name === undefined && input.changes === undefined) {
        throw new Error("send name, changes, or both");
      }
      if (input.name !== undefined && typeof input.name !== "string") throw new Error("name must be a string");
      return d.updateForecastScenario(id, {
        ...(input.name !== undefined ? { name: input.name as string } : {}),
        ...(input.changes !== undefined ? { changes: requireChanges(input.changes) } : {}),
      });
    }
  }
}
