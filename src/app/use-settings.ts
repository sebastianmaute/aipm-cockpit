"use client";

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { type Lang, loadI18n, migrateLang } from "./i18n";
import { defaultSettings, sanitizeIntegrations, sanitizeOutlookCalendar, sanitizeSelfResourceId, type AiConfig, type Settings, type NextActionsLearningConfig } from "./settings-types";
import { defaultTimelogConfig } from "./timelog-types";
import { sanitizeDigestConfig } from "./digest/digest-config";
import { defaultNotificationsConfig, resolveSnapshotSettings, resolveNextActionsConfig, sanitizeAiConfig, sanitizeExportConfig, sanitizeBranding } from "./settings-types";
import type { StakeholderQuadrant } from "./stakeholders";
import { resolveExtraReports } from "./addable-reports";
import { sanitizeFeatures } from "./feature-modules";
import { sanitizeTemplates } from "./templates";
import { CANONICAL_NOTE_HTML_OPS } from "./note-log";
import { sanitizeVersionRetention } from "./version-history";
import { isPlainObject } from "./sanitize";
import { isSafeMode } from "./safe-mode";
import { migratePlaintextSecrets, readDeviceSecret, probeDeviceSecretReadable } from "./secrets-store";
import { SECRET_IDS } from "./secrets";
import { reportAiKeyUnreadable } from "./ai-key-status";
import { dropLegacyActivityLog } from "./activity-log";
import { sanitizeJiraExtraProjects } from "./jira-projects";
import { logDiag } from "./diagnostics";
import { settingsSealedForReload } from "./settings-reload-seal";
import { type AiConsent, publishAiConsentState } from "./ai-consent";

export const SETTINGS_KEY = "aipm-cockpit:settings";

/** The AI fields a revocation or a switch-off changes: the master switch and the two consent records. */
export type PersistedAiState = { enabled: boolean; consent: AiConsent | undefined; backgroundConsent: AiConsent | undefined };

/** The AI switch and consent records as they are persisted NOW, through the load sanitizer. No settings, an
 *  unreadable blob or no storage read as switched off with no consent. */
export function readPersistedAiState(): PersistedAiState {
  let ai: AiConfig;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    ai = sanitizeAiConfig(isPlainObject(parsed) && isPlainObject(parsed.ai) ? parsed.ai : {});
  } catch {
    ai = sanitizeAiConfig({});
  }
  return { enabled: ai.enabled === true, consent: ai.consent, backgroundConsent: ai.backgroundConsent };
}

function sameConsent(a: AiConsent | undefined, b: AiConsent | undefined): boolean {
  return a?.acceptedAt === b?.acceptedAt && a?.disclosureVersion === b?.disclosureVersion;
}

function sameAiState(ai: AiConfig, p: PersistedAiState): boolean {
  return (ai.enabled === true) === p.enabled && sameConsent(ai.consent, p.consent) && sameConsent(ai.backgroundConsent, p.backgroundConsent);
}

const STORAGE_AI_FIELDS: ReadonlySet<string> = new Set(["enabled", "consent", "backgroundConsent"]);

function sameKeysExcept(a: Record<string, unknown>, b: Record<string, unknown>, skip: (key: string) => boolean): boolean {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!skip(key) && a[key] !== b[key]) return false;
  }
  return true;
}

/** AI-01 — true when `next` differs from `base` in nothing but the three AI fields and those equal `fromStorage`:
 *  the change was read from another tab's write, so it is neither written back nor broadcast. Any other change
 *  in the same commit (a local edit batched with it) makes this false, so that edit is still saved and sent. */
export function isOnlyStorageAiChange(base: Settings | null, next: Settings, fromStorage: PersistedAiState | null): boolean {
  if (base === null || fromStorage === null || !sameAiState(next.ai, fromStorage)) return false;
  const rec = (s: unknown) => s as Record<string, unknown>;
  return sameKeysExcept(rec(base), rec(next), (key) => key === "ai")
    && sameKeysExcept(rec(base.ai), rec(next.ai), (key) => STORAGE_AI_FIELDS.has(key));
}

