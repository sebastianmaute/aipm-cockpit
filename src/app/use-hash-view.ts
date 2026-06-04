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
 */
export function useHashView(enabled: boolean = true, features?: readonly FeatureModuleId[]): void {
  const { activeTab, setActiveTab, isPopout, requestOpen } = useWorkspaceTab();

  // Mount + back/forward: hash drives the view (and any deep-linked item).
  useLayoutEffect(() => {
    if (!enabled || isPopout) return;
    const apply = () => {
      const { view, itemId } = parseHash(currentHash());
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
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || isPopout || activeTab === "edit") return;
    const current = parseHash(window.location.hash);
    if (current.view !== activeTab) window.location.hash = buildHash(activeTab);
  }, [enabled, isPopout, activeTab]);
}
