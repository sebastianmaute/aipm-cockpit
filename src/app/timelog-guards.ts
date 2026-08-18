/**
 * TimeLog action guards — ONE contract per action, shared by the handler and
 * the button.
 *
 * ★★★ These exist because every TimeLog action handler in `timelog-panel.tsx`
 * USED TO hand-roll its own early-return guard while its button hand-rolled a
 * STRICTER `disabled` expression in a different file: the buttons included
 * `isMisconfigured` and the handlers did not. So any non-button caller — a
 * voice command, a keyboard shortcut, a future Action-Center CTA — would have
 * acted against an unconfigured TimeLog. Latent, because the button is the
 * only caller today.
 * ★ Past tense deliberately: this module REMOVED those expressions, so a
 * reader who greps for them finds nothing. An earlier revision described the
 * pre-fix world in the present tense, leaving no way to tell whether the doc
 * or the code was stale.
 *
 * Pure and i18n-free by design — the point is that both call sites evaluate
 * the SAME expression, so they cannot drift again. See open-followups §74.
 *
 * ★ **This asymmetry is what made open-followups §39 possible.** The test
 * compensated for the product code's split instead of the product code
 * resolving it: the fix there waits for the button to become enabled, which
 * works precisely because the button carries a guard the handler does not.
 * Read §39 as "test fixed", not "cause removed" (§74).
 */

/** Blockers shared by every TimeLog action. */
export interface TimelogActionState {
  /** Popout windows are read-only for sync actions. */
  isPopout: boolean;
  /** A sync is already in flight. */
  syncBusy: boolean;
  /** A destructive confirmation is open. */
  confirming: boolean;
  /** `!cfg.enabled || !cfg.host || !cfg.apiToken` — no usable TimeLog config. */
  isMisconfigured: boolean;
}

export interface TimelogFetchState extends TimelogActionState {
  /**
   * The picker's customer id; `""` means none chosen. Matches the real state
   * shape (`useState<number | "">("")` in `use-timelog-picker-scope.ts`,
   * mirrored by `TimelogToolbar`'s prop in `timelog-panel-toolbar.tsx`).
   */
  projectCustomerId: number | "";
  /** How many projects are ticked in the picker. */
  selectedCount: number;
}

export interface TimelogRefreshState extends TimelogActionState {
  /** A previously-fetched scope exists to re-fetch. */
  canRefresh: boolean;
}

function isBlocked(state: TimelogActionState): boolean {
  return state.isPopout || state.syncBusy || state.confirming || state.isMisconfigured;
}

/** Fetch pulls the CURRENT picker selection, so it needs a customer + ≥1 project. */
export function canFetchBookings(state: TimelogFetchState): boolean {
  return !isBlocked(state) && state.projectCustomerId !== "" && state.selectedCount > 0;
}

/** Refresh re-fetches the LAST-FETCHED persisted scope, so it needs one to exist. */
export function canRefreshBookings(state: TimelogRefreshState): boolean {
  return !isBlocked(state) && state.canRefresh;
}

/**
 * Refresh the booking window and immediately open the apply confirm dialog.
 *
 * ★★ Identical preconditions to `canRefreshBookings` — it IS a refresh, plus a
 * confirm-open afterwards. Expressed as its own export rather than an alias so
 * the button and the handler share ONE predicate: this file records four
 * separate instances of a handler guard drifting from its button's `disabled`.
 * A FIFTH was found afterwards, on apply — see `canApplyToBudget`.
 *
 * ★ It exists as a distinct NAME for the same reason `canLoadManagedProjects`
 * does — the day this action grows a precondition of its own (a cache the
 * confirm step needs, say) there is one place to add it, and the delegation
 * below becomes a real body without touching either call site.
 */
export function canRefreshAndReapply(state: TimelogRefreshState): boolean {
  return canRefreshBookings(state);
}