/** AI-01 — the AI slice of a revoke that could not be saved and is committed anyway, which Settings → AI has
 *  already reported (`noteConsentRevokeNotSaved`). The persist effect does not raise the generic "settings
 *  could not be saved" notice for a commit carrying THIS slice, in any instance: the revoke's own commit. A
 *  commit with any other AI slice raises it as usual, and any successful write clears the note. (A later edit
 *  that keeps the slice cannot reach that notice before a successful write: the revoke's commit already put
 *  every instance on the failing edge, and a new instance loads a slice of its own.) A failed ACCEPT notes
 *  nothing: it is not committed, so no generic notice follows it to suppress. */
let reportedRevokeAi: Settings["ai"] | null = null;

/** AI-01 — Settings → AI reported that this revoke could not be saved; call it just before committing it. */
export function noteConsentRevokeNotSaved(revoked: Settings): void {
  reportedRevokeAi = revoked.ai;
}

/** Test seam: forget a noted revoke. */
export function __resetConsentFailureForTests(): void {
  reportedRevokeAi = null;
}

/** Where `writeSettings` takes the two AI consent records from. */
export type ConsentSource = "persisted" | "settings";

/** Synchronously write settings to localStorage WITH the at-rest secrets
 *  blanked. Secret ciphertext is persisted separately (secrets-store) on change;
 *  see the useSettings mount-load for the decrypt+merge back into memory.
 *  Returns true on success, false when the write failed (quota / storage
 *  disabled) so the caller can surface it — a swallowed failure silently
 *  reverts settings on the next reload.
 *  ★★ AI-01 — the two consent records (`ai.consent`, `ai.backgroundConsent`) are written from `settings`
 *  ONLY when `consentSource` is `"settings"`, which only `persistAiConsentChange` passes (the accept and
 *  revoke actions in Settings → AI). Every other write keeps the records already persisted, so an instance
 *  holding an older copy (another tab, a popout, an instance whose load finished after a revoke) can never
 *  write a withdrawn consent back. */
