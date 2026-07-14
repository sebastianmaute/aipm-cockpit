"use client";
import { useEffect, useLayoutEffect } from "react";
import { useWorkspaceTab } from "./workspace-tab-context";
import { buildHash, parseHash, type AppView } from "./nav-config";
import { isViewEnabled, type FeatureModuleId } from "./feature-modules";

function currentHash(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash;
}

/**
 * True when the URL fragment is an MSAL auth response (`#code=…`/`#state=…`/
 * `#error=…`/`#id_token=…`). Such a fragment MUST be left untouched: the MSAL
 * popup lands on the app origin and its `handleRedirectPromise` reads the
 * fragment, broadcasts the response to the opener over a BroadcastChannel, and
 * closes the popup. If this hook rewrites the hash first (routing an unknown
 * slug to a default view), the response is destroyed and the sign-in popup
 * hangs open forever. A normal view hash (`#raid/123`) never has these keys.
 */
export function isAuthResponseHash(raw: string): boolean {
  const h = raw.charAt(0) === "#" ? raw.slice(1) : raw;
  if (!h) return false;
  const params = new URLSearchParams(h);
  return (
    params.has("code") ||
    params.has("state") ||
    params.has("error") ||
    params.has("id_token") ||
    params.has("session_state")
  );
}

/**
 * Two-way sync between the URL hash and the active view, for the MAIN window
 * only (popouts use ?popout= and must not be touched). Hash grammar is
 * `#<slug>[/<id>]`: a trailing numeric id deep-links a specific item via
 * requestOpen. On view change we only rewrite the hash when the BASE view
 * differs, so an existing `#raid/123` is preserved while the user stays on RAID.
 *
 * `enabled` gates the whole sync — pass false in Classic mode.
 * `features` gates navigation to disabled-module views — if the hash points at
 * a view whose module is off, the hash is ignored (the redirect effect keeps
 * the user on a valid view and will rewrite the hash).
 *
 * IMPORTANT — why the view→hash write uses `history.replaceState` and not
 * `window.location.hash = …`: assigning to `location.hash` fires a `hashchange`
 * event, which this hook's own listener (`apply`) handles by calling
 * `setActiveTab`. That self-notification turns the two effects into a feedback
 * loop: every view→hash write re-enters hash→view, which can flip the view and
 * trigger another write. Because `hashchange` is a macrotask, React's
 * "maximum update depth" guard never trips, so the loop pegs the main thread
 * silently (blank page, no error). `replaceState` updates the URL without
 * firing `hashchange`; genuine back/forward navigation still fires it and is
 * still handled by `apply`.
 */
export function useHashView(enabled: boolean = true, features?: readonly FeatureModuleId[]): void {
  const { activeTab, setActiveTab, isPopout, requestOpen } = useWorkspaceTab();

  // Mount + back/forward: hash drives the view (and any deep-linked item).
  useLayoutEffect(() => {
    if (!enabled || isPopout) return;
    const apply = () => {
      const raw = currentHash();
      // Leave an MSAL auth-response fragment intact for handleRedirectPromise —
      // routing it away would strand the sign-in popup open (see isAuthResponseHash).
      if (isAuthResponseHash(raw)) return;
      // Fresh open / no view encoded ("" or bare "#") lands on the Dashboard
      // home — but fall back to open-points (a guaranteed core view) if the
      // dashboard module is disabled, so the user is never stranded.
      const blank = raw === "" || raw === "#";
      const blankView: AppView = features && !isViewEnabled("dashboard", features) ? "open-points" : "dashboard";
      const { view, itemId } = blank ? { view: blankView, itemId: null } : parseHash(raw);
      if (features && !isViewEnabled(view, features)) return; // disabled target: ignore the hash
      setActiveTab(view);
      if (itemId != null) requestOpen(view, itemId);
    };
    apply();
    window.addEventListener("hashchange", apply);
    window.addEventListener("popstate", apply);
    return () => {
      window.removeEventListener("hashchange", apply);
      window.removeEventListener("popstate", apply);
    };
  }, [enabled, isPopout, features, setActiveTab, requestOpen]);

  // View change: write the hash, but only when the BASE view differs — so an
  // existing "#raid/123" is not clobbered while we stay on RAID. Skip "edit".
  // Uses replaceState (not `location.hash =`) so the write does NOT re-enter
  // the hashchange listener above — see the hook doc comment.
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || isPopout || activeTab === "edit") return;
    if (isAuthResponseHash(window.location.hash)) return; // don't clobber an MSAL response
    const current = parseHash(window.location.hash);
    if (current.view !== activeTab) {
      window.history.replaceState(null, "", buildHash(activeTab));
    }
  }, [enabled, isPopout, activeTab]);
}
