// The IndexedDB layout BrowserBackend reads and writes: database name and
// version, the entity record stores and every kv key, each keyed by the
// Workspace field it holds. ★ No imports and no browser API, on purpose: the
// e2e seed (e2e/seed.ts) imports this to write the sample workspace in exactly
// this shape, so a store or kv slice added here is seeded without anyone
// editing a second list (§99). idb.ts and browser-backend.ts take their
// constants from here; idb-layout.test.ts fails when either declares a kv key
// of its own, or when a slice here reaches the e2e seed with no data.

export const IDB_DB_NAME = "aipm-cockpit";
/** Bump when a store is added: `openIdb`'s `onupgradeneeded` adds missing stores. */
export const IDB_DB_VERSION = 6;
export const IDB_KV_STORE = "kv";

/** Workspace field → its record store (keyPath "id"). */
export const IDB_ENTITY_STORES = {
  tasks: "tasks",
  raid: "raid",
  absences: "absences",
  shifts: "shifts",
  resources: "resources",
  roles: "roles",
  disciplines: "disciplines",
  grades: "grades",
  budgets: "budgets",
} as const;

/** Workspace field → kv key, for the slices every workspace carries. The key is
 *  NOT always the field name (`plan` is "resource-plan"). */
export const IDB_CORE_KV_KEYS = {
  plan: "resource-plan",
  fxRates: "fx-rates",
  status: "project-status",
  milestones: "milestones",
  changes: "changes",
  stakeholders: "stakeholders",
  project: "project",
} as const;

/** Workspace field → kv key, for the optional slices. */
export const IDB_OPTIONAL_KV_KEYS = {
  fieldVisibility: "fieldVisibility",
  features: "features",
  steeringCommittee: "steeringCommittee",
  timelogLinks: "timelogLinks",
  knowledgeItems: "knowledgeItems",
  insights: "insights",
  settingsOverrides: "settingsOverrides",
  calendarEvents: "calendarEvents",
  documents: "documents",
  documentVersions: "documentVersions",
  activityLog: "activityLog",
  budgetHistory: "budgetHistory",
  documentAssets: "documentAssets",
} as const;
