// src/app/forecast-target.ts
//
// The project's target confidence and proposed scenario (§502 part 4). Both ride
// Workspace.settingsOverrides.forecast beside the Monte Carlo switch, so they travel with
// the project on all six write paths. ABSENCE IS THE DEFAULT: 80 and "no proposal" are
// never stored. Pure and i18n-free.

import type { ForecastScenario } from "./forecast-scenarios";
import { hasAnyOverride } from "./settings-overrides";
import type { SettingsOverrides } from "./settings-types";

export type TargetConfidence = 50 | 80 | 95;
export const TARGET_CONFIDENCES: readonly TargetConfidence[] = [50, 80, 95];
export const DEFAULT_TARGET_CONFIDENCE: TargetConfidence = 80;

const EVEN_ODDS = 0.5;
const PERCENT = 100;

/** The stored target, or 80 when unset. */
export function targetConfidenceOf(o: SettingsOverrides | undefined): TargetConfidence {
  const v = o?.forecast?.targetConfidence;
  return v === 50 || v === 95 ? v : DEFAULT_TARGET_CONFIDENCE;
}

/** The proposed scenario's id, or null when unset or when it names no scenario in
 *  `scenarios` (a deleted one reads as no proposal; undo restoring it brings it back). */
export function proposalIdOf(
  o: SettingsOverrides | undefined,
  scenarios: readonly ForecastScenario[],
): number | null {
  const id = o?.forecast?.proposalScenarioId;
  return id !== undefined && scenarios.some((s) => s.id === id) ? id : null;
}

/** Merge `patch` into `forecast`, dropping undefined fields; undefined when nothing is left. */
function withForecast(
  o: SettingsOverrides | undefined,
  patch: Partial<NonNullable<SettingsOverrides["forecast"]>>,
): SettingsOverrides | undefined {
  const merged = { ...o?.forecast, ...patch };
  const forecast = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
  const next: SettingsOverrides = { ...o };
  delete next.forecast;
  if (Object.keys(forecast).length > 0) next.forecast = forecast;
  return hasAnyOverride(next) ? next : undefined;
}

/** A NEW override with the target set; 80 is stored as absence. */
export function withTargetConfidence(
  o: SettingsOverrides | undefined,
  v: TargetConfidence,
): SettingsOverrides | undefined {
  return withForecast(o, { targetConfidence: v === 50 || v === 95 ? v : undefined });
}

/** A NEW override with the proposal set; null is stored as absence. */
export function withProposal(
  o: SettingsOverrides | undefined,
  id: number | null,
): SettingsOverrides | undefined {
  return withForecast(o, { proposalScenarioId: id ?? undefined });
}

/** The one rule for every part-4 chance dot and the verdict: red below even odds, amber
 *  below the goal, green at or above it. `chance` is a 0..1 probability. */
export function chanceSeverity(chance: number, goal: TargetConfidence): "red" | "amber" | "green" {
  if (chance < EVEN_ODDS) return "red";
  return chance < goal / PERCENT ? "amber" : "green";
}
