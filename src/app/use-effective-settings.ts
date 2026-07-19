// src/app/use-effective-settings.ts
//
// Thin render-scope glue: resolves the EFFECTIVE settings for the active project
// by folding its per-project override sources onto the device-global Settings.
//   • device Settings      ← useSettings()
//   • policy overrides      ← useWorkspace().settingsOverrides (travels with the project)
//   • appearance prefs      ← loadProjectAppearance(projectId) (per-device-per-project)
//
// `projectId` is passed IN (not derived from context) — this mirrors the only
// existing per-device-per-project consumer, use-landing-delta, which also takes a
// `projectId` arg; no context currently exposes the active project id to a hook.
// Callers use `currentProjectId ?? "default"` (as workspace-section does).

import { useMemo, useSyncExternalStore } from "react";
import { useSettings } from "./use-settings";
import { useWorkspace } from "./workspace-context";
import { getAppearanceSnapshot, subscribeAppearance } from "./project-appearance-prefs";
import { resolveEffectiveSettings } from "./settings-effective";
import type { Settings } from "./settings-types";

export function useEffectiveSettings(projectId: string): Settings {
  const { settings } = useSettings();
  const { settingsOverrides } = useWorkspace();
  // Defensive: an empty/blank id would collapse every project into one shared
  // appearance bucket — fall back to the "default" project like the callers do.
  const pid = projectId || "default";
  // Reactive read: a UI change to this project's appearance override notifies the
  // store and re-renders here (localStorage writes alone don't re-render React).
  const appearance = useSyncExternalStore(
    subscribeAppearance,
    () => getAppearanceSnapshot(pid),
    () => getAppearanceSnapshot(pid),
  );
  return useMemo(
    () => resolveEffectiveSettings(settings, settingsOverrides, appearance),
    [settings, settingsOverrides, appearance],
  );
}
