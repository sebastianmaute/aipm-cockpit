// src/app/workspace.ts
//
// The Workspace shape and its lifecycle: emptyWorkspace, the V5-V8
// migrations, the JSON envelope codec (workspaceToJson / jsonToWorkspace),
// and the storage config/error/backend-interface types. This is the root of
// the storage layer — codecs and backends import from here, never the
// reverse. Extracted from storage.ts (which re-exports everything).

import {
  backfillResourceFks,
  backfillResources,
  defaultResourcePlan,
  seedDisciplines,
  seedGrades,
} from "./resource-foundation";
import { sanitizeFieldVisibility, type FieldVisibilityConfig } from "./field-visibility";
import { sanitizeFeatures, type FeatureModuleId } from "./feature-modules";
import { migrateTask } from "./task-status";
import {
  sanitizeNoteFields,
  sanitizeRaidRichFields,
  sanitizeChangeRichFields,
  sanitizeMilestoneRichFields,
} from "./note-log";
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
  sanitizeSteeringCommittee,
} from "./sanitize";
import { sanitizeTimelogLinks } from "./timelog-sanitize";
import type { TimelogLinks } from "./timelog-types";
import { sanitizeKnowledgeItems, type KnowledgeItem } from "./document-link";
import { sanitizeInsights } from "./insights/sanitize-insights";
import type { Insight } from "./insights/insight";
import { sanitizeActivityLog, type ActivityEntry } from "./activity-log";
import { sanitizeProjectDocuments, type DocTruncationDiag, type ProjectDocument } from "./document-model";
import { sanitizeDocumentRichFields } from "./document-rich-fields";
import { sanitizeDocumentVersions, type DocVersion } from "./document-versions";
// ★ logDiag is a no-op when `window` is undefined and swallows its own errors,
// so importing it here cannot break the bare-node sample generator.
import { logDiag } from "./diagnostics";
import type { SettingsOverrides } from "./settings-types";
import { sanitizeSettingsOverrides, hasAnyOverride } from "./settings-overrides";
import { type CalendarEvent, sanitizeCalendarEvent } from "./calendar-event";
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
  type SteeringCommittee,
  type Task,
} from "./types";

/** Top-level shape persisted to storage. JSON wraps it as an envelope; the
 *  CSV/MD encoders emit sections in one file. The browser backend keeps each
 *  entity type under a separate IndexedDB object store. */
/** Immutability contract: the Turso dirty-table save (`dirtyWorkspaceTables`
 *  in turso-schema.ts) detects changes by REFERENCE EQUALITY on these
 *  sections. An in-place `push`/`splice`/`sort` on a workspace array would
 *  silently skip that table's save — the readonly types below make the
 *  compiler enforce replace-don't-mutate. */
