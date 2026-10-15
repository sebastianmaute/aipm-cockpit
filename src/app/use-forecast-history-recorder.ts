// src/app/use-forecast-history-recorder.ts
//
// Background recorder for the daily forecast history (§502). While a project is
// open with "show simulation" on, today's default forecast is written as ONE
// history entry (last writer of the day wins), so a later surface can show the
// change over a week.
//
// ★ Called from inside `useInsightLifecycle`, not from `task-manager.tsx`: the
// orchestrator has no size-ratchet headroom, and both are background
// derivations over the same inputs (tasks, milestones, plan, holidays, today).
//
// ★ Writes through the context setter only: no undo capture, no activity-log
// entry. The call is synchronous, so it needs no `dropStaleScopeWrite` (a write
// that awaited would); the scope epoch is read only as the key described below. It is skipped while a load or
// swap is pending (§548), in a popout, and until holidays are ready.
//
// ★★ Whether to write is decided against THIS tab's own last entry for the day,
// not against the stored one. The history is broadcast between tabs, and two tabs
// can compute different entries (holidays are a per-device setting that is not
// synced; an old and a new tab can run different engine code). Comparing with the
// stored entry made each tab overwrite the other's for ever, re-arming the
// autosave every round. A tab now writes when nothing is stored for today, when
// it has not recorded today yet and the stored entry differs, or when its OWN
// computed entry changed since it last recorded. A peer's differing entry is left
// alone: the peer wrote last ("last writer of the day wins"). A stored entry equal
// to the computed one is adopted as this tab's own, so a later peer write is not
// answered either.
//
// ★★ The memory is keyed by the SCOPE EPOCH (`scope-epoch.ts`), not cleared on
// `loadPending`. A same-project reload (the conflict banner's Reload, a held
// same-scope op) also raises `loadPending`; clearing there made the tab answer a
// peer's entry after every reload, one extra Turso revision and a conflict pause
// for the other user each time. The epoch moves only when another project's data
// is applied, so a memory from another epoch counts as "nothing recorded". It is
// keyed on the epoch rather than `currentProjectId` because that id is the file
// registry's: in Turso portfolio mode the open project is `tursoProjectId` (see
// `landingProjectId` in task-manager.tsx), so a Turso swap would not move it.
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { computeAppForecast, toHistoryEntry } from "./forecast/app-forecast";
import { upsertForecastHistory, type ForecastHistoryEntry } from "./forecast-history";
import { isSimulationActive } from "./forecast-simulation";
import type { FeatureModuleId } from "./feature-modules";
import type { ScopeEpochReader } from "./scope-epoch";
import type { SettingsOverrides } from "./settings-types";
import type { Milestone, Task } from "./types";

export interface ForecastHistoryRecorderDeps {
  hydrated: boolean;
  isPopout: boolean;
  loadPending: boolean;
  holidaysReady: boolean;
  today: string;
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  planEnd: string;
  holidaySet: ReadonlySet<string>;
  settingsOverrides: SettingsOverrides | undefined;
  /** Enabled feature modules: hiding the Forecast view stops the recorder. */
  features: readonly FeatureModuleId[];
  forecastHistory: readonly ForecastHistoryEntry[];
  setForecastHistory: Dispatch<SetStateAction<readonly ForecastHistoryEntry[]>>;
  /** Keys this tab's memory of its own entry to the project in scope (§548). */
  getScopeEpoch: ScopeEpochReader;
}

/** This tab's own last entry, and the scope epoch it was recorded under. */
interface RecordedEntry {
  scope: number;
  entry: ForecastHistoryEntry;
}

function sameEntry(a: ForecastHistoryEntry, b: ForecastHistoryEntry): boolean {
  return (
    a.date === b.date &&
    a.p50 === b.p50 &&
    a.p80 === b.p80 &&
    a.p95 === b.p95 &&
    a.chanceOnTime === b.chanceOnTime
  );
}

export function useForecastHistoryRecorder(d: ForecastHistoryRecorderDeps): void {
  const {
    hydrated, isPopout, loadPending, holidaysReady, today, tasks, milestones,
    planEnd, holidaySet, settingsOverrides, features, forecastHistory, setForecastHistory, getScopeEpoch,
  } = d;
  const on = isSimulationActive(settingsOverrides, features);
  const recorded = useRef<RecordedEntry | null>(null);
  useEffect(() => {
    if (!on || !hydrated || isPopout || loadPending || !holidaysReady) return;
    const entry = toHistoryEntry(
      computeAppForecast({ tasks, milestones, planEnd, today, holidaySet }),
      today,
    );
    if (!entry) return;
    const scope = getScopeEpoch();
    const stored = forecastHistory.find((e) => e.date === today);
    if (stored && sameEntry(stored, entry)) {
      recorded.current = { scope, entry };
      return;
    }
    const own = recorded.current?.scope === scope ? recorded.current.entry : null;
    if (stored && own && sameEntry(own, entry)) return;
    recorded.current = { scope, entry };
    setForecastHistory((prev) => upsertForecastHistory(prev, entry));
  }, [
    on, hydrated, isPopout, loadPending, holidaysReady, today, tasks, milestones,
    planEnd, holidaySet, forecastHistory, setForecastHistory, getScopeEpoch,
  ]);
}
