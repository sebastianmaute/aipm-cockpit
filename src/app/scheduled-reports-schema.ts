// §772 — data-only DDL for the portfolio-wide `scheduled_reports` table (kept apart from the store so the
// side-table registry in `project-side-tables.ts` does not import `turso-pipeline`).
export const SCHEDULED_REPORTS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS scheduled_reports (id TEXT PRIMARY KEY, project_id TEXT, job_key TEXT, slot TEXT, status TEXT, ok INTEGER, ran_at TEXT, claimed_by TEXT, data TEXT, UNIQUE (job_key, slot))`,
];
