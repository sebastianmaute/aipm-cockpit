"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COUNTRIES } from "./holidays";
import { type Lang, type TranslationKey, t } from "./i18n";
import { JiraSettingsSection } from "./jira-settings";
import { SegmentedControl } from "./segmented-control";
import { type StorageKind } from "./storage";
import { StorageConfigSection } from "./storage-config";
import type { Theme } from "./theme";
import { useTheme } from "./use-theme";
import { useMsAuth } from "./use-ms-auth";
import { InfoTooltip } from "./info-tooltip";
import {
  type Settings,
  type TursoIntegrationsSettings,
  type M365IntegrationsSettings,
  type ChatModel,
  type ChannelConfig,
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
  const [pending, setPending] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const lang = settings.language;
  const { theme, setTheme } = useTheme();

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

  const countryName = (code: string) => {
    const c = COUNTRIES.find((c) => c.code === code);
    if (!c) return code;
    return lang === "de" ? c.nameDe : c.nameEn;
  };

  const available = COUNTRIES.filter(
    (c) => !settings.holidayCountries.includes(c.code),
  );

  function addCountry() {
    if (!pending || settings.holidayCountries.includes(pending)) return;
    onChange({
      ...settings,
      holidayCountries: [...settings.holidayCountries, pending],
    });
    setPending("");
  }

  function removeCountry(code: string) {
    onChange({
      ...settings,
      holidayCountries: settings.holidayCountries.filter((c) => c !== code),
    });
  }

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

          <div className="mb-4">
            <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
              {t(lang, "theme")}
              <InfoTooltip text={t(lang, "themeTooltip")} />
            </span>
            <SegmentedControl<Theme>
              value={theme}
              ariaLabel={t(lang, "theme")}
              title={t(lang, "themeHint")}
              className="w-full"
              options={[
                { value: "light", label: t(lang, "themeLight") },
                { value: "dark", label: t(lang, "themeDark") },
                { value: "system", label: t(lang, "themeSystem") },
              ]}
              onChange={setTheme}
            />
          </div>

          <div className="mb-4">
            <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
              {t(lang, "layout")}
              <InfoTooltip text={t(lang, "layoutTooltip")} />
            </span>
            <SegmentedControl<"modern" | "classic">
              value={settings.layout}
              ariaLabel={t(lang, "layout")}
              title={t(lang, "layoutTooltip")}
              className="w-full"
              options={[
                { value: "modern", label: t(lang, "layoutModern") },
                { value: "classic", label: t(lang, "layoutClassic") },
              ]}
              onChange={(v) => onChange({ ...settings, layout: v })}
            />
          </div>

          <label className="mb-4 block">
            <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
              {t(lang, "language")}
              <InfoTooltip text={t(lang, "languageTooltip")} />
            </span>
            <select
              value={settings.language}
              onChange={(e) =>
                onChange({ ...settings, language: e.target.value as Lang })
              }
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
            >
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="de">Deutsch</option>
            </select>
          </label>

          <div>
            <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
              {t(lang, "holidayCountries")}
              <InfoTooltip text={t(lang, "holidayCountriesTooltip")} />
            </span>
            <div className="flex gap-2">
              <select
                value={pending}
                onChange={(e) => setPending(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
              >
                <option value="">{t(lang, "selectCountry")}</option>
                {available.map((c) => (
                  <option key={c.code} value={c.code}>
                    {lang === "de" ? c.nameDe : c.nameEn}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addCountry}
                disabled={!pending}
                className="shrink-0 rounded-md bg-AIPM-dark-blue px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t(lang, "add")}
              </button>
            </div>

            {settings.holidayCountries.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t(lang, "noCountriesSelected")}
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {settings.holidayCountries.map((code) => (
                  <li
                    key={code}
                    className="flex items-center justify-between rounded-md bg-surface-muted px-3 py-1.5 text-sm"
                  >
                    <span className="text-foreground">
                      {countryName(code)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeCountry(code)}
                      aria-label={`${t(lang, "remove")} ${countryName(code)}`}
                      className="text-muted-foreground hover:text-AIPM-pink"
                    >
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                        className="h-4 w-4"
                      >
                        <path
                          fillRule="evenodd"
                          d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <hr className="my-4 border-line" />

          <div className="mb-4">
            <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
              {t(lang, "notifications")}
              <InfoTooltip text={t(lang, "notificationsTooltip")} />
            </span>
            <p className="mb-2 text-xs text-muted-foreground">
              {t(lang, "notificationsHint")}
            </p>
            <label className="mb-2 flex items-center justify-between gap-2 text-sm text-foreground">
              <span className="inline-flex items-center gap-1">
                {t(lang, "reminderLeadDays")}
                <InfoTooltip text={t(lang, "reminderLeadDaysTooltip")} />
              </span>
              <input type="number" min={0} max={365}
                value={settings.notifications.reminderLeadDays}
                onChange={(e) => onChange({ ...settings, notifications: { ...settings.notifications, reminderLeadDays: Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))) } })}
                className="w-20 rounded-md border border-line px-2 py-1 text-right tabular-nums" />
            </label>
            <NotificationRow
              labelKey="notifBanner"
              lang={lang}
              config={settings.notifications.banner}
              onChange={(c) =>
                onChange({
                  ...settings,
                  notifications: { ...settings.notifications, banner: c },
                })
              }
            />
            <NotificationRow
              labelKey="notifToast"
              lang={lang}
              config={settings.notifications.toast}
              onChange={(c) =>
                onChange({
                  ...settings,
                  notifications: { ...settings.notifications, toast: c },
                })
              }
            />
            <NotificationRow
              labelKey="notifPopup"
              lang={lang}
              config={settings.notifications.popup}
              onChange={(c) =>
                onChange({
                  ...settings,
                  notifications: { ...settings.notifications, popup: c },
                })
              }
            />
            <div className="mt-2 flex items-center gap-2 text-sm text-foreground">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.notifications.birthday.enabled}
                  onChange={(e) => onChange({ ...settings, notifications: { ...settings.notifications, birthday: { enabled: e.target.checked } } })} />
                {t(lang, "notifBirthday")}
              </label>
              <InfoTooltip text={t(lang, "notifBirthdayTooltip")} />
            </div>
          </div>

          <hr className="my-4 border-line" />

          <div className="mb-4">
            <div className="flex items-center gap-1">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.popout.reuseWindow}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      popout: { ...settings.popout, reuseWindow: e.target.checked },
                    })
                  }
                  className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
                />
                <span className="text-sm text-foreground">
                  {t(lang, "popoutReuseWindow")}
                </span>
              </label>
              <InfoTooltip text={t(lang, "popoutReuseWindowTooltip")} />
            </div>
          </div>

          <hr className="my-4 border-line" />

          <div className="mb-4">
            <label className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-sm text-foreground">
                {t(lang, "resourcesWorkdayHours")}
                <InfoTooltip text={t(lang, "resourcesWorkdayHoursTooltip")} />
              </span>
              <input
                type="number" min={1} max={24} step={0.5}
                value={settings.resources.workdayHours}
                onChange={(e) => {
                  const n = Math.min(24, Math.max(1, Number(e.target.value) || 8));
                  onChange({ ...settings, resources: { ...settings.resources, workdayHours: n } });
                }}
                className="w-20 rounded-md border border-line px-2 py-1 text-sm"
              />
            </label>
          </div>

          <hr className="my-4 border-line" />

          <div className="mb-4">
            <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
              {t(lang, "aiAssistant")}
              <InfoTooltip text={t(lang, "aiAssistantTooltip")} />
            </span>
            <label className="mt-2 block">
              <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                {t(lang, "aiApiKey")}
                <InfoTooltip text={t(lang, "aiApiKeyTooltip")} />
              </span>
              <input
                type="password"
                autoComplete="off"
                value={settings.ai.apiKey}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    ai: { ...settings.ai, apiKey: e.target.value },
                  })
                }
                placeholder={t(lang, "aiApiKeyPlaceholder")}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
              />
            </label>
            <label className="mt-2 block">
              <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                {t(lang, "aiModel")}
                <InfoTooltip text={t(lang, "aiModelTooltip")} />
              </span>
              <select
                value={settings.ai.model}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    ai: {
                      ...settings.ai,
                      model: e.target.value as ChatModel,
                    },
                  })
                }
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
              >
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="claude-opus-4-7">Claude Opus 4.7</option>
                <option value="claude-haiku-4-5-20251001">
                  Claude Haiku 4.5
                </option>
              </select>
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              {t(lang, "aiApiKeyHint")}
            </p>
            {settings.ai.consentAccepted ? (
              <p className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>✓ {t(lang, "aiConsentGranted")}</span>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...settings,
                      ai: { ...settings.ai, consentAccepted: false },
                    })
                  }
                  className="text-xs font-medium text-AIPM-pink underline-offset-2 hover:underline"
                >
                  {t(lang, "aiConsentRevoke")}
                </button>
              </p>
            ) : (
              <p className="mt-2 text-xs text-AIPM-purple">
                {t(lang, "aiConsentRequired")}
              </p>
            )}
          </div>

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

function NotificationRow({
  labelKey,
  lang,
  config,
  onChange,
}: {
  labelKey: TranslationKey;
  lang: Lang;
  config: ChannelConfig;
  onChange: (c: ChannelConfig) => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
        />
        <span className="text-foreground">
          {t(lang, labelKey)}
        </span>
      </label>
    </div>
  );
}
