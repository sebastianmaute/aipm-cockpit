import {
  backfillResources,
  defaultResourcePlan,
  seedDisciplines,
  seedGrades,
} from "./resource-foundation";
import {
  sanitizeAbsence,
  sanitizeBudgetBucket,
  sanitizeChangeItem,
  sanitizeDiscipline,
  sanitizeFxRates,
  sanitizeGrade,
  sanitizeMilestone,
  sanitizePlan,
  sanitizeProjectMeta,
  sanitizeResource,
  sanitizeRole,
  sanitizeShift,
  sanitizeStakeholder,
} from "./sanitize";
import {
  type Absence,
  type BudgetBucket,
  type ChangeItem,
  type Discipline,
  type FxRates,
  type Grade,
  type Milestone,
  type ProjectMeta,
  type ProjectStatus,
  type RaidItem,
  type Resource,
  type ResourcePlan,
  type Role,
  type Shift,
  type Stakeholder,
  type Task,
} from "./types";

/** Top-level shape persisted to storage. JSON wraps it as an envelope; the
 *  CSV/MD encoders emit sections in one file. The browser backend keeps each
 *  entity type under a separate IndexedDB object store. */
export type Workspace = {
  tasks: Task[];
  raid: RaidItem[];
  absences: Absence[];
  shifts: Shift[]; // dormant
  resources: Resource[];
  roles: Role[];
  disciplines: Discipline[];
  grades: Grade[];
  plan: ResourcePlan;
  /** Budget planner buckets. Optional so older saved files and existing
   *  Workspace literals still satisfy the type; every load path defaults to
   *  [] (see migrateWorkspaceV6). */
  budgets?: BudgetBucket[];
  /** Cached ECB rate table; null/absent until first fetched. */
  fxRates?: FxRates | null;
  /** Project-level RAG overrides + PM narrative for the dashboard. Optional so
   *  older saved files still type-check; every load path defaults to {}. */
  status?: ProjectStatus;
  /** Project milestones (key dates). Optional for back-compat; load paths default to []. */
  milestones?: Milestone[];
  /** Change-control register. Optional for back-compat; load paths default to []. */
  changes?: ChangeItem[];
  /** Stakeholder register (incl. per-milestone RACI map). Optional for back-compat; load paths default to []. */
  stakeholders?: Stakeholder[];
  /** Top-level descriptor of the project this workspace tracks. Additive and
   *  optional: a workspace with `project === undefined` serializes byte-for-byte
   *  as it did before this field existed (no project block is emitted). */
  project?: ProjectMeta;
};

const SCHEMA_VERSION = 10;

/** A blank workspace with a default plan anchored to today. */
export function emptyWorkspace(): Workspace {
  return {
    tasks: [], raid: [], absences: [], shifts: [],
    resources: [], roles: [], disciplines: [], grades: [],
    plan: defaultResourcePlan(new Date().toISOString().slice(0, 10)),
    budgets: [],
    fxRates: null,
    status: {},
    milestones: [],
    changes: [],
    stakeholders: [],
  };
}

/**
 * Idempotent v5 migration over a loaded workspace:
 *   - seeds discipline/grade reference lists when empty,
 *   - ensures a plan exists,
 *   - backfills resources from task/absence assignees the first time
 *     (when no resources are present yet), stamping resourceId.
 * Pure — no IndexedDB. Returns a new workspace; reuses arrays unchanged.
 */
export function migrateWorkspaceV5(ws: Workspace): Workspace {
  const disciplines = ws.disciplines.length ? ws.disciplines : seedDisciplines();
  const grades = ws.grades.length ? ws.grades : seedGrades();
  const plan = ws.plan ?? defaultResourcePlan(new Date().toISOString().slice(0, 10));
  let { tasks, absences, resources } = ws;
  if (resources.length === 0) {
    const built = backfillResources(tasks, absences);
    resources = built.resources;
    tasks = built.tasks;
    absences = built.absences;
  }
  return { ...ws, tasks, absences, resources, roles: ws.roles, disciplines, grades, plan };
}

/**
 * v6 migration: ensures the budget planner fields exist. Runs after v5.
 * Idempotent — reuses arrays/values unchanged.
 */
export function migrateWorkspaceV6(ws: Workspace): Workspace {
  const base = migrateWorkspaceV5(ws);
  const budgets = Array.isArray(base.budgets) ? base.budgets : [];
  const fxRates = base.fxRates ?? null;
  const status = base.status && typeof base.status === "object" ? base.status : {};
  const milestones = Array.isArray(base.milestones) ? base.milestones : [];
  if (budgets === base.budgets && fxRates === base.fxRates && status === base.status && milestones === base.milestones) {
    return base;
  }
  return { ...base, budgets, fxRates, status, milestones };
}

/**
 * v7 migration: ensures the change-control register exists. Runs after v6.
 * Idempotent — reuses arrays/values unchanged.
 */
export function migrateWorkspaceV7(ws: Workspace): Workspace {
  const base = migrateWorkspaceV6(ws);
  const changes = Array.isArray(base.changes) ? base.changes : [];
  if (changes === base.changes) return base;
  return { ...base, changes };
}

/** v8: ensure the stakeholders array exists. Runs after v7. Idempotent. */
export function migrateWorkspaceV8(ws: Workspace): Workspace {
  const base = migrateWorkspaceV7(ws);
  return base.stakeholders ? base : { ...base, stakeholders: [] };
}

// --- Storage configuration -------------------------------------------------

export type StorageKind =
  | "browser"
  | "local-json"
  | "local-csv"
  | "local-md"
  | "sp-json"
  | "sp-csv"
  | "turso";

export type LocalKind = "local-json" | "local-csv" | "local-md";

