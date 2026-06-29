// src/app/settings-types.ts
import type { CommTemplateSendMode } from "./comm-send";
import type { AddableReportId } from "./addable-reports";
import type { StakeholderQuadrant } from "./stakeholders";
import type { FeatureModuleId } from "./feature-modules";
import { ALL_MODULE_IDS } from "./feature-modules";
import type { Lang } from "./i18n";
import type { SnapshotCadence } from "./snapshot";
import type { ProjectTemplate } from "./templates";
import {
  type StorageConfig,
  defaultStorageConfig,
} from "./workspace";
import { type TimelogConfig, defaultTimelogConfig } from "./timelog-types";

/** Single source of truth for the selectable AI models. Add/replace ONE entry
 *  here on a model release — the `ChatModel` union, the sanitize allowlist, and
 *  the Settings → AI dropdown all derive from this array, so they can't drift
 *  apart. `id` is the Anthropic model id sent to the API; `label` is the UI text. */
export const CHAT_MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
] as const;

export type ChatModel = (typeof CHAT_MODELS)[number]["id"];

export const DEFAULT_SESSION_TOKEN_CAP = 200_000;
export const DEFAULT_WEEKLY_TOKEN_CAP = 2_000_000;

export type AiConfig = {
  enabled?: boolean; // Master switch for all AI features. Default OFF (undefined = off) — must be ticked to use the assistant.
  apiKey: string;
  model: ChatModel;
  consentAccepted: boolean;
  sessionTokenCap?: number;
  weeklyTokenCap?: number;
  groundInGuides: boolean;
  actionSuggestions?: boolean; // Action Center "Analyze with AI" button. Default ON (undefined = on).
  scheduledJobs?: boolean; // Scheduled Claude jobs (SP5). Default OFF (opt-in) — recurring billed calls.
  suggestAllNextActionThresholds?: boolean; // AI weight suggestions (SP-C). Default OFF (opt-in).
};

export const defaultAiConfig: AiConfig = {
  apiKey: "",
  model: "claude-sonnet-4-6",
  consentAccepted: false,
  sessionTokenCap: DEFAULT_SESSION_TOKEN_CAP,
  weeklyTokenCap: DEFAULT_WEEKLY_TOKEN_CAP,
  groundInGuides: true,
};

export function sanitizeAiConfig(raw: unknown): AiConfig {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const coerceCap = (v: unknown, def: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : def;
  };
  const model: ChatModel = CHAT_MODELS.some((m) => m.id === obj.model)
    ? (obj.model as ChatModel)
    : defaultAiConfig.model;
  return {
    apiKey: typeof obj.apiKey === "string" ? obj.apiKey : "",
    model,
    consentAccepted: obj.consentAccepted === true,
    sessionTokenCap: coerceCap(obj.sessionTokenCap, DEFAULT_SESSION_TOKEN_CAP),
    weeklyTokenCap: coerceCap(obj.weeklyTokenCap, DEFAULT_WEEKLY_TOKEN_CAP),
    enabled: obj.enabled === true,
    groundInGuides: obj.groundInGuides !== false,
    scheduledJobs: obj.scheduledJobs === true,
    suggestAllNextActionThresholds: obj.suggestAllNextActionThresholds === true,
  };
}

/** True only when the AI master switch is ON and a usable key is present.
 *  Master switch defaults OFF (undefined → false). The single source of truth
 *  for "may AI run" — gate every AI activation through this (or aiKeyIfEnabled). */
export function isAiEnabled(ai: AiConfig | undefined): boolean {
  return ai?.enabled === true && !!ai?.apiKey?.trim();
}

/** The trimmed API key, but only when the AI master switch is on; "" otherwise.
 *  Feeding "" downstream makes every key-presence gate treat AI as unconfigured. */
export function aiKeyIfEnabled(ai: AiConfig | undefined): string {
  return ai?.enabled === true ? (ai?.apiKey?.trim() ?? "") : "";
}

export type ChannelConfig = { enabled: boolean; leadDays?: number };

export type NotificationsConfig = {
  reminderLeadDays: number;
  useGlobalLeadDays: boolean;
  birthday: ChannelConfig;
  raidReview: ChannelConfig;
  raidReviewIntervalDays: number;
  dueSoonWorkdays: number;
  stakeholderComms: ChannelConfig;
  stakeholderCommsLeadDays: Record<StakeholderQuadrant, number>;
  jiraTokenError: ChannelConfig;
  /** Desktop browser notifications for urgent ("now") Action Center signals. Off by default. */
  desktopUrgent: ChannelConfig;
};

