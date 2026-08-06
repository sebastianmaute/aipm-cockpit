// src/app/chat-dispatcher-types.ts — ChatDispatcherArgs, split out of
// use-chat-dispatcher.ts to keep that file under the file-size ratchet.

import type { Dispatch, SetStateAction } from "react";
import type { AppView } from "./nav-config";
import { type Settings } from "./settings-types";
import { type DashboardModel } from "./dashboard";
import { type ProjectReport } from "./budget-report";
import { type AllocationsSnapshot } from "./alloc-plan/alloc-plan";

export interface ChatDispatcherArgs {
  settings: Settings;
  today: string;
  setSelectedIds: Dispatch<SetStateAction<Set<number>>>;
  setSettings: Dispatch<SetStateAction<Settings>>;
  /** True in a popout/mirror window — mutating tools are refused so chat edits
   *  can't be silently lost (popouts neither persist nor broadcast). */
  isReadOnly: boolean;
  currentView: AppView;
  /** Canonical per-device settings key (`portfolioCurrentId ?? "default"`) —
   *  NOT the calendar project id. Only used to resolve this project's APPEARANCE
   *  override, which is where `tasksViewMode` lives; the Open Points digest has
   *  to know whether the pane is a table, a board or swimlanes. */
  settingsProjectId: string;
  /** Threaded, NOT minted here. `useHolidaySet` owns state + an async effect, so
   *  a local instance would add a fourth copy re-rendering the whole tree, and
   *  would leave a window where the digest's set has resolved and the table's
   *  has not — making the two disagree on the health filter for one paint. */
  holidaySet: ReadonlySet<string>;
  /** Live dashboard render model. A getter (not the value) so the dispatcher
   *  identity stays stable — it is read through a ref at tool-call time. */
  getDashboardModel: () => DashboardModel;
  /** Live budget rollup, or null when the budget module is off. Deliberately
   *  NOT memoized upstream: it runs only when a tool actually asks, so an
   *  unused read tool costs nothing per render. */
  getBudgetRollup: () => ProjectReport | null;
  /** Live resource-planning grid snapshot for `list_allocations`. Deliberately
   *  NOT memoized upstream — same reasoning as `getBudgetRollup`. */
  getAllocationsSnapshot: () => AllocationsSnapshot;
}
