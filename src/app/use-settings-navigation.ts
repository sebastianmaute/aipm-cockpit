// src/app/use-settings-navigation.ts
//
// "Open settings" requests from anywhere in the app, routed by layout. The
// modern layout has a Settings view with sections, reached by a deep-link
// request carrying a monotonic nonce; the classic layout has no Settings view,
// only the header `SettingsMenu` popover, whose open state is owned here.
// Extracted from task-manager.tsx (§491); move-only.
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
}

export function useSettingsNavigation(deps: SettingsNavigationDeps) {
  const { layout, setActiveTab } = deps;

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

  return {
    settingsSectionRequest,
    clearSettingsSectionRequest,
    isClassicLayout,
    classicSettingsOpen,
    setClassicSettingsOpen,
    onOpenSettingsSection,
    onOpenSettings,
    onOpenLearningSettings,
  };
}
