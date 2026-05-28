"use client";

import { useEffect, useRef, useState } from "react";
import { COUNTRIES } from "./holidays";
import { type Lang, type TranslationKey, t } from "./i18n";
import { JiraSettingsSection } from "./jira-settings";
import { SegmentedControl } from "./segmented-control";
import {
  type StorageConfig,
  defaultStorageConfig,
} from "./storage";
import { StorageConfigSection } from "./storage-config";
import type { Theme } from "./theme";
import { useTheme } from "./use-theme";
import { useMsAuth } from "./use-ms-auth";

type ChatModel =
  | "claude-sonnet-4-6"
  | "claude-opus-4-7"
  | "claude-haiku-4-5-20251001";

export type AiConfig = {
  apiKey: string;
  model: ChatModel;
  consentAccepted: boolean;
};

const defaultAiConfig: AiConfig = {
  apiKey: "",
  model: "claude-sonnet-4-6",
  consentAccepted: false,
};

type ChannelConfig = { enabled: boolean };

type NotificationsConfig = {
  reminderLeadDays: number;
  banner: ChannelConfig;
  toast: ChannelConfig;
  popup: ChannelConfig;
  birthday: ChannelConfig;
};

const defaultNotificationsConfig: NotificationsConfig = {
  reminderLeadDays: 7,
  banner: { enabled: true },
  toast: { enabled: true },
  popup: { enabled: true },
  birthday: { enabled: true },
};

export type JiraAssigneeMode = "currentUser" | "any" | "specific";

export type JiraConfig = {
  enabled: boolean;
  /** e.g. "https://acme.atlassian.net" — no trailing slash */
  siteUrl: string;
  email: string;
  apiToken: string;
  /** e.g. "LOP" */
  projectKey: string;
  /** Display name of the project (cached for UI). */
  projectName: string;
  /** Selected issue types by name, e.g. ["Task", "Story", "Bug"]. */
  issueTypes: string[];
  assigneeMode: JiraAssigneeMode;
  /** Used when assigneeMode === "specific". Jira's stable accountId. */
  assigneeAccountId: string;
  assigneeDisplayName: string;
  /** Optional ISO date "YYYY-MM-DD" the user records from Atlassian; "" = unknown/never. Drives proactive warnings. */
  tokenExpiresAt: string;
  /** ISO timestamp set when a Jira call returns 401/403; cleared on the next successful sync/test. Drives the reactive "rejected" state. */
  tokenInvalidAt?: string;
};

export const defaultJiraConfig: JiraConfig = {
  enabled: false,
  siteUrl: "",
  email: "",
  apiToken: "",
  projectKey: "",
  projectName: "",
  issueTypes: [],
  assigneeMode: "currentUser",
  assigneeAccountId: "",
  assigneeDisplayName: "",
  tokenExpiresAt: "",
};

export type M365IntegrationsSettings = {
  enabled: boolean;
  clientId?: string;
  tenantId?: string;
  sharepoint: boolean;
  outlookContacts: boolean;
  outlookCalendar: boolean;
};

export type TursoIntegrationsSettings = {
  enabled: boolean;
};

export type IntegrationsSettings = {
  m365?: M365IntegrationsSettings;
  turso?: TursoIntegrationsSettings;
};

export const defaultM365Integrations: M365IntegrationsSettings = {
  enabled: false,
  sharepoint: false,
  outlookContacts: false,
  outlookCalendar: false,
};

export const defaultTursoIntegrations: TursoIntegrationsSettings = {
  enabled: false,
};

export const defaultIntegrations: IntegrationsSettings = {
  m365: defaultM365Integrations,
  turso: defaultTursoIntegrations,
};

export function sanitizeIntegrations(raw: unknown): IntegrationsSettings {
  if (!raw || typeof raw !== "object") return { ...defaultIntegrations };
  const obj = raw as Record<string, unknown>;
  const m365Raw = obj.m365 as Record<string, unknown> | undefined;
  const tursoRaw = obj.turso as Record<string, unknown> | undefined;
  return {
    m365: {
      enabled: typeof m365Raw?.enabled === "boolean" ? m365Raw.enabled : false,
      clientId: typeof m365Raw?.clientId === "string" ? m365Raw.clientId : undefined,
      tenantId: typeof m365Raw?.tenantId === "string" ? m365Raw.tenantId : undefined,
      sharepoint: typeof m365Raw?.sharepoint === "boolean" ? m365Raw.sharepoint : false,
      outlookContacts: typeof m365Raw?.outlookContacts === "boolean" ? m365Raw.outlookContacts : false,
      outlookCalendar: typeof m365Raw?.outlookCalendar === "boolean" ? m365Raw.outlookCalendar : false,
    },
    turso: {
      enabled: typeof tursoRaw?.enabled === "boolean" ? tursoRaw.enabled : false,
    },
  };
}