export type StorageConfig =
  | { kind: "browser" }
  | { kind: "local-json" }
  | { kind: "local-csv" }
  | { kind: "local-md" }
  | {
      kind: "sp-json";
      hostname: string;
      sitePath: string;
      itemPath: string;
    }
  | {
      kind: "sp-csv";
      hostname: string;
      sitePath: string;
      itemPath: string;
    }
  | { kind: "turso" };

export const defaultStorageConfig: StorageConfig = { kind: "browser" };

// --- Errors ----------------------------------------------------------------

export class StorageNotReadyError extends Error {
  constructor(public hint: string) {
    super(`Storage not ready: ${hint}`);
    this.name = "StorageNotReadyError";
  }
}

export class StorageNotImplementedError extends Error {
  constructor(public hint: string) {
    super(`Storage not implemented: ${hint}`);
    this.name = "StorageNotImplementedError";
  }
}

// --- Backend interface -----------------------------------------------------

export interface StorageBackend {
  readonly kind: StorageKind;
  load(): Promise<Workspace>;
  save(workspace: Workspace): Promise<void>;
  /** Optional: human-readable status (e.g., picked filename). */
  describe?(): Promise<string | null>;
  /** Whether this backend is configured to read/write right now. */
  isReady(): Promise<boolean>;
}

/** Serialize a workspace to the JSON envelope (schemaVersion + entity arrays). */
export function workspaceToJson(ws: Workspace): string {
  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      tasks: ws.tasks, raid: ws.raid, absences: ws.absences, shifts: ws.shifts,
      resources: ws.resources, roles: ws.roles, disciplines: ws.disciplines,
      grades: ws.grades, plan: ws.plan, budgets: ws.budgets ?? [], fxRates: ws.fxRates ?? null,
      status: ws.status ?? {},
      milestones: ws.milestones ?? [],
      changes: ws.changes ?? [],
      stakeholders: ws.stakeholders ?? [],
      // Additive: only present when a project is set, so legacy/no-project files
      // stay free of a `project` key.
      ...(ws.project ? { project: ws.project } : {}),
    },
    null,
    2,
  );
}

/** Defensive: whitelist the six known ProjectStatus fields from untrusted JSON. */
export function sanitizeProjectStatus(raw: unknown): ProjectStatus {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const rag = (v: unknown): "R" | "A" | "G" | undefined =>
    v === "R" || v === "A" || v === "G" ? v : undefined;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const out: ProjectStatus = {};
  const ragOverride = rag(r.ragOverride); if (ragOverride) out.ragOverride = ragOverride;
  const scheduleOverride = rag(r.scheduleOverride); if (scheduleOverride) out.scheduleOverride = scheduleOverride;
  const budgetOverride = rag(r.budgetOverride); if (budgetOverride) out.budgetOverride = budgetOverride;
  const scopeOverride = rag(r.scopeOverride); if (scopeOverride) out.scopeOverride = scopeOverride;
  const narrative = str(r.narrative); if (narrative) out.narrative = narrative;
  const narrativeUpdatedAt = str(r.narrativeUpdatedAt); if (narrativeUpdatedAt) out.narrativeUpdatedAt = narrativeUpdatedAt;
  return out;
}

/** Parse a JSON envelope back to a workspace. Tolerates legacy files (pre-v6)
 *  by defaulting budgets -> [] and fxRates -> null. Returns an empty workspace
 *  on malformed input. */
export function jsonToWorkspace(text: string): Workspace {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyWorkspace();
    const p = parsed as Record<string, unknown>;
    if (!Array.isArray(p.tasks) || !Array.isArray(p.raid)) return emptyWorkspace();
    const raw: Workspace = {
      tasks: p.tasks as Task[],
      raid: p.raid as RaidItem[],
      absences: ((p.absences as unknown[]) ?? []).map((a) => sanitizeAbsence(a)).filter((a): a is Absence => a !== null),
      shifts: ((p.shifts as unknown[]) ?? []).map((s) => sanitizeShift(s)).filter((s): s is Shift => s !== null),
      resources: ((p.resources as unknown[]) ?? []).map((r) => sanitizeResource(r)).filter((r): r is Resource => r !== null),
      roles: ((p.roles as unknown[]) ?? []).map((r) => sanitizeRole(r)).filter((r): r is Role => r !== null),
      disciplines: ((p.disciplines as unknown[]) ?? []).map((d) => sanitizeDiscipline(d)).filter((d): d is Discipline => d !== null),
      grades: ((p.grades as unknown[]) ?? []).map((g) => sanitizeGrade(g)).filter((g): g is Grade => g !== null),
      plan: sanitizePlan(p.plan ?? {}, new Date().toISOString().slice(0, 10)),
      budgets: ((p.budgets as unknown[]) ?? []).map((b) => sanitizeBudgetBucket(b)).filter((b): b is BudgetBucket => b !== null),
      fxRates: sanitizeFxRates(p.fxRates),
      status: sanitizeProjectStatus(p.status),
      milestones: ((p.milestones as unknown[]) ?? []).map((m) => sanitizeMilestone(m)).filter((m): m is Milestone => m !== null),
      changes: ((p.changes as unknown[]) ?? []).map((c) => sanitizeChangeItem(c)).filter((c): c is ChangeItem => c !== null),
      stakeholders: ((p.stakeholders as unknown[]) ?? []).map((s) => sanitizeStakeholder(s)).filter((s): s is Stakeholder => s !== null),
    };
    // Additive: sanitize an incoming project when present; otherwise leave the
    // key off so no-project files round-trip without a `project` field.
    if (p.project !== undefined) {
      const project = sanitizeProjectMeta(p.project);
      if (project) raw.project = project;
    }
    return migrateWorkspaceV8(raw);
  } catch {
    return emptyWorkspace();
  }
}
