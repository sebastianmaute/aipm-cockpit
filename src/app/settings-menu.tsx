"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { JiraSettingsSection } from "./jira-settings";
import { type StorageKind } from "./storage";
import { StorageConfigSection } from "./storage-config";
import { useMsAuth } from "./use-ms-auth";
import { InfoTooltip } from "./info-tooltip";
import { AppearanceSection } from "./settings-sections/appearance-section";
import { GeneralSection } from "./settings-sections/general-section";
import { LocalizationSection } from "./settings-sections/localization-section";
import { NotificationsSection } from "./settings-sections/notifications-section";
import { AiSection } from "./settings-sections/ai-section";
import {
  type Settings,
  type TursoIntegrationsSettings,
  type M365IntegrationsSettings,
  defaultIntegrations,
  defaultM365Integrations,
  defaultTursoIntegrations,
} from "./settings-types";

export {
  defaultAiConfig,
  defaultNotificationsConfig,
  defaultJiraConfig,
  defaultM365Integrations,
  defaultTursoIntegrations,
  defaultIntegrations,
  sanitizeIntegrations,
  defaultSettings,
} from "./settings-types";
export type {
  ChatModel,
  AiConfig,
  ChannelConfig,
  NotificationsConfig,
  JiraAssigneeMode,
  JiraConfig,
  M365IntegrationsSettings,
  TursoIntegrationsSettings,
  IntegrationsSettings,
  Settings,
} from "./settings-types";

