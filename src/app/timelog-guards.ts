/**
 * TimeLog action guards — ONE contract per action, shared by the handler and
 * the button.
 *
 * ★★★ These exist because `handleRefreshBookings` / `handleFetchBookings`
 * (`timelog-panel.tsx`) hand-roll their own early-return guards while
 * `TimelogToolbar` (`timelog-panel-toolbar.tsx`) hand-rolls a STRICTER
 * `disabled` expression: the buttons include `isMisconfigured` and the
 * handlers do not. So any non-button caller — a voice command, a keyboard
 * shortcut, a future Action-Center CTA — would act against an unconfigured
 * TimeLog. Latent, because the button is the only caller today.
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
