"use client";
import { useEffect, useLayoutEffect } from "react";
import { useWorkspaceTab } from "./workspace-tab-context";
import { buildHash, parseHash } from "./nav-config";
import { isViewEnabled, type FeatureModuleId } from "./feature-modules";

function currentHash(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash;
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
      // Fresh open / no view encoded ("" or bare "#") lands on the Dashboard
      // home rather than the parseHash slug fallback.
      const blank = raw === "" || raw === "#";
      const { view, itemId } = blank ? { view: "dashboard" as const, itemId: null } : parseHash(raw);
      if (features && !isViewEnabled(view, features)) return; // disabled target: ignore the hash
      setActiveTab(view);
      if (itemId != null) requestOpen(view, itemId);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [enabled, isPopout, features, setActiveTab, requestOpen]);

  // View change: write the hash, but only when the BASE view differs — so an
  // existing "#raid/123" is not clobbered while we stay on RAID. Skip "edit".
  // Uses replaceState (not `location.hash =`) so the write does NOT re-enter
  // the hashchange listener above — see the hook doc comment.
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || isPopout || activeTab === "edit") return;
    const current = parseHash(window.location.hash);
    if (current.view !== activeTab) {
      window.history.replaceState(null, "", buildHash(activeTab));
    }
  }, [enabled, isPopout, activeTab]);
}
