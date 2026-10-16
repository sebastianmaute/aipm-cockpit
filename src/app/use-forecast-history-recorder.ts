// src/app/use-forecast-history-recorder.ts
//
// Background recorder for the daily forecast history (§502). While a project is
// open with "Use Monte Carlo forecasting" on, today's default forecast is written as ONE
// history entry (last writer of the day wins), so a later surface can show the
// change over a week.
//
// ★ Called from inside `useInsightLifecycle`, not from `task-manager.tsx`: the
// orchestrator has no size-ratchet headroom, and both are background
// derivations over the same inputs (tasks, milestones, plan, holidays, today).
//
// ★ Writes through the context setter only: no undo capture, no activity-log
// entry. The call is synchronous, so it needs no `dropStaleScopeWrite` (a write
// that awaited would); the scope epoch is read only as a key (the baseline's, and rule 1's). It is skipped while a load or
// swap is pending (§548), in a popout, and until holidays are ready.
//
// ★★ ONE WRITE PER DAY ACROSS DEVICES. The history is broadcast between tabs and
// saved to Turso, and two clients can compute different entries for the same
// day: every stored field (p50/p80/p95/chanceOnTime) is computed in
// holiday-adjusted working days, holidays are a per-device setting that is not
// synced, and an old and a new tab can run different engine code. No stored
// field is holiday-immune, so a tab never compares its entry with a PEER's, only
// with its own earlier computation (its baseline, the ref below). Comparing with
// the stored entry once made two clients overwrite each other for ever; answering
// a peer's entry once still cost every disagreeing client an extra write (a Turso
// revision) per day.
// Per effect run that passes the gates above:
//   1. An IDLE DAY CHANGE writes nothing: `today` moved and `tasks`, `milestones`,
//      `planEnd`, `holidaySet` (by reference) and the scope epoch all equal the
//      previous run's. An idle tab at midnight would otherwise race every other
//      open client to write the new day. The next input change or load records it.
//      The first run after mount, and the first after any gated run (switch off,
//      load pending, popout, holidays not ready), has no previous run: it is a
//      load and may write.
//   2. Nothing stored for today: write (also when this tab's own entry for today
//      went missing from the stored history).
//   3. A stored entry for today that this tab has no baseline for today against
//      (it did not record it, or its baseline is from an earlier day or another
//      scope): ADOPT it. No write; the tab's own computed entry becomes its
//      baseline, so a later peer write is not answered either.
//   4. A stored entry and a baseline for today: write only when the computed entry
//      differs from the baseline (this tab's own forecast changed); the computed
//      entry becomes the new baseline. Otherwise nothing.
//
// ★★ The baseline is keyed by the SCOPE EPOCH (`scope-epoch.ts`), not cleared on
// `loadPending`. The epoch moves only when another project's data is applied, and
// a baseline from another epoch counts as none (rule 3): kept across the swap, the
// old project's entry would read as "my own forecast changed" and overwrite the
// entry stored for the new project. A same-project reload (the conflict banner's
// Reload, a held same-scope op) raises `loadPending` without moving the epoch, so
// the baseline survives it; only the previous run's INPUTS (rule 1) are dropped. It is
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

/** This tab's own last computed entry (its baseline), and the scope epoch it was computed under. */
interface RecordedEntry {
  scope: number;
  entry: ForecastHistoryEntry;
}

/** The inputs of the previous effect run that passed the gates (rule 1). */
interface RunInputs {
  today: string;
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  planEnd: string;
  holidaySet: ReadonlySet<string>;
  scope: number;
}

/** Rule 1: only `today` moved since the previous run. No previous run is a load, never idle. */
function isIdleDayChange(prev: RunInputs | null, next: RunInputs): boolean {
  return (
    prev !== null &&
    prev.today !== next.today &&
    prev.tasks === next.tasks &&
    prev.milestones === next.milestones &&
    prev.planEnd === next.planEnd &&
    prev.holidaySet === next.holidaySet &&
    prev.scope === next.scope
  );
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
  const lastRun = useRef<RunInputs | null>(null);
  useEffect(() => {
    if (!on || !hydrated || isPopout || loadPending || !holidaysReady) {
      lastRun.current = null;
      return;
    }
    const scope = getScopeEpoch();
    const run: RunInputs = { today, tasks, milestones, planEnd, holidaySet, scope };
    const idle = isIdleDayChange(lastRun.current, run);
    lastRun.current = run;
    if (idle) return;
    const entry = toHistoryEntry(
      computeAppForecast({ tasks, milestones, planEnd, today, holidaySet }),
      today,
    );
    if (!entry) return;
    const stored = forecastHistory.find((e) => e.date === today);
    const base = recorded.current;
    const own = base && base.scope === scope && base.entry.date === today ? base.entry : null;
    recorded.current = { scope, entry };
    // Rule 3 (no baseline for today: adopt) or rule 4 (own forecast unchanged).
    if (stored && (!own || sameEntry(own, entry))) return;
    setForecastHistory((prev) => upsertForecastHistory(prev, entry));
  }, [
    on, hydrated, isPopout, loadPending, holidaysReady, today, tasks, milestones,
    planEnd, holidaySet, forecastHistory, setForecastHistory, getScopeEpoch,
  ]);
}
