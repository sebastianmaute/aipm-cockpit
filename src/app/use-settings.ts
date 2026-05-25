"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { type Lang, loadI18n, migrateLang } from "./i18n";
import { defaultSettings, type Settings } from "./settings-menu";
import { isPlainObject } from "./sanitize";

const SETTINGS_KEY = "lop-app:settings";

function migrateNotifications(raw: unknown): Settings["notifications"] {
  const p = (isPlainObject(raw) ? raw : {}) as Record<string, unknown>;
  const pick = (v: unknown) => (isPlainObject(v) ? (v as Record<string, unknown>) : {});
  const ch = (v: unknown) => ({ enabled: isPlainObject(v) ? (v as { enabled?: unknown }).enabled !== false : true });
  const lead = Number(p.reminderLeadDays ?? pick(p.birthday).leadDays ?? pick(p.banner).thresholdWorkDays);
  return {
    reminderLeadDays: Number.isFinite(lead) && lead >= 0 ? lead : 7,
    banner: ch(p.banner), toast: ch(p.toast), popup: ch(p.popup), birthday: ch(p.birthday),
  };
}

export function useSettings(): {
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  hydrated: boolean;
  i18nReady: boolean;
  lang: Lang;
} {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);
  const [i18nReady, setI18nReady] = useState(false);

  // Load settings from localStorage once on mount; lift hydrated + i18nReady gates.
  useEffect(() => {
    let cancelled = false;
    let resolvedLang: Lang = defaultSettings.language;
    try {
      const settingsRaw = window.localStorage.getItem(SETTINGS_KEY);
      if (settingsRaw) {
        const parsed = JSON.parse(settingsRaw);
        if (isPlainObject(parsed)) {
          resolvedLang = migrateLang(
            (parsed as Record<string, unknown>).language,
          );
          const merged: Settings = {
            ...defaultSettings,
            ...parsed,
            language: resolvedLang,
            ai: {
              ...defaultSettings.ai,
              ...(isPlainObject(parsed.ai) ? parsed.ai : {}),
            },
            notifications: migrateNotifications(parsed.notifications),
            jira: {
              ...defaultSettings.jira,
              ...(isPlainObject(parsed.jira) ? parsed.jira : {}),
            },
            popout: {
              ...defaultSettings.popout,
              ...(isPlainObject(parsed.popout) ? parsed.popout : {}),
            },
            resources: {
              ...defaultSettings.resources,
              ...(isPlainObject(parsed.resources) ? parsed.resources : {}),
            },
            holidayCountries: Array.isArray(parsed.holidayCountries)
              ? (parsed.holidayCountries as unknown[]).filter(
                  (v): v is string => typeof v === "string",
                )
              : defaultSettings.holidayCountries,
          };
          Promise.resolve().then(() => {
            if (!cancelled) setSettings(merged);
          });
        }
      }
    } catch {
      // ignore corrupt storage
    }
    Promise.resolve().then(() => {
      if (!cancelled) setHydrated(true);
    });
    loadI18n(resolvedLang).finally(() => {
      if (!cancelled) setI18nReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist settings on every change, guarded by hydration so mount doesn't overwrite.
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings, hydrated]);

  // Sync document language attribute and ensure dict is loaded on mid-session switch.
  useEffect(() => {
    document.documentElement.lang = settings.language;
    void loadI18n(settings.language);
  }, [settings.language]);

  const lang = settings.language;

  return { settings, setSettings, hydrated, i18nReady, lang };
}
