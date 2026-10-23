// §772 — the portfolio-wide `scheduled_reports` table. A row is BOTH the report and the run claim: the
// UNIQUE (job_key, slot) index lets exactly one device insert a given slot, so `claimReport` is the lock.
// ★ Outside TABLE_NAMES (a workspace save's per-table DELETE would wipe it) and registered in
// `project-side-tables.ts` so a project hard delete sweeps it. `SqlArg.value` is string-only.
// ★★ DDL goes in its own call BEFORE any transaction: `runTursoPipeline` refuses anything ahead of BEGIN.
import { runTursoPipeline } from "./turso-pipeline";
import { rowObjects, txt, type SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { TranslationKey } from "./i18n";
import { SCHEDULED_REPORTS_DDL } from "./scheduled-reports-schema";
import { GROUNDABLE_VIEWS, type AiActionSeverity, type GroundableView } from "./action-ai";

/** At most this many rows are kept per job key (newest by slot). */
export const REPORT_RETENTION_PER_JOB = 50;
/** The view reads at most this many rows (newest slot first): reports of deleted jobs are kept for ever, so an unbounded
 *  read would grow with the table on every mount, focus and run. */
export const REPORT_LIST_LIMIT = 200;
/** A `running` row older than this is shown as interrupted (tab closed, device slept). */
export const RUNNING_STALE_MS = 30 * 60_000;

/** `storage-unreachable` stays in the closed set because `toErrorToken` still maps a `StorageNotReadyError` to it; the
 *  run's callers catch that error first, as transient, so no row the runner writes carries it today. */
export type ReportErrorToken =
  | "limit" | "401" | "403" | "parse" | "storage-unreachable" | "turso"
  | "project-archived" | "project-missing" | "interrupted" | "error";

/** The one token -> message map, shared by the reports view and the Settings run history. */
export const REPORT_ERROR_KEY: Record<ReportErrorToken, TranslationKey> = {
  limit: "scheduledReportsErrLimit",
  "401": "scheduledReportsErr401",
  "403": "scheduledReportsErr403",
  parse: "scheduledReportsErrParse",
  "storage-unreachable": "scheduledReportsErrStorage",
  turso: "scheduledReportsErrTurso",
  "project-archived": "scheduledReportsErrProjectArchived",
  "project-missing": "scheduledReportsErrProjectMissing",
  interrupted: "scheduledReportsErrInterrupted",
  error: "scheduledReportsErrError",
};

export type ReportData = {
  jobName: string;
  projectName: string;
  instruction?: string;
  summary: string;
  /** Set when part of the project could not be read, so the summary may describe less than the whole project. */
  partial?: true;
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
  /** Set by the DATABASE when the claim is made, so every device compares one clock. */
  ranAt: string;
  claimedBy: string;
  data: ReportData;
  /** The database's own clock when this row was read (absent on a hand-built row). */
  serverNow?: string;
};

const ddl = (): SqlStmt[] => SCHEDULED_REPORTS_DDL.map((sql) => ({ sql }));

/** The table is created once per database per session, not on every 5-minute tick of every open tab. A failed
 *  call forgets it again, so a database that lost the table is re-created on the next call. */
const ensured = new Set<string>();
const schemaKey = (config: TursoConfig | null): string => config?.httpUrl ?? "";
async function ensureTable(config: TursoConfig | null): Promise<void> {
  const key = schemaKey(config);
  if (ensured.has(key)) return;
  await runTursoPipeline(config, ddl());
  ensured.add(key);
}
async function withTable<T>(config: TursoConfig | null, run: () => Promise<T>): Promise<T> {
  await ensureTable(config);
  try {
    return await run();
  } catch (e) {
    ensured.delete(schemaKey(config));
    throw e;
  }
}
/** Test-only: forget which databases already have the table. */
export function __resetScheduledReportsSchemaCache(): void {
  ensured.clear();
}

/** The database's clock, as the uniform ISO text `ran_at` uses. */
const SERVER_NOW_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

/** The pre-claim check (spec Slots): true when ANY report of this job has a slot at or after `slot`, i.e. the slot
 *  is taken or older than the job's last report. So a time or zone edited to an EARLIER slot does not re-run the day;
 *  an edit to a LATER slot gives a slot with no report at or after it, which is due and runs once more that day. Slots are uniform
 *  `toISOString()` strings, so text order is time order. The UNIQUE claim still guards the exact slot. */
export async function hasReportAtOrAfter(config: TursoConfig | null, jobKey: string, slot: string): Promise<boolean> {
  return withTable(config, async () => {
    const results = await runTursoPipeline(config, [
      { sql: `SELECT id FROM scheduled_reports WHERE job_key = ? AND slot >= ? LIMIT 1`, args: [txt(jobKey), txt(slot)] },
    ]);
    return rowObjects(results[0]).length > 0;
  });
}

/** What the report table says about a slot of a job. `final`: a finished report (done or failed) exists, or a running
 *  claim old enough to count as interrupted (judged on the database's clock), or a row of a LATER slot exists.
 *  `in-flight`: a live running claim, which its claimant may still release. `none`: nothing at or after the slot. */
export type SlotStatus = "none" | "in-flight" | "final";

export async function slotStatus(config: TursoConfig | null, jobKey: string, slot: string): Promise<SlotStatus> {
  return withTable(config, async () => {
    const results = await runTursoPipeline(config, [{
      sql: `SELECT slot, status, ran_at, ${SERVER_NOW_SQL} AS server_now FROM scheduled_reports WHERE job_key = ? AND slot >= ?`,
      args: [txt(jobKey), txt(slot)],
    }]);
    const rows = rowObjects(results[0]);
    if (rows.length === 0) return "none";
    const settled = rows.some((r) =>
      r.status === "done" || r.slot > slot || runningIsStale(r.ran_at, Date.parse(r.server_now)));
    return settled ? "final" : "in-flight";
  });
}

/** True iff THIS call inserted the row, i.e. won the claim for `(jobKey, slot)`. */
export async function claimReport(
  config: TursoConfig | null,
  row: { id: string; projectId: string; jobKey: string; slot: string; claimedBy: string; data: ReportData },
): Promise<boolean> {
  // ★ DDL goes in its own call before the insert. `ran_at` is the DATABASE's clock, not the claimant's.
  return withTable(config, async () => {
    const results = await runTursoPipeline(config, [{
      sql: `INSERT INTO scheduled_reports (id, project_id, job_key, slot, status, ok, ran_at, claimed_by, data) VALUES (?, ?, ?, ?, 'running', 0, ${SERVER_NOW_SQL}, ?, ?) ON CONFLICT (job_key, slot) DO NOTHING RETURNING id`,
      args: [txt(row.id), txt(row.projectId), txt(row.jobKey), txt(row.slot), txt(row.claimedBy), txt(JSON.stringify(row.data))],
    }]);
    return rowObjects(results[0]).length > 0;
  });
}

export async function releaseClaim(config: TursoConfig | null, id: string): Promise<void> {
  await withTable(config, () => runTursoPipeline(config, [
    { sql: `DELETE FROM scheduled_reports WHERE id = ? AND status = 'running'`, args: [txt(id)] },
  ]));
}

/** Marks the claim done and applies retention in ONE atomic batch. */
export async function finishReport(
  config: TursoConfig | null, id: string, jobKey: string, ok: boolean, data: ReportData,
): Promise<void> {
  await withTable(config, () => runTursoPipeline(config, [
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
  ]));
}

const ERROR_TOKENS: ReadonlySet<string> = new Set<ReportErrorToken>([
  "limit", "401", "403", "parse", "storage-unreachable", "turso",
  "project-archived", "project-missing", "interrupted", "error",
]);
const SEVERITIES: ReadonlySet<string> = new Set<AiActionSeverity>(["now", "soon", "monitor"]);
const GROUNDABLE: ReadonlySet<string> = new Set(GROUNDABLE_VIEWS);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** ★ A row is shared with other devices and app versions, so `data` is external input: every field the view
 *  reads is checked here. An unknown severity reads as the lowest tier, an unknown error token as plain "error",
 *  and an entity the view cannot name is dropped. Null only when `data` is not an object at all. */
export function sanitizeReportData(raw: unknown): ReportData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const actions = (Array.isArray(d.actions) ? d.actions : []).flatMap((a): ReportData["actions"] => {
    if (!a || typeof a !== "object") return [];
    const x = a as Record<string, unknown>;
    const e = x.entity as Record<string, unknown> | undefined;
    const entity = e && typeof e.id === "string" && typeof e.view === "string" && GROUNDABLE.has(e.view)
      ? { view: e.view as GroundableView, id: e.id } : undefined;
    const severity = typeof x.severity === "string" && SEVERITIES.has(x.severity) ? (x.severity as AiActionSeverity) : "monitor";
    const title = str(x.title);
    const why = str(x.why);
    if (!title && !why) return []; // a malformed row would render as an empty card
    return [{ title, why, severity, ...(entity ? { entity } : {}) }];
  });
  const instruction = str(d.instruction);
  const error = d.error === undefined ? undefined : ERROR_TOKENS.has(str(d.error)) ? (d.error as ReportErrorToken) : "error";
  return {
    jobName: str(d.jobName), projectName: str(d.projectName), summary: str(d.summary), actions,
    ...(instruction ? { instruction } : {}), ...(error ? { error } : {}), ...(d.partial === true ? { partial: true as const } : {}),
  };
}

