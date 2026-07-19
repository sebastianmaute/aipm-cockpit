// src/app/settings-effective.ts
//
// Pure resolver that folds the two per-project override sources onto the
// device-global Settings to produce the EFFECTIVE settings for the active
// project. Precedence is override-wins: an override value takes effect, else the
// device value stands. The two sources are split by nature:
//   • POLICY overrides (Workspace.settingsOverrides) travel WITH the project —
//     nextActions/notifications MERGE their partial onto the device config;
//     timezone/additionalTimezones WHOLE-REPLACE when provided.
//   • APPEARANCE prefs (per-device-per-project, project-appearance-prefs.ts) —
//     each settings-blob-resident field (dashboardDensity/showViewHints/
//     tasksViewMode) WHOLE-REPLACES when set.
// `theme`/`activeSchemeId` are NOT settings-blob fields (they live in boot keys);
// their wiring is handled by use-theme/use-style (Phase 5), so the resolver
// leaves them alone.
//
// Immutable: returns a NEW Settings; the device object is never mutated.

import { resolveNextActionsConfig } from "./settings-types";
import type { Settings, SettingsOverrides } from "./settings-types";
import type { ProjectAppearancePref } from "./project-appearance-prefs";

export function resolveEffectiveSettings(
  device: Settings,
  policy: SettingsOverrides | undefined,
  appearance: ProjectAppearancePref | undefined,
): Settings {
  const out: Settings = { ...device };

  // Policy: partial-merge the two config groups (override fields win, others keep
  // the device value). notifications is always a full config; nextActions is
  // optional on the device, so the merge stays a valid full config only when the
  // device had one — downstream readers resolve defaults regardless.
  if (policy?.nextActions) {
    // resolveNextActionsConfig fills EVERY field from defaults, so the merged
    // partial becomes a valid full config (never a cast-masked partial) and is a
    // fresh object (no aliasing into device.nextActions).
    out.nextActions = resolveNextActionsConfig({ ...device.nextActions, ...policy.nextActions });
  }
  if (policy?.notifications) {
    out.notifications = { ...device.notifications, ...policy.notifications };
  }
  // Policy timezone: whole-replace each provided field.
  if (policy?.timezone?.timezone !== undefined) {
    out.timezone = policy.timezone.timezone;
  }
  if (policy?.timezone?.additionalTimezones !== undefined) {
    out.additionalTimezones = policy.timezone.additionalTimezones;
  }

  // Appearance: whole-replace each settings-blob-resident field when set.
  if (appearance?.dashboardDensity !== undefined) {
    out.dashboardDensity = appearance.dashboardDensity;
  }
  if (appearance?.showViewHints !== undefined) {
    out.showViewHints = appearance.showViewHints;
  }
  if (appearance?.tasksViewMode !== undefined) {
    out.tasksViewMode = appearance.tasksViewMode;
  }

  return out;
}
