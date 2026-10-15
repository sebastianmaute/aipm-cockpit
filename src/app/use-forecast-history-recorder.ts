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
// entry. The call is synchronous, so no scope-epoch handling is needed (a write
// that awaited would need `dropStaleScopeWrite`). It is skipped while a load or
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
// answered either. The memory is cleared while a load or swap is pending, so it
// never carries over to another project.
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { computeAppForecast, toHistoryEntry } from "./forecast/app-forecast";
import { upsertForecastHistory, type ForecastHistoryEntry } from "./forecast-history";
import { isSimulationOn } from "./forecast-simulation";
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
  forecastHistory: readonly ForecastHistoryEntry[];
  setForecastHistory: Dispatch<SetStateAction<readonly ForecastHistoryEntry[]>>;
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
    planEnd, holidaySet, settingsOverrides, forecastHistory, setForecastHistory,
  } = d;
  const on = isSimulationOn(settingsOverrides);
  const recorded = useRef<ForecastHistoryEntry | null>(null);
  useEffect(() => {
    if (loadPending) recorded.current = null;
    if (!on || !hydrated || isPopout || loadPending || !holidaysReady) return;
    const entry = toHistoryEntry(
      computeAppForecast({ tasks, milestones, planEnd, today, holidaySet }),
      today,
    );
    if (!entry) return;
    const stored = forecastHistory.find((e) => e.date === today);
    if (stored && sameEntry(stored, entry)) {
      recorded.current = entry;
      return;
    }
    const own = recorded.current;
    if (stored && own && sameEntry(own, entry)) return;
    recorded.current = entry;
    setForecastHistory((prev) => upsertForecastHistory(prev, entry));
  }, [
    on, hydrated, isPopout, loadPending, holidaysReady, today, tasks, milestones,
    planEnd, holidaySet, forecastHistory, setForecastHistory,
  ]);
}
