"use client";

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { type Lang, loadI18n, migrateLang } from "./i18n";
import { defaultSettings, sanitizeIntegrations, sanitizeOutlookCalendar, sanitizeSelfResourceId, type Settings, type NextActionsLearningConfig } from "./settings-types";
import { defaultTimelogConfig } from "./timelog-types";
import { sanitizeDigestConfig } from "./digest/digest-config";
import { defaultNotificationsConfig, resolveSnapshotSettings, resolveNextActionsConfig, sanitizeAiConfig, sanitizeExportConfig, sanitizeBranding } from "./settings-types";
import type { StakeholderQuadrant } from "./stakeholders";
import { resolveExtraReports } from "./addable-reports";
import { sanitizeFeatures } from "./feature-modules";
import { sanitizeTemplates } from "./templates";
import { sanitizeVersionRetention } from "./version-history";
import { isPlainObject } from "./sanitize";
import { isSafeMode } from "./safe-mode";
import { migratePlaintextSecrets, readDeviceSecret, probeDeviceSecretReadable } from "./secrets-store";
import { sanitizeJiraExtraProjects } from "./jira-projects";
import { logDiag } from "./diagnostics";

export const SETTINGS_KEY = "aipm-cockpit:settings";

/** Synchronously write settings to localStorage WITH the at-rest secrets
 *  blanked. Secret ciphertext is persisted separately (secrets-store) on change;
 *  see the useSettings mount-load for the decrypt+merge back into memory.
 *  Returns true on success, false when the write failed (quota / storage
 *  disabled) so the caller can surface it — a swallowed failure silently
 *  reverts settings on the next reload. */
export function writeSettings(settings: Settings): boolean {
  const turso = settings.integrations?.turso;
  const persistable: Settings = {
    ...settings,
    ai: { ...settings.ai, apiKey: "" },
    integrations: turso
      ? { ...settings.integrations, turso: { ...turso, authToken: "" } }
      : settings.integrations,
    jira: settings.jira ? { ...settings.jira, apiToken: "" } : settings.jira,
    timelog: settings.timelog ? { ...settings.timelog, apiToken: "" } : settings.timelog,
    dictation: settings.dictation ? { ...settings.dictation, sttApiKey: "" } : settings.dictation,
  };
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(persistable));
    return true;
  } catch (err) {
    // quota exceeded / storage disabled — keep in-memory settings, but log +
    // signal so the caller can warn the user (settings silently revert on the
    // next reload otherwise).
    logDiag("error", "settings.writeFailed", { message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Merge device-wrapped secrets into an in-memory Settings (passphrase-wrapped
 *  ones stay blank until an explicit unlock). Reads the secret store. */
export async function hydrateSecretsInto(settings: Settings): Promise<Settings> {
  const apiKey = (await readDeviceSecret("anthropicApiKey")) ?? settings.ai.apiKey;
  const token = await readDeviceSecret("tursoAuthToken");
  const jiraToken = await readDeviceSecret("jiraApiToken");
  const timelogToken = await readDeviceSecret("timelogApiToken");
  const sttApiKey = await readDeviceSecret("sttApiKey");
  const turso = settings.integrations?.turso;
  return {
    ...settings,
    ai: { ...settings.ai, apiKey },
    integrations:
      turso && token !== null
        ? { ...settings.integrations, turso: { ...turso, authToken: token } }
        : settings.integrations,
    jira:
      settings.jira && jiraToken !== null
        ? { ...settings.jira, apiToken: jiraToken }
        : settings.jira,
    timelog:
      settings.timelog && timelogToken !== null
        ? { ...settings.timelog, apiToken: timelogToken }
        : settings.timelog,
    dictation:
      settings.dictation && sttApiKey !== null
        ? { ...settings.dictation, sttApiKey }
        : settings.dictation,
  };
}

const COMMS_QUADRANTS: readonly StakeholderQuadrant[] = [
  "manage-closely", "keep-satisfied", "keep-informed", "monitor",
];

export function migrateNextActionsLearning(raw: unknown): NextActionsLearningConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    store: o.store === "turso" ? "turso" : "local",
  };
}

export function migrateNotifications(raw: unknown): Settings["notifications"] {
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
    desktopUrgent: {
      enabled:
        isPlainObject(p.desktopUrgent) &&
        (p.desktopUrgent as { enabled?: unknown }).enabled === true,
    },
  };
}