export type Workspace = {
  tasks: ReadonlyArray<Task>;
  raid: ReadonlyArray<RaidItem>;
  absences: ReadonlyArray<Absence>;
  shifts: ReadonlyArray<Shift>; // dormant
  resources: ReadonlyArray<Resource>;
  roles: ReadonlyArray<Role>;
  disciplines: ReadonlyArray<Discipline>;
  grades: ReadonlyArray<Grade>;
  plan: Readonly<ResourcePlan>;
  /** Budget planner buckets. Optional so older saved files and existing
   *  Workspace literals still satisfy the type; every load path defaults to
   *  [] (see migrateWorkspaceV6). */
  budgets?: ReadonlyArray<BudgetBucket>;
  /** Cached ECB rate table; null/absent until first fetched. */
  fxRates?: Readonly<FxRates> | null;
  /** Project-level RAG overrides + PM narrative for the dashboard. Optional so
   *  older saved files still type-check; every load path defaults to {}. */
  status?: Readonly<ProjectStatus>;
  /** Project milestones (key dates). Optional for back-compat; load paths default to []. */
  milestones?: ReadonlyArray<Milestone>;
  /** Change-control register. Optional for back-compat; load paths default to []. */
  changes?: ReadonlyArray<ChangeItem>;
  /** Stakeholder register (incl. per-milestone RACI map). Optional for back-compat; load paths default to []. */
  stakeholders?: ReadonlyArray<Stakeholder>;
  /** Top-level descriptor of the project this workspace tracks. Additive and
   *  optional: a workspace with `project === undefined` serializes byte-for-byte
   *  as it did before this field existed (no project block is emitted). */
  project?: Readonly<ProjectMeta>;
  /** Per-project modal field-visibility config. Optional & additive: when
   *  undefined a workspace serializes byte-for-byte as before (no JSON key),
   *  and every modal falls back to its Advanced default. */
  fieldVisibility?: Readonly<FieldVisibilityConfig>;
  /** Per-project enabled feature modules. Optional & additive: undefined = no override
   *  (legacy / inherits the current active set); [] = Simple mode. Serializes to nothing
   *  when undefined. */
  features?: readonly FeatureModuleId[];
  /** Steering committee config (board membership, meetings, info-pack cadence).
   *  Optional & additive: undefined serializes to nothing; persistence/UI land
   *  in later SP-E tasks. */
  steeringCommittee?: Readonly<SteeringCommittee>;
  /** Timelog integration link mappings (user→resource, project→bucket).
   *  Optional & additive: undefined serializes to nothing (byte-stable). */
  timelogLinks?: Readonly<TimelogLinks>;
  /** Standalone Knowledge-library items (documents / Confluence pages / URLs)
   *  that live on their own, optionally cross-linked to tasks. Optional &
   *  additive: undefined/empty serializes to nothing (byte-stable). */
  knowledgeItems?: readonly KnowledgeItem[];
  /** Insights → Action Loop records (detected project signals + their lifecycle).
   *  Optional & additive: undefined/empty serializes to nothing (byte-stable).
   *  Sanitized by sanitizeInsights. */
  insights?: readonly Insight[];
  /** Per-project audit trail. Meta-blob (like insights/documents), storage-only
   *  — deliberately absent from EXPORT_SECTION_KEYS, because an export would
   *  carry `changes` (old and new values for up to 12 fields per update), which
   *  does not belong in a document handed to a client. Optional & additive:
   *  undefined/empty serializes to nothing (byte-stable). Sanitized by
   *  sanitizeActivityLog. */
  activityLog?: readonly ActivityEntry[];
  /** AI- and user-authored project documents (canonical block model; the
   *  .docx/.pptx/.html/.pdf bytes are rendered on demand and never stored).
   *  Optional & additive: undefined/empty serializes to nothing (byte-stable).
   *  Sanitized in TWO passes — `sanitizeProjectDocuments` for structure, then
   *  `sanitizeDocumentRichFields` for the paragraph HTML allow-list. They are
   *  separate because the first is DOM-FREE by contract (it runs under bare
   *  node in the sample generator) and therefore cannot call DOMPurify. */
  documents?: readonly ProjectDocument[];
  /** Before-image snapshots of document mutations (AI and user) — the safety
   *  net that makes direct AI document writes acceptable, since chat tool
   *  writes have no undo capture. Restoring writes a version back verbatim;
   *  there is no inversion logic. Optional & additive: undefined/empty
   *  serializes to nothing (byte-stable). Sanitized by
   *  `sanitizeDocumentVersions` (DOM-free, structure only) then the paragraph
   *  HTML allow-list, same two-pass split as `documents`. */
  documentVersions?: readonly DocVersion[];
  /** Per-project policy overrides (next-actions weights, notification cadence,
   *  timezone) that travel WITH the project. Optional & additive: undefined
   *  serializes to nothing (byte-stable). Sanitized by sanitizeSettingsOverrides. */
  settingsOverrides?: Readonly<SettingsOverrides>;
  /** Resource-calendar timed events (optionally recurring). Optional & additive:
   *  undefined/empty serializes to nothing (byte-stable). Field declaration
   *  only — load/save wiring (JSON/IndexedDB/app state) lands in a later task;
   *  this task wires CSV + Turso persistence via ENTITY_SPECS. Sanitized by
   *  sanitizeCalendarEvent. */
  calendarEvents?: readonly CalendarEvent[];
};

const SCHEMA_VERSION = 11;

/** True when a workspace holds NO user records in any collection (a default
 *  plan / empty config does not count). Guards a reload from silently replacing
 *  a populated project with an empty backend read — a real data-loss vector. */