export function writeSettings(settings: Settings, consentSource: ConsentSource = "persisted"): boolean {
  if (settingsSealedForReload()) return true; // §740 — sealed for a reload: skipped, not failed
  const turso = settings.integrations?.turso;
  const consents = consentSource === "settings"
    ? { consent: settings.ai.consent, backgroundConsent: settings.ai.backgroundConsent }
    : (({ consent, backgroundConsent }) => ({ consent, backgroundConsent }))(readPersistedAiState());
  const persistable: Settings = {
    ...settings,
    ai: { ...settings.ai, ...consents, apiKey: "" },
    integrations: turso
      ? { ...settings.integrations, turso: { ...turso, authToken: "" } }
      : settings.integrations,
    jira: settings.jira ? { ...settings.jira, apiToken: "" } : settings.jira,
    timelog: settings.timelog ? { ...settings.timelog, apiToken: "" } : settings.timelog,
    dictation: settings.dictation ? { ...settings.dictation, sttApiKey: "" } : settings.dictation,
  };
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(persistable));
    reportedRevokeAi = null;
    return true;
  } catch (err) {
    // quota exceeded / storage disabled — keep in-memory settings, but log +
    // signal so the caller can warn the user (settings silently revert on the
    // next reload otherwise).
    logDiag("error", "settings.writeFailed", { message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** §548 — the most the mount effect waits for the secret merge (`migratePlaintextSecrets` +
 *  `hydrateSecretsInto`) before hydrating on the in-memory fallback. The load hold is up while
 *  `hydrated` is false, so a merge that never settles would lock the app. The merge is local (IndexedDB
 *  + WebCrypto) and normally takes well under a second. */
export const SECRET_MERGE_TIMEOUT_MS = 5_000;

/** AI-01 — persist an accept or a revoke of an AI consent at once, consent records included. The one caller
 *  of `writeSettings` with `consentSource: "settings"`. Call it with the settings the action commits, before
 *  committing them. Safe mode writes nothing (its settings are the defaults, held in memory only).
 *  Returns false when the write failed: the caller owns the message (an accept is then not committed; a
 *  revoke still is, in memory only). */
export function persistAiConsentChange(settings: Settings): boolean {
  if (isSafeMode()) return true;
  return writeSettings(settings, "settings");
}

/** `settings` with the AI switch and consent records replaced by the persisted ones. */
function withPersistedAiState(settings: Settings): Settings {
  return { ...settings, ai: { ...settings.ai, ...readPersistedAiState() } };
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
// Test seam: how many broadcast deliveries have run. An echo is otherwise
// invisible — the sender's listener finds every slice equal and returns its own
// object, so `setSettings` bails out and nothing re-renders.
let broadcastDeliveries = 0;
export function __settingsBroadcastDeliveriesForTests(): number {
  return broadcastDeliveries;
}

/** `next` with every top-level slice whose VALUE equals `prev`'s replaced by
 *  `prev`'s own object; `prev` itself when nothing changed.
 *
 *  ★★ Each instance hydrates from localStorage on its own, so two instances hold
 *  EQUAL nested objects that are not the SAME objects. A broadcast hands the
 *  receiver the sender's whole object, and consumers key on slice identity —
 *  `useStorageBackend` memoises the backend on `storageConfig`. Without this, the
 *  first change made through a freshly mounted instance (saving a template in
 *  Settings → Templates) gave TaskManager a new `storageConfig` object of the same
 *  value: a new backend, a full workspace reload, the load hold, and Settings
 *  remounting on General.
 *
 *  ★ The comparison is `sameValue`, a structural walk, NOT `JSON.stringify`: a
 *  slice can be large (`branding` holds up to three 700,000-character data-URL
 *  images: the logo, the favicon and the start logo) and a broadcast reaches every live instance, so stringifying both sides
 *  on every settings keystroke would cost megabytes of string work per receiver.
 *  The walk compares a long string with one `===` and stops at the first
 *  difference. It also never merges two different values: `NaN` and `null` are
 *  not equal here, and a key holding `undefined` differs from an absent key (both
 *  only cost a lost sharing, never a lost update). Settings hold no Date, Map or
 *  class instance; such a field would compare by its own keys and needs a rethink. */
export function shareUnchangedSlices(prev: Settings, next: Settings): Settings {
  const prevRec = prev as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let changed = Object.keys(prevRec).length !== Object.keys(next).length;
  for (const [key, value] of Object.entries(next)) {
    const old = prevRec[key];
    if (key in prevRec && sameValue(old, value)) {
      out[key] = old;
    } else {
      out[key] = value;
      changed = true;
    }
  }
  return changed ? (out as unknown as Settings) : prev;
}

/** Structural equality over the plain data settings hold: primitives by
 *  `Object.is`, arrays by length and element, plain objects by key set and value. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bArr = b as unknown[];
    return a.length === bArr.length && a.every((v, i) => sameValue(v, bArr[i]));
  }
  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec);
  if (aKeys.length !== Object.keys(bRec).length) return false;
  return aKeys.every((k) => Object.prototype.hasOwnProperty.call(bRec, k) && sameValue(aRec[k], bRec[k]));
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

  // Identity of THIS instance's broadcast listener, and the value last
  // received-from / sent-to the registry — used to suppress echo loops. Both
  // refs are only touched in effects (never during render).
  const listenerRef = useRef<SettingsListener | null>(null);
  const lastSyncedRef = useRef<Settings | null>(null);
  // This instance's last committed settings, read by the listener (which runs in
  // ANOTHER instance's effect, never during this one's render).
  const committedRef = useRef<Settings>(settings);
  useEffect(() => {
    committedRef.current = settings;
  }, [settings]);

  // Subscribe to cross-instance broadcasts. The listener records the value it
  // applies before applying it, so this instance's broadcast effect recognises
  // it as already-synced and does not echo it back. It applies the incoming
  // value with this instance's unchanged slices kept (`shareUnchangedSlices`).
  useEffect(() => {
    const listener: SettingsListener = (next) => {
      const applied = shareUnchangedSlices(committedRef.current, next);
      lastSyncedRef.current = applied;
      setSettings(applied);
    };
    listenerRef.current = listener;
    settingsListeners.add(listener);
    return () => {
      settingsListeners.delete(listener);
      listenerRef.current = null;
    };
  }, []);

  // AI-01 — another tab or popout persisted settings: take its AI switch and consent records at once, so a
  // revocation or a switch-off there stops AI here too (the publish effect below then updates the send-time
  // flags). Only those three fields are taken; the rest of this instance's settings is left alone. The value
  // came FROM storage, so a commit that changes nothing else is neither written back nor broadcast to this
  // tab's other instances (each of them gets the same `storage` event) — `isOnlyStorageAiChange`, checked by
  // the broadcast and persist effects below. The persist effect clears `fromStorageRef` once it has run.
  // ★★ A FUNCTIONAL update over the latest state, never one built from `committedRef`: a local edit made just
  //   before the event (committed or queued, and not yet in `committedRef`) is kept, and because that commit
  //   then differs in more than the three AI fields, it is still written and broadcast.
  const fromStorageRef = useRef<PersistedAiState | null>(null);
  useEffect(() => {
    if (isSafeMode()) return;
    const onStorage = (e: StorageEvent) => {
      // A null key is a `clear()` of the whole storage area.
      if (e.key !== null && e.key !== SETTINGS_KEY) return;
      const fresh = readPersistedAiState();
      fromStorageRef.current = fresh;
      setSettings((prev) => (sameAiState(prev.ai, fresh) ? prev : { ...prev, ai: { ...prev.ai, ...fresh } }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // After a LOCAL change commits, notify every other live instance. Skips
  // pre-hydration (load/defaults) and values that arrived via a broadcast.
  useEffect(() => {
    if (!hydrated) return;
    if (lastSyncedRef.current === settings) return;
    const fromStorageOnly = isOnlyStorageAiChange(lastSyncedRef.current, settings, fromStorageRef.current);
    lastSyncedRef.current = settings;
    if (fromStorageOnly) return; // AI-01 — every instance gets the same `storage` event
    for (const l of settingsListeners) {
      if (l === listenerRef.current) continue;
      broadcastDeliveries += 1;
      l(settings);
    }
  }, [settings, hydrated]);

  // Load settings from localStorage once on mount; lift hydrated + i18nReady gates.
  useEffect(() => {
    // One-time cleanup of the pre-upgrade device-local activity log (now
    // workspace data, persisted via the six write paths — see activity-log.ts).
    // Unconditional and independent of SETTINGS_KEY / safe mode: it touches a
    // different localStorage key and cannot re-brick the boot either way.
    dropLegacyActivityLog();

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
            budgetChartView:
              (parsed as Record<string, unknown>).budgetChartView === "cumulative" ? "cumulative" : "burndown",
            budgetChartUnit:
              (parsed as Record<string, unknown>).budgetChartUnit === "hours" ? "hours" : "eur",
            budgetForecastView:
              (parsed as Record<string, unknown>).budgetForecastView === "efficiency" ? "efficiency" : "pace",
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
            // §298 — the canonical note cleaner, so a template keeps a long note rich.
            templates: sanitizeTemplates((parsed as Record<string, unknown>).templates, CANONICAL_NOTE_HTML_OPS),
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
            const mergeSecrets = async (): Promise<typeof merged> => {
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
              return {
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
              return merged;
            }
            };
            // ★★★ §548 — THE MERGE IS BOUNDED. The load hold is up until `hydrated` flips, so a merge that
            //   never settles (an IndexedDB open queued behind another connection, a stalled WebCrypto call)
            //   would lock the app behind the skeleton for good. On timeout, take the same in-memory fallback
            //   the throw path takes; the late result, when it comes, is ignored.
            let mergeTimer: ReturnType<typeof setTimeout> | undefined;
            const mergeOutcome = await Promise.race([
              mergeSecrets(),
              new Promise<null>((resolve) => { mergeTimer = setTimeout(() => resolve(null), SECRET_MERGE_TIMEOUT_MS); }),
            ]);
            clearTimeout(mergeTimer);
            if (mergeOutcome === null) logDiag("warn", "settings.secretMergeTimedOut", { ms: SECRET_MERGE_TIMEOUT_MS });
            // ★★ AI-01 — the switch and consent records are read AGAIN here, not taken from the mount-time
            //   parse: a revoke or a switch-off made by another instance while this merge ran is already
            //   persisted, and this instance must not publish (or hold) the copy it read before it.
            const committed = withPersistedAiState(mergeOutcome ?? merged);
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
                // §567 — every sealed id, from the one runtime list (see secrets.ts).
                const states = await Promise.all(SECRET_IDS.map((id) => probeDeviceSecretReadable(id)));
                // §650 — the Anthropic key gets its OWN, persistent surface (the AI key banner +
                // the Settings → AI notice, via the in-memory verdict), so it is taken out of the
                // one-shot generic toast, which stays for the other secrets.
                const unreadable = SECRET_IDS.filter((_, i) => states[i] === "unreadable");
                if (unreadable.includes("anthropicApiKey")) reportAiKeyUnreadable();
                if (unreadable.some((id) => id !== "anthropicApiKey")) {
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
  // Route through writeSettings so EVERY at-rest secret is blanked before it
  // hits localStorage — a raw JSON.stringify(settings) write would dump the
  // decrypted plaintext. ★★ There are FIVE, not the two this comment named
  // until 2026-09-18: ai.apiKey, integrations.turso.authToken, jira.apiToken,
  // timelog.apiToken and dictation.sttApiKey. Do not trust that restatement
  // either — SECRET_IDS and SECRET_SETTINGS_PATHS (secrets.ts) are the source
  // of truth, and a hardcoded copy of them drifting out of step is the exact
  // rot §560 was filed to kill in redactSettings.
  const settingsWriteFailingRef = useRef(false);
  const persistBaseRef = useRef<Settings | null>(null);
  useEffect(() => {
    const fromStorage = fromStorageRef.current;
    fromStorageRef.current = null;
    if (!hydrated || isSafeMode()) return;
    const base = persistBaseRef.current;
    persistBaseRef.current = settings;
    if (isOnlyStorageAiChange(base, settings, fromStorage)) return; // AI-01 — just read from storage
    const ok = writeSettings(settings);
    // Notify once on the healthy→failing edge (useSettings has no toast
    // context, so bridge to whoever does via a window event). writeSettings
    // already logged the diagnostic.
    if (!ok && !settingsWriteFailingRef.current) {
      settingsWriteFailingRef.current = true;
      // AI-01 — the commit of a revoke Settings → AI has already reported as not saved, more specifically.
      if (settings.ai !== reportedRevokeAi) window.dispatchEvent(new CustomEvent("aipm-cockpit-settings-write-failed"));
    } else if (ok) {
      settingsWriteFailingRef.current = false;
    }
  }, [settings, hydrated]);

  // Publish the consent state for the request path (plain functions cannot read settings). No setState.
  // ★ Only a HYDRATED instance publishes: useSettings() runs in many components, and a fresh one still holds
  //   defaultSettings (no consent), which would otherwise revoke a live consent until its own load finishes.
  useEffect(() => {
    if (hydrated) publishAiConsentState(settings.ai);
  }, [settings.ai, hydrated]);

  // Sync document language attribute and ensure dict is loaded on mid-session switch.
  useEffect(() => {
    document.documentElement.lang = settings.language;
    void loadI18n(settings.language);
  }, [settings.language]);

  const lang = settings.language;

  return { settings, setSettings, hydrated, i18nReady, lang };
}
