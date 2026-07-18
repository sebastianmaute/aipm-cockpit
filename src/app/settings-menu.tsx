"use client";

import { useCallback, useRef, useState } from "react";
import { usePopoverDismiss } from "./use-popover-dismiss";
import { t } from "./i18n";
import { JiraSettingsSection } from "./jira-settings";
import { type StorageKind } from "./storage";
import { StorageConfigSection } from "./storage-config";
import { AppearanceSection } from "./settings-sections/appearance-section";
import { GeneralSection } from "./settings-sections/general-section";
import { LocalizationSection } from "./settings-sections/localization-section";
import { NotificationsSection } from "./settings-sections/notifications-section";
import { AiSection } from "./settings-sections/ai-section";
import { IntegrationsSection } from "./settings-sections/integrations-section";
import { TemplatesSection } from "./settings-sections/templates-section";
import { type Settings } from "./settings-types";

export function SettingsMenu({
  settings,
  onChange,
  storageDescription,
  storageReady,
  onPickStorageFile,
  onOpenStorageFile,
  onGrantStorageWrite,
  onRequestStorageSwitch,
  onMigrateToTurso,
  open: controlledOpen,
  onOpenChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  storageDescription: string | null;
  storageReady: boolean;
  onPickStorageFile: () => Promise<void>;
  onOpenStorageFile: () => Promise<void>;
  onGrantStorageWrite: () => Promise<void>;
  onRequestStorageSwitch: (kind: StorageKind) => void;
  onMigrateToTurso?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange) onOpenChange(next);
      else setInternalOpen(next);
    },
    [onOpenChange],
  );
  const ref = useRef<HTMLDivElement>(null);
  const lang = settings.language;

  usePopoverDismiss(open, ref, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={t(lang, "settings")}
        aria-expanded={open}
        className="rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className="h-5 w-5"
        >
          <path
            fillRule="evenodd"
            d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t(lang, "settings")}
          className="absolute right-0 top-full z-20 mt-2 max-h-[80vh] w-80 overflow-y-auto rounded-lg border border-line bg-surface p-4"
        >
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(lang, "settings")}
          </h3>

          <AppearanceSection lang={lang} settings={settings} onChange={onChange} />

          <LocalizationSection lang={lang} settings={settings} onChange={onChange} />

          <hr className="my-4 border-line" />

          <TemplatesSection lang={lang} />

          <hr className="my-4 border-line" />

          <NotificationsSection lang={lang} settings={settings} onChange={onChange} />

          <hr className="my-4 border-line" />

          <GeneralSection lang={lang} settings={settings} onChange={onChange} />

          <hr className="my-4 border-line" />

          <AiSection lang={lang} settings={settings} onChange={onChange} />

          <hr className="my-4 border-line" />

          <JiraSettingsSection
            lang={lang}
            config={settings.jira}
            onChange={(jira) => onChange({ ...settings, jira })}
          />

          <hr className="my-4 border-line" />

          <StorageConfigSection
            lang={lang}
            config={settings.storageConfig}
            onChange={(storageConfig) =>
              onChange({ ...settings, storageConfig })
            }
            onRequestSwitch={onRequestStorageSwitch}
            description={storageDescription}
            ready={storageReady}
            onPickFile={onPickStorageFile}
            onOpenFile={onOpenStorageFile}
            onGrantWrite={onGrantStorageWrite}
            m365Enabled={settings.integrations?.m365?.enabled ?? false}
            sharepointEnabled={settings.integrations?.m365?.sharepoint ?? false}
            tursoEnabled={settings.integrations?.turso?.enabled ?? false}
          />

          <hr className="my-4 border-line" />

          <IntegrationsSection lang={lang} settings={settings} onChange={onChange} onMigrateToTurso={onMigrateToTurso} />
        </div>
      )}
    </div>
  );
}