export const defaultNotificationsConfig: NotificationsConfig = {
  reminderLeadDays: 7,
  useGlobalLeadDays: true,
  birthday: { enabled: true },
  raidReview: { enabled: true },
  raidReviewIntervalDays: 14,
  dueSoonWorkdays: 3,
  stakeholderComms: { enabled: true },
  stakeholderCommsLeadDays: {
    "manage-closely": 14,
    "keep-satisfied": 7,
    "keep-informed": 7,
    monitor: 3,
  },
  jiraTokenError: { enabled: true },
  desktopUrgent: { enabled: false },
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
  outlookCalendarPush: boolean;
};

export type TursoIntegrationsSettings = {
  enabled: boolean;
  databaseUrl?: string;
  authToken?: string;
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
  outlookCalendarPush: false,
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
      outlookCalendarPush: typeof m365Raw?.outlookCalendarPush === "boolean" ? m365Raw.outlookCalendarPush : false,
    },
    turso: {
      enabled: typeof tursoRaw?.enabled === "boolean" ? tursoRaw.enabled : false,
      databaseUrl: typeof tursoRaw?.databaseUrl === "string" ? tursoRaw.databaseUrl : undefined,
      authToken: typeof tursoRaw?.authToken === "string" ? tursoRaw.authToken : undefined,
    },
  };
}

export const EXPORT_SECTION_KEYS = [
  "project",
  "tasks", "raid", "changes", "milestones", "stakeholders",
  "budgets", "resources", "roles", "absences", "shifts", "status",
] as const;
export type ExportSectionKey = (typeof EXPORT_SECTION_KEYS)[number];
export type ExportConfig = Record<ExportSectionKey, boolean>;

export const defaultExportConfig: ExportConfig = {
  project: true,
  tasks: true,  raid: true,
  changes: false, milestones: false, stakeholders: false, budgets: false,
  resources: false, roles: false, absences: false, shifts: false, status: false,
};

export function sanitizeExportConfig(raw: unknown): ExportConfig {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const result = {} as Record<ExportSectionKey, boolean>;
  for (const key of EXPORT_SECTION_KEYS) {
    result[key] = typeof obj[key] === "boolean" ? (obj[key] as boolean) : defaultExportConfig[key];
  }
  return result;
}

export type SnapshotSettings = {
  enabled: boolean;
  cadence: SnapshotCadence;
};

export const defaultSnapshotSettings: SnapshotSettings = {
  enabled: true,
  cadence: "weekly",
};

const SNAPSHOT_CADENCES: readonly SnapshotCadence[] = ["weekly", "daily", "monthly"];

/** Unset -> default (fresh copy); otherwise coerce to a valid SnapshotSettings. */
export function resolveSnapshotSettings(raw: unknown): SnapshotSettings {
  if (!raw || typeof raw !== "object") return { ...defaultSnapshotSettings };
  const obj = raw as Record<string, unknown>;
  const cadence = SNAPSHOT_CADENCES.includes(obj.cadence as SnapshotCadence)
    ? (obj.cadence as SnapshotCadence)
    : "weekly";
  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : true,
    cadence,
  };
}

/** User-tunable signal-firing thresholds for the "next actions" engine. Each
 *  overrides a hard-coded default used to decide WHEN a suggested action fires
 *  (the day-based lead times live in NotificationsConfig, not here). */
export type NextActionsConfig = {
  /** Pending-change backlog count that raises the aggregate scope action. */
  scopePendingRed: number;
  /** Schedule SPI at/above which no schedule action fires. */
  scheduleSpiWarn: number;
  /** Schedule SPI below which the action escalates to critical. */
  scheduleSpiCritical: number;
  /** Near-term planned utilisation % above which an over-allocated alert fires. */
  workloadAllocatedPct: number;
  /** Over-allocation % at/above which the alert escalates to critical. */
  workloadAllocatedCritical: number;
  /** Overdue-task count at/above which an overload alert fires. */
  workloadOverdueThreshold: number;
  /** Overdue-task count at/above which the overload alert escalates to urgent. */
  workloadOverdueUrgent: number;
  /** Confidence bonus for a clear-fix action. */
  clarityBonus: number;
  /** Confidence bonus for a semi-clear (several-lever) action. */
  semiClarityBonus: number;
  /** Confidence penalty for a vague/aggregate static signal. */
  staticPenalty: number;
};

export const defaultNextActionsConfig: NextActionsConfig = {
  scopePendingRed: 5,
  scheduleSpiWarn: 0.9,
  scheduleSpiCritical: 0.8,
  workloadAllocatedPct: 100,
  workloadAllocatedCritical: 130,
  workloadOverdueThreshold: 3,
  workloadOverdueUrgent: 5,
  clarityBonus: 15,
  semiClarityBonus: 7,
  staticPenalty: 25,
};

