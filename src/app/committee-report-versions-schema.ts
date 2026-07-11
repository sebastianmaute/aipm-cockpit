// src/app/committee-report-versions-schema.ts — pure SQL builders + row decoder for
// the GLOBAL append-only committee_report_versions table (steering-committee meeting
// report snapshots). MUST stay OUT of turso-schema's TABLE_NAMES (a guard test enforces
// it) so the workspace save's per-table DELETE never touches it.
import type { PipelineResultLike, SqlStmt } from "./turso-schema";

export interface MeetingReportVersion {
  id: string;
  projectId: string;
  meetingId: number;
  html: string;     // HTML snapshot
  isAuto: boolean;  // 1 = "before restore" auto-snapshot
  capturedAt: string;
}

export const MEETING_REPORT_VERSION_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS committee_report_versions (id TEXT PRIMARY KEY, project_id TEXT, meeting_id INTEGER, html TEXT, is_auto INTEGER, captured_at TEXT)`,
];

const txt = (value: string) => ({ type: "text" as const, value });
const int = (value: number) => ({ type: "integer" as const, value: String(value) });

export const versionsSelect = (projectId: string, meetingId: number): SqlStmt[] => [
  { sql: `SELECT * FROM committee_report_versions WHERE project_id = ? AND meeting_id = ? ORDER BY captured_at DESC`, args: [txt(projectId), int(meetingId)] },
];

export function insertVersionStatements(v: MeetingReportVersion): SqlStmt[] {
  return [{
    sql: `INSERT INTO committee_report_versions (id,project_id,meeting_id,html,is_auto,captured_at) VALUES (?,?,?,?,?,?)`,
    args: [txt(v.id), txt(v.projectId), int(v.meetingId), txt(v.html), int(v.isAuto ? 1 : 0), txt(v.capturedAt)],
  }];
}

export function deleteVersionStatements(id: string): SqlStmt[] {
  return [{ sql: `DELETE FROM committee_report_versions WHERE id = ?`, args: [txt(id)] }];
}

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

export function rowsToVersions(res: PipelineResultLike | undefined): MeetingReportVersion[] {
  return rowObjects(res)
    .filter((r) => r.id)
    .map((r): MeetingReportVersion => ({
      id: r.id,
      projectId: r.project_id ?? "",
      meetingId: Number(r.meeting_id ?? "0"),
      html: r.html ?? "",
      isAuto: r.is_auto === "1",
      capturedAt: r.captured_at ?? "",
    }));
}
