// src/app/backend-setup-steps.ts
// Pure, i18n-free, testable engine for the Backend Setup Wizard step model.
// No React dependencies — safe to import from tests without jsdom.

import type { TranslationKey } from "./i18n";
import type { Settings } from "./settings-types";

export type BackendSetupStepKey =
  | "storage"
  | "ai"
  | "jira"
  | "timelog"
  | "review";

export const BACKEND_SETUP_STEPS: readonly {
  key: BackendSetupStepKey;
  titleKey: TranslationKey;
  skippable: boolean;
}[] = [
  { key: "storage", titleKey: "setupWizardStepStorage", skippable: false },
  { key: "ai",      titleKey: "setupWizardStepAi",      skippable: true  },
  { key: "jira",    titleKey: "setupWizardStepJira",    skippable: true  },
  { key: "timelog", titleKey: "setupWizardStepTimelog", skippable: true  },
  { key: "review",  titleKey: "setupWizardStepReview",  skippable: false },
] as const;

/** Clamp an index to [0, total-1]; returns 0 for an empty list. */
export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(index, total - 1));
}

export type SetupSummaryItem = {
  key: BackendSetupStepKey;
  labelKey: TranslationKey;
  configured: boolean;
  /** Optional human-readable detail (e.g. the storage kind). */
  detailText?: string;
};

/**
 * Pure summary of which areas are configured — drives the Review step.
 * Storage is always "configured" (it defaults to indexeddb); only the
 * optional integrations (AI key, Jira enabled, Timelog enabled) can be
 * unconfigured.
 */
export function summarizeBackendSetup(settings: Settings): SetupSummaryItem[] {
  const storageKind = settings.storageConfig?.kind ?? "indexeddb";
  return [
    {
      key: "storage",
      labelKey: "setupWizardStepStorage",
      configured: true,
      detailText: storageKind,
    },
    {
      key: "ai",
      labelKey: "setupWizardStepAi",
      configured: !!(settings.ai?.apiKey?.trim()),
    },
    {
      key: "jira",
      labelKey: "setupWizardStepJira",
      configured: !!(settings.jira?.enabled),
    },
    {
      key: "timelog",
      labelKey: "setupWizardStepTimelog",
      configured: !!(settings.timelog?.enabled),
    },
  ];
}