const intMin1 = (v: unknown, def: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : def;
};
const intMin0 = (v: unknown, def: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : def;
};
const ratio = (v: unknown, def: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 2 ? n : def;
};

/** Per-field validator for NextActionsConfig - the SINGLE source of clamping,
 *  used by resolveNextActionsConfig AND the AI weight-suggestion parser. */
export const NEXT_ACTIONS_FIELD_COERCE: Record<keyof NextActionsConfig, (v: unknown, def: number) => number> = {
  scopePendingRed: intMin1,
  scheduleSpiWarn: ratio,
  scheduleSpiCritical: ratio,
  workloadAllocatedPct: intMin1,
  workloadAllocatedCritical: intMin1,
  workloadOverdueThreshold: intMin1,
  workloadOverdueUrgent: intMin1,
  clarityBonus: intMin0,
  semiClarityBonus: intMin0,
  staticPenalty: intMin0,
};

/** Unset -> default (fresh copy); otherwise coerce each field to a finite value
 *  within sane bounds, falling back to the default per field. */
export function resolveNextActionsConfig(raw: unknown): NextActionsConfig {
  if (!raw || typeof raw !== "object") return { ...defaultNextActionsConfig };
  const obj = raw as Record<string, unknown>;
  const d = defaultNextActionsConfig;
  return {
    scopePendingRed: intMin1(obj.scopePendingRed, d.scopePendingRed),
    scheduleSpiWarn: ratio(obj.scheduleSpiWarn, d.scheduleSpiWarn),
    scheduleSpiCritical: ratio(obj.scheduleSpiCritical, d.scheduleSpiCritical),
    workloadAllocatedPct: intMin1(obj.workloadAllocatedPct, d.workloadAllocatedPct),
    workloadAllocatedCritical: intMin1(obj.workloadAllocatedCritical, d.workloadAllocatedCritical),
    workloadOverdueThreshold: intMin1(obj.workloadOverdueThreshold, d.workloadOverdueThreshold),
    workloadOverdueUrgent: intMin1(obj.workloadOverdueUrgent, d.workloadOverdueUrgent),
    clarityBonus: intMin0(obj.clarityBonus, d.clarityBonus),
    semiClarityBonus: intMin0(obj.semiClarityBonus, d.semiClarityBonus),
    staticPenalty: intMin0(obj.staticPenalty, d.staticPenalty),
  };
}

export type LearningStoreKind = "local" | "turso";
export type NextActionsLearningConfig = { enabled: boolean; store: LearningStoreKind };
export const defaultNextActionsLearning: NextActionsLearningConfig = { enabled: false, store: "local" };

/** Per-device sidebar branding override. `logo` is a base64 `data:image/*` URL,
 *  `slogan` overrides the sidebar app-name subtitle, `footerSlogan` overrides the
 *  bottom footer-bar tagline. */
export interface BrandingConfig {
  logo?: string;
  slogan?: string;
  footerSlogan?: string;
  favicon?: string;
}
/** Default bottom footer-bar tagline (used when no custom footerSlogan is set). */
export const DEFAULT_FOOTER_SLOGAN = "Command your projects - AI-assisted tracking that plugs into M365, Jira and Timelog. Local-first, no backend.";
/** Max stored logo length (~512 KB raw → ~700k base64 chars). */
export const BRANDING_LOGO_MAX_LEN = 700_000;
export const BRANDING_SLOGAN_MAX = 60;
export const BRANDING_FOOTER_SLOGAN_MAX = 120;
/** Accepted raster logo data-URL prefixes. SVG is intentionally excluded
 *  (avoids the SVG-in-data-URL XSS surface entirely). */
const BRANDING_LOGO_RE = /^data:image\/(png|jpeg|webp|gif);base64,/i;

/** Validate untrusted branding (from localStorage or a freshly-read file):
 *  logo must be a size-bounded raster `data:image` URL; slogan trimmed + capped.
 *  Returns undefined when nothing valid remains so the defaults apply. */
