// src/app/settings-view.tsx
"use client";

import { useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import type { Settings } from "./settings-types";
import type { StorageKind } from "./storage";
import { AppearanceSection } from "./settings-sections/appearance-section";
import { LocalizationSection } from "./settings-sections/localization-section";
import { GeneralSection } from "./settings-sections/general-section";
import { NotificationsSection } from "./settings-sections/notifications-section";
import { AiSection } from "./settings-sections/ai-section";
import { IntegrationsSection } from "./settings-sections/integrations-section";
import { JiraSettingsSection } from "./jira-settings";
import { StorageConfigSection } from "./storage-config";

interface SettingsViewProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  storageDescription: string | null;
  storageReady: boolean;
  onPickStorageFile: () => Promise<void>;
  onOpenStorageFile: () => Promise<void>;
  onGrantStorageWrite: () => Promise<void>;
  onRequestStorageSwitch: (kind: StorageKind) => void;
}

type SectionId =
  | "appearance" | "localization" | "general" | "notifications"
  | "ai" | "jira" | "storage" | "integrations";

const RAIL: { id: SectionId; labelKey: TranslationKey }[] = [
  { id: "appearance", labelKey: "settingsSectionAppearance" },
  { id: "localization", labelKey: "settingsSectionLocalization" },
  { id: "general", labelKey: "settingsSectionGeneral" },
  { id: "notifications", labelKey: "settingsSectionNotifications" },
  { id: "ai", labelKey: "settingsSectionAi" },
  { id: "jira", labelKey: "settingsSectionJira" },
  { id: "storage", labelKey: "settingsSectionStorage" },
  { id: "integrations", labelKey: "settingsSectionIntegrations" },
];

export function SettingsView(props: SettingsViewProps) {
  const { lang, settings, onChange } = props;
  const [active, setActive] = useState<SectionId>("appearance");

  return (
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
      </section>
    </div>
  );
}
