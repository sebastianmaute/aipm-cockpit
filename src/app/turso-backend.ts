// src/app/turso-backend.ts
//
// Turso (libSQL) storage backend. Stores the workspace relationally via
// Turso's HTTP pipeline API. Token is delegated via the resolved TursoConfig
// (env-or-settings). Last-write-wins; save() wraps the overwrite in a
// BEGIN/COMMIT transaction.
//
// The backend is parameterized by an optional `projectId`:
//   - projectId === undefined → single-tenant mode: the whole DB is one
//     workspace (plus the legacy single-blob import probe).
//   - projectId set → multi-tenant (portfolio) mode: reads/writes only the
//     slice of the shared DB tagged with `project_id = projectId`, using the
//     project-scoped statement builders from turso-tenant-schema.
//
// The schema modules are imported dynamically inside load() / save() (called
// only at runtime, never at module-init time) — a historical guard against the
// former storage → turso-backend → turso-schema → storage cycle, kept to defer
// loading the heavy codec layer until a Turso backend is actually used. The
// type-only imports below are erased at compile time.

import {
  emptyWorkspace,
  jsonToWorkspace,
  type StorageBackend,
  type Workspace,
} from "./workspace";
import { LOAD_TIMEOUT_MS, runTursoPipeline } from "./turso-pipeline";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

const OLD_BLOB_DDL = "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, data TEXT NOT NULL)";
const OLD_BLOB_SELECT = "SELECT data FROM workspace WHERE id = 1";

/** Upper bound on waiting for the cross-tab write lock. Generously above the
 *  15s pipeline timeout so a healthy lock holder finishes its save first. */
const LOCK_WAIT_TIMEOUT_MS = 20_000;

/** The cross-tab write lock could not be acquired within LOCK_WAIT_TIMEOUT_MS.
 *  Deliberately NOT a StorageNotReadyError and NOT classified by
 *  storage-error.ts: a lock timeout is transient (another tab is writing), so
 *  it surfaces via the generic save-failure toast rather than the persistent
 *  connectivity/auth banner. */
export class TursoLockTimeoutError extends Error {
  constructor(options?: ErrorOptions) {
    super("Turso write lock timed out — another tab may be saving to the same database.", options);
    this.name = "TursoLockTimeoutError";
  }
}

/** Web Locks name for the cross-tab single-writer lock. Scoped by DB URL and
 *  (in tenant mode) project id: different DBs / projects must not contend. */
export function tursoWriteLockName(httpUrl: string, projectId: string | undefined): string {
  return `lop-turso-write:${httpUrl}:${projectId ?? "single"}`;
}

/** Defensively read results[i].response.result.rows[0][0].value as a string. */
function firstRowText(results: PipelineResultLike[], i: number): string | null {
  const cell = results[i]?.response?.result?.rows?.[0]?.[0];
  return cell && typeof cell.value === "string" ? cell.value : null;
}

/** Reduce the relational SELECT results of a load pipeline to "is the project
 *  empty?" — but ONLY when EVERY result is a well-formed success. A malformed or
 *  absent result means a PARTIAL/FAILED read; treating it as "0 rows" (the old
 *  `?? 0`) masks a failure as an empty project and lets the caller wipe good
 *  data — the version-history data-loss we hit. THROW on a malformed result so
 *  the load surfaces the error (banner) instead of returning an empty workspace.
 *  A genuinely-empty project (well-formed results, all 0 rows) still returns true. */
export function relationalReadIsEmpty(
  relational: readonly PipelineResultLike[],
  expected?: number,
): boolean {
  // A TRUNCATED pipeline (fewer results than SELECT statements) would otherwise
  // slip through the per-entry check and `.every([...])` as "empty" — the same
  // masked-partial-read hole. Require the full expected count.
  if (expected !== undefined && relational.length !== expected) {
    throw new Error(
      `Turso load returned ${relational.length} results, expected ${expected} — refusing to treat a truncated read as empty.`,
    );
  }
  for (const r of relational) {
    if (!Array.isArray(r?.response?.result?.rows)) {
      throw new Error(
        "Turso load returned a malformed/partial result — refusing to treat it as an empty project.",
      );
    }
  }
  return relational.every((r) => (r.response?.result?.rows ?? []).length === 0);
}

export class TursoBackend implements StorageBackend {
  readonly kind = "turso" as const;

