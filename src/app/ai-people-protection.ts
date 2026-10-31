// src/app/ai-people-protection.ts
//
// The per-project "AI may see people" switch. PROTECTED IS THE DEFAULT: the
// stored form of "allowed" is `settingsOverrides.ai.peopleAllowed === true`, and
// protected is ABSENCE. Turning it back off deletes the key and folds an empty
// override to undefined, so a project that never allowed people serialises
// byte-for-byte as before. A deployment can force protection on with the
// `ai-people` integration id; the stored value is never touched by that.

import { isIntegrationDisabled } from "./integration-switches";
import { hasAnyOverride } from "./settings-overrides";
import type { SettingsOverrides } from "./settings-types";

/** The deployment forces protection on (AIPM_DISABLED_INTEGRATIONS names `ai-people`). */
export function isPeopleProtectionForced(): boolean {
  return isIntegrationDisabled("ai-people");
}

/** The stored choice alone: true only for an explicit `ai.peopleAllowed === true`. */
export function isPeopleAiAllowedRaw(o: SettingsOverrides | undefined): boolean {
  return o?.ai?.peopleAllowed === true;
}

/** The AI must not see people: the deployment forces it, or the project has not allowed it. */
export function isPeopleProtected(o: SettingsOverrides | undefined): boolean {
  return isPeopleProtectionForced() || !isPeopleAiAllowedRaw(o);
}

/** Return a NEW override with the choice set; `undefined` when none is left. */
export function withPeopleAllowed(
  o: SettingsOverrides | undefined,
  allowed: boolean,
): SettingsOverrides | undefined {
  const next: SettingsOverrides = { ...o };
  delete next.ai;
  if (allowed) next.ai = { peopleAllowed: true };
  return hasAnyOverride(next) ? next : undefined;
}
