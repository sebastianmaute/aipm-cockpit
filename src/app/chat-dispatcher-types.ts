// src/app/chat-dispatcher-types.ts — ChatDispatcherArgs, split out of
// use-chat-dispatcher.ts to keep that file under the file-size ratchet.

import type { Dispatch, SetStateAction } from "react";
import type { LogActivityAsFn } from "./activity-log-context";
import type { AppView } from "./nav-config";
import type { ProjectClock } from "./timezone";
import { type Settings } from "./settings-types";
import { type DashboardModel } from "./dashboard";
import { type ProjectReport } from "./budget-report";
import { type AllocationsSnapshot } from "./alloc-plan/alloc-plan";
import { type UndoStackApi } from "./undo/use-undo-stack";

export interface ChatDispatcherArgs {
  settings: Settings;
  /** The project's day AND the zone it was computed in, as ONE value (§159).
   *
   *  ★★★ THIS WAS TWO FIELDS — `today: string` and `timezone: TimeZone` — and
   *  they were the exact pair that transposed silently into the recap engine.
   *  Branding the zone made a TRANSPOSITION unrepresentable but left an
   *  INCONSISTENT PAIR (a `today` computed in one zone beside a `tz` naming
   *  another) well-typed, because `today` is a pure function of `tz` and they
   *  travelled as two independent fields. `ProjectClock` derives `today` from
   *  `tz` inside its factory, so no caller can build a disagreeing pair.
   *
   *  ★★ Do NOT re-split this into two fields for call-site convenience, and do
   *  not add a `today` alongside it: the value of the bag is precisely that
   *  there is no second place to get the date from. Threaded rather than
   *  re-derived here — `settings.timezone` is only the FIRST candidate, so
   *  deriving it locally would ignore a project-level zone and the browser
   *  fallback. */
  clock: ProjectClock;
  /** Called immediately after this dispatcher writes its own `"ai"`-stamped
   *  `settings.updated` row, so the debounced settings-log effect can skip the
   *  duplicate actor-less row it would otherwise add (§160).
   *
   *  ★★★ EVERY CALLER MUST HAVE JUST CREATED A NEW `settings` IDENTITY, or it
   *  credits a run that will never happen. Both call sites satisfy this
   *  unconditionally (`setLanguage` spreads a fresh object; `updateSettings`
   *  credits only inside its `applied` guard).
   *
   *  ★★★ THAT IS NECESSARY BUT NOT SUFFICIENT, and an earlier version of this
   *  note claimed it was enough. Credits are issued PER CALL and consumed PER
   *  EFFECT RUN, and React batches every `setSettings` of one assistant turn
   *  into ONE render — so N calls in a turn produce N credits against a single
   *  run. The consumer therefore CLEARS the counter instead of decrementing it;
   *  do not "fix" that back to a decrement, which leaves the surplus alive to
   *  swallow an arbitrarily later user row. See `aiSettingsCreditsRef`.
   *
   *  ★ Optional so a fixture can omit it: a test that does not pass it simply
   *  gets the old both-rows behaviour, which is the safe direction. */
  onSettingsLoggedByAi?: () => void;
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
  /** ★★ Arms the one-shot destructive-save bypass (`use-storage-backend.ts`) —
   *  threaded through to `useDocumentTools`, which is the only consumer today.
   *  `documents` counts toward `workspaceRecordCount`, and several
   *  `delete_document` calls in ONE assistant turn execute back-to-back:
   *  `chat-panel.tsx` walks every tool_use block of one response in a single
   *  loop with no model round-trip between, and each block is a local mutation.
   *  So they land orders of magnitude inside `SAVE_DEBOUNCE_MS` and coalesce
   *  into one debounced save, which Layer B can then read as a mass deletion
   *  and REFUSE — the deletions show as applied while the backend still holds
   *  them.
   *  ★ THE LOOP SHAPE IS THE CLAIM, not "one tick". Each block is `await`ed, so
   *  consecutive blocks are separated by microtask turns rather than sharing a
   *  React batch; "closer together than 500ms" is all the argument needs and it
   *  survives a batching change. The threshold arithmetic is NOT intuitive —
   *  `use-document-tools.ts`'s arming site carries the runnable check.
   *  Optional, like `logActivityAs`: a test harness or a popout supplies no
   *  bypass at all. */
  allowDestructiveSave?: () => void;
  /** Undo capture for AI writes. Optional so every existing test and the popout
   *  path keep working untouched; when absent, writes apply exactly as before.
   *  ★ Optional is a MIGRATION affordance, not a design choice — once every
   *  call site passes it, make it required. An always-optional dependency is
   *  how a write path silently stops capturing. */
  undo?: Pick<UndoStackApi, "captureComposite">;
}
