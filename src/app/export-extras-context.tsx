"use client";

// open-followups §545 — what a derived document `dataSection` needs beyond the
// workspace: today, the budget forecast. Provided ONCE by `WorkspaceSection`
// from task-manager's `exportForecast` (the same value the workspace export
// receives) and read by every leaf that renders or downloads a document: the
// preview, the history-row preview, the Documents pane's downloads and the
// chat document card.
//
// ★ A context rather than a prop chain because those leaves sit two to four
//   hops below the section, under memoised panels (`ChatPanel`); a prop
//   threaded through them would hand each a fresh identity on every forecast
//   change, and a hop forgotten would render a `budgetForecast` block as
//   nothing with no error.
// ★ The default is `{}` — no provider means no forecast, which is exactly what
//   a renderer does with the argument omitted. A test that mounts a leaf
//   alone keeps working and renders the block as nothing. Popouts are NOT
//   that case: their `legacyTree` renders `WorkspaceSection` too, from the
//   popout's own `workspaceProps`, so they get the provider and the forecast.
//
// §502 part 4 — the simulated forecast decision rides here too, as a lazy
// source (`ForecastDecisionSource`): nothing runs until a document block or an
// export asks for the section. Previews read its live half instead, from a
// context of its own (`useForecastDecisionLive`, read by `usePreviewExportExtras`),
// so their lever search runs off the render path.
// ★ The handle changes on every task, milestone or plan edit; the extras value
//   does NOT follow it. Its `forecastDecision` is one stable thunk that calls
//   the LATEST source (kept in a ref, updated after commit), so the value keeps
//   its identity while the forecast bundle and the section's presence hold, and
//   the leaves under memoised panels (chat cards, the Documents pane, the block
//   editors) do not re-render on every edit. Every caller of that thunk calls it
//   from an event (a download, an export click), never from render; a preview,
//   which renders the decision, reads the live context, which does change.
// The two workspace exports read the source at the click: the Projects
// panel's "export current project" takes it from this context (main window and
// popout alike) and hands it to task-manager's handler; the header Export menu,
// which is mounted on views where `WorkspaceSection` is not, derives its own from
// the same recipe (`useWorkspaceForecastDecisionSource`). Neither is a published
// module slot — that held the last mounted section's source, so it was empty on
// the modern shell's Open Points, Settings and Learning insights views.
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { ExportExtras } from "./export-forecast-section";
import type { ForecastBundle } from "./budget-forecast-bundle";
import type { ForecastDecisionHandle, ForecastDecisionLive, ForecastDecisionSource } from "./forecast-decision";

const NO_EXTRAS: ExportExtras = {};

const Ctx = createContext<ExportExtras>(NO_EXTRAS);
const LiveCtx = createContext<ForecastDecisionLive | undefined>(undefined);

/** A workspace export's extras: the budget forecast, plus the decision source when the simulation offers one. */
export function workspaceExportExtras(budgetForecast: ForecastBundle | null, forecastDecision: ForecastDecisionSource | null | undefined): ExportExtras {
  return forecastDecision ? { budgetForecast, forecastDecision } : { budgetForecast };
}

export function ExportExtrasProvider({
  forecast,
  forecastDecision = null,
  children,
}: {
  /** `exportForecastFor(settings.features, dashboardModel.forecastBundle)`:
   *  null with the budget module off or no forecast. */
  forecast: ForecastBundle | null | undefined;
  /** `useForecastDecisionSource`'s handle; null while the simulation is off, and then both keys are absent. */
  forecastDecision?: ForecastDecisionHandle | null;
  children: ReactNode;
}) {
  const latest = useRef(forecastDecision);
  useEffect(() => {
    latest.current = forecastDecision;
  }, [forecastDecision]);
  const hasDecision = forecastDecision !== null;
  const value = useMemo<ExportExtras>(() => {
    if (!forecast && !hasDecision) return NO_EXTRAS;
    return {
      ...(forecast ? { budgetForecast: forecast } : {}),
      ...(hasDecision ? { forecastDecision: () => latest.current?.source() ?? null } : {}),
    };
  }, [forecast, hasDecision]);
  return (
    <Ctx.Provider value={value}>
      <LiveCtx.Provider value={forecastDecision?.live}>{children}</LiveCtx.Provider>
    </Ctx.Provider>
  );
}

export function useExportExtras(): ExportExtras {
  return useContext(Ctx);
}

/** The decision's live half (`ForecastDecisionLive`) for a document PREVIEW; undefined while the simulation is off.
 *  Changes with every handle, unlike `useExportExtras()`, so only the previews that render it re-render. */
export function useForecastDecisionLive(): ForecastDecisionLive | undefined {
  return useContext(LiveCtx);
}
