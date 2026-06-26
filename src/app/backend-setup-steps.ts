// src/app/backend-setup-steps.ts
// Pure, i18n-free, testable engine for the Backend Setup Wizard step model.
// No React dependencies — safe to import from tests without jsdom.

import type { TranslationKey } from "./i18n";
import type { Settings } from "./settings-types";
import { getTursoConfig } from "./turso-config";

// Storage-kind → i18n label key (mirrors STORAGE_OPTIONS in storage-config.tsx
// without importing that React surface into this pure engine).
const STORAGE_KIND_LABEL_KEYS: Record<string, TranslationKey> = {
  browser: "storageBrowser",
  "local-json": "storageLocalJson",
  "local-csv": "storageLocalCsv",
  "local-md": "storageLocalMd",
  "sp-json": "storageSpJson",
  "sp-csv": "storageSpCsv",
  turso: "storageTurso",
};

// clampStep is shared with the guided tour — re-export rather than re-implement
// (identical bounds-clamp; one fix can't drift from the other).
export { clampStep } from "./app-tour";

export type BackendSetupStepKey =
  | "storage"
  | "ai"
  | "jira"
  | "review";

// The "Storage & connections" step reuses the whole IntegrationsSection, which
// already includes Microsoft 365 AND Timelog — so there is no dedicated Timelog
// step (it would duplicate the same form). Jira + AI are NOT part of
// IntegrationsSection, so they get their own steps.
export const BACKEND_SETUP_STEPS: readonly {
  key: BackendSetupStepKey;
  titleKey: TranslationKey;
  skippable: boolean;
}[] = [
  { key: "storage", titleKey: "setupWizardStepStorage", skippable: false },
  { key: "ai",      titleKey: "setupWizardStepAi",      skippable: true  },
  { key: "jira",    titleKey: "setupWizardStepJira",    skippable: true  },
  { key: "review",  titleKey: "setupWizardStepReview",  skippable: false },
] as const;

export type SetupSummaryItem = {
  /** React list key — covers more areas (M365, Timelog) than the step keys. */
  key: string;
  labelKey: TranslationKey;
  configured: boolean;
  /** Optional i18n key for a detail (e.g. the storage kind) — translated by
   *  the caller so the bilingual Review step never shows a raw enum value. */
  detailKey?: TranslationKey;
};

/**
 * Pure summary of which areas are configured — drives the Review step.
 * A local-file/IndexedDB storage backend always "works"; a Turso backend is
 * only configured once a database URL AND auth token are present (the
 * `storageConfig.kind === "turso"` vs real-config landmine — kind can be
 * "turso" with the config quarantined/empty, which must NOT read as green).
 */
export function summarizeBackendSetup(settings: Settings): SetupSummaryItem[] {
  const storageKind = settings.storageConfig?.kind ?? "browser";
  const turso = settings.integrations?.turso;
  // Reuse the canonical resolver (env vars, loopback, URL validation) so the
  // Review verdict matches what actually drives the Turso backend — not a
  // divergent inline url+token check.
  const storageConfigured =
    storageKind === "turso"
      ? getTursoConfig(turso?.databaseUrl, turso?.authToken) !== null
      : true;
  return [
    {
      key: "storage",
      labelKey: "setupWizardStepStorage",
      configured: storageConfigured,
      detailKey: STORAGE_KIND_LABEL_KEYS[storageKind],
    },
    {
      key: "m365",
      labelKey: "integrationsM365",
      configured: !!settings.integrations?.m365?.enabled,
    },
    {
      key: "ai",
      labelKey: "setupWizardStepAi",
      configured: !!settings.ai?.apiKey?.trim(),
    },
    {
      key: "jira",
      labelKey: "setupWizardStepJira",
      configured: !!settings.jira?.enabled,
    },
    {
      key: "timelog",
      labelKey: "setupWizardStepTimelog",
      configured: !!settings.timelog?.enabled,
    },
  ];
}
