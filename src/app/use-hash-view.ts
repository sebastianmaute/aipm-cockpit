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
 */
export function useHashView(): void {
  const { activeTab, setActiveTab, isPopout } = useWorkspaceTab();

  // Mount + back/forward: hash drives the view.
  useLayoutEffect(() => {
    if (isPopout) return;
    const apply = () => setActiveTab(slugToView(hashSlug()));
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [isPopout, setActiveTab]);

  // View change: write the hash (skip the reserved full-page edit view).
  useEffect(() => {
    if (isPopout || activeTab === "edit") return;
    const next = `#${viewToSlug(activeTab)}`;
    if (window.location.hash !== next) window.location.hash = next;
  }, [isPopout, activeTab]);
}