export function isWorkspaceEmpty(ws: Workspace): boolean {
  return (ws.tasks?.length ?? 0) === 0
    && (ws.raid?.length ?? 0) === 0
    && (ws.absences?.length ?? 0) === 0
    && (ws.shifts?.length ?? 0) === 0
    && (ws.resources?.length ?? 0) === 0
    && (ws.roles?.length ?? 0) === 0
    && (ws.disciplines?.length ?? 0) === 0
    && (ws.grades?.length ?? 0) === 0
    && (ws.budgets?.length ?? 0) === 0
    && (ws.milestones?.length ?? 0) === 0
    && (ws.changes?.length ?? 0) === 0
    && (ws.stakeholders?.length ?? 0) === 0
    && (ws.calendarEvents?.length ?? 0) === 0
    // ★★ documents belongs here even though the other JSON-blob slices
    //    (insights, knowledgeItems, timelogLinks) do NOT. This feeds the LOAD
    //    guard, which refuses an incoming empty workspace only when the current
    //    one is non-empty. "Only documents" is an ordinary state — someone
    //    drafting a charter before entering any task — and without this a
    //    transient empty read applies, wipes them, and autosave persists it.
    //    ★ Deliberately NOT added to nonEmptyCollectionCount /
    //    workspaceRecordCount: those feed the SAVE-time mass-deletion
    //    thresholds, so widening them changes when saves are REFUSED for every
    //    existing project. See docs/open-followups.md §98.
    && (ws.documents?.length ?? 0) === 0
    && (ws.documentVersions?.length ?? 0) === 0;
    // ★★★ activityLog is deliberately ABSENT here, INVERTING the documents rule
    //     directly above. The log is auto-appended by ordinary use, so counting
    //     it would make a workspace with log entries and NO user records read as
    //     non-empty — slipping past this guard and letting a transient empty
    //     backend read replace a populated project. That converts a data-loss
    //     guard into a data-loss vector. Pinned by workspace.test.ts
    //     ("ONLY activity entries is still EMPTY"). Do not "complete" the
    //     documents precedent by adding it.
    //     Same reasoning keeps it out of nonEmptyCollectionCount /
    //     workspaceRecordCount (SAVE-time mass-deletion thresholds, §98).
}

/** Number of user collections that hold at least one record. Used by the
 *  persistence-layer data-loss guard to tell a MULTI-collection simultaneous
 *  wipe (the applyWorkspace(empty) bug signature) from an incremental single-
 *  collection user delete/clear. */
export function nonEmptyCollectionCount(ws: Workspace): number {
  let n = 0;
  if (ws.tasks?.length) n++;
  if (ws.raid?.length) n++;
  if (ws.absences?.length) n++;
  if (ws.shifts?.length) n++;
  if (ws.resources?.length) n++;
  if (ws.roles?.length) n++;
  if (ws.disciplines?.length) n++;
  if (ws.grades?.length) n++;
  if (ws.budgets?.length) n++;
  if (ws.milestones?.length) n++;
  if (ws.changes?.length) n++;
  if (ws.stakeholders?.length) n++;
  if (ws.calendarEvents?.length) n++;
  return n;
}

/** Total user records across all collections. Drives the Layer-B save invariant
 *  that refuses an unexplained MASS deletion (a large fraction lost in one save). */
export function workspaceRecordCount(ws: Workspace): number {
  return (ws.tasks?.length ?? 0)
    + (ws.raid?.length ?? 0)
    + (ws.absences?.length ?? 0)
    + (ws.shifts?.length ?? 0)
    + (ws.resources?.length ?? 0)
    + (ws.roles?.length ?? 0)
    + (ws.disciplines?.length ?? 0)
    + (ws.grades?.length ?? 0)
    + (ws.budgets?.length ?? 0)
    + (ws.milestones?.length ?? 0)
    + (ws.changes?.length ?? 0)
    + (ws.stakeholders?.length ?? 0)
    + (ws.calendarEvents?.length ?? 0);
}

/** Layer-B invariant: is this save an unexplained MASS deletion? True when it
 *  removes at least `floor` records AND leaves ≤ `fraction` of the previous
 *  total — the "lost almost everything in one step" signature. Normal edits
 *  (remove a few) and moderate bulk deletes are NOT flagged. `prev`/`cur` are
 *  total record counts. */
export function isMassDeletion(prev: number, cur: number, floor = 5, fraction = 0.1): boolean {
  if (cur >= prev) return false;
  return (prev - cur) >= floor && cur <= prev * fraction;
}

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

