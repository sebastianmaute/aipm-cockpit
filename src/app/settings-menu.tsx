"use client";

import { useEffect, useRef, useState } from "react";
import { COUNTRIES } from "./holidays";
import { type Lang, type TranslationKey, t } from "./i18n";
import { JiraSettingsSection } from "./jira-settings";
import {
  type StorageConfig,
  defaultStorageConfig,
} from "./storage";
import { StorageConfigSection } from "./storage-config";

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

type DueNotificationKind = "banner" | "toast" | "popup";

type DueNotificationConfig = {
  enabled: boolean;
  thresholdWorkDays: number;
};

type NotificationsConfig = {
  banner: DueNotificationConfig;
  toast: DueNotificationConfig;
  popup: DueNotificationConfig;
};

const defaultNotificationsConfig: NotificationsConfig = {
  banner: { enabled: true, thresholdWorkDays: 3 },
  toast: { enabled: true, thresholdWorkDays: 3 },
  popup: { enabled: true, thresholdWorkDays: 3 },
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
};

export type Settings = {
  language: Lang;
  holidayCountries: string[];
  storageConfig: StorageConfig;
  ai: AiConfig;
  notifications: NotificationsConfig;
  jira: JiraConfig;
  popout: { reuseWindow: boolean };
};

export const defaultSettings: Settings = {
  language: "en-US",
  holidayCountries: [],
  storageConfig: defaultStorageConfig,
  ai: defaultAiConfig,
  notifications: defaultNotificationsConfig,
  jira: defaultJiraConfig,
  popout: { reuseWindow: false },
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
        className="rounded-md p-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
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
          className="absolute right-0 top-full z-20 mt-2 max-h-[80vh] w-80 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t(lang, "settings")}
          </h3>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t(lang, "language")}
            </span>
            <select
              value={settings.language}
              onChange={(e) =>
                onChange({ ...settings, language: e.target.value as Lang })
              }
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="de">Deutsch</option>
            </select>
          </label>

          <div>
            <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t(lang, "holidayCountries")}
            </span>
            <div className="flex gap-2">
              <select
                value={pending}
                onChange={(e) => setPending(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
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
                className="shrink-0 rounded-md bg-AIPM-dark-blue px-3 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t(lang, "add")}
              </button>
            </div>

            {settings.holidayCountries.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                {t(lang, "noCountriesSelected")}
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {settings.holidayCountries.map((code) => (
                  <li
                    key={code}
                    className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-1.5 text-sm dark:bg-zinc-800"
                  >
                    <span className="text-zinc-800 dark:text-zinc-100">
                      {countryName(code)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeCountry(code)}
                      aria-label={`${t(lang, "remove")} ${countryName(code)}`}
                      className="text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400"
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

          <hr className="my-4 border-zinc-200 dark:border-zinc-800" />

          <div className="mb-4">
            <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t(lang, "notifications")}
            </span>
            <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
              {t(lang, "notificationsHint")}
            </p>
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
          </div>

          <hr className="my-4 border-zinc-200 dark:border-zinc-800" />

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
                className="h-4 w-4 rounded border-zinc-300 text-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-600 dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                {t(lang, "popoutReuseWindow")}
              </span>
            </label>
          </div>

          <hr className="my-4 border-zinc-200 dark:border-zinc-800" />

          <div className="mb-4">
            <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t(lang, "aiAssistant")}
            </span>
            <label className="mt-2 block">
              <span className="mb-1 block text-xs text-zinc-600 dark:text-zinc-400">
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
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>
            <label className="mt-2 block">
              <span className="mb-1 block text-xs text-zinc-600 dark:text-zinc-400">
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
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="claude-opus-4-7">Claude Opus 4.7</option>
                <option value="claude-haiku-4-5-20251001">
                  Claude Haiku 4.5
                </option>
              </select>
            </label>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {t(lang, "aiApiKeyHint")}
            </p>
            {settings.ai.consentAccepted ? (
              <p className="mt-2 flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <span>✓ {t(lang, "aiConsentGranted")}</span>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...settings,
                      ai: { ...settings.ai, consentAccepted: false },
                    })
                  }
                  className="text-xs font-medium text-red-600 underline-offset-2 hover:underline dark:text-red-400"
                >
                  {t(lang, "aiConsentRevoke")}
                </button>
              </p>
            ) : (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                {t(lang, "aiConsentRequired")}
              </p>
            )}
          </div>

          <hr className="my-4 border-zinc-200 dark:border-zinc-800" />

          <JiraSettingsSection
            lang={lang}
            config={settings.jira}
            onChange={(jira) => onChange({ ...settings, jira })}
          />

          <hr className="my-4 border-zinc-200 dark:border-zinc-800" />

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
  config: DueNotificationConfig;
  onChange: (c: DueNotificationConfig) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <label className="flex flex-1 items-center gap-2">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
          className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-600 dark:bg-zinc-800"
        />
        <span className="text-zinc-700 dark:text-zinc-300">
          {t(lang, labelKey)}
        </span>
      </label>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {t(lang, "notifThreshold")}
      </span>
      <input
        type="number"
        min={0}
        max={30}
        value={config.thresholdWorkDays}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n))
            onChange({
              ...config,
              thresholdWorkDays: Math.max(0, Math.min(30, Math.round(n))),
            });
        }}
        disabled={!config.enabled}
        className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {t(lang, "notifThresholdSuffix")}
      </span>
    </div>
  );
}
