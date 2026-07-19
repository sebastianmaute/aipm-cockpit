// src/app/scheduled-jobs-store.ts — dual-backend persistence for SP5 scheduled
// Claude jobs. This is a GLOBAL store (NOT workspace data), so its Turso table
// MUST stay OUT of TABLE_NAMES — otherwise the workspace save's per-table DELETE
// would wipe it (mirrors operating-guide-store / comm-templates / learning).
//   tursoConfig === null -> localStorage (always-available default)
//   tursoConfig !== null -> global Turso table (cross-device), out of TABLE_NAMES.
import { readDeviceJson } from "./device-store";
import { runTursoPipeline } from "./turso-pipeline";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import {
  JOB_HISTORY_CAP, type JobCadence, type ScheduledJob, type ScheduledJobRun,
} from "./scheduled-jobs/types";

export const LOCAL_KEY = "aipm-cockpit:scheduled-jobs";
export const SCHEDULED_JOBS_TABLE = "scheduled_jobs";

// One row per job; the whole job (history inline) is stored as a JSON blob in
// `data` so a new history field never needs a column migration. SqlArg.value is
// string-only even for the integer id (Turso wants String(v)).
const SCHEDULED_JOBS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS ${SCHEDULED_JOBS_TABLE} (id TEXT PRIMARY KEY, data TEXT)`,
];
const ddl = (): SqlStmt[] => SCHEDULED_JOBS_DDL.map((sql) => ({ sql }));
const txt = (value: string) => ({ type: "text" as const, value });

const jobsSelect = (): SqlStmt[] => [{ sql: `SELECT id, data FROM ${SCHEDULED_JOBS_TABLE}` }];

function replaceAllStatements(jobs: readonly ScheduledJob[]): SqlStmt[] {
  // The job set is small and edited as a whole, so a wipe-then-reinsert keeps
  // load == save without per-id diffing. Kept off TABLE_NAMES, so this DELETE is
  // the ONLY one that ever touches the table.
  const stmts: SqlStmt[] = [{ sql: `DELETE FROM ${SCHEDULED_JOBS_TABLE}` }];
  for (const job of jobs) {
    stmts.push({
      sql: `INSERT INTO ${SCHEDULED_JOBS_TABLE} (id, data) VALUES (?, ?)`,
      args: [txt(String(job.id)), txt(JSON.stringify(job))],
    });
  }
  return stmts;
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

function sanitizeJob(raw: unknown): ScheduledJob | null {
  if (!isRecord(raw)) return null;
  const id = Number(raw.id);
  if (!Number.isFinite(id)) return null;
  const cadence = sanitizeCadence(raw.cadence);
  if (cadence === null) return null;
  if (raw.type !== "portfolioAnalysis") return null;
  const history = Array.isArray(raw.history)
    ? raw.history
        .map(sanitizeRun)
        .filter((r): r is ScheduledJobRun => r !== null)
        .slice(0, JOB_HISTORY_CAP)
    : [];
  const lastRunAt = typeof raw.lastRunAt === "string" ? raw.lastRunAt : null;
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : "",
    type: "portfolioAnalysis",
    cadence,
    enabled: raw.enabled === true,
    lastRunAt,
    history,
  };
}

function sanitizeJobs(raw: unknown): ScheduledJob[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeJob).filter((j): j is ScheduledJob => j !== null);
}

// ---- localStorage backend ---------------------------------------------------

function readLocal(): ScheduledJob[] {
  return sanitizeJobs(readDeviceJson<unknown>(LOCAL_KEY, null));
}
function writeLocal(jobs: readonly ScheduledJob[]): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(jobs));
}

// ---- Turso row decode -------------------------------------------------------

function rowsToJobs(res: PipelineResultLike | undefined): ScheduledJob[] {
  const cols = (res?.response?.result?.cols ?? []).map((c) => c?.name ?? "");
  const dataIdx = cols.indexOf("data");
  const rows = res?.response?.result?.rows ?? [];
  const jobs: ScheduledJob[] = [];
  for (const row of rows) {
    const cell = dataIdx >= 0 ? row[dataIdx] : undefined;
    if (cell == null || cell.value == null) continue;
    try {
      const job = sanitizeJob(JSON.parse(String(cell.value)) as unknown);
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
  const results = await runTursoPipeline(config, [...ddl(), ...jobsSelect()]);
  return rowsToJobs(results[SCHEDULED_JOBS_DDL.length]);
}

export async function saveScheduledJobs(
  config: TursoConfig | null,
  jobs: readonly ScheduledJob[],
): Promise<void> {
  if (!config) {
    writeLocal(jobs);
    return;
  }
  await runTursoPipeline(config, [...ddl(), ...replaceAllStatements(jobs)]);
}
