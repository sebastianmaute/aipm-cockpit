// The system-prompt block that tells the assistant how to quote the simulated
// forecast, or that forecasting is off. Pure and i18n-free, like its siblings
// (`chat-recap.ts`, `activity-recap.ts`).
//
// ★★ `offeredTools` IS THE SET THE WIRE WILL SEND, and the tool names appear
//    ONLY when that set holds `get_forecast`: the off text must never name a
//    tool the request does not carry.

const FORECAST_ON =
  'FORECAST — get_forecast returns this project\'s Monte Carlo forecast. Every figure it returns is simulated: say so. Call P80 "safe to commit", never a promise or a guarantee. When a column reports status "insufficient", quote its reason instead of estimating dates yourself. Its figures use the app defaults (60-working-day history, tasks unit), not the Forecast view\'s toolbar. You may create or edit a saved scenario (create_forecast_scenario, update_forecast_scenario) but never delete one.';

const FORECAST_OFF =
  "FORECAST — Monte Carlo forecasting is off for this project (the Forecast view is hidden or the project's switch is off), so no forecast tool is available. If asked for forecast dates or chances, say forecasting is off and never estimate them.";

export function buildForecastBlock(offeredTools: ReadonlySet<string>): string {
  return offeredTools.has("get_forecast") ? FORECAST_ON : FORECAST_OFF;
}