/**
 * Loading the managed-project list has NO precondition beyond the shared
 * blockers, so this is `isBlocked` negated and nothing more.
 *
 * ★ It exists anyway rather than exporting `isBlocked` directly: a call site
 * asking "may I do X?" reads the same way for all three actions, and the day
 * this action grows a precondition of its own there is one place to add it.
 * ★★ Its handler carried the ORIGINAL §74 asymmetry for longer than the other
 * two — `handleLoadManagedProjects` checked `isPopout || sync.busy` while its
 * button already evaluated all four blockers, i.e. the button's expression was
 * literally `isBlocked` spelled out by hand. The first pass at §74 migrated
 * Fetch and Refresh and left this one, so the entry read as though the class
 * was closed while a third hand-rolled copy of the contract was still live.
 */
export function canLoadManagedProjects(state: TimelogActionState): boolean {
  return !isBlocked(state);
}

export interface TimelogApplyState {
  /** Popout windows are read-only. */
  isPopout: boolean;
  /** Rows `buildApplyPlan` would write. Zero = nothing to apply. */
  rowCount: number;
  /** The cached aggregate lost at least one project to a fetch error. */
  isPartial: boolean;
}

/**
 * Write the cached actuals overlay onto the budget buckets.
 *
 * ★★★ `isPartial` IS A DATA-LOSS GUARD, not a tidiness one. Apply OWNS every
 * allocation line of a period it routes: `buildApplyPlan` emits a row for every
 * line whose `next` differs from `current`, and a line this fetch did not route
 * to gets `next = 0`. That ownership is what lets an apply clear a stale total
 * — and it is why a SHORT aggregate is poison. When one of several TimeLog
 * projects feeding a bucket throws, `finish()` still runs on whatever arrived,
 * so the aggregate is well-formed, yields rows, and is simply missing that
 * project's hours; applying it rewrites the bucket at the smaller figure and
 * the difference is ERASED. "Present and non-empty" is NOT the test — a partial
 * aggregate passes both. See open-followups §172.
 *
 * ★★ It is the FIFTH instance of the §74 asymmetry this file exists to end, and
 * the one that had teeth: `openConfirm` returned early on `!overlay` alone
 * while its button carried `applyDiff.length === 0 || isPopout`, so a non-button
 * caller could apply from a popout, or with an empty plan. Both call sites now
 * evaluate THIS.
 *
 * ★ Deliberately NOT extending `TimelogActionState`: apply reaches no network,
 * so `isMisconfigured` must not block it — same reasoning as
 * `canClearAllFetched` below, and expressed the same way (its own state type,
 * so adding a blocker later is a typecheck error rather than a silent change).
 * `syncBusy`/`confirming` are likewise absent: a fetch in flight cannot change
 * the FROZEN snapshot the dialog writes, and `confirming` is the state this
 * action ENTERS.
 */
export function canApplyToBudget(state: TimelogApplyState): boolean {
  return !state.isPopout && state.rowCount > 0 && !state.isPartial;
}

export interface TimelogClearState {
  isPopout: boolean;
  syncBusy: boolean;
  confirming: boolean;
  /** Something has been fetched, so there is a cache to clear. */
  hasFetched: boolean;
}

/**
 * Clearing the fetched cache is the ONE action that deliberately does NOT take
 * `isMisconfigured`, so it takes its own state type rather than extending
 * `TimelogActionState`.
 *
 * ★★★ That omission is the point, not an oversight: the cache is local data
 * the user already has. Broken or disabled TimeLog credentials are exactly a
 * state in which someone may want to clear stale bookings, and gating it on
 * `isMisconfigured` would trap them with data they cannot refresh and cannot
 * remove. Every OTHER action reaches the network; this one only forgets.
 * ★ Because the type does not carry `isMisconfigured`, adding it later is a
 * typecheck error at the call site rather than a silent behaviour change.
 *
 * ★★ Found by review as the FOURTH instance of the §74 asymmetry, after the
 * entry had been declared closed twice: the handler guarded on
 * `isPopout || confirming` while its button carried
 * `syncBusy || isPopout || !fetchedAt || confirming`. Exactly one arm
 * (`confirming`) had been mirrored by hand, with a comment saying so — which is
 * how a partial mirror reads as a complete one.
 */
export function canClearAllFetched(state: TimelogClearState): boolean {
  return !state.isPopout && !state.syncBusy && !state.confirming && state.hasFetched;
}
