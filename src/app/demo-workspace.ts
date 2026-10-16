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
  // The same shift can move a task's completion past today, and the forecast and coaching would then count
  // work finished in the future. Clamp it to today: the task stays Done (status ⟺ completedDate holds).
  // Creation and last update are records of the past too, so they get the same bound, which keeps a clamped
  // task created and updated no later than it was finished. A planned `startDate` may stay in the future,
  // except on a finished task, which cannot have started after it finished.
  const tasks = shifted.tasks.map((task) => {
    const completedDate = notAfter(task.completedDate, today);
    const createdDate = notAfter(task.createdDate, today);
    const lastUpdateDate = notAfter(task.lastUpdateDate, today) as string;
    const startDate = completedDate ? notAfter(task.startDate, completedDate) : task.startDate;
    if (
      completedDate === task.completedDate && createdDate === task.createdDate &&
      lastUpdateDate === task.lastUpdateDate && startDate === task.startDate
    ) {
      return task;
    }
    // Override only the fields the task has, so a missing one does not come back as an explicit `undefined`.
    return {
      ...task, lastUpdateDate,
      ...(completedDate && { completedDate }), ...(createdDate && { createdDate }), ...(startDate && { startDate }),
    };
  });
  return history === undefined ? { ...shifted, tasks } : { ...shifted, tasks, forecastHistory: history };
}

function notAfter(date: string | undefined, bound: string): string | undefined {
  return date && date > bound ? bound : date;
}
