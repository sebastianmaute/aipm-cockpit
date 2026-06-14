// src/app/settings-view.tsx
"use client";

import { useState } from "react";
import { type Lang, type TranslationKey, t, localeFor } from "./i18n";
import type { Settings } from "./settings-types";
import type { StorageKind } from "./storage";
import { APP_LICENSE, APP_LICENSE_URL, APP_VERSION_LABEL } from "./version";
import { VersionInfoModal } from "./version-info";
import { InfoTooltip } from "./info-tooltip";
import { AppearanceSection } from "./settings-sections/appearance-section";
import { LocalizationSection } from "./settings-sections/localization-section";
import { GeneralSection } from "./settings-sections/general-section";
import { NotificationsSection } from "./settings-sections/notifications-section";
import { NextActionsSection } from "./settings-sections/next-actions-section";
import { AiSection } from "./settings-sections/ai-section";
import { IntegrationsSection } from "./settings-sections/integrations-section";
import { ModeSection } from "./settings-sections/mode-section";
import { TemplatesSection } from "./settings-sections/templates-section";
import { InformationFlowsSection } from "./settings-sections/information-flows-section";
import { ExportSection } from "./settings-sections/export-section";
import { JiraSettingsSection } from "./jira-settings";
import { StorageConfigSection } from "./storage-config";
import type { FeatureModuleId } from "./feature-modules";

interface SettingsViewProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  onCommitFeatures: (features: FeatureModuleId[]) => void;
  storageDescription: string | null;
  storageReady: boolean;
  onPickStorageFile: () => Promise<void>;
  onOpenStorageFile: () => Promise<void>;
  onGrantStorageWrite: () => Promise<void>;
  onRequestStorageSwitch: (kind: StorageKind) => void;
  onMigrateToTurso?: () => void;
}

type SectionId =
  | "mode" | "templates" | "appearance" | "localization" | "general" | "notifications"
  | "nextActions" | "ai" | "jira" | "storage" | "integrations" | "export" | "informationFlows";

const RAIL: { id: SectionId; labelKey: TranslationKey }[] = [
  { id: "mode", labelKey: "settingsSectionMode" },
  { id: "templates", labelKey: "settingsSectionTemplates" },
  { id: "appearance", labelKey: "settingsSectionAppearance" },
  { id: "localization", labelKey: "settingsSectionLocalization" },
  { id: "general", labelKey: "settingsSectionGeneral" },
  { id: "notifications", labelKey: "settingsSectionNotifications" },
  { id: "ai", labelKey: "settingsSectionAi" },
  { id: "jira", labelKey: "settingsSectionJira" },
  { id: "storage", labelKey: "settingsSectionStorage" },
  { id: "integrations", labelKey: "settingsSectionIntegrations" },
  { id: "export", labelKey: "settingsSectionExport" },
  { id: "nextActions", labelKey: "settingsSectionNextActions" },
  { id: "informationFlows", labelKey: "settingsSectionInformationFlows" },
];

// Advanced sections revealed only in expert mode.
const EXPERT_IDS: readonly SectionId[] = ["nextActions", "notifications", "templates", "mode", "export"];
// Connectivity sections grouped together above Information flows (own divider).
const INTEGRATION_IDS: readonly SectionId[] = ["ai", "jira", "integrations"];
// Storage gets its own divider group between connectivity and information flows.
const STORAGE_ID: SectionId = "storage";
const FLOWS_ID: SectionId = "informationFlows";

