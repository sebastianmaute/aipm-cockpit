// src/app/use-settings-navigation.ts
//
// "Open settings" requests from anywhere in the app, routed by layout. The
// modern layout has a Settings view with sections, reached by a deep-link
// request carrying a monotonic nonce; the classic layout has no Settings view,
// only the header `SettingsMenu` popover, whose open state is owned here.
// Extracted from task-manager.tsx (§491); move-only.
//
// §706 — it also owns the OTHER "go and open X" request that Settings makes: Settings -> Functions
// opens Edit project focused on its Functions part (`openProjectFunctions`). That request is a
// monotonic number (`null` = none) the Projects view consumes; it is state HERE, not in
// task-manager, because task-manager has no line to spare.
//
// ★ It keeps the inline `useCallback` memoization on purpose, against
// Extraction convention 1 (non-memoized handlers): `clearSettingsSectionRequest`
// reaches settings-view.tsx as `onSectionConsumed`, which is in the dependency
// array of the effect that consumes a deep-link request, so an unstable one
// would re-run that effect on every render. The dependency arrays are the
// inline ones, unchanged.
"use client";
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { SettingsSectionId } from "./dashboard-coaching";
import type { AppView } from "./nav-config";
import type { Settings } from "./settings-types";

export interface SettingsNavigationDeps {
  layout: Settings["layout"];
  setActiveTab: Dispatch<SetStateAction<AppView>>;
  /** A popout window gets no section opener in `workspaceNav` (it has no Settings to open). */
  isPopout: boolean;
}

export function useSettingsNavigation(deps: SettingsNavigationDeps) {
  const { layout, setActiveTab, isPopout } = deps;

  // Deep-link the Action Center's "Learning is ON/OFF" pill to the Next-actions
  // settings section (where the learning controls live) — not the bare Settings
  // root. The nonce re-fires navigation even on a repeat click.
  const [settingsSectionRequest, setSettingsSectionRequest] = useState<{ id: SettingsSectionId; nonce: number } | undefined>(undefined);
  // Monotonic nonce (a ref, never reset) so each deep-link request is distinct
  // even after the previous one was consumed/cleared — robust whether SettingsView
  // remounts (modern) or stays mounted.
  const settingsSectionNonceRef = useRef(0);
  // §650 — the CLASSIC layout has no Settings view (task-manager's classic-fallback effect bounces
  // "settings" to chat); its settings are the header `SettingsMenu` popover, controlled from here so
  // an "open settings" request opens it. The popover has no sections, so it opens at the top. No
  // nonce is involved on this path: the state lives HERE and the menu is controlled, so there is no
  // child-side "handled" seed to swallow a request on a fresh mount.
  const [classicSettingsOpen, setClassicSettingsOpen] = useState(false);
  const isClassicLayout = layout === "classic";
  // ★★ The popover holds the Layout control, so picking "Modern" in it unmounts the classic header
  // while this parent-owned state is still `true`. Before the state was lifted here it died with
  // the unmount; now it must be CLEARED when the layout leaves classic (render-time reconcile —
  // set-state-in-effect is banned), or a later switch back to classic reopens it. The `open` passed
  // down is also derived (`isClassicLayout && …`) so the render that switches layout never feeds a
  // stale `true` to anything.
  if (!isClassicLayout && classicSettingsOpen) setClassicSettingsOpen(false);
  const onOpenSettingsSection = useCallback((id: SettingsSectionId) => {
    if (isClassicLayout) {
      setClassicSettingsOpen(true);
      return;
    }
    settingsSectionNonceRef.current += 1;
    setSettingsSectionRequest({ id, nonce: settingsSectionNonceRef.current });
    setActiveTab("settings");
  }, [setActiveTab, isClassicLayout]);
  /** The un-sectioned "open settings" request (the storage banner's action), in either layout. */
  const onOpenSettings = useCallback(() => {
    if (isClassicLayout) setClassicSettingsOpen(true);
    else setActiveTab("settings");
  }, [setActiveTab, isClassicLayout]);
  const onOpenLearningSettings = useCallback(() => onOpenSettingsSection("nextActions"), [onOpenSettingsSection]);
  const clearSettingsSectionRequest = useCallback(() => setSettingsSectionRequest(undefined), []);

  // §706 — "open this project's functions". The Projects view MOUNTS FRESH after the view switch, so
  // the request is a monotonic NUMBER the panel seeds its last-seen value against with a sentinel
  // (AGENTS.md "Remount-swallow"), and the panel calls the clear callback once it has acted.
  // The counter lives in a ref and is never reset, so a request after a consumed one is distinct.
  const [projectFunctionsRequest, setProjectFunctionsRequest] = useState<number | null>(null);
  const projectFunctionsNonceRef = useRef(0);
  const openProjectFunctions = useCallback(() => {
    projectFunctionsNonceRef.current += 1;
    setProjectFunctionsRequest(projectFunctionsNonceRef.current);
    setActiveTab("projects");
  }, [setActiveTab]);
  const clearProjectFunctionsRequest = useCallback(() => setProjectFunctionsRequest(null), []);

  // ★ Ready-made prop bags: task-manager spreads these instead of destructuring eleven names and
  // folding the popout gate into a long line. Each bag's keys are the PROP names its consumer
  // takes, so a call site cannot rename one by accident. Rebuilt each render; the members are the
  // stable callbacks above, so no consumer sees a changed identity.
  const workspaceNav = {
    onOpenLearningSettings,
    onOpenSettingsSection: isPopout ? undefined : onOpenSettingsSection,
    projectFunctionsRequest,
    onProjectFunctionsRequestConsumed: clearProjectFunctionsRequest,
  };
  const classicMenu = {
    settingsMenuOpen: isClassicLayout && classicSettingsOpen,
    onSettingsMenuOpenChange: setClassicSettingsOpen,
  };
  const sectionProps = { requestSection: settingsSectionRequest, onSectionConsumed: clearSettingsSectionRequest };

  return {
    workspaceNav,
    classicMenu,
    sectionProps,
    settingsSectionRequest,
    clearSettingsSectionRequest,
    isClassicLayout,
    classicSettingsOpen,
    setClassicSettingsOpen,
    onOpenSettingsSection,
    onOpenSettings,
    onOpenLearningSettings,
    projectFunctionsRequest,
    openProjectFunctions,
    clearProjectFunctionsRequest,
  };
}