export function SettingsMenu({
  settings,
  onChange,
  storageDescription,
  storageReady,
  onPickStorageFile,
  onOpenStorageFile,
  onGrantStorageWrite,
  onRequestStorageSwitch,
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

  const integrations = settings.integrations ?? defaultIntegrations;
  const m365 = integrations.m365 ?? defaultM365Integrations;
  const turso = integrations.turso ?? defaultTursoIntegrations;
  const auth = useMsAuth(m365.enabled);
  const envClientIdSet = !!process.env.NEXT_PUBLIC_MSAL_CLIENT_ID;
  const envTenantIdSet = !!process.env.NEXT_PUBLIC_MSAL_TENANT_ID;
  const envTursoUrlSet = !!process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
  const envTursoTokenSet = !!process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;

  function updateTurso(patch: Partial<TursoIntegrationsSettings>) {
    onChange({
      ...settings,
      integrations: { ...integrations, turso: { ...turso, ...patch } },
    });
  }

  function updateM365(patch: Partial<M365IntegrationsSettings>) {
    onChange({
      ...settings,
      integrations: {
        ...integrations,
        m365: { ...m365, ...patch },
      },
    });
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={t(lang, "settings")}
        aria-expanded={open}
        className="rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-AIPM-green"
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

          <div className="rounded-md border border-line bg-surface p-3">
            <div className="mb-2 flex items-center gap-1">
              <h3 className="text-sm font-semibold text-foreground">{t(lang, "integrations")}</h3>
              <InfoTooltip text={t(lang, "integrationsTooltip")} />
            </div>

            <div className="flex items-center gap-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={m365.enabled}
                  onChange={(e) => updateM365({ enabled: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>{t(lang, "integrationsM365")}</span>
              </label>
              <InfoTooltip text={t(lang, "integrationsM365Tooltip")} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, "integrationsM365Hint")}
            </p>

            {m365.enabled && (
              <div className="mt-3 space-y-2 border-l-2 border-line pl-3">
                {!envClientIdSet && (
                  <label className="block text-xs">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      {t(lang, "integrationsM365ClientId")}
                      <InfoTooltip text={t(lang, "integrationsM365ClientIdTooltip")} />
                    </span>
                    <input
                      type="text"
                      value={m365.clientId ?? ""}
                      onChange={(e) => updateM365({ clientId: e.target.value })}
                      placeholder={t(lang, "integrationsM365ClientIdPlaceholder")}
                      className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
                    />
                  </label>
                )}
                {!envTenantIdSet && (
                  <label className="block text-xs">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      {t(lang, "integrationsM365TenantId")}
                      <InfoTooltip text={t(lang, "integrationsM365TenantIdTooltip")} />
                    </span>
                    <input
                      type="text"
                      value={m365.tenantId ?? ""}
                      onChange={(e) => updateM365({ tenantId: e.target.value })}
                      placeholder={t(lang, "integrationsM365TenantIdPlaceholder")}
                      className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
                    />
                  </label>
                )}

                <div className="flex items-center gap-2">
                  {auth.account ? (
                    <>
                      <span className="text-xs text-foreground">
                        {t(lang, "integrationsM365SignedInAs")} {auth.account.username}
                      </span>
                      <button
                        type="button"
                        onClick={() => { void auth.signOut(); }}
                        className="rounded border border-line bg-surface px-2 py-1 text-xs hover:bg-surface-muted"
                      >
                        {t(lang, "integrationsM365SignOut")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { void auth.signIn(); }}
                      disabled={!envClientIdSet && !m365.clientId}
                      title={
                        !envClientIdSet && !m365.clientId
                          ? t(lang, "integrationsM365NeedsConfig")
                          : undefined
                      }
                      className="rounded border border-AIPM-dark-blue bg-AIPM-dark-blue px-2 py-1 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t(lang, "integrationsM365SignIn")}
                    </button>
                  )}
                </div>

                <fieldset className="mt-3 border-t border-line pt-2">
                  {(
                    [
                      ["integrationsSharepoint", "sharepoint", false, "integrationsSharepointTooltip"],
                      ["integrationsOutlookContacts", "outlookContacts", false, "integrationsOutlookContactsTooltip"],
                      ["integrationsOutlookCalendar", "outlookCalendar", false, "integrationsOutlookCalendarTooltip"],
                    ] as const
                  ).map(([labelKey, key, comingSoon, tooltipKey]) => (
                    <div key={labelKey} className="mt-1 flex items-center gap-1">
                      <label
                        className={`flex items-center gap-2 text-sm ${comingSoon ? "text-muted-foreground" : "text-foreground"}`}
                        title={comingSoon ? t(lang, "integrationsComingSoon") : undefined}
                      >
                        <input
                          type="checkbox"
                          disabled={comingSoon}
                          checked={comingSoon ? false : m365[key]}
                          onChange={
                            comingSoon
                              ? undefined
                              : (e) => updateM365({ [key]: e.target.checked })
                          }
                          className={comingSoon ? "h-4 w-4 cursor-not-allowed" : "h-4 w-4"}
                        />
                        <span>{t(lang, labelKey)}</span>
                      </label>
                      <InfoTooltip text={t(lang, tooltipKey)} />
                    </div>
                  ))}
                </fieldset>
              </div>
            )}

            <div className="mt-3 flex items-center gap-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={turso.enabled}
                  onChange={(e) => updateTurso({ enabled: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>{t(lang, "integrationsTurso")}</span>
              </label>
              <InfoTooltip text={t(lang, "integrationsTursoTooltip")} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, "integrationsTursoHint")}
            </p>
            <p className="mt-1 text-xs">
              <a
                href="https://turso.tech/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-AIPM-dark-blue underline hover:opacity-80"
              >
                {t(lang, "integrationsTursoLearnMore")}
              </a>
            </p>

            {turso.enabled && (
              <div className="mt-2 space-y-2 border-l-2 border-line pl-3">
                {!envTursoUrlSet && (
                  <label className="block text-xs">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      {t(lang, "integrationsTursoUrl")}
                      <InfoTooltip text={t(lang, "integrationsTursoUrlTooltip")} />
                    </span>
                    <input
                      type="text"
                      value={turso.databaseUrl ?? ""}
                      onChange={(e) => updateTurso({ databaseUrl: e.target.value })}
                      placeholder={t(lang, "integrationsTursoUrlPlaceholder")}
                      className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
                    />
                  </label>
                )}
                {!envTursoTokenSet && (
                  <label className="block text-xs">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      {t(lang, "integrationsTursoToken")}
                      <InfoTooltip text={t(lang, "integrationsTursoTokenTooltip")} />
                    </span>
                    <input
                      type="password"
                      value={turso.authToken ?? ""}
                      onChange={(e) => updateTurso({ authToken: e.target.value })}
                      placeholder={t(lang, "integrationsTursoTokenPlaceholder")}
                      className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
                    />
                  </label>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