  /**
   * Per-section workspace references from the LAST SUCCESSFUL save() — the
   * baseline for table-level dirty detection (see dirtyWorkspaceTables).
   * null until the first save succeeds, so the first save of an instance is
   * always a full rewrite (guards a fresh DB and the legacy-blob import path,
   * where load() returns data that is NOT yet in the relational tables).
   * Backend/project switches construct a new instance (storage.ts
   * createBackend), so the baseline never leaks across targets.
   */
  private baseline: Workspace | null = null;

  /**
   * Memoizes the one-time idempotent column-ensure migration (see
   * ensureColumns). Held as a Promise so concurrent saves on the same instance
   * await the SAME PRAGMA round-trip instead of each issuing their own. Reset to
   * null only if the migration throws, so a transient failure can be retried by
   * the next save (a successful run — including the zero-ALTER no-op — sticks).
   */
  private columnsEnsured: Promise<void> | null = null;

  constructor(
    private config: TursoConfig | null,
    private projectId?: string,
  ) {}

  async isReady(): Promise<boolean> {
    return this.config !== null;
  }

  async describe(): Promise<string | null> {
    if (!this.config) return null;
    try {
      return `Turso: ${new URL(this.config.httpUrl).host}`;
    } catch {
      return "Turso";
    }
  }

  async load(): Promise<Workspace> {
    return this.projectId === undefined
      ? this.loadSingleTenant()
      : this.loadTenant(this.projectId);
  }

  async save(workspace: Workspace): Promise<void> {
    // Dynamic import breaks the storage → turso-backend → turso-schema → storage cycle.
    const { workspaceToStatements, dirtyWorkspaceTables } = await import("./turso-schema");
    // Table-level dirty detection by reference equality (React state follows
    // the immutable-update convention). undefined = no baseline → full rewrite.
    const dirty = this.baseline ? dirtyWorkspaceTables(this.baseline, workspace) : undefined;
    if (dirty !== undefined && dirty.size === 0) {
      // Nothing changed since the last successful save — skip the round-trip.
      this.baseline = workspace;
      return;
    }
    let stmts: SqlStmt[];
    if (this.projectId === undefined) {
      stmts = workspaceToStatements(workspace, dirty);
    } else {
      const { tenantWorkspaceToStatements } = await import("./turso-tenant-schema");
      stmts = tenantWorkspaceToStatements(workspace, this.projectId, dirty);
    }
    // Cross-tab single-writer: two full tabs on the same DB + project would
    // otherwise interleave per-table dirty writes into a state neither tab
    // ever had. See withWriteLock. The column-ensure migration runs INSIDE the
    // lock too: it is itself a write (ALTER TABLE), so it must self-heal an
    // existing DB BEFORE the named-column INSERTs and be serialized with them.
    await this.withWriteLock(async () => {
      await this.ensureColumns();
      return runTursoPipeline(this.config, stmts);
    });
    // Reached only when the pipeline succeeded: a failed (or lock-aborted)
    // save keeps the old baseline so the next save retries the dirty tables.
    this.baseline = workspace;
  }

