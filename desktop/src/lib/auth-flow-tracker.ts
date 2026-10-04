// The desktop sign-in popup's auth-flow state machine (§547), extracted from
// main.ts so every transition is unit-testable. main.ts keeps one
// `AuthFlowState` per WebContents and calls these on the matching Electron
// events; nothing here touches Electron.
//
// Two values per WebContents:
//   committed -- the flag for the page that is actually showing. Written only
//                when Chromium confirms a navigation landed (`did-navigate`),
//                or when a failed return to the app ends the flow (n2).
//   staged    -- the NEXT value, set by an `allow-in-app` will-navigate /
//                will-redirect decision for a navigation still in flight.
//                `undefined` when nothing is in flight.
//
// The three review-found bugs this shape fixes, each pinned by a test in
// auth-flow-tracker.test.ts:
//   M-C -- the flag was written at will-* time, before Chromium committed the
//          navigation, so a later redirect denial or a failed load left it
//          `true` against a page that never moved. Fix: stage, then commit on
//          `did-navigate`.
//   m1  -- a server redirect arriving before the first `did-navigate` read
//          only the committed (still false) flag, so Azure AD's direct 30x to a
//          federated IdP opened in the system browser and hung MSAL. Fix:
//          will-redirect reads the staged value first.
//   m2  -- a CANCELLED navigation fires `did-fail-provisional-load`, not
//          `did-fail-load`, and that event did not discard the staged value,
//          so a later unrelated `did-navigate` committed it. Fix: both failure
//          events call `onLoadFailed`.
// Plus n2: a failed attempt to return to the app origin still ends the flow.

import { decideNavigation, originOnly, type NavigationContext, type NavigationDecision } from "./window-open-policy";

export interface AuthFlowState {
  readonly committed: boolean;
  readonly staged: boolean | undefined;
}

export const INITIAL_AUTH_FLOW: AuthFlowState = { committed: false, staged: undefined };

/** The decision for a navigation, given the auth-flow flag it should be judged under. */
export type DecideNavigation = (inAuthFlow: boolean) => NavigationDecision;

export interface WillResult {
  readonly state: AuthFlowState;
  readonly decision: NavigationDecision["decision"];
}

function stageIfAllowed(state: AuthFlowState, result: NavigationDecision): WillResult {
  // `deny` / `open-external` cancel the navigation, so nothing is in flight to
  // stage and the committed value stays the truth for the page still showing.
  if (result.decision !== "allow-in-app") return { state, decision: result.decision };
  return { state: { committed: state.committed, staged: result.authFlow }, decision: result.decision };
}

/** `will-navigate` always starts a NEW top-level navigation, so it is judged on
 *  the COMMITTED flag; any staged value belongs to a superseded navigation. */
export function onWillNavigate(state: AuthFlowState, decide: DecideNavigation): WillResult {
  return stageIfAllowed(state, decide(state.committed));
}

/** A server redirect continues the SAME in-flight navigation, so it is judged on
 *  the STAGED value first, falling back to the committed one (m1). */
export function onWillRedirect(state: AuthFlowState, decide: DecideNavigation): WillResult {
  return stageIfAllowed(state, decide(state.staged ?? state.committed));
}

/** `did-navigate`: the in-flight navigation landed, so its staged value is now
 *  the committed one. A navigation no will-* event saw (a programmatic
 *  `loadURL`) has nothing staged and changes nothing. */
export function onDidNavigate(state: AuthFlowState): AuthFlowState {
  if (state.staged === undefined) return state;
  return { committed: state.staged, staged: undefined };
}

/** `did-fail-load` and `did-fail-provisional-load` (main frame): drop the staged
 *  value (m2); a failed return to the app origin also ends the flow (n2). */
export function onLoadFailed(state: AuthFlowState, validatedURL: string, appOrigin: string): AuthFlowState {
  let returnedToApp = false;
  try {
    returnedToApp = new URL(validatedURL).origin === appOrigin;
  } catch {
    // Empty or unparsable: not a return to the app, nothing to end.
  }
  return { committed: returnedToApp ? false : state.committed, staged: undefined };
}

// ---------------------------------------------------------------------------
// The Electron wiring, kept here rather than in main.ts so that WHICH events
// drive each transition is under test too: m2 was a missing registration
// (`did-fail-provisional-load`), which no reducer test could have caught.

/** The part of a will-navigate / will-redirect event this wiring reads. */
export interface WillNavigationDetails {
  readonly url: string;
  readonly isMainFrame: boolean;
  preventDefault(): void;
}

/** A WebContents, as far as this wiring needs one. */
export interface NavigationEventTarget {
  on(event: string, listener: (...args: never[]) => void): unknown;
}

export interface AuthFlowNavigationDeps<D extends WillNavigationDetails> {
  readonly appOrigin: string;
  /** The window facts for this WebContents, judged under `inAuthFlow`. */
  contextFor(details: D, inAuthFlow: boolean): NavigationContext;
  openExternal(url: string): Promise<void>;
  log(line: string): void;
}

/** Registers the auth-flow navigation guard on one WebContents. Returns a
 *  reader for its current state (tests; main.ts does not need it). */
export function attachAuthFlowNavigation<D extends WillNavigationDetails>(
  target: NavigationEventTarget,
  deps: AuthFlowNavigationDeps<D>,
): () => AuthFlowState {
  let state = INITIAL_AUTH_FLOW;

  const install = (event: string, listener: (...args: never[]) => void): void => {
    try {
      target.on(event, listener);
    } catch (e: unknown) {
      deps.log(`${event} handler install: ${String(e)}`);
    }
  };

  const guard = (event: "will-navigate" | "will-redirect", step: typeof onWillNavigate) => (details: D): void => {
    if (!details.isMainFrame) return;
    const result = step(state, (inAuthFlow) => decideNavigation(details.url, deps.appOrigin, deps.contextFor(details, inAuthFlow)));
    state = result.state;
    if (result.decision === "allow-in-app") return;
    // For will-redirect this cancels the WHOLE in-flight navigation, not just
    // the hop; Chromium then fires did-fail-provisional-load, which drops the
    // staged value.
    details.preventDefault();
    if (result.decision === "open-external") {
      void deps.openExternal(new URL(details.url).href).catch((e: unknown) => {
        deps.log(`${event}: ${String(e)}`);
      });
    } else {
      deps.log(`${event}: denied ${originOnly(details.url)}`);
    }
  };

  const loadFailed = (_event: unknown, _code: number, _description: string, validatedURL: string, isMainFrame: boolean): void => {
    // Unlike did-navigate, both failure events also fire for subframes.
    if (!isMainFrame) return;
    state = onLoadFailed(state, validatedURL, deps.appOrigin);
  };

  install("will-navigate", guard("will-navigate", onWillNavigate));
  install("will-redirect", guard("will-redirect", onWillRedirect));
  // Main-frame only by definition; fires for a programmatic loadURL too, which
  // stages nothing.
  install("did-navigate", () => {
    state = onDidNavigate(state);
  });
  install("did-fail-load", loadFailed);
  install("did-fail-provisional-load", loadFailed);

  return () => state;
}