export function SettingsView(props: SettingsViewProps) {
  const { lang, settings, onChange } = props;
  // Default to an always-visible section ("mode" is expert-gated).
  const [active, setActive] = useState<SectionId>("appearance");
  const [showVersion, setShowVersion] = useState(false);

  const expert = settings.expertMode === true;
  const byLabel = (a: { labelKey: TranslationKey }, b: { labelKey: TranslationKey }) =>
    t(lang, a.labelKey).localeCompare(t(lang, b.labelKey), localeFor(lang));

  // Main group: everything except storage, integrations + flows, with expert-only
  // sections shown only in expert mode. Alphabetical by label.
  const mainEntries = RAIL.filter(
    (r) =>
      r.id !== FLOWS_ID &&
      r.id !== STORAGE_ID &&
      !INTEGRATION_IDS.includes(r.id) &&
      (expert || !EXPERT_IDS.includes(r.id)),
  ).sort(byLabel);
  const integrationEntries = RAIL.filter((r) => INTEGRATION_IDS.includes(r.id)).sort(byLabel);
  const storageEntry = RAIL.find((r) => r.id === STORAGE_ID);
  const flowsEntry = RAIL.find((r) => r.id === FLOWS_ID);

  const toggleExpert = (next: boolean) => {
    onChange({ ...settings, expertMode: next });
    // Leaving expert mode while parked on an expert-only section would blank the
    // panel — fall back to an always-visible section.
    if (!next && EXPERT_IDS.includes(active)) setActive("appearance");
  };

  const renderRailButton = ({ id, labelKey }: { id: SectionId; labelKey: TranslationKey }) => {
    const isActive = active === id;
    return (
      <button
        key={id}
        type="button"
        aria-current={isActive ? "page" : undefined}
        onClick={() => setActive(id)}
        className={
          isActive
            ? "rounded-md bg-AIPM-dark-blue px-3 py-2 text-left text-sm font-medium text-white"
            : "rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
        }
      >
        {t(lang, labelKey)}
      </button>
    );
  };

  return (
    <>
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 md:flex-row">
      <nav
        aria-label={t(lang, "settings")}
        className="flex shrink-0 flex-row flex-wrap gap-1 md:w-56 md:flex-col"
      >
        <label className="mb-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={expert}
            aria-label={t(lang, "settingsExpertMode")}
            onChange={(e) => toggleExpert(e.target.checked)}
            className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
          />
          <span className="inline-flex items-center gap-1">
            {t(lang, "settingsExpertMode")}
            <InfoTooltip text={t(lang, "settingsExpertModeHint")} />
          </span>
        </label>
        {mainEntries.map(renderRailButton)}
        {integrationEntries.length > 0 && (
          <>
            <hr className="my-1 border-line" />
            {integrationEntries.map(renderRailButton)}
          </>
        )}
        {storageEntry && (
          <>
            <hr className="my-1 border-line" />
            {renderRailButton(storageEntry)}
          </>
        )}
        {flowsEntry && (
          <>
            <hr className="my-1 border-line" />
            {renderRailButton(flowsEntry)}
          </>
        )}
      </nav>

      <section className="min-w-0 flex-1 rounded-lg border border-line bg-surface p-6">
        {active === "mode" && (
          <ModeSection
            // Remount when the active project's functions change so the draft
            // re-seeds from the new set — prevents a stale draft (and thus
            // saving the old project's functions) after a project switch.
            key={(settings.features ?? []).join("|")}
            lang={lang}
            settings={settings}
            onCommitFeatures={props.onCommitFeatures}
            onChange={onChange}
          />
        )}
        {active === "templates" && <TemplatesSection lang={lang} />}
        {active === "appearance" && (
          <AppearanceSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "localization" && (
          <LocalizationSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "general" && (
          <GeneralSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "notifications" && (
          <NotificationsSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "nextActions" && (
          <NextActionsSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "ai" && (
          <AiSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "jira" && (
          <JiraSettingsSection
            lang={lang}
            config={settings.jira}
            onChange={(jira) => onChange({ ...settings, jira })}
            alwaysOpen
          />
        )}
        {active === "storage" && (
          <StorageConfigSection
            lang={lang}
            config={settings.storageConfig}
            onChange={(storageConfig) => onChange({ ...settings, storageConfig })}
            onRequestSwitch={props.onRequestStorageSwitch}
            description={props.storageDescription}
            ready={props.storageReady}
            onPickFile={props.onPickStorageFile}
            onOpenFile={props.onOpenStorageFile}
            onGrantWrite={props.onGrantStorageWrite}
            m365Enabled={settings.integrations?.m365?.enabled ?? false}
            sharepointEnabled={settings.integrations?.m365?.sharepoint ?? false}
            tursoEnabled={settings.integrations?.turso?.enabled ?? false}
          />
        )}
        {active === "integrations" && (
          <IntegrationsSection lang={lang} settings={settings} onChange={onChange} onMigrateToTurso={props.onMigrateToTurso} />
        )}
        {active === "export" && (
          <ExportSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "informationFlows" && (
          <InformationFlowsSection lang={lang} />
        )}
      </section>
    </div>

    <footer className="mx-auto mt-6 flex w-full max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-line pt-4 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setShowVersion(true)}
        title={t(lang, "versionHistory")}
        className="font-medium text-AIPM-dark-blue underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-AIPM-blue"
      >
        {t(lang, "versionVersion")} {APP_VERSION_LABEL}
      </button>
      <span aria-hidden>·</span>
      <a
        href={APP_LICENSE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
      >
        {t(lang, "versionLicense")}: {APP_LICENSE} ↗
      </a>
    </footer>

    <VersionInfoModal lang={lang} open={showVersion} onClose={() => setShowVersion(false)} />
    </>
  );
}
