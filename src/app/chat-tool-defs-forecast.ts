// src/app/chat-tool-defs-forecast.ts — Anthropic tool schemas for the Monte Carlo forecast (§502).
// Pure data; routing and the gate live in chat-tools-forecast.ts. The six tools are offered only while
// the simulation is on (`ToolFlags.forecast`, bit 4 in chat-api.ts), and refused by the executor otherwise.

import { expectedTokenField } from "./chat-tools-updates";
import { P80_HISTORY_ENTRIES, WHAT_IT_TAKES_MILESTONE_CAP } from "./forecast-ai-report";
import {
  DEFAULT_HISTORY_WINDOW, EFFORT_MODE_MIN_COVERAGE, HISTORY_WINDOWS, MAX_HORIZON_WORKING_DAYS,
} from "./forecast/constants";
import { AVAILABILITY_MAX, AVAILABILITY_MIN, DEFAULT_RAMP_WEEKS, MAX_FORECAST_SCENARIOS } from "./forecast-scenarios";
import { TARGET_CONFIDENCES } from "./forecast-target";

/** 1300 → "1,300", fixed to en-US so the model-facing text does not follow the machine's locale. */
const HORIZON = MAX_HORIZON_WORKING_DAYS.toLocaleString("en-US");
const EFFORT_COVERAGE = Math.round(EFFORT_MODE_MIN_COVERAGE * 100);

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
      `Read this project's Monte Carlo schedule forecast: P50/P80/P95 finish dates, chance of finishing by the plan end, each milestone's chance, the week-on-week change, cost at finish and chance over budget, and every saved scenario's results. Each forecast column carries basis: {backlog (the work simulated: the open tasks with the column's own scope changes, or hours in the effort unit, where an unestimated task counts at the median estimate), finishedInWindow (tasks finished in the history window), windowWorkingDays, doneWithoutDate (done tasks with no completion date, which count nowhere in the history), beyondShare (0 to 1)}: use it to explain the dates. An insufficient column carries doneWithoutDate too. Each milestone with a chance has prioritised: its chance if its own open linked tasks went first; list_milestones' linkedTaskIds names those tasks. howManyByPlanEnd is As is only: {by, p50, p80, p95}, how much finishes by the plan end (by, capped at the horizon), at least that much in that percent of runs, in the run's unit; null when As is is insufficient, there is no plan end, or it is not after today. Every figure is simulated, by default with the app defaults (${DEFAULT_HISTORY_WINDOW}-working-day history, tasks unit) as the Dashboard, Reports and the recorded history use. Optional historyWindow (${HISTORY_WINDOWS.join(", ")}, in working days) and unit ("tasks" or "effort", estimated hours; effort needs an estimate on at least ${EFFORT_COVERAGE} % of open tasks, else the run uses tasks, and settings.unit says which ran) reproduce a Forecast view toolbar the user changed; with either away from the defaults, weeklyChange is null and whatItTakes is {omitted: "settings"} (a call with whatIf still gets {omitted: "whatIf"}), because both are defined at the defaults. Optional byGroup: true adds byGroup, one row per task group with open tasks, each forecast from that group's own history at the defaults: {key (the group, "" for none), open, kind, p80 (null past the horizon), chanceOnTime} or the insufficient counts; it costs one forecast run per group with open tasks and blocks the app while it runs, so ask only when needed. Optional whatIf: a list of changes, in the same shape as a scenario's, computed once and never saved. Each saved scenario carries an expectedToken for update_forecast_scenario. Units: chances (chanceOnTime, a milestone chance, chanceOverBudget) are fractions from 0 to 1; cost amounts are in settings.currency; "beyond" means past the ${HORIZON}-working-day horizon; cost is null when the Budget module is off, the project has no budget buckets, or the simulation switch is off; cost is {unavailable: reason} when a cost exists but cannot be simulated yet; a weeklyChange of kind "pending" means there is no week-old history yet; weeklyChange is null when asIs is "insufficient". targetConfidence (50, 80 or 95) is the project's goal for a chance, as a percent: chances are fractions, so 80 means 0.8. whatItTakes holds planEnd (null when asIs has no plan-end chance) and one entry per milestone whose chance is below targetConfidence, worst first, at most ${WHAT_IT_TAKES_MILESTONE_CAP}; notSearched lists {id, name} of the below-target milestones that were not searched, normally those past the cap; planEnd is null and both lists are empty when asIs is "insufficient"; whatItTakes itself is {omitted: "whatIf"} on a call with whatIf (it does not depend on the draft: call without whatIf to read it). Each take gives the As-is chance, prioritised (the milestone's chance with its own tasks first; null for the plan end), and two levers: people (placeholders sized from the team, added from today with a ${DEFAULT_RAMP_WEEKS}-week ramp) and tasks (open tasks removed; hours is that amount in estimated hours, or null). A lever is state "reaches" with the smallest n and its chance, "out-of-reach", "on-target", or state "inert" with a reason (needs-booked-hours, no-open-tasks, too-few-tasks). proposal is {id, name} of the scenario the user proposed, or null; its figures are that scenario's entry. p80History is the last ${P80_HISTORY_ENTRIES} recorded entries, oldest first: {date, p80}, p80 null meaning past the horizon that day.`,
    input_schema: {
      type: "object" as const,
      properties: {
        whatIf: changesField,
        historyWindow: { type: ["number", "string"], enum: [...HISTORY_WINDOWS] },
        unit: { type: "string" as const, enum: ["tasks", "effort"] },
        byGroup: { type: "boolean" as const },
      },
    },
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
  {
    name: "delete_forecast_scenario",
    description:
      "Delete a saved forecast scenario. Requires the expectedToken from get_forecast. The user can undo it. Deleting the proposed scenario leaves no proposal until it is restored.",
    input_schema: {
      type: "object" as const,
      properties: { id: { type: "number" as const }, ...expectedTokenField },
      required: ["id", "expectedToken"],
    },
  },
  {
    name: "set_forecast_proposal",
    description:
      "Set the scenario the user proposes as the intervention, by its id from get_forecast, or clear the proposal with id null. Only when the user asks: never choose it yourself.",
    input_schema: {
      type: "object" as const,
      properties: { id: { type: ["number", "null"], description: "A saved scenario's id, or null to clear" } },
      required: ["id"],
    },
  },
  {
    name: "set_forecast_target_confidence",
    description:
      `Set the project's target confidence, the goal a chance is measured against: ${TARGET_CONFIDENCES.join(", ")} (percent). Only when the user asks.`,
    input_schema: {
      type: "object" as const,
      properties: { value: { type: "number" as const, enum: [...TARGET_CONFIDENCES] } },
      required: ["value"],
    },
  },
];
