// src/app/forecast-simulation.ts
//
// The per-project "Use Monte Carlo forecasting" switch (§502). It rides
// Workspace.settingsOverrides.forecast, so it travels with the project on all
// six write paths. OFF IS ABSENCE: turning it off deletes the key and folds an
// empty override to undefined, so a project that never turned it on serialises
// byte-for-byte as before.

import { isViewEnabled } from "./feature-modules";
import type { FeatureModuleId } from "./feature-modules";
import { hasAnyOverride } from "./settings-overrides";
import type { SettingsOverrides } from "./settings-types";

/** True only for an explicit `forecast.showSimulation === true`. */
export function isSimulationOn(o: SettingsOverrides | undefined): boolean {
  return o?.forecast?.showSimulation === true;
}

/** The switch as every simulation surface must read it: hiding the Forecast view hides the
 *  simulation with it, whatever is stored. The stored value is never touched, so showing the
 *  view again restores the user's choice. `isSimulationOn` stays the raw read for the writer. */
export function isSimulationActive(
  o: SettingsOverrides | undefined,
  features: readonly FeatureModuleId[],
): boolean {
  return isViewEnabled("forecast", features) && isSimulationOn(o);
}

/** Return a NEW override with the switch set; `undefined` when none is left. */
export function withSimulation(
  o: SettingsOverrides | undefined,
  on: boolean,
): SettingsOverrides | undefined {
  // The target and the proposal are project data, not part of the switch: only showSimulation moves.
  const kept = { ...o?.forecast };
  delete kept.showSimulation;
  return withForecastObject(o, on ? { showSimulation: true, ...kept } : kept);
}

/** Replace `forecast` wholesale: undefined fields are dropped, an empty object removes the key, and an
 *  override left with nothing folds to undefined. The one fold shared by the switch and the target/proposal. */
export function withForecastObject(
  o: SettingsOverrides | undefined,
  forecast: NonNullable<SettingsOverrides["forecast"]>,
): SettingsOverrides | undefined {
  const kept = Object.fromEntries(Object.entries(forecast).filter(([, v]) => v !== undefined));
  const next: SettingsOverrides = { ...o };
  delete next.forecast;
  if (Object.keys(kept).length > 0) next.forecast = kept;
  return hasAnyOverride(next) ? next : undefined;
}

/** Pin `target`'s switch to `current`'s. The switch is a viewing choice, not project data, so a
 *  version restore must neither turn it on nor off. Returns `target` itself when they agree. */
export function keepSimulationSwitch(
  target: SettingsOverrides | undefined,
  current: SettingsOverrides | undefined,
): SettingsOverrides | undefined {
  const on = isSimulationOn(current);
  if (isSimulationOn(target) === on) return target;
  return withSimulation(target, on);
}
