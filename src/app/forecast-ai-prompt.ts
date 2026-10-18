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

const FORECAST_ON = `FORECAST — get_forecast returns this project's Monte Carlo forecast. Every figure it returns is simulated: say so. Call P80 "safe to commit", never a promise or a guarantee. When a column reports status "insufficient", quote its reason instead of estimating dates yourself. Its figures use the app defaults (${DEFAULT_HISTORY_WINDOW}-working-day history, tasks unit), not the Forecast view's toolbar. You may create or edit a saved scenario (create_forecast_scenario, update_forecast_scenario) but never delete one.`;

const FORECAST_OFF =
  'FORECAST — You cannot read this project\'s forecast: its "Use Monte Carlo forecasting" switch is off, so no forecast tool is available. The Forecast view still runs the simulation and shows its dates and chances to the user. If asked for forecast dates or chances, point the user to the Forecast view, or to turning the switch on so you can read it, and never estimate them yourself.';

/** ★★ Decided by the SNAPSHOT, not the tool set; the tool set only decides whether the text may name tools.
 *  - Forecast view not enabled (held back by `RELEASE_HIDDEN_VIEWS`, or its module off): nothing — the user cannot
 *    see the feature, so the prompt must not mention it.
 *  - View enabled, simulation off (the project's switch): the off text, which names no tool.
 *  - Simulation on and `get_forecast` offered (the chat): the quoting rules.
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
  return offeredTools.has("get_forecast") ? FORECAST_ON : "";
}
