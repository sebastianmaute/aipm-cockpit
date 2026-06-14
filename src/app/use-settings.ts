"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { type Lang, loadI18n, migrateLang } from "./i18n";
import { defaultSettings, sanitizeIntegrations, type Settings } from "./settings-types";
import { defaultNotificationsConfig, resolveSnapshotSettings, resolveNextActionsConfig, sanitizeAiConfig, sanitizeExportConfig } from "./settings-types";
import type { StakeholderQuadrant } from "./stakeholders";
import { resolveExtraReports } from "./addable-reports";
import { sanitizeFeatures } from "./feature-modules";
import { sanitizeTemplates } from "./templates";
import { sanitizeVersionRetention } from "./version-history";
import { isPlainObject } from "./sanitize";
import { isSafeMode } from "./safe-mode";

export const SETTINGS_KEY = "lop-app:settings";

/** Synchronously write settings to localStorage. */
export function writeSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // quota exceeded / storage disabled — degrade gracefully, keep in-memory settings
  }
}

const COMMS_QUADRANTS: readonly StakeholderQuadrant[] = [
  "manage-closely", "keep-satisfied", "keep-informed", "monitor",
];

function migrateNotifications(raw: unknown): Settings["notifications"] {
  const p = (isPlainObject(raw) ? raw : {}) as Record<string, unknown>;
  const pick = (v: unknown) => (isPlainObject(v) ? (v as Record<string, unknown>) : {});
  const ch = (v: unknown) => {
    const o = isPlainObject(v) ? (v as Record<string, unknown>) : {};
    const n = Number((o as { leadDays?: unknown }).leadDays);
    const validLeadDays = Number.isFinite(n) && n >= 0 ? Math.min(365, Math.round(n)) : undefined;
    const result: { enabled: boolean; leadDays?: number } = {
      enabled: isPlainObject(v) ? (v as { enabled?: unknown }).enabled !== false : true,
    };
    if (validLeadDays !== undefined) result.leadDays = validLeadDays;
    return result;
  };
  const lead = Number(p.reminderLeadDays ?? pick(p.birthday).leadDays);
  const raidInterval = Math.round(Number(p.raidReviewIntervalDays));
  const dueSoonWd = Math.round(Number(p.dueSoonWorkdays));

  const rawLeadDays = isPlainObject(p.stakeholderCommsLeadDays)
    ? (p.stakeholderCommsLeadDays as Record<string, unknown>)
    : {};
  const stakeholderCommsLeadDays = {} as Record<StakeholderQuadrant, number>;
  for (const q of COMMS_QUADRANTS) {
    const n = Number(rawLeadDays[q]);
    stakeholderCommsLeadDays[q] =
      Number.isFinite(n) && n >= 0 ? Math.min(365, Math.round(n)) : defaultNotificationsConfig.stakeholderCommsLeadDays[q];
  }

  return {
    reminderLeadDays: Number.isFinite(lead) && lead >= 0 ? lead : 7,
    useGlobalLeadDays: typeof p.useGlobalLeadDays === "boolean" ? p.useGlobalLeadDays : true,
    birthday: ch(p.birthday),
    raidReview: ch(p.raidReview),
    raidReviewIntervalDays:
      Number.isFinite(raidInterval) && raidInterval >= 1 ? Math.min(365, raidInterval) : 14,
    dueSoonWorkdays:
      Number.isFinite(dueSoonWd) && dueSoonWd >= 1 ? Math.min(365, dueSoonWd) : 3,
    stakeholderComms: ch(p.stakeholderComms),
    stakeholderCommsLeadDays,
    jiraTokenError: ch(p.jiraTokenError),
  };
}

export function coerceLayout(value: unknown): "modern" | "classic" {
  return value === "classic" ? "classic" : "modern";
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

    // Safe mode: ignore persisted settings entirely. Boot the default settings
    // in memory and load the default-language dict. Nothing is read into or
    // written from SETTINGS_KEY, so a broken config can't re-brick the boot.
    if (isSafeMode()) {
      Promise.resolve().then(() => {
        if (!cancelled) setHydrated(true);
      });
      loadI18n(defaultSettings.language).finally(() => {
        if (!cancelled) setI18nReady(true);
      });
      return () => {
        cancelled = true;
      };
    }

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
            ai: sanitizeAiConfig(isPlainObject(parsed.ai) ? parsed.ai : {}),
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
            layout: coerceLayout((parsed as Record<string, unknown>).layout),
            holidayCountries: Array.isArray(parsed.holidayCountries)
              ? (parsed.holidayCountries as unknown[]).filter(
                  (v): v is string => typeof v === "string",
                )
              : defaultSettings.holidayCountries,
            reports: {
              extra: resolveExtraReports(
                isPlainObject(parsed.reports) ? (parsed.reports as { extra?: unknown }).extra : undefined,
              ),
            },
            integrations: sanitizeIntegrations(parsed.integrations),
            snapshots: resolveSnapshotSettings(parsed.snapshots),
            nextActions: resolveNextActionsConfig((parsed as Record<string, unknown>).nextActions),
            features: sanitizeFeatures((parsed as Record<string, unknown>).features),
            versionHistoryRetention: sanitizeVersionRetention((parsed as Record<string, unknown>).versionHistoryRetention),
            templates: sanitizeTemplates((parsed as Record<string, unknown>).templates),
            export: sanitizeExportConfig((parsed as Record<string, unknown>).export),
          };
          Promise.resolve().then(() => {
            if (!cancelled) {
              setSettings(merged);
            }
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
    if (!hydrated || isSafeMode()) return;
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // quota exceeded / storage disabled — degrade gracefully, keep in-memory settings
    }
  }, [settings, hydrated]);

  // Sync document language attribute and ensure dict is loaded on mid-session switch.
  useEffect(() => {
    document.documentElement.lang = settings.language;
    void loadI18n(settings.language);
  }, [settings.language]);

  const lang = settings.language;

  return { settings, setSettings, hydrated, i18nReady, lang };
}
