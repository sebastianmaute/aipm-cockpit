// src/app/settings-types.ts
import type { AddableReportId } from "./addable-reports";
import type { StakeholderQuadrant } from "./stakeholders";
import type { FeatureModuleId } from "./feature-modules";
import { ALL_MODULE_IDS } from "./feature-modules";
import type { Lang } from "./i18n";
import type { SnapshotCadence } from "./snapshot";
import {
  type StorageConfig,
  defaultStorageConfig,
} from "./workspace";

export type ChatModel =
  | "claude-sonnet-4-6"
  | "claude-opus-4-7"
  | "claude-haiku-4-5-20251001";

export const DEFAULT_SESSION_TOKEN_CAP = 200_000;
export const DEFAULT_WEEKLY_TOKEN_CAP = 2_000_000;

export type AiConfig = {
  apiKey: string;
  model: ChatModel;
  consentAccepted: boolean;
  sessionTokenCap?: number;
  weeklyTokenCap?: number;
};

export const defaultAiConfig: AiConfig = {
  apiKey: "",
  model: "claude-sonnet-4-6",
  consentAccepted: false,
  sessionTokenCap: DEFAULT_SESSION_TOKEN_CAP,
  weeklyTokenCap: DEFAULT_WEEKLY_TOKEN_CAP,
};

export function sanitizeAiConfig(raw: unknown): AiConfig {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const coerceCap = (v: unknown, def: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : def;
  };
  const MODELS: readonly ChatModel[] = [
    "claude-sonnet-4-6",
    "claude-opus-4-7",
    "claude-haiku-4-5-20251001",
  ];
  const model: ChatModel = MODELS.includes(obj.model as ChatModel)
    ? (obj.model as ChatModel)
    : defaultAiConfig.model;
  return {
    apiKey: typeof obj.apiKey === "string" ? obj.apiKey : "",
    model,
    consentAccepted: obj.consentAccepted === true,
    sessionTokenCap: coerceCap(obj.sessionTokenCap, DEFAULT_SESSION_TOKEN_CAP),
    weeklyTokenCap: coerceCap(obj.weeklyTokenCap, DEFAULT_WEEKLY_TOKEN_CAP),
  };
}

export type ChannelConfig = { enabled: boolean; leadDays?: number };

export type NotificationsConfig = {
  reminderLeadDays: number;
  useGlobalLeadDays: boolean;
  banner: ChannelConfig;
  toast: ChannelConfig;
  popup: ChannelConfig;
  birthday: ChannelConfig;
  raidReview: ChannelConfig;
  raidReviewIntervalDays: number;
  stakeholderComms: ChannelConfig;
  stakeholderCommsLeadDays: Record<StakeholderQuadrant, number>;
  jiraTokenError: ChannelConfig;
  /** Set to true once the one-time v0.57 toast-first migration has run. Fresh installs start true. */
  toastFirstMigrated: boolean;
};

export const defaultNotificationsConfig: NotificationsConfig = {
  reminderLeadDays: 7,
  useGlobalLeadDays: true,
  banner: { enabled: false },
  toast: { enabled: true },
  popup: { enabled: false },
  birthday: { enabled: true },
  raidReview: { enabled: true },
  raidReviewIntervalDays: 14,
  stakeholderComms: { enabled: true },
  stakeholderCommsLeadDays: {
    "manage-closely": 14,
    "keep-satisfied": 7,
    "keep-informed": 7,
    monitor: 3,
  },
  jiraTokenError: { enabled: true },
  toastFirstMigrated: true,
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

export type Settings = {
  language: Lang;
  holidayCountries: string[];
  storageConfig: StorageConfig;
  ai: AiConfig;
  notifications: NotificationsConfig;
  jira: JiraConfig;
  popout: { reuseWindow: boolean };
  resources: { workdayHours: number };
  layout: "modern" | "classic";
  reports?: { extra: AddableReportId[] };
  integrations?: IntegrationsSettings;
  snapshots?: SnapshotSettings;
  features: FeatureModuleId[];
  export?: ExportConfig;
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
  layout: "modern",
  reports: { extra: ["raid-report", "budget-report"] },
  integrations: defaultIntegrations,
  snapshots: defaultSnapshotSettings,
  features: [...ALL_MODULE_IDS],
  export: defaultExportConfig,
};