function decode(r: Record<string, string>): ScheduledReport | null {
  try {
    const data = sanitizeReportData(JSON.parse(r.data));
    if (!data) return null;
    return {
      id: r.id, projectId: r.project_id, jobKey: r.job_key, slot: r.slot,
      status: r.status === "done" ? "done" : "running",
      ok: r.ok === "1", ranAt: r.ran_at, claimedBy: r.claimed_by, data,
      ...(r.server_now ? { serverNow: r.server_now } : {}),
    };
  } catch {
    return null;
  }
}

/** Newest slot first (a slot is never re-run, so this is also newest `ran_at` first); a row whose `data` does not parse is
 *  skipped. With `projectId` only that project's rows are read (still the newest REPORT_LIST_LIMIT of them), so the view's
 *  project filter reaches rows older than the newest REPORT_LIST_LIMIT overall. */
export async function listReports(config: TursoConfig | null, projectId?: string): Promise<ScheduledReport[]> {
  return withTable(config, async () => {
    const where = projectId === undefined ? "" : " WHERE project_id = ?";
    const results = await runTursoPipeline(config, [
      {
        sql: `SELECT id, project_id, job_key, slot, status, ok, ran_at, claimed_by, data, ${SERVER_NOW_SQL} AS server_now FROM scheduled_reports${where} ORDER BY slot DESC, id DESC LIMIT ${REPORT_LIST_LIMIT}`,
        ...(projectId === undefined ? {} : { args: [txt(projectId)] }),
      },
    ]);
    return rowObjects(results[0])
      .map(decode)
      .filter((r): r is ScheduledReport => r !== null);
  });
}

