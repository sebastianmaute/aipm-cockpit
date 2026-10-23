// src/app/scheduled-jobs-store.ts — dual-backend persistence for SP5 scheduled
// Claude jobs. This is a GLOBAL store (NOT workspace data), so its Turso table
// MUST stay OUT of TABLE_NAMES — otherwise the workspace save's per-table DELETE
// would wipe it (mirrors operating-guide-store / comm-templates / learning).
//   tursoConfig === null -> localStorage (always-available default)
//   tursoConfig !== null -> global Turso table (cross-device), out of TABLE_NAMES.
// §772 — Turso jobs live in `scheduled_jobs_v2`. The pre-§772 table `scheduled_jobs` is read ONCE (migration) and
// then left to old clients: an old client rebuilds every job from a fixed field list and re-inserts the lot, which
// would strip the project, key, zone and instruction of every job sharing that table.
import { readDeviceJson } from "./device-store";
import { runTursoPipeline } from "./turso-pipeline";
import { rowObjects, type PipelineResultLike, type SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import { normalizeJobFields } from "./scheduled-jobs/schedule";
import {
  JOB_HISTORY_CAP, type JobCadence, type ScheduledJob, type ScheduledJobRun,
} from "./scheduled-jobs/types";

export const LOCAL_KEY = "aipm-cockpit:scheduled-jobs";
/** The pre-§772 table: read once by the migration, never written again by this client. */
export const SCHEDULED_JOBS_TABLE = "scheduled_jobs";
export const SCHEDULED_JOBS_V2_TABLE = "scheduled_jobs_v2";
/** A row of the v2 table that is not a job: it says the one-time migration has run. */
export const MIGRATED_MARKER_ID = "__migrated__";

// One row per job; the whole job (history inline) is stored as a JSON blob in
// `data` so a new history field never needs a column migration. SqlArg.value is
// string-only even for the integer id (Turso wants String(v)).
// The legacy table is created too, so the migration's SELECT never meets a missing table.
export const SCHEDULED_JOBS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS ${SCHEDULED_JOBS_V2_TABLE} (id TEXT PRIMARY KEY, data TEXT)`,
  `CREATE TABLE IF NOT EXISTS ${SCHEDULED_JOBS_TABLE} (id TEXT PRIMARY KEY, data TEXT)`,
];
const ddl = (): SqlStmt[] => SCHEDULED_JOBS_DDL.map((sql) => ({ sql }));
const txt = (value: string) => ({ type: "text" as const, value });

const jobsSelect = (): SqlStmt => ({ sql: `SELECT id, data FROM ${SCHEDULED_JOBS_V2_TABLE} WHERE id <> ?`, args: [txt(MIGRATED_MARKER_ID)] });
const markerSelect = (): SqlStmt => ({ sql: `SELECT id FROM ${SCHEDULED_JOBS_V2_TABLE} WHERE id = ?`, args: [txt(MIGRATED_MARKER_ID)] });
const markerInsert = (): SqlStmt => ({
  sql: `INSERT OR IGNORE INTO ${SCHEDULED_JOBS_V2_TABLE} (id, data) VALUES (?, ?)`, args: [txt(MIGRATED_MARKER_ID), txt("1")],
});
const noMarker = `NOT EXISTS (SELECT 1 FROM ${SCHEDULED_JOBS_V2_TABLE} WHERE id = ?)`;

/** ONE transaction, so two tabs migrating at once cannot both copy: the second finds the marker (or its write
 *  fails and the next load retries). Order matters: copy (every field kept), then switch the legacy rows OFF so a
 *  pre-§772 runner stops running them, then the marker that the first two statements test for. */
export function migrationStatements(): SqlStmt[] {
  const arg = [txt(MIGRATED_MARKER_ID)];
  return [
    { sql: "BEGIN" },
    { sql: `INSERT OR IGNORE INTO ${SCHEDULED_JOBS_V2_TABLE} (id, data) SELECT id, data FROM ${SCHEDULED_JOBS_TABLE} WHERE ${noMarker}`, args: arg },
    {
      sql: `UPDATE ${SCHEDULED_JOBS_TABLE} SET data = json_set(data, '$.enabled', json('false')) WHERE json_valid(data) AND ${noMarker}`,
      args: arg,
    },
    markerInsert(),
    { sql: "COMMIT" },
  ];
}

function replaceAllStatements(jobs: readonly ScheduledJob[]): SqlStmt[] {
  // The job set is small and edited as a whole, so a wipe-then-reinsert keeps
  // load == save without per-id diffing, and one transaction leaves no empty window.
  // Kept off TABLE_NAMES, so this DELETE is the ONLY one that ever touches the table.
  const stmts: SqlStmt[] = [{ sql: "BEGIN" }, { sql: `DELETE FROM ${SCHEDULED_JOBS_V2_TABLE}` }, markerInsert()];
  for (const job of jobs) {
    stmts.push({
      sql: `INSERT INTO ${SCHEDULED_JOBS_V2_TABLE} (id, data) VALUES (?, ?)`,
      args: [txt(job.foreign?.rowId ?? String(job.id)), txt(JSON.stringify(serializeJob(job)))],
    });
  }
  stmts.push({ sql: "COMMIT" });
  return stmts;
}

/** Databases whose tables exist and whose migration has run, this session. Forgotten after a failed call. */
const ready = new Set<string>();
async function ensureV2(config: TursoConfig): Promise<void> {
  if (ready.has(config.httpUrl)) return;
  const results = await runTursoPipeline(config, [...ddl(), markerSelect()]);
  const migrated = rowObjects(results[results.length - 1]).length > 0;
  if (!migrated) await runTursoPipeline(config, migrationStatements());
  ready.add(config.httpUrl);
}
/** Test-only: forget which databases are ready. */
export function __resetScheduledJobsStoreCache(): void {
  ready.clear();
}

// ---- validation / sanitization on load (never throw on bad input) ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function sanitizeCadence(raw: unknown): JobCadence | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  const timeOfDay = typeof raw.timeOfDay === "string" ? raw.timeOfDay : "";
  if (kind === "daily") return { kind: "daily", timeOfDay };
  if (kind === "weekly") {
    const dayOfWeek = Number(raw.dayOfWeek);
    return {
      kind: "weekly",
      dayOfWeek: Number.isFinite(dayOfWeek) ? dayOfWeek : 0,
      timeOfDay,
    };
  }
  return null;
}

function sanitizeRun(raw: unknown): ScheduledJobRun | null {
  if (!isRecord(raw)) return null;
  const ranAt = typeof raw.ranAt === "string" ? raw.ranAt : "";
  if (!ranAt) return null;
  const actionCount = Number(raw.actionCount);
  const run: ScheduledJobRun = {
    ranAt,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    actionCount: Number.isFinite(actionCount) ? actionCount : 0,
    ok: raw.ok === true,
  };
  if (typeof raw.error === "string") run.error = raw.error;
  return run;
}

/** The keys this version reads. Anything else on a stored job came from a newer version and is carried through. */
const KNOWN_JOB_KEYS: ReadonlySet<string> = new Set([
  "id", "name", "type", "cadence", "enabled", "projectId", "instruction", "timeZone", "key", "lastRunAt", "history",
]);

/** A job this version cannot read (an unknown type or cadence): a placeholder that carries the stored JSON verbatim. */
function foreignJob(id: number, raw: Record<string, unknown>, rowId?: string): ScheduledJob {
  return {
    id, name: typeof raw.name === "string" ? raw.name : "", type: "portfolioAnalysis",
    cadence: { kind: "daily", timeOfDay: "00:00" }, enabled: false, projectId: null, timeZone: null, key: null,
    lastRunAt: null, history: [], foreign: rowId !== undefined ? { raw, rowId } : { raw },
  };
}

/** What goes into storage: a foreign job exactly as it was read, any other job with its unknown fields put back. */
export function serializeJob(job: ScheduledJob): Record<string, unknown> {
  if (job.foreign) return job.foreign.raw;
  const known: Record<string, unknown> = { ...job };
  delete known.extra;
  delete known.foreign;
  return { ...job.extra, ...known };
}

/** A stable, negative placeholder id for a job whose own id is not a number (it cannot clash with a real one). */
function placeholderId(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return -1 - (h % 2147483647);
}

const numericId = (v: unknown): number =>
  typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : Number.NaN;

function sanitizeJob(raw: unknown, rowId?: string): ScheduledJob | null {
  if (!isRecord(raw) || Array.isArray(raw)) return null;
  const rawId = numericId(raw.id);
  const fromRow = rowId === undefined ? Number.NaN : numericId(rowId);
  const id = Number.isFinite(rawId) ? rawId : fromRow;
  // No numeric id anywhere: a newer version's job. Kept read-only and verbatim under a stable placeholder id; the
  // stored row id (when there is one) is written back unchanged.
  if (!Number.isFinite(id)) return foreignJob(placeholderId(rowId ?? JSON.stringify(raw)), raw, rowId);
  const cadence = sanitizeCadence(raw.cadence);
  if (cadence === null || raw.type !== "portfolioAnalysis") return foreignJob(id, raw);
  const history = Array.isArray(raw.history)
    ? raw.history
        .map(sanitizeRun)
        .filter((r): r is ScheduledJobRun => r !== null)
        .slice(0, JOB_HISTORY_CAP)
    : [];
  const lastRunAt = typeof raw.lastRunAt === "string" ? raw.lastRunAt : null;
  const { instruction, timeZone } = normalizeJobFields(
    typeof raw.instruction === "string" ? raw.instruction : undefined,
    typeof raw.timeZone === "string" ? raw.timeZone : null,
  );
  const extra = Object.fromEntries(Object.entries(raw).filter(([k]) => !KNOWN_JOB_KEYS.has(k)));
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : "",
    type: "portfolioAnalysis",
    cadence,
    enabled: raw.enabled === true,
    projectId: typeof raw.projectId === "string" && raw.projectId !== "" ? raw.projectId : null,
    ...(instruction !== undefined ? { instruction } : {}),
    timeZone,
    key: typeof raw.key === "string" && raw.key !== "" ? raw.key : null,
    lastRunAt,
    history,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

function sanitizeJobs(raw: unknown): ScheduledJob[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => sanitizeJob(r)).filter((j): j is ScheduledJob => j !== null);
}

// ---- localStorage backend ---------------------------------------------------

function readLocal(): ScheduledJob[] {
  return sanitizeJobs(readDeviceJson<unknown>(LOCAL_KEY, null));
}
function writeLocal(jobs: readonly ScheduledJob[]): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(jobs.map(serializeJob)));
}

// ---- Turso row decode -------------------------------------------------------

function rowsToJobs(res: PipelineResultLike | undefined): ScheduledJob[] {
  const cols = (res?.response?.result?.cols ?? []).map((c) => c?.name ?? "");
  const dataIdx = cols.indexOf("data");
  const idIdx = cols.indexOf("id");
  const rows = res?.response?.result?.rows ?? [];
  const jobs: ScheduledJob[] = [];
  for (const row of rows) {
    const cell = dataIdx >= 0 ? row[dataIdx] : undefined;
    if (cell == null || cell.value == null) continue;
    try {
      const idCell = idIdx >= 0 ? row[idIdx]?.value : undefined;
      const job = sanitizeJob(JSON.parse(String(cell.value)) as unknown, idCell == null ? undefined : String(idCell));
      if (job !== null) jobs.push(job);
    } catch {
      // Skip an unparseable row rather than failing the whole load.
    }
  }
  return jobs;
}

// ---- public API -------------------------------------------------------------

export async function loadScheduledJobs(config: TursoConfig | null): Promise<ScheduledJob[]> {
  if (!config) return readLocal();
  try {
    await ensureV2(config);
    const results = await runTursoPipeline(config, [jobsSelect()]);
    return rowsToJobs(results[0]);
  } catch (e) {
    ready.delete(config.httpUrl);
    throw e;
  }
}

export async function saveScheduledJobs(
  config: TursoConfig | null,
  jobs: readonly ScheduledJob[],
): Promise<void> {
  if (!config) {
    writeLocal(jobs);
    return;
  }
  try {
    await ensureV2(config);
    await runTursoPipeline(config, replaceAllStatements(jobs));
  } catch (e) {
    ready.delete(config.httpUrl);
    throw e;
  }
}
