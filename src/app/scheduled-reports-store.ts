// §772 — the portfolio-wide `scheduled_reports` table. A row is BOTH the report and the run claim: the
// UNIQUE (job_key, slot) index lets exactly one device insert a given slot, so `claimReport` is the lock.
// ★ Outside TABLE_NAMES (a workspace save's per-table DELETE would wipe it) and registered in
// `project-side-tables.ts` so a project hard delete sweeps it. `SqlArg.value` is string-only.
// ★★ DDL goes in its own call BEFORE any transaction: `runTursoPipeline` refuses anything ahead of BEGIN.
import { runTursoPipeline } from "./turso-pipeline";
import { rowObjects, txt, type SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import { SCHEDULED_REPORTS_DDL } from "./scheduled-reports-schema";
import type { AiActionSeverity, GroundableView } from "./action-ai";


/** At most this many rows are kept per job key (newest by slot). */
export const REPORT_RETENTION_PER_JOB = 50;
/** A `running` row older than this is shown as interrupted (tab closed, device slept). */
export const RUNNING_STALE_MS = 30 * 60_000;

export type ReportErrorToken =
  | "limit" | "401" | "403" | "parse" | "storage-unreachable" | "turso"
  | "project-archived" | "project-missing" | "interrupted" | "error";

export type ReportData = {
  jobName: string;
  projectName: string;
  instruction?: string;
  summary: string;
  actions: {
    title: string;
    why: string;
    severity: AiActionSeverity;
    entity?: { view: GroundableView; id: string };
  }[];
  error?: ReportErrorToken;
};

export type ScheduledReport = {
  id: string;
  projectId: string;
  jobKey: string;
  slot: string;
  status: "running" | "done";
  ok: boolean;
  ranAt: string;
  claimedBy: string;
  data: ReportData;
};

const ddl = (): SqlStmt[] => SCHEDULED_REPORTS_DDL.map((sql) => ({ sql }));

export async function hasReport(config: TursoConfig | null, jobKey: string, slot: string): Promise<boolean> {
  const results = await runTursoPipeline(config, [
    ...ddl(),
    { sql: `SELECT id FROM scheduled_reports WHERE job_key = ? AND slot = ?`, args: [txt(jobKey), txt(slot)] },
  ]);
  return rowObjects(results[SCHEDULED_REPORTS_DDL.length]).length > 0;
}

/** True iff THIS call inserted the row, i.e. won the claim for `(jobKey, slot)`. */
export async function claimReport(
  config: TursoConfig | null,
  row: { id: string; projectId: string; jobKey: string; slot: string; ranAt: string; claimedBy: string; data: ReportData },
): Promise<boolean> {
  await runTursoPipeline(config, ddl());
  const results = await runTursoPipeline(config, [{
    sql: `INSERT INTO scheduled_reports (id, project_id, job_key, slot, status, ok, ran_at, claimed_by, data) VALUES (?, ?, ?, ?, 'running', 0, ?, ?, ?) ON CONFLICT (job_key, slot) DO NOTHING RETURNING id`,
    args: [txt(row.id), txt(row.projectId), txt(row.jobKey), txt(row.slot), txt(row.ranAt), txt(row.claimedBy), txt(JSON.stringify(row.data))],
  }]);
  return rowObjects(results[0]).length > 0;
}

export async function releaseClaim(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [
    ...ddl(),
    { sql: `DELETE FROM scheduled_reports WHERE id = ? AND status = 'running'`, args: [txt(id)] },
  ]);
}

/** Marks the claim done and applies retention in ONE atomic batch. */
export async function finishReport(
  config: TursoConfig | null, id: string, jobKey: string, ok: boolean, data: ReportData,
): Promise<void> {
  await runTursoPipeline(config, ddl());
  await runTursoPipeline(config, [
    { sql: `BEGIN` },
    {
      sql: `UPDATE scheduled_reports SET status = 'done', ok = ?, data = ? WHERE id = ? AND status = 'running'`,
      args: [txt(ok ? "1" : "0"), txt(JSON.stringify(data)), txt(id)],
    },
    // Counts `running` rows on purpose (spec): a running claim goes only once 50 newer slots of its job exist. Do not narrow to status = 'done'.
    {
      sql: `DELETE FROM scheduled_reports WHERE job_key = ? AND id NOT IN (SELECT id FROM scheduled_reports WHERE job_key = ? ORDER BY slot DESC, id DESC LIMIT ${REPORT_RETENTION_PER_JOB})`,
      args: [txt(jobKey), txt(jobKey)],
    },
    { sql: `COMMIT` },
  ]);
}

function decode(r: Record<string, string>): ScheduledReport | null {
  try {
    const data = JSON.parse(r.data) as ReportData;
    if (!data || typeof data !== "object") return null;
    return {
      id: r.id, projectId: r.project_id, jobKey: r.job_key, slot: r.slot,
      status: r.status === "done" ? "done" : "running",
      ok: r.ok === "1", ranAt: r.ran_at, claimedBy: r.claimed_by, data,
    };
  } catch {
    return null;
  }
}

/** Newest slot first; a row whose `data` does not parse is skipped. */
export async function listReports(config: TursoConfig | null): Promise<ScheduledReport[]> {
  const results = await runTursoPipeline(config, [
    ...ddl(),
    { sql: `SELECT id, project_id, job_key, slot, status, ok, ran_at, claimed_by, data FROM scheduled_reports ORDER BY slot DESC, id DESC` },
  ]);
  return rowObjects(results[SCHEDULED_REPORTS_DDL.length])
    .map(decode)
    .filter((r): r is ScheduledReport => r !== null);
}

export function isInterrupted(r: ScheduledReport, now: Date): boolean {
  if (r.status !== "running") return false;
  const started = Date.parse(r.ranAt);
  return Number.isFinite(started) && now.getTime() - started > RUNNING_STALE_MS;
}
