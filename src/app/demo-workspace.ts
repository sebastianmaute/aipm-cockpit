// Pure: the demo project = the sample master, dates moved so that "today" sits
// where DEMO_AS_OF sits in the authored file. The master is authored as of
// DEMO_AS_OF; update both together when re-authoring it.
import { jsonToWorkspace, type Workspace } from "./workspace";
import { demoShiftFor, shiftWorkspaceDates } from "./shift-workspace-dates";

export const DEMO_AS_OF = "2026-09-18";

export function buildDemoWorkspace(raw: unknown, today: string): Workspace {
  const ws = jsonToWorkspace(JSON.stringify(raw), { strict: true });
  const shifted = shiftWorkspaceDates(ws, demoShiftFor(DEMO_AS_OF, today, ws.plan.granularity));
  // The shift moves whole months (or weeks), so the master's latest forecast-history days (§502) can
  // land after the real today. A recorded forecast from the future is impossible: drop those days.
  const history = shifted.forecastHistory?.filter((e) => e.date <= today);
  return history === undefined ? shifted : { ...shifted, forecastHistory: history };
}
