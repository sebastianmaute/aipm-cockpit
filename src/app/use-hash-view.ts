"use client";
import { useEffect, useLayoutEffect } from "react";
import { useWorkspaceTab } from "./workspace-tab-context";
import { slugToView, viewToSlug } from "./nav-config";

function hashSlug(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash.replace(/^#/, "");
}

/**
 * Two-way sync between the URL hash and the active view, for the MAIN window
 * only (popouts use the `?popout=` query param and must not be touched).
 * On mount: hash -> view (defaulting to open-points). On view change: view ->
 * hash. Also listens for manual hashchange (back/forward).
 *
 * `enabled` gates the whole sync — pass `false` in Classic mode, where the
 * modern-only views (open-points, etc.) have no panel and the hash must not
 * drive the active view.
 */
export function useHashView(enabled: boolean = true): void {
  const { activeTab, setActiveTab, isPopout } = useWorkspaceTab();

  // Mount + back/forward: hash drives the view.
  useLayoutEffect(() => {
    if (!enabled || isPopout) return;
    const apply = () => setActiveTab(slugToView(hashSlug()));
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [enabled, isPopout, setActiveTab]);

  // View change: write the hash (skip the reserved full-page edit view).
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || isPopout || activeTab === "edit") return;
    const next = `#${viewToSlug(activeTab)}`;
    if (window.location.hash !== next) window.location.hash = next;
  }, [enabled, isPopout, activeTab]);
}
