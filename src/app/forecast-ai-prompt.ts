// The system-prompt block that tells the assistant how to quote the simulated
// forecast, or that it cannot read it. Pure and i18n-free, like its siblings
// (`chat-recap.ts`, `activity-recap.ts`).
//
// ★★ `offeredTools` IS THE SET THE WIRE WILL SEND, and the tool names appear
//    ONLY when that set holds `get_forecast`: the off text must never name a
//    tool the request does not carry.
// ★★ THE OFF TEXT MUST NOT SAY FORECASTING IS OFF: `ForecastPanel` runs the
//    simulation whatever the switch says, so the view still shows dates and
//    chances. It carries the off-state pointer to the view too, because the
//    forecast view scope's `reading` goes with `get_forecast`
//    (`readingRequiresTool`) and a `ViewScope` holds one reading only.
import { DEFAULT_HISTORY_WINDOW } from "./forecast/constants";
import { WHAT_IT_TAKES_MILESTONE_CAP } from "./forecast-ai-report";

const FORECAST_READ = `FORECAST — get_forecast returns this project's Monte Carlo forecast. Every figure it returns is simulated: say so. Call P80 "safe to commit", never a promise or a guarantee. When a column reports status "insufficient", quote its reason instead of estimating dates yourself. Its figures use the app defaults (${DEFAULT_HISTORY_WINDOW}-working-day history, tasks unit) unless you pass historyWindow or unit: pass them to match a Forecast view toolbar the user changed. Explain the dates from basis (backlog, finished tasks in the window, its working days), and name doneWithoutDate as done tasks missing from the history. A milestone get_project_health counts as at risk is judged by dates (a linked task due or finished after it), not by the simulation, so its simulated chance can disagree: say which one you quote. get_project_health's forecast is the budget forecast at current pace, not this simulation. targetConfidence is the project's goal for a chance (50, 80 or 95 percent; chances are fractions, so 80 means 0.8): a chance below it is below target. whatItTakes is the app's own answer for the plan end and each below-target milestone: the fewest people added, or tasks removed, that alone reach the target; when no single lever does, combine them in a scenario. It searches at most the ${WHAT_IT_TAKES_MILESTONE_CAP} milestones furthest below target; notSearched names the below-target milestones that were not searched: say so rather than guess their levers, and when asked about one, explore it with whatIf. A call with whatIf omits whatItTakes; call without whatIf to read it. proposal is the saved scenario the user chose to propose, or null; p80History is the recorded safe-to-commit date by day.`;

/** Task 10's decision writes (§502 part 4). Each is named only while the request carries it, so a build or a request
 *  without one never tells the model to call a tool it lacks. */
const DELETE_TOOL = "delete_forecast_scenario";
const PROPOSAL_TOOL = "set_forecast_proposal";
const TARGET_TOOL = "set_forecast_target_confidence";

function forecastWrites(offeredTools: ReadonlySet<string>): string {
  const create = "You may create or edit a saved scenario (create_forecast_scenario, update_forecast_scenario)";
  const parts = [offeredTools.has(DELETE_TOOL) ? `${create}, or delete one (${DELETE_TOOL}).` : `${create} but never delete one.`];
  if (offeredTools.has(PROPOSAL_TOOL)) {
    parts.push(`Set or clear the proposal (${PROPOSAL_TOOL}) only when the user asks: never choose it yourself.`);
  }
  if (offeredTools.has(TARGET_TOOL)) parts.push(`Change the target confidence (${TARGET_TOOL}) only when the user asks.`);
  return parts.join(" ");
}

const FORECAST_OFF =
  'FORECAST — You cannot read this project\'s forecast: its "Use Monte Carlo forecasting" switch is off, so no forecast tool is available. The Forecast view still runs the simulation and shows its dates and chances to the user. If asked for forecast dates or chances, point the user to the Forecast view, or to turning the switch on so you can read it, and never estimate them yourself.';

/** ★★ Decided by the SNAPSHOT, not the tool set; the tool set only decides whether the text may name tools.
 *  - Forecast view not enabled (held back by `RELEASE_HIDDEN_VIEWS`, or its module off): nothing — the user cannot
 *    see the feature, so the prompt must not mention it.
 *  - View enabled, simulation off (the project's switch): the off text, which names no tool.
 *  - Simulation on and `get_forecast` offered (the chat): the quoting rules, the decision reads (target confidence,
 *    what it would take, proposal, P80 history) and the writes the request carries (`forecastWrites`).
 *  - Simulation on and `get_forecast` NOT offered (inline AI edit, whose `NO_RECALL_TOOLS` carries no forecast):
 *    nothing — the on text names tools the request lacks, and the off text would be false.
 *  The caller's join drops the empty string. */
export function buildForecastBlock(
  offeredTools: ReadonlySet<string>,
  forecastView: boolean,
  forecastSimulation: boolean,
): string {
  if (!forecastView) return "";
  if (!forecastSimulation) return FORECAST_OFF;
  return offeredTools.has("get_forecast") ? `${FORECAST_READ} ${forecastWrites(offeredTools)}` : "";
}