/**
 * v9 migration: back-fill the optional person-FK fields toward the Resource
 * registry by case-folded email match. Runs after v8.
 *   - Absence.resourceId   from assigneeEmail
 *   - RaidItem.ownerResourceId from ownerEmail
 *   - Shift.resourceId     from assigneeEmail
 * Only blank (null/undefined) FKs are filled; already-set FKs are never
 * overwritten. The denormalized name/email caches are left untouched.
 * Idempotent — reuses arrays unchanged when nothing matched.
 */
export function migrateWorkspaceV9(ws: Workspace): Workspace {
  const base = migrateWorkspaceV8(ws);
  const filled = backfillResourceFks(base.resources, base.absences, base.raid, base.shifts);
  if (
    filled.absences === base.absences &&
    filled.raid === base.raid &&
    filled.shifts === base.shifts
  ) {
    return base;
  }
  return { ...base, absences: filled.absences, raid: filled.raid, shifts: filled.shifts };
}

/**
 * v10 migration: rename the legacy embedded `documentLinks` field to
 * `knowledgeLinks` on every entity that carries it (task / raid / change /
 * milestone / stakeholder + ProjectMeta). ONLY the field NAME changed — the
 * value shape (KnowledgeLink[]) is identical — so an old JSON export or an old
 * IndexedDB record keeps all of its links. Runs after v9.
 *
 * The CSV / Markdown / Turso decoders already alias the old column at decode
 * time (so those paths arrive with `knowledgeLinks` set and this is a no-op);
 * this migration exists for the WHOLE-OBJECT pass-through backends (JSON file +
 * IndexedDB), which store the raw entity object and never touch a codec.
 *
 * Immutable + idempotent: an item/array is reused by reference when it has no
 * legacy key, so a re-run (or an already-migrated workspace) allocates nothing.
 */
