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
// that awaited would); the scope epoch is read only as a key (it keys the memory, the baseline and the last-seen stored entry). It is skipped while a load or
// swap is pending (§548), in a popout, and until holidays are ready.
//
// ★★ ONE WRITE PER DAY ACROSS DEVICES. The history is broadcast between tabs and
// saved to Turso, and two clients can compute different entries for the same
// day: every stored field (p50/p80/p95/chanceOnTime) is computed in
// holiday-adjusted working days, holidays are a per-device setting that is not
// synced, and an old and a new tab can run different engine code. No stored
// field is holiday-immune, so a peer's differing entry is never a reason to write:
// a tab writes only when its OWN forecast changed (against its baseline, below)
// or nothing is stored for today. Writing whenever the stored entry differed
// once made two clients overwrite each other for ever; answering
// a peer's entry once still cost every disagreeing client an extra write (a Turso
// revision) per day.
// The ref below remembers, per scope epoch, the tab's BASELINE (its own last
// computed entry) and SEEN (the stored entry for today it last saw or wrote).
// Per effect run that passes the gates above:
//   1. Nothing stored for today: write (also when this tab's own entry for today
//      went missing from the stored history).
//   2. The stored entry for today EQUALS the computed one: no write (a second
//      write of the same values is still a new array, an autosave and a Turso
//      revision).
//   3. ADOPT, no write, when the tab has no baseline for today (none, an earlier
//      day's, or another epoch's) or the stored entry is not SEEN (a peer wrote
//      it since this tab's last run). A peer's entry usually arrives together
//      with the peer's edit, which changes this tab's inputs too; answering it
//      would cost one write per remote edit from every client whose holidays
//      differ.
//   4. Otherwise (stored is SEEN and differs from the computed entry): write only
//      when the computed entry differs from the baseline, i.e. this tab's own
//      forecast changed.
//   Every run that computes an entry rebaselines to it; SEEN becomes what was
//   written, or the stored entry when nothing was.
// ★ A DAY CHANGE IN AN IDLE TAB RECORDS THE NEW DAY. Its baseline is yesterday's, so
// it writes only when nothing is stored for today yet (rule 1) and adopts a peer's
// entry otherwise (rule 3). Several tabs open at midnight can each write once before
// they see each other's entry; that is bounded at one write per tab per day. An
// earlier rule that skipped the idle day change avoided that race, but a window left
// open for days with no edits then never recorded a day, and after a week the tile's
// "Change shown from" date moved forward every day.
//
// ★★ The memory is keyed by the SCOPE EPOCH (`scope-epoch.ts`), not cleared on
// `loadPending`. The epoch moves only when another project's data is applied, and
// a memory from another epoch counts as none (rule 3): kept across the swap, an
// entry stored for the new project that happens to equal the one this tab wrote
// for the old project would read as SEEN, and the new project's forecast as "my
// own forecast changed", overwriting it. A same-project reload (the conflict
// banner's Reload, a held same-scope op) raises `loadPending` without moving the
// epoch, so the memory survives it. That changes a write decision in one case
// only: the reload leaves today's stored entry as the one this tab saw and its
// own forecast changed, so it writes (rule 4) where a cleared memory would adopt.
// A reload that brings a peer's differing entry writes nothing either way (rule 3). It is
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

/** The tab's memory under one scope epoch: its BASELINE and the SEEN stored entry. */
interface RecordedEntry {
  scope: number;
  /** This tab's own last computed entry. */
  entry: ForecastHistoryEntry;
  /** The stored entry for `entry.date` this tab last saw, or wrote. */
  seen: ForecastHistoryEntry;
}

/**
 * Rules 1-4. `own` is the memory in this scope, or null. An earlier day's memory
 * needs no check of its own: SEEN carries its date, so it never equals today's
 * stored entry and rule 3 adopts.
 */
function shouldWrite(own: RecordedEntry | null, stored: ForecastHistoryEntry | undefined, entry: ForecastHistoryEntry): boolean {
  if (!stored) return true;
  if (sameEntry(stored, entry)) return false;
  if (!own || !sameEntry(own.seen, stored)) return false;
  return !sameEntry(own.entry, entry);
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
    const scope = getScopeEpoch();
    const entry = toHistoryEntry(
      computeAppForecast({ tasks, milestones, planEnd, today, holidaySet }),
      today,
    );
    if (!entry) return;
    const stored = forecastHistory.find((e) => e.date === today);
    const mem = recorded.current;
    const own = mem && mem.scope === scope ? mem : null;
    const write = shouldWrite(own, stored, entry);
    recorded.current = { scope, entry, seen: write || !stored ? entry : stored };
    if (write) setForecastHistory((prev) => upsertForecastHistory(prev, entry));
  }, [
    on, hydrated, isPopout, loadPending, holidaysReady, today, tasks, milestones,
    planEnd, holidaySet, forecastHistory, setForecastHistory, getScopeEpoch,
  ]);
}
