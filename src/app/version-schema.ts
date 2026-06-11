// src/app/version-schema.ts
//
// Pure SQL builders + row decoders for the per-project version-history table.
// This table is APPEND-ONLY and MUST stay disjoint from turso-schema's
// TABLE_NAMES so the workspace overwrite (DELETE FROM ... per save) never
// touches it. Mirrors snapshot-schema.ts.

import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { ProjectVersion, ProjectVersionMeta, VersionTrigger } from "./version-history";

export const VERSION_TABLE_NAME = "project_versions";

export const VERSION_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS project_versions (
  id TEXT PRIMARY KEY, project_id TEXT, captured_at TEXT, trigger TEXT,
  label TEXT, summary TEXT, payload TEXT
)`,
];

const text = (value: string) => ({ type: "text" as const, value });

/** Metadata columns (everything except the heavy payload). */
const META_COLS = ["id", "project_id", "captured_at", "trigger", "label", "summary"] as const;

const ALL_COLS = [...META_COLS, "payload"] as const;

/** Single INSERT of all 7 columns. label/summary default to "" when null. */
export function appendVersionStatements(v: ProjectVersion, projectId: string): SqlStmt[] {
  return [
    {
      sql: `INSERT INTO ${VERSION_TABLE_NAME} (${ALL_COLS.join(", ")}) VALUES (${ALL_COLS.map(() => "?").join(", ")})`,
      args: [
        text(v.id), text(projectId), text(v.capturedAt), text(v.trigger),
        text(v.label ?? ""), text(v.summary ?? ""), text(v.payload),
      ],
    },
  ];
}

/** SELECT metadata only (NO payload), newest first, scoped to one project. */
export function versionListStatements(projectId: string): SqlStmt[] {
  return [
    {
      sql: `SELECT ${META_COLS.join(", ")} FROM ${VERSION_TABLE_NAME} WHERE project_id = ? ORDER BY captured_at DESC`,
      args: [text(projectId)],
    },
  ];
}

/** Fetch a single version's payload by id + project. */
export function versionPayloadStatements(id: string, projectId: string): SqlStmt[] {
  return [
    {
      sql: `SELECT payload FROM ${VERSION_TABLE_NAME} WHERE id = ? AND project_id = ?`,
      args: [text(id), text(projectId)],
    },
  ];
}

/** Delete auto rows beyond the newest `keep`; never touches manual rows.
 *  `keep` is a trusted integer (a constant or a clamped setting), so it is
 *  inlined as a sanitized integer — SQLite's LIMIT wants an integer expression,
 *  not a text-bound parameter (whose type affinity is driver-dependent). */
export function pruneStatements(projectId: string, keep: number): SqlStmt[] {
  const limit = Math.max(0, Math.floor(keep)); // injection-safe: integer only
  return [
    {
      sql: `DELETE FROM ${VERSION_TABLE_NAME} WHERE project_id = ? AND trigger = 'auto' AND id NOT IN (`
        + `SELECT id FROM ${VERSION_TABLE_NAME} WHERE project_id = ? AND trigger = 'auto' ORDER BY captured_at DESC LIMIT ${limit})`,
      args: [text(projectId), text(projectId)],
    },
  ];
}

export function deleteVersionStatements(id: string, projectId: string): SqlStmt[] {
  return [
    {
      sql: `DELETE FROM ${VERSION_TABLE_NAME} WHERE id = ? AND project_id = ?`,
      args: [text(id), text(projectId)],
    },
  ];
}

// --- decode ---------------------------------------------------------------

// Copied verbatim from snapshot-schema.ts / turso-schema.ts: knows the exact
// PipelineResultLike row/column shape.
function rowObjects(res: PipelineResultLike | undefined): Record<string, string>[] {
  const names = (res?.response?.result?.cols ?? []).map((c) => c?.name ?? "");
  const rows = res?.response?.result?.rows ?? [];
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    names.forEach((n, i) => {
      const cell = row[i];
      obj[n] = cell == null || cell.value == null ? "" : String(cell.value);
    });
    return obj;
  });
}

const triggerOf = (s: string): VersionTrigger => (s === "manual" ? "manual" : "auto");

/** Map metadata-query rows into ProjectVersionMeta. Rows without an id are
 *  skipped; empty label/summary become null. */
export function rowsToVersionMeta(res: PipelineResultLike | undefined): ProjectVersionMeta[] {
  return rowObjects(res)
    .filter((r) => r.id)
    .map((r): ProjectVersionMeta => ({
      id: r.id,
      projectId: r.project_id,
      capturedAt: r.captured_at,
      trigger: triggerOf(r.trigger),
      label: r.label === "" ? null : r.label,
      summary: r.summary === "" ? null : r.summary,
    }));
}

/** First row's payload, or null when the result is empty. */
export function payloadFromResult(res: PipelineResultLike | undefined): string | null {
  const rows = rowObjects(res);
  return rows.length > 0 ? rows[0].payload : null;
}
