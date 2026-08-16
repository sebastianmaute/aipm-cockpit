// src/app/chat-dispatcher-types.ts — ChatDispatcherArgs, split out of
// use-chat-dispatcher.ts to keep that file under the file-size ratchet.

import type { Dispatch, SetStateAction } from "react";
import type { LogActivityAsFn } from "./activity-log-context";
import type { AppView } from "./nav-config";
import type { TimeZone } from "./timezone";
import { type Settings } from "./settings-types";
import { type DashboardModel } from "./dashboard";
import { type ProjectReport } from "./budget-report";
import { type AllocationsSnapshot } from "./alloc-plan/alloc-plan";

export interface ChatDispatcherArgs {
  settings: Settings;
  today: string;
  /** The effective IANA zone `today` was computed in (`resolveTimezone` of the
   *  device override and the project's operating tz). Threaded rather than
   *  re-derived: `settings.timezone` is only the FIRST candidate, so deriving
   *  it here would silently ignore a project-level zone and the browser
   *  fallback and put day bounds back out of step with `today`.
   *
   *  ★★ `TimeZone`, not `string`, and widening it back is what re-opens the
   *  defect: this field and `today` above are the exact pair that transposed
   *  silently into the recap engine. The brand only holds while every hop from
   *  `resolveTimezone` to `buildActivityRecapBlock` carries it — a `string`
   *  here lets a raw value in at precisely the point a future edit would. */
  timezone: TimeZone;
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
  /** Threaded from task-manager's `useActivityLog()`, NOT minted here — a second
   *  `useActivityLog()` call would be an independent state instance, so its rows
   *  would be written and never appear in the Activity panel (which renders
   *  task-manager's copy). Optional + called with `?.`, matching every other
   *  `ai.*` emitter (use-alloc-plan, use-raci-suggest, use-inline-entity-edit),
   *  so a test harness or a future caller can omit it.
   *
   *  ★★ ACTOR-AWARE, and it REPLACED the actor-less `logActivity` this file used
   *  to carry rather than sitting beside it: every row the dispatcher writes is
   *  the assistant's, so an actor-less variant here would have no caller left
   *  and would only invite one. Consumed by the 20 entity writers AND by
   *  `useDocumentTools` for the `ai.documentWrite` row — that one is redundant
   *  with its kind and stamped anyway, since a consumer filtering on ACTOR must
   *  not have to special-case a kind.
   *
   *  ★★★ THE ARG LIST IS UNTYPED (`...args`), so nothing in the type system
   *  checks arity against the kind's i18n string. Passing two args to
   *  `raid.updated` ("RAID #{0} updated ({1}): {2}") renders a literal "{2}" in
   *  the Activity panel and in the model's own history feed. The per-kind
   *  contract is pinned ONLY by `use-chat-dispatcher.test.tsx`. */
  logActivityAs?: LogActivityAsFn;
}