export function coerceLayout(value: unknown): "modern" | "classic" {
  return value === "classic" ? "classic" : "modern";
}

// ── Same-page settings sync ────────────────────────────────────────────────
// useSettings() is called by several independent components (the canonical
// TaskManager instance, the standalone WorkspaceSection — which must also run
// in pop-out windows — and a few read-only consumers). Each keeps its OWN
// useState (so SSR, load/persist, and per-test isolation are unchanged), but
// without coordination a change made through one instance never reaches the
// others until a reload (e.g. accepting AI consent in Settings vs. the chat).
//
// This module-level registry bridges them: setSettings applies locally AND
// notifies every OTHER live instance with the new value. Listeners are added on
// mount and removed on unmount, so the ONLY module state is a transient Set of
// callbacks — no settings value is cached at module scope, so nothing leaks
// across renders or test cases.
type SettingsListener = (next: Settings) => void;
const settingsListeners = new Set<SettingsListener>();

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

  // Identity of THIS instance's broadcast listener, and the value last
  // received-from / sent-to the registry — used to suppress echo loops. Both
  // refs are only touched in effects (never during render).
  const listenerRef = useRef<SettingsListener | null>(null);
  const lastSyncedRef = useRef<Settings | null>(null);

  // Subscribe to cross-instance broadcasts. The listener records the incoming
  // value before applying it, so this instance's broadcast effect recognises it
  // as already-synced and does not echo it back.
  useEffect(() => {
    const listener: SettingsListener = (next) => {
      lastSyncedRef.current = next;
      setSettings(next);
    };
    listenerRef.current = listener;
    settingsListeners.add(listener);
    return () => {
      settingsListeners.delete(listener);
      listenerRef.current = null;
    };
  }, []);

  // After a LOCAL change commits, notify every other live instance. Skips
  // pre-hydration (load/defaults) and values that arrived via a broadcast.
  useEffect(() => {
    if (!hydrated) return;
    if (lastSyncedRef.current === settings) return;
    lastSyncedRef.current = settings;
    for (const l of settingsListeners) {
      if (l !== listenerRef.current) l(settings);
    }
  }, [settings, hydrated]);

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
            jira: (() => {
              const merged = {
                ...defaultSettings.jira,
                ...(isPlainObject(parsed.jira) ? parsed.jira : {}),
              };
              return {
                ...merged,
                extraProjects: sanitizeJiraExtraProjects(
                  merged.extraProjects,
                  merged.projectKey,
                ),
              };
            })(),
            timelog: {
              ...defaultTimelogConfig,
              ...(isPlainObject(parsed.timelog) ? parsed.timelog : {}),
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
            expertMode: (parsed as Record<string, unknown>).expertMode === true,
            hideFinishedTasks: (parsed as Record<string, unknown>).hideFinishedTasks === true,
            hideExternalTasks: (parsed as Record<string, unknown>).hideExternalTasks === true,
            tasksViewMode:
              (parsed as Record<string, unknown>).tasksViewMode === "board" ? "board"
              : (parsed as Record<string, unknown>).tasksViewMode === "swimlane" ? "swimlane"
              : "table",
            selfResourceId: sanitizeSelfResourceId((parsed as Record<string, unknown>).selfResourceId),
            digest: sanitizeDigestConfig((parsed as Record<string, unknown>).digest),
            dictation: {
              engine:
                isPlainObject((parsed as Record<string, unknown>).dictation) &&
                ((parsed as Record<string, unknown>).dictation as Record<string, unknown>).engine === "stt"
                  ? "stt"
                  : "web-speech",
              sttBaseUrl: (() => {
                const raw = isPlainObject((parsed as Record<string, unknown>).dictation)
                  ? ((parsed as Record<string, unknown>).dictation as Record<string, unknown>).sttBaseUrl
                  : undefined;
                return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 500) : undefined;
              })(),
              sttModel: (() => {
                const raw = isPlainObject((parsed as Record<string, unknown>).dictation)
                  ? ((parsed as Record<string, unknown>).dictation as Record<string, unknown>).sttModel
                  : undefined;
                return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 500) : undefined;
              })(),
              hotkey: (() => {
                const raw = isPlainObject((parsed as Record<string, unknown>).dictation)
                  ? ((parsed as Record<string, unknown>).dictation as Record<string, unknown>).hotkey
                  : undefined;
                return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 40) : "F4";
              })(),
            },
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
            nextActionsLearning: migrateNextActionsLearning((parsed as Record<string, unknown>).nextActionsLearning),
            features: sanitizeFeatures((parsed as Record<string, unknown>).features),
            versionHistoryRetention: sanitizeVersionRetention((parsed as Record<string, unknown>).versionHistoryRetention),
            templates: sanitizeTemplates((parsed as Record<string, unknown>).templates),
            export: sanitizeExportConfig((parsed as Record<string, unknown>).export),
            outlookCalendar: sanitizeOutlookCalendar((parsed as Record<string, unknown>).outlookCalendar),
            // Fall back to the default branding (seeds the app slogan) when the
            // stored blob has none, so settings.branding.footerSlogan is populated.
            branding: sanitizeBranding((parsed as Record<string, unknown>).branding) ?? defaultSettings.branding,
            completedTours: Array.isArray((parsed as Record<string, unknown>).completedTours)
              ? Array.from(
                  new Set(
                    ((parsed as Record<string, unknown>).completedTours as unknown[]).filter(
                      (v): v is string => typeof v === "string",
                    ),
                  ),
                ).slice(0, 50)
              : undefined,
          };
          void (async () => {
            // Migrate any legacy plaintext secrets out of the parsed blob into
            // the device-wrapped secret store, then merge the device-wrapped
            // secrets back in. The merge runs against a copy with both at-rest
            // secrets blanked, so a passphrase-locked secret (which
            // readDeviceSecret returns null for) stays empty until explicit
            // unlock — and a plaintext value never reaches in-memory state.
            // Fallback: keep the plaintext-bearing in-memory settings (the
            // pre-secrets-feature behaviour). If the secret store throws for
            // any reason — no IndexedDB, no crypto.subtle, locked-down browser,
            // test env — we commit this instead of crashing or losing the
            // secret for the session.
            let committed = merged;
            try {
              // migratePlaintextSecrets is hardened to never reject: a failed
              // seal (no IndexedDB / WebCrypto) leaves that secret un-migrated
              // and RETURNS its original plaintext so we can keep it in memory.
              const unmigrated = await migratePlaintextSecrets({
                apiKey: merged.ai.apiKey,
                authToken: merged.integrations?.turso?.authToken,
                jiraApiToken: merged.jira?.apiToken,
                timelogApiToken: merged.timelog?.apiToken,
                sttApiKey: merged.dictation?.sttApiKey,
              });
              const mergedTurso = merged.integrations?.turso;
              const hydratedSettings = await hydrateSecretsInto({
                ...merged,
                ai: { ...merged.ai, apiKey: "" },
                integrations: mergedTurso
                  ? { ...merged.integrations, turso: { ...mergedTurso, authToken: "" } }
                  : merged.integrations,
                jira: merged.jira ? { ...merged.jira, apiToken: "" } : merged.jira,
                timelog: merged.timelog ? { ...merged.timelog, apiToken: "" } : merged.timelog,
                dictation: merged.dictation ? { ...merged.dictation, sttApiKey: "" } : merged.dictation,
              });
              // Re-merge any secret the seal failed to persist: hydration left
              // it blank (nothing was sealed), so without this the in-memory
              // plaintext would be lost for the session.
              const turso = hydratedSettings.integrations?.turso;
              const jira = hydratedSettings.jira;
              const timelog = hydratedSettings.timelog;
              const dictation = hydratedSettings.dictation;
              committed = {
                ...hydratedSettings,
                ai: {
                  ...hydratedSettings.ai,
                  apiKey: hydratedSettings.ai.apiKey || unmigrated.apiKey,
                },
                integrations:
                  turso && unmigrated.authToken && !turso.authToken
                    ? { ...hydratedSettings.integrations, turso: { ...turso, authToken: unmigrated.authToken } }
                    : hydratedSettings.integrations,
                jira:
                  jira && unmigrated.jiraApiToken && !jira.apiToken
                    ? { ...jira, apiToken: unmigrated.jiraApiToken }
                    : jira,
                timelog:
                  timelog && unmigrated.timelogApiToken && !timelog.apiToken
                    ? { ...timelog, apiToken: unmigrated.timelogApiToken }
                    : timelog,
                dictation:
                  dictation && unmigrated.sttApiKey && !dictation.sttApiKey
                    ? { ...dictation, sttApiKey: unmigrated.sttApiKey }
                    : dictation,
              };
            } catch {
              // IndexedDB / WebCrypto unavailable — fall back to the in-memory
              // plaintext secrets so the app still works this session.
              committed = merged;
            }
            try {
              if (!cancelled) {
                // Load applies locally only — every instance reads the same
                // localStorage, so mark it synced to keep the broadcast effect
                // from echoing the loaded value.
                lastSyncedRef.current = committed;
                setSettings(committed);
              }
            } finally {
              // Flip the ready flag only AFTER the secret merge resolves, so
              // consumers never observe a half-loaded settings object (the
              // merged blob with blank secrets) as the hydrated state.
              if (!cancelled) setHydrated(true);
            }
            // Best-effort: detect device secrets that are SEALED but unreadable
            // (corrupt ciphertext / device-key mismatch) vs. never configured, so
            // the user is told to re-enter them rather than silently seeing the
            // field as unconfigured. useSettings has no toast context → bridge via
            // a window event (task-manager listens).
            if (!cancelled) {
              try {
                const ids = ["anthropicApiKey", "tursoAuthToken", "jiraApiToken", "timelogApiToken", "sttApiKey"] as const;
                const states = await Promise.all(ids.map((id) => probeDeviceSecretReadable(id)));
                if (states.some((s) => s === "unreadable")) {
                  window.dispatchEvent(new CustomEvent("aipm-cockpit-secret-unreadable"));
                }
              } catch { /* probe is best-effort; never block hydration */ }
            }
          })();
        } else {
          // Parsed value wasn't a settings object — nothing to merge; just
          // mark hydration complete on the default settings already in state.
          Promise.resolve().then(() => {
            if (!cancelled) setHydrated(true);
          });
        }
      } else {
        // No persisted settings — defaults are already in state; mark hydrated.
        Promise.resolve().then(() => {
          if (!cancelled) setHydrated(true);
        });
      }
    } catch {
      // ignore corrupt storage
      Promise.resolve().then(() => {
        if (!cancelled) setHydrated(true);
      });
    }
    loadI18n(resolvedLang).finally(() => {
      if (!cancelled) setI18nReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist settings on every change, guarded by hydration so mount doesn't overwrite.
  // Route through writeSettings so the two at-rest secrets (ai.apiKey,
  // integrations.turso.authToken) are blanked before they hit localStorage —
  // a raw JSON.stringify(settings) write would dump the decrypted plaintext.
  const settingsWriteFailingRef = useRef(false);
  useEffect(() => {
    if (!hydrated || isSafeMode()) return;
    const ok = writeSettings(settings);
    // Notify once on the healthy→failing edge (useSettings has no toast
    // context, so bridge to whoever does via a window event). writeSettings
    // already logged the diagnostic.
    if (!ok && !settingsWriteFailingRef.current) {
      settingsWriteFailingRef.current = true;
      window.dispatchEvent(new CustomEvent("aipm-cockpit-settings-write-failed"));
    } else if (ok) {
      settingsWriteFailingRef.current = false;
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
