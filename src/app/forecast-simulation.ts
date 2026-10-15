// src/app/forecast-simulation.ts
//
// The per-project "show simulation" switch (§502). It rides
// Workspace.settingsOverrides.forecast, so it travels with the project on all
// six write paths. OFF IS ABSENCE: turning it off deletes the key and folds an
// empty override to undefined, so a project that never turned it on serialises
// byte-for-byte as before.

import { hasAnyOverride } from "./settings-overrides";
import type { SettingsOverrides } from "./settings-types";

/** True only for an explicit `forecast.showSimulation === true`. */
export function isSimulationOn(o: SettingsOverrides | undefined): boolean {
  return o?.forecast?.showSimulation === true;
}

/** Return a NEW override with the switch set; `undefined` when none is left. */
export function withSimulation(
  o: SettingsOverrides | undefined,
  on: boolean,
): SettingsOverrides | undefined {
  const next: SettingsOverrides = { ...o };
  delete next.forecast;
  if (on) next.forecast = { showSimulation: true };
  return hasAnyOverride(next) ? next : undefined;
}