export type Settings = {
  language: Lang;
  holidayCountries: string[];
  storageConfig: StorageConfig;
  ai: AiConfig;
  notifications: NotificationsConfig;
  jira: JiraConfig;
  popout: { reuseWindow: boolean };
  resources: { workdayHours: number };
  integrations?: IntegrationsSettings;
};

export const defaultSettings: Settings = {
  language: "en-US",
  holidayCountries: [],
  storageConfig: defaultStorageConfig,
  ai: defaultAiConfig,
  notifications: defaultNotificationsConfig,
  jira: defaultJiraConfig,
  popout: { reuseWindow: false },
  resources: { workdayHours: 8 },
  integrations: defaultIntegrations,
};

export function SettingsMenu({
  settings,
  onChange,
  storageDescription,
  storageReady,
  onPickStorageFile,
  onOpenStorageFile,
  onGrantStorageWrite,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  storageDescription: string | null;
  storageReady: boolean;
  onPickStorageFile: () => Promise<void>;
  onOpenStorageFile: () => Promise<void>;
  onGrantStorageWrite: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
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
  }, [open]);

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
        onClick={() => setOpen((o) => !o)}
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
            <span className="mb-1 block text-sm font-medium text-foreground">
              {t(lang, "theme")}
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

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-foreground">
              {t(lang, "language")}
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
            <span className="mb-1 block text-sm font-medium text-foreground">
              {t(lang, "holidayCountries")}
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
            <span className="mb-1 block text-sm font-medium text-foreground">
              {t(lang, "notifications")}
            </span>
            <p className="mb-2 text-xs text-muted-foreground">
              {t(lang, "notificationsHint")}
            </p>
            <label className="mb-2 flex items-center justify-between gap-2 text-sm text-foreground">
              {t(lang, "reminderLeadDays")}
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
            </div>
          </div>

          <hr className="my-4 border-line" />

          <div className="mb-4">
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
          </div>

          <hr className="my-4 border-line" />

          <div className="mb-4">
            <label className="flex items-center justify-between gap-2">
              <span className="text-sm text-foreground">
                {t(lang, "resourcesWorkdayHours")}
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
            <span className="mb-1 block text-sm font-medium text-foreground">
              {t(lang, "aiAssistant")}
            </span>
            <label className="mt-2 block">
              <span className="mb-1 block text-xs text-muted-foreground">
                {t(lang, "aiApiKey")}
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
              <span className="mb-1 block text-xs text-muted-foreground">
                {t(lang, "aiModel")}
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
            description={storageDescription}
            ready={storageReady}
            onPickFile={onPickStorageFile}
            onOpenFile={onOpenStorageFile}
            onGrantWrite={onGrantStorageWrite}
          />

          <hr className="my-4 border-line" />

          <div className="rounded-md border border-line bg-surface p-3">
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              {t(lang, "integrations")}
            </h3>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={m365.enabled}
                onChange={(e) => updateM365({ enabled: e.target.checked })}
                className="h-4 w-4"
              />
              <span>{t(lang, "integrationsM365")}</span>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, "integrationsM365Hint")}
            </p>

            {m365.enabled && (
              <div className="mt-3 space-y-2 border-l-2 border-line pl-3">
                {!envClientIdSet && (
                  <label className="block text-xs">
                    <span className="text-muted-foreground">
                      {t(lang, "integrationsM365ClientId")}
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
                    <span className="text-muted-foreground">
                      {t(lang, "integrationsM365TenantId")}
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
                  <legend className="text-xs text-muted-foreground">
                    {t(lang, "integrationsComingSoon")}
                  </legend>
                  {(
                    [
                      ["integrationsSharepoint", "sharepoint", false] as const,
                      ["integrationsOutlookContacts", "outlookContacts", true] as const,
                      ["integrationsOutlookCalendar", "outlookCalendar", true] as const,
                    ]
                  ).map(([labelKey, key, comingSoon]) => (
                    <label
                      key={labelKey}
                      className={`mt-1 flex items-center gap-2 text-sm ${comingSoon ? "text-muted-foreground" : "text-foreground"}`}
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
                        readOnly={comingSoon}
                        className={`h-4 w-4 ${comingSoon ? "cursor-not-allowed" : ""}`}
                      />
                      <span>{t(lang, labelKey)}</span>
                    </label>
                  ))}
                </fieldset>
              </div>
            )}

            <label
              className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"
              title={t(lang, "integrationsComingSoon")}
            >
              <input
                type="checkbox"
                disabled
                checked={turso.enabled}
                readOnly
                className="h-4 w-4 cursor-not-allowed"
              />
              <span>{t(lang, "integrationsTurso")}</span>
            </label>
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