  /** Run `fn` while holding the exclusive cross-tab Web Lock for this DB +
   *  project. Falls back to a direct call when the Web Locks API is
   *  unavailable (jsdom, older browsers) or when no config is set (the
   *  pipeline then throws its own not-configured error). The wait is bounded:
   *  if the lock is not granted within LOCK_WAIT_TIMEOUT_MS the save fails
   *  with TursoLockTimeoutError instead of hanging forever. */
  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks || !this.config) return fn();
    const name = tursoWriteLockName(this.config.httpUrl, this.projectId);
    let granted = false;
    try {
      return await locks.request(
        name,
        { mode: "exclusive", signal: AbortSignal.timeout(LOCK_WAIT_TIMEOUT_MS) },
        () => {
          granted = true;
          return fn();
        },
      );
    } catch (err) {
      // A rejection before the callback ran means the lock wait itself was
      // aborted (the timeout fired). Errors thrown by fn() — i.e. real
      // pipeline failures — pass through unchanged once the lock was granted.
      if (!granted) throw new TursoLockTimeoutError({ cause: err });
      throw err;
    }
  }

  /**
   * Idempotent, once-per-instance column-ensure migration. SCHEMA_DDL uses
   * `CREATE TABLE IF NOT EXISTS`, which never adds a column to an existing
   * table — so a DB created before a new spec column (e.g. milestones'
   * outlookEventId) lacks it, and the save's named-column INSERT fails. This
   * reads each entity table's actual columns via PRAGMA table_info and issues
   * `ALTER TABLE … ADD COLUMN … TEXT` only for genuinely-missing columns.
   *
   * Cheap on the common path: one PRAGMA pipeline per session, and the ALTER
   * pipeline runs ONLY when something is missing (fresh / up-to-date DBs issue
   * zero ALTERs and skip the second round-trip). Memoized via columnsEnsured so
   * a no-op result is not re-checked on every subsequent save.
   */
  private ensureColumns(): Promise<void> {
    if (this.columnsEnsured) return this.columnsEnsured;
    const run = this.runColumnEnsure().catch((err) => {
      // A failed migration must not stick: clear the memo so the next save
      // retries, then propagate so this save fails rather than INSERTing into a
      // still-missing column.
      this.columnsEnsured = null;
      throw err;
    });
    this.columnsEnsured = run;
    return run;
  }

  private async runColumnEnsure(): Promise<void> {
    const {
      pragmaStatements, buildColumnEnsureAlters,
      singleTenantTableColumns, tenantTableColumns,
    } = await import("./turso-migrate");
    const specs = this.projectId === undefined ? singleTenantTableColumns() : tenantTableColumns();
    const tables = specs.map((s) => s.table);
    const pragmaResults = await runTursoPipeline(this.config, pragmaStatements(tables));
    const alters = buildColumnEnsureAlters(specs, pragmaResults);
    if (alters.length === 0) return; // fresh / up-to-date DB — no second round-trip.
    // Wrap a multi-table migration in a transaction so it applies atomically
    // (libSQL supports DDL in a transaction). A partial failure rolls back fully.
    await runTursoPipeline(this.config, [{ sql: "BEGIN" }, ...alters, { sql: "COMMIT" }]);
  }

  private async loadSingleTenant(): Promise<Workspace> {
    // Dynamic import breaks the storage → turso-backend → turso-schema → storage cycle.
    const { SCHEMA_DDL, TABLE_NAMES, selectStatements, rowsToWorkspace } =
      await import("./turso-schema");

    const stmts: SqlStmt[] = [
      ...SCHEMA_DDL.map((sql) => ({ sql })),
      { sql: OLD_BLOB_DDL },
      ...selectStatements(),
      { sql: OLD_BLOB_SELECT },
    ];
    const results = await runTursoPipeline(this.config, stmts, LOAD_TIMEOUT_MS);
    const ddlCount = SCHEMA_DDL.length + 1; // schema DDL + old-blob DDL
    const selectCount = TABLE_NAMES.length;
    const relational = results.slice(ddlCount, ddlCount + selectCount);
    const blobResult = results[ddlCount + selectCount];
    const isEmpty = relationalReadIsEmpty(relational, selectCount);
    if (isEmpty) {
      const blob = firstRowText([blobResult], 0);
      if (typeof blob === "string" && blob.length > 0) return jsonToWorkspace(blob);
      return emptyWorkspace();
    }
    return rowsToWorkspace(relational);
  }

  // NOTE: rowsToWorkspace does not populate ws.project (ProjectMeta is not in the
  // workspace tables under Turso), so tenant load() additionally fetches the
  // projects-table row for this id and sets ws.project from it.
  private async loadTenant(projectId: string): Promise<Workspace> {
    const { TABLE_NAMES, rowsToWorkspace } = await import("./turso-schema");
    const { tenantSchemaDdl, tenantSelectStatements, selectProjectStatement, rowsToProjectList } =
      await import("./turso-tenant-schema");
    const ddl = tenantSchemaDdl();
    const stmts = [
      ...ddl.map((sql) => ({ sql })),
      ...tenantSelectStatements(projectId),
      selectProjectStatement(projectId),
    ];
    const results = await runTursoPipeline(this.config, stmts, LOAD_TIMEOUT_MS);
    const relational = results.slice(ddl.length, ddl.length + TABLE_NAMES.length);
    const projectsResult = results[ddl.length + TABLE_NAMES.length];
    const isEmpty = relationalReadIsEmpty(relational, TABLE_NAMES.length);
    const ws = isEmpty ? emptyWorkspace() : rowsToWorkspace(relational);
    const meta = rowsToProjectList(projectsResult)[0]?.meta;
    return meta ? { ...ws, project: meta } : ws;
  }
}