export function migrateWorkspaceV10(ws: Workspace): Workspace {
  const base = migrateWorkspaceV9(ws);
  const LEGACY = "documentLinks";
  const NEW = "knowledgeLinks";
  const renameItem = <T>(item: T): T => {
    const rec = item as Record<string, unknown>;
    if (!(LEGACY in rec)) return item;
    const { [LEGACY]: legacy, ...rest } = rec;
    // Never clobber an already-present knowledgeLinks; just drop the legacy key.
    return (NEW in rec ? rest : { ...rest, [NEW]: legacy }) as T;
  };
  const renameArr = <T>(arr: readonly T[] | undefined): readonly T[] | undefined => {
    if (!arr) return arr;
    let touched = false;
    const out = arr.map((it) => {
      const next = renameItem(it);
      if (next !== it) touched = true;
      return next;
    });
    return touched ? out : arr;
  };
  const tasks = renameArr(base.tasks) as Task[];
  const raid = renameArr(base.raid) as RaidItem[];
  const changes = renameArr(base.changes) as ChangeItem[] | undefined;
  const milestones = renameArr(base.milestones) as Milestone[] | undefined;
  const stakeholders = renameArr(base.stakeholders) as Stakeholder[] | undefined;
  const project = base.project ? renameItem(base.project) : base.project;
  if (
    tasks === base.tasks &&
    raid === base.raid &&
    changes === base.changes &&
    milestones === base.milestones &&
    stakeholders === base.stakeholders &&
    project === base.project
  ) {
    return base;
  }
  return { ...base, tasks, raid, changes, milestones, stakeholders, project };
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
  /**
   * Optional: how many malformed rows the LAST {@link load} silently dropped
   * while decoding a CSV/Markdown import (0 for well-formed or non-tabular
   * backends). Lets the import UI warn the user instead of showing only success.
   */
  lastImportDroppedRows?: number;
  /**
   * Optional: whether the LAST {@link load} hit an unterminated quote while
   * decoding a CSV/Markdown import. Distinct from
   * {@link StorageBackend.lastImportDroppedRows} — a dropped row was malformed
   * and rejected, whereas unbalanced quoting ABSORBS rows into one cell so they
   * are never counted at all.
   */
  lastImportUnterminatedQuote?: boolean;
  /**
   * Optional: what the LAST {@link load} silently discarded to stay inside the
   * document caps. `entries` counts raw array entries past MAX_DOCUMENTS (an
   * upper bound — see DocTruncationDiag); `blocks` counts blocks past
   * MAX_BLOCKS_PER_DOC, in stored versions AND in live documents.
   * ★ Every backend must set this. A backend that leaves it undefined reports
   * no truncation and its users lose documents in silence.
   * ★★ The net is a VITEST UNIT TEST (`backend-truncation-registry.test.ts`),
   * NOT a build step — `next build` never runs it — and it scans a HARDCODED
   * list of four files for an assignment, so a fifth backend is not caught
   * until someone adds it there. An earlier wording here said it "fails the
   * build", which overstates both what runs it and what it checks.
   */
  lastLoadTruncation?: { entries: number; blocks: number };
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
      // Additive: only present when configured, so legacy files stay free of a
      // `fieldVisibility` key.
      ...(ws.fieldVisibility ? { fieldVisibility: ws.fieldVisibility } : {}),
      // Additive: present (incl. explicit [] = Simple) emits the key; undefined
      // (no override) omits it, so legacy files round-trip without a `features` key.
      ...(ws.features ? { features: ws.features } : {}),
      // Additive: only present when a committee is configured, so legacy files
      // stay free of a `steeringCommittee` key.
      ...(ws.steeringCommittee ? { steeringCommittee: ws.steeringCommittee } : {}),
      // Additive: only present when timelog links are configured, so legacy
      // files stay free of a `timelogLinks` key.
      ...(ws.timelogLinks ? { timelogLinks: ws.timelogLinks } : {}),
      // Additive: only present when standalone knowledge items exist, so legacy
      // files stay free of a `knowledgeItems` key. JSON is the complete
      // round-trip, so this is always emitted (storage AND export) when present.
      ...(ws.knowledgeItems && ws.knowledgeItems.length
        ? { knowledgeItems: ws.knowledgeItems }
        : {}),
      // Additive: only present when insights exist, so legacy files stay free
      // of an `insights` key. JSON is the complete round-trip, so this is
      // always emitted (storage AND export) when present.
      ...(ws.insights && ws.insights.length ? { insights: ws.insights } : {}),
      // Additive: only present when activity entries exist, so legacy files
      // stay free of an `activityLog` key. JSON is the complete round-trip, so
      // this is always emitted (storage AND export) when present.
      ...(ws.activityLog && ws.activityLog.length ? { activityLog: ws.activityLog } : {}),
      // Additive: only present when documents exist, so legacy files stay free
      // of a `documents` key. JSON is the complete round-trip, so this is
      // always emitted (storage AND export) when present.
      ...(ws.documents && ws.documents.length ? { documents: ws.documents } : {}),
      // Additive: only present when version history exists, so files without
      // it stay free of a `documentVersions` key. Mirrors `documents` above.
      ...(ws.documentVersions && ws.documentVersions.length
        ? { documentVersions: ws.documentVersions }
        : {}),
      // Additive: only present when the project carries policy overrides, so
      // override-less files stay free of a `settingsOverrides` key.
      ...(hasAnyOverride(ws.settingsOverrides) ? { settingsOverrides: ws.settingsOverrides } : {}),
      // Additive: only present when calendar events exist, so legacy/event-less
      // files stay free of a `calendarEvents` key. JSON is the complete
      // round-trip, so this is always emitted (storage AND export) when present.
      ...(ws.calendarEvents && ws.calendarEvents.length
        ? { calendarEvents: ws.calendarEvents }
        : {}),
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

/** Thrown by `jsonToWorkspace(text, { strict: true })` when the input is
 *  present-but-corrupt (parse failure) or structurally not a workspace
 *  (non-object / missing tasks|raid). The strict load paths let this
 *  propagate so a corrupt file surfaces as a load error instead of silently
 *  becoming an empty workspace that the next autosave then overwrites. */
export class WorkspaceParseError extends Error {
  constructor(public readonly reason: "parse" | "shape") {
    super(`workspace parse failed: ${reason}`);
    this.name = "WorkspaceParseError";
  }
}

/** Parse a JSON envelope back to a workspace. Tolerates legacy files (pre-v6)
 *  by defaulting budgets -> [] and fxRates -> null.
 *
 *  Forgiving default (opts.strict falsy): returns an empty workspace on any
 *  malformed input — for internal callers (version-history diff, demo import)
 *  where an empty fallback is acceptable.
 *
 *  Strict (opts.strict === true): THROWS `WorkspaceParseError` on a parse
 *  failure or a non-workspace shape. Used by the disk/SharePoint load paths so
 *  a corrupt file becomes a controlled load error, never a silent empty that
 *  the next autosave overwrites. (Empty/blank text is guarded upstream by the
 *  backends before reaching here, so strict only ever sees non-blank content.)
 *
 *  `opts.diag`: an optional accumulator the caller owns. The document and
 *  document-version sanitizers write into it what a load-time CAP silently
 *  discarded, so a backend can report the loss instead of truncating in
 *  silence. Purely additive — omitting it decodes exactly as before. */
export function jsonToWorkspace(
  text: string,
  opts?: { strict?: boolean; diag?: DocTruncationDiag },
): Workspace {
  const strict = opts?.strict === true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (strict) throw new WorkspaceParseError("parse");
    return emptyWorkspace();
  }
  try {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      if (strict) throw new WorkspaceParseError("shape");
      return emptyWorkspace();
    }
    const p = parsed as Record<string, unknown>;
    if (!Array.isArray(p.tasks) || !Array.isArray(p.raid)) {
      if (strict) throw new WorkspaceParseError("shape");
      return emptyWorkspace();
    }
    const raw: Workspace = {
      // Untrusted-import boundary: an attacker-crafted .json can carry malicious
      // sanitized-HTML fields (noteLog[].html / description) that CSV/MD/Turso
      // scrub on load but the whole-object JSON cast would pass through verbatim.
      tasks: (p.tasks as Task[]).map(migrateTask).map(sanitizeNoteFields),
      raid: (p.raid as RaidItem[]).map(sanitizeRaidRichFields),
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
      // The entity sanitizers UPGRADE a legacy plain rich field (sanitizeRichText
      // -> descriptionHtml) but are DOM-free by contract, so they never run
      // DOMPurify. The whole-object load boundary is where that pass belongs.
      milestones: ((p.milestones as unknown[]) ?? []).map((m) => sanitizeMilestone(m)).filter((m): m is Milestone => m !== null).map(sanitizeMilestoneRichFields),
      changes: ((p.changes as unknown[]) ?? []).map((c) => sanitizeChangeItem(c)).filter((c): c is ChangeItem => c !== null).map(sanitizeChangeRichFields),
      stakeholders: ((p.stakeholders as unknown[]) ?? []).map((s) => sanitizeStakeholder(s)).filter((s): s is Stakeholder => s !== null),
    };
    // Additive: sanitize an incoming project when present; otherwise leave the
    // key off so no-project files round-trip without a `project` field.
    if (p.project !== undefined) {
      const project = sanitizeProjectMeta(p.project);
      if (project) raw.project = project;
    }
    // Additive: sanitize an incoming field-visibility config when present;
    // junk sanitizes to undefined and the key stays off.
    const fieldVisibility = sanitizeFieldVisibility(p.fieldVisibility);
    if (fieldVisibility) raw.fieldVisibility = fieldVisibility;
    // Additive + present-checked: only sanitize when the key is present, so an
    // absent key stays undefined (no override) and an explicit [] (Simple) is
    // preserved rather than expanded to all modules by sanitizeFeatures(undefined).
    if (p.features !== undefined) {
      raw.features = sanitizeFeatures(p.features);
    }
    // Additive: sanitize an incoming committee when present; garbage sanitizes
    // to undefined and the key stays off so committee-less files round-trip.
    if (p.steeringCommittee !== undefined) {
      const committee = sanitizeSteeringCommittee(p.steeringCommittee);
      if (committee) raw.steeringCommittee = committee;
    }
    // Additive: sanitize incoming timelog links when present.
    if (p.timelogLinks !== undefined) {
      const links = sanitizeTimelogLinks(p.timelogLinks);
      if (links) raw.timelogLinks = links;
    }
    // Additive: sanitize incoming standalone knowledge items when present.
    if (p.knowledgeItems !== undefined) {
      const items = sanitizeKnowledgeItems(p.knowledgeItems);
      if (items.length) raw.knowledgeItems = items;
    }
    // Additive: sanitize incoming insights when present.
    if (p.insights !== undefined) {
      const ins = sanitizeInsights(p.insights);
      if (ins.length) raw.insights = ins;
    }
    // Additive: sanitize incoming activity-log entries when present.
    if (p.activityLog !== undefined) {
      const log = sanitizeActivityLog(p.activityLog);
      if (log.length) raw.activityLog = log;
    }
    // Additive: sanitize incoming documents when present. TWO passes, in this
    // order: sanitizeProjectDocuments enforces the STRUCTURE (and is DOM-free
    // by contract, so it cannot run an HTML allow-list), then the rich-field
    // pass applies DOMPurify to the paragraph HTML. Running only the first
    // would persist `<script>` from a crafted .json verbatim. An all-garbage or
    // empty list stays off the key rather than emitting [].
    // ★★★ The rich-field pass is the ONLY DOM-dependent step in this decoder, and
    // it needs its OWN catch. Without one, a throw here reaches the outer
    // catch-all below, which answers a non-strict load with `emptyWorkspace()` —
    // so one unsanitizable document discarded every task, RAID item and
    // milestone in the file, silently. Measured: tasks 0. CSV, Markdown and
    // Turso already scope this call locally and lose only the documents; this
    // brings JSON into line. See open-followups §97.
    // ★★ Scoped to these two calls ONLY, never widened to the whole decode: a
    // broader catch would make real file corruption survivable, which is what
    // `strict` exists to prevent.
    // ★ Degrading a THROW to "documents dropped" matches what this field already
    // does with garbage — `sanitizeProjectDocuments` returns [] and the key stays
    // off — so containment does not invent a new failure mode for it.
    if (p.documents !== undefined) {
      try {
        const docs = sanitizeProjectDocuments(p.documents, opts?.diag).map(sanitizeDocumentRichFields);
        if (docs.length) raw.documents = docs;
      } catch (err) {
        // ★★ strict must stay LOUD. The sample generator decodes with
        // { strict: true } so a bad load fails the build rather than writing a
        // near-empty artifact; rethrowing lets the outer catch raise the same
        // WorkspaceParseError("shape") it always did.
        if (strict) throw err;
        // ★ Not silent: the diagnostics ring is the channel for THIS loss. The
        // signature does carry an optional `DocTruncationDiag`, but that
        // accumulator counts only what the CAPS discarded — it has no field for
        // a sanitize THROW, and a caller reading it after this branch sees
        // nothing. So the ring stays the channel here. Names what was lost, so
        // a user who opens a file and finds no documents has something to find.
        logDiag("error", "workspace.documentsDropped", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Additive: sanitize incoming document version history when present. Same
    // two-pass shape as documents just above — sanitizeDocumentVersions
    // enforces structure (DOM-free), then each version's blocks get the
    // paragraph HTML allow-list via sanitizeDocumentRichFields. A version has
    // no independent createdAt/updatedAt, so it is passed through a synthetic
    // ProjectDocument-shaped wrapper with savedAt standing in for both. An
    // all-garbage or empty list stays off the key rather than emitting [].
    // ★ Same containment as documents: the rich-field pass is the only
    // DOM-dependent step, scoped to its own catch so one bad version cannot
    // discard the whole workspace on a non-strict load.
    if (p.documentVersions !== undefined) {
      try {
        const versions = sanitizeDocumentVersions(p.documentVersions, opts?.diag).map((v) => ({
          ...v,
          blocks: sanitizeDocumentRichFields({
            id: v.documentId,
            title: v.title,
            blocks: v.blocks,
            createdAt: v.savedAt,
            updatedAt: v.savedAt,
          }).blocks,
        }));
        if (versions.length) raw.documentVersions = versions;
      } catch (err) {
        if (strict) throw err;
        logDiag("error", "workspace.documentVersionsDropped", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Additive: sanitize incoming per-project policy overrides when present;
    // an all-junk override sanitizes to {} (no valid sub-key) and the key stays off.
    if (p.settingsOverrides !== undefined) {
      const overrides = sanitizeSettingsOverrides(p.settingsOverrides);
      if (hasAnyOverride(overrides)) raw.settingsOverrides = overrides;
    }
    // Additive: sanitize incoming calendar events when present; garbage rows
    // are dropped individually (sanitizeCalendarEvent never throws), and an
    // all-garbage/empty list stays off the key rather than emitting [].
    if (p.calendarEvents !== undefined) {
      const events = ((p.calendarEvents as unknown[]) ?? [])
        .map((e) => sanitizeCalendarEvent(e))
        .filter((e): e is CalendarEvent => e !== null);
      if (events.length) raw.calendarEvents = events;
    }
    return migrateWorkspaceV10(raw);
  } catch (err) {
    if (err instanceof WorkspaceParseError) throw err;
    if (strict) throw new WorkspaceParseError("shape");
    return emptyWorkspace();
  }
}