/** Every project that has a report, with the name its NEWEST report carries (newest project first): a cheap query of its
 *  own, so the project filter does not depend on how many rows the list read returns. */
export async function listReportProjects(config: TursoConfig | null): Promise<{ id: string; name: string }[]> {
  return withTable(config, async () => {
    const results = await runTursoPipeline(config, [{
      sql: `SELECT r.project_id AS project_id, json_extract(r.data, '$.projectName') AS name FROM scheduled_reports r JOIN (SELECT project_id, MAX(slot) AS newest FROM scheduled_reports GROUP BY project_id) m ON r.project_id = m.project_id AND r.slot = m.newest ORDER BY r.slot DESC, r.id DESC`,
    }]);
    const seen = new Map<string, string>();
    for (const r of rowObjects(results[0])) if (r.project_id && !seen.has(r.project_id)) seen.set(r.project_id, r.name ?? "");
    return Array.from(seen, ([id, name]) => ({ id, name }));
  });
}

/** A running claim older than `RUNNING_STALE_MS` is shown, and judged, as interrupted. */
function runningIsStale(ranAt: string, referenceMs: number): boolean {
  const started = Date.parse(ranAt);
  return Number.isFinite(started) && Number.isFinite(referenceMs) && referenceMs - started > RUNNING_STALE_MS;
}

export function isInterrupted(r: ScheduledReport, now: Date): boolean {
  if (r.status !== "running") return false;
  // Both ends on the database's clock when the row carries it: the claimant's and the viewer's clocks may differ.
  return runningIsStale(r.ranAt, r.serverNow !== undefined ? Date.parse(r.serverNow) : now.getTime());
}