export function sanitizeBranding(obj: unknown): BrandingConfig | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  const out: BrandingConfig = {};
  if (typeof o.logo === "string" && BRANDING_LOGO_RE.test(o.logo) && o.logo.length <= BRANDING_LOGO_MAX_LEN) {
    out.logo = o.logo;
  }
  if (typeof o.slogan === "string") {
    const s = o.slogan.trim().slice(0, BRANDING_SLOGAN_MAX);
    if (s) out.slogan = s;
  }
  if (typeof o.footerSlogan === "string") {
    const s = o.footerSlogan.trim().slice(0, BRANDING_FOOTER_SLOGAN_MAX);
    if (s) out.footerSlogan = s;
  }
  if (typeof o.favicon === "string" && BRANDING_LOGO_RE.test(o.favicon) && o.favicon.length <= BRANDING_LOGO_MAX_LEN) {
    out.favicon = o.favicon;
  }
  return out.logo || out.slogan || out.footerSlogan || out.favicon ? out : undefined;
}

export type Settings = {
  language: Lang;
  holidayCountries: string[];
  storageConfig: StorageConfig;
  ai: AiConfig;
  notifications: NotificationsConfig;
  jira: JiraConfig;
  /** Intentionally optional (mirrors other optional-but-defaulted fields like snapshots?);
   *  readers use `settings.timelog ?? defaultTimelogConfig`. */
  timelog?: TimelogConfig;
  popout: { reuseWindow: boolean };
  resources: { workdayHours: number };
  layout: "modern" | "classic";
  /** Expert mode reveals advanced settings sections + template actions. */
  expertMode?: boolean;
  /** Per-device tasks-view toggle: hide finished (Done + Cancelled) tasks. Default OFF. */
  hideFinishedTasks?: boolean;
  /** Per-device tasks-pane layout: table list or Kanban board. Default "table". */
  tasksViewMode?: "table" | "board";
  /** Per-device Dashboard density (spacing only). Default "comfortable". */
  dashboardDensity?: "comfortable" | "compact";
  /** Per-device: show the contextual per-view Help callouts. Default ON
   *  (read as `!== false`); individual callouts can also be dismissed per-view. */
  showViewHints?: boolean;
  /** Per-device sidebar branding: a custom logo (data:image URL) and/or slogan
   *  overriding the default Acme logo + subtitle. */
  branding?: BrandingConfig;
  /** Per-device: the guided tour has been seen/skipped (suppresses auto-launch). */
  tourSeen?: boolean;
  /** Per-device: ids of guided tours the user has completed (✓ badge in the
   *  Help catalog). Separate from `tourSeen` (which gates first-run auto-launch). */
  completedTours?: readonly string[];
  /** Per-device: the security & responsibility disclaimer has been acknowledged
   *  (shown once, the first time any integration/AI enable checkbox is ticked). */
  integrationDisclaimerSeen?: boolean;
  /** Per-device override of the app timezone (IANA). Undefined = follow project/browser. */
  timezone?: string;
  /** Per-device extra zones to surface (calendar + per-window switcher), IANA strings. */
  additionalTimezones?: string[];
  /** Per-device: show the top-bar display-timezone switcher. Default OFF. */
  showDisplayTzSwitcher?: boolean;
  reports?: { extra: AddableReportId[] };
  integrations?: IntegrationsSettings;
  snapshots?: SnapshotSettings;
  /** User overrides for the next-actions signal thresholds (omit = defaults). */
  nextActions?: NextActionsConfig;
  /** Action Center learning layer (opt-in). */
  nextActionsLearning?: NextActionsLearningConfig;
  features: FeatureModuleId[];
  /** Max auto-versions kept per project in version history (Turso). Min 50, step 10. */
  versionHistoryRetention?: number;
  /** User-created project templates (built-ins live in code). Cross-project, in the settings blob. */
  templates?: ProjectTemplate[];
  export?: ExportConfig;
  /** How comm-template sends are dispatched. Readers fall back to "mailto" when unset. */
  commTemplateSendMode?: CommTemplateSendMode;
};

export const defaultSettings: Settings = {
  language: "en-US",
  holidayCountries: [],
  storageConfig: defaultStorageConfig,
  ai: defaultAiConfig,
  notifications: defaultNotificationsConfig,
  jira: defaultJiraConfig,
  timelog: defaultTimelogConfig,
  popout: { reuseWindow: false },
  resources: { workdayHours: 8 },
  layout: "modern",
  expertMode: false,
  hideFinishedTasks: false,
  tasksViewMode: "table",
  dashboardDensity: "comfortable",
  showViewHints: true,
  branding: { footerSlogan: DEFAULT_FOOTER_SLOGAN },
  showDisplayTzSwitcher: false,
  reports: { extra: ["raid-report", "budget-report"] },
  integrations: defaultIntegrations,
  snapshots: defaultSnapshotSettings,
  nextActions: defaultNextActionsConfig,
  features: [...ALL_MODULE_IDS],
  versionHistoryRetention: 50,
  templates: [],
  export: defaultExportConfig,
};
