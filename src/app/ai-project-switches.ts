// src/app/ai-project-switches.ts
//
// Two per-project AI switches beside the people one. Both are stored as
// `settingsOverrides.ai.<key> === true` and OFF is ABSENCE: turning one off deletes
// the key and folds an empty override to undefined, so a project that never set
// either serialises byte-for-byte as before. A deployment can force either on with
// an integration id; the stored value is never touched by that.

import { isIntegrationDisabled } from "./integration-switches";
import { withAiOverrideFlag } from "./settings-overrides";
import type { SettingsOverrides } from "./settings-types";

/** The deployment forces review of every AI write (AIPM_DISABLED_INTEGRATIONS names `ai-direct-writes`). */
export function isReviewAllWritesForced(): boolean {
  return isIntegrationDisabled("ai-direct-writes");
}

/** Every AI write goes to review: the deployment forces it, or the project chose it. */
export function isReviewAllWrites(o: SettingsOverrides | undefined): boolean {
  return isReviewAllWritesForced() || o?.ai?.reviewAllWrites === true;
}

/** The deployment forces rates out of Plan with AI (AIPM_DISABLED_INTEGRATIONS names `ai-rates`). */
export function isRatesWithheldForced(): boolean {
  return isIntegrationDisabled("ai-rates");
}

/** Rates are kept out of Plan with AI: the deployment forces it, or the project chose it. */
export function isRatesWithheld(o: SettingsOverrides | undefined): boolean {
  return isRatesWithheldForced() || o?.ai?.ratesWithheld === true;
}

/** Return a NEW override with one switch set or cleared; `undefined` when none is left. */
export function withAiSwitch(
  o: SettingsOverrides | undefined,
  key: "reviewAllWrites" | "ratesWithheld",
  on: boolean,
): SettingsOverrides | undefined {
  return withAiOverrideFlag(o, key, on);
}
