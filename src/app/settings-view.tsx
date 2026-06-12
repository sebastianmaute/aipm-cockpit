// src/app/settings-view.tsx
"use client";

import { useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import type { Settings } from "./settings-types";
import type { StorageKind } from "./storage";
import { APP_LICENSE, APP_LICENSE_URL, APP_VERSION_LABEL } from "./version";
import { VersionInfoModal } from "./version-info";
import { AppearanceSection } from "./settings-sections/appearance-section";
import { LocalizationSection } from "./settings-sections/localization-section";
import { GeneralSection } from "./settings-sections/general-section";
import { NotificationsSection } from "./settings-sections/notifications-section";
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
}

type SectionId =
  | "mode" | "templates" | "appearance" | "localization" | "general" | "notifications"
  | "ai" | "jira" | "storage" | "integrations" | "export" | "informationFlows";

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
  { id: "informationFlows", labelKey: "settingsSectionInformationFlows" },
];

export function SettingsView(props: SettingsViewProps) {
  const { lang, settings, onChange } = props;
  const [active, setActive] = useState<SectionId>("mode");
  const [showVersion, setShowVersion] = useState(false);

  return (
    <>
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 md:flex-row">
      <nav
        aria-label={t(lang, "settings")}
        className="flex shrink-0 flex-row flex-wrap gap-1 md:w-56 md:flex-col"
      >
        {RAIL.map(({ id, labelKey }) => {
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
        })}
      </nav>

      <section className="min-w-0 flex-1 rounded-lg border border-line bg-surface p-6">
        {active === "mode" && (
          <ModeSection
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
          <IntegrationsSection lang={lang} settings={settings} onChange={onChange} />
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
