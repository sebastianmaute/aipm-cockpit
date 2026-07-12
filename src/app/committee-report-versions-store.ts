// src/app/committee-report-versions-store.ts — async CRUD for steering-committee
// meeting report versions over the shared Turso pipeline. Every call prepends the
// DDL (CREATE IF NOT EXISTS).
import { runTursoPipeline } from "./turso-pipeline";
import {
  MEETING_REPORT_VERSION_DDL, MEETING_REPORT_VERSION_CAP, versionsSelect, insertVersionStatements,
  deleteVersionStatements, pruneVersionsStatements, rowsToVersions,
  type MeetingReportVersion,
} from "./committee-report-versions-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

const ddl = (): SqlStmt[] => MEETING_REPORT_VERSION_DDL.map((sql) => ({ sql }));

export async function loadVersions(config: TursoConfig | null, projectId: string, meetingId: number): Promise<MeetingReportVersion[]> {
  const results = await runTursoPipeline(config, [...ddl(), ...versionsSelect(projectId, meetingId)]);
  return rowsToVersions(results[MEETING_REPORT_VERSION_DDL.length]);
}
export async function saveVersion(config: TursoConfig | null, v: MeetingReportVersion): Promise<void> {
  // Insert then prune older snapshots beyond the per-meeting cap (one pipeline).
  await runTursoPipeline(config, [
    ...ddl(),
    ...insertVersionStatements(v),
    ...pruneVersionsStatements(v.projectId, v.meetingId, MEETING_REPORT_VERSION_CAP),
  ]);
}
export async function deleteVersion(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...deleteVersionStatements(id)]);
}
