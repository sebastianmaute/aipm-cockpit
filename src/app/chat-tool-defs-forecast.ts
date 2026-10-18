// src/app/chat-tool-defs-forecast.ts — Anthropic tool schemas for the Monte Carlo forecast (§502).
// Pure data; routing and the gate live in chat-tools-forecast.ts. The three tools are offered only while
// the simulation is on (`ToolFlags.forecast`, bit 4 in chat-api.ts), and refused by the executor otherwise.

import { expectedTokenField } from "./chat-tools-updates";
import { DEFAULT_HISTORY_WINDOW, MAX_HORIZON_WORKING_DAYS } from "./forecast/constants";
import { AVAILABILITY_MAX, AVAILABILITY_MIN, DEFAULT_RAMP_WEEKS, MAX_FORECAST_SCENARIOS } from "./forecast-scenarios";

/** 1300 → "1,300", fixed to en-US so the model-facing text does not follow the machine's locale. */
const HORIZON = MAX_HORIZON_WORKING_DAYS.toLocaleString("en-US");

// ★ KEEP IN SYNC WITH `ScenarioChange` (forecast-scenarios.ts) AND `parseToolChanges` BY HAND — this is a
//   JSON-schema literal for the model, so tsc cannot catch drift.
const changeSchema = {
  type: "object" as const,
  description:
    `One dated change. availability: {kind:"availability",percent:${AVAILABILITY_MIN}-${AVAILABILITY_MAX},from,until} scales the whole team's capacity. addPeople: {kind:"addPeople",who,from,until,rampWeeks?} adds capacity; who is either {resourceId,hoursPerWeek} for a person on the resource list, or {label,count,rate,currency,hoursPerWeek} for a placeholder. scope: {kind:"scope",tasks,on,milestoneId?} adds (positive) or removes (negative) tasks on a date. Dates are YYYY-MM-DD; until:"" means to the end; rampWeeks defaults to ${DEFAULT_RAMP_WEEKS}.`,
  properties: {
    kind: { type: "string" as const, enum: ["availability", "addPeople", "scope"] },
    percent: { type: "number" as const },
    from: { type: "string" as const },
    until: { type: "string" as const },
    rampWeeks: { type: "number" as const },
    who: { type: "object" as const },
    tasks: { type: "number" as const },
    on: { type: "string" as const },
    milestoneId: { type: "number" as const },
  },
  required: ["kind"],
};

const changesField = { type: "array" as const, items: changeSchema };

export const FORECAST_TOOL_DEFS = [
  {
    name: "get_forecast",
    description:
      `Read this project's Monte Carlo schedule forecast: P50/P80/P95 finish dates, chance of finishing by the plan end, each milestone's chance, the week-on-week change, cost at finish and chance over budget, and every saved scenario's results. Every figure is simulated with the app defaults (${DEFAULT_HISTORY_WINDOW}-working-day history, tasks unit). Optional whatIf: a list of changes, in the same shape as a scenario's, computed once and never saved. Each saved scenario carries an expectedToken for update_forecast_scenario. Units: chances (chanceOnTime, a milestone chance, chanceOverBudget) are fractions from 0 to 1; cost amounts are in settings.currency; "beyond" means past the ${HORIZON}-working-day horizon; cost is null when the Budget module is off, the project has no budget buckets, or the simulation switch is off; cost is {unavailable: reason} when a cost exists but cannot be simulated yet; a weeklyChange of kind "pending" means there is no week-old history yet; weeklyChange is null when asIs is "insufficient".`,
    input_schema: { type: "object" as const, properties: { whatIf: changesField } },
  },
  {
    name: "create_forecast_scenario",
    description:
      `Save a new forecast scenario (at most ${MAX_FORECAST_SCENARIOS} per project): a name and a list of dated changes. Check it with get_forecast's whatIf first.`,
    input_schema: {
      type: "object" as const,
      properties: { name: { type: "string" as const }, changes: changesField },
      required: ["name", "changes"],
    },
  },
  {
    name: "update_forecast_scenario",
    description:
      "Edit a saved forecast scenario. changes REPLACES the whole list (omitted rows are removed); send name alone to rename. Requires the expectedToken from get_forecast. When changes is sent, the result carries removedRows: stored rows not kept unchanged (an edited row counts as removed and re-added).",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "number" as const },
        ...expectedTokenField,
        name: { type: "string" as const },
        changes: changesField,
      },
      required: ["id", "expectedToken"],
    },
  },
];
