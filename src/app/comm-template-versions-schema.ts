// src/app/comm-template-versions-schema.ts — pure SQL builders + row decoder for
// the GLOBAL append-only comm_template_versions table. MUST stay OUT of
// turso-schema's TABLE_NAMES (a guard test enforces it) so the workspace save's
// per-table DELETE never touches it.
import { rowObjects, txt, int, type PipelineResultLike, type SqlStmt } from "./turso-schema";

export interface CommTemplateVersion {
  id: string;
  templateId: string;
  name: string;
  body: string;     // HTML snapshot
  isAuto: boolean;  // 1 = "before restore" auto-snapshot
  createdAt: string;
}

export const COMM_TEMPLATE_VERSION_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS comm_template_versions (id TEXT PRIMARY KEY, template_id TEXT, name TEXT, body TEXT, is_auto INTEGER, created_at TEXT)`,
];

export const versionsSelect = (templateId: string): SqlStmt[] => [
  { sql: `SELECT * FROM comm_template_versions WHERE template_id = ? ORDER BY created_at DESC`, args: [txt(templateId)] },
];

export function insertVersionStatements(v: CommTemplateVersion): SqlStmt[] {
  return [{
    sql: `INSERT INTO comm_template_versions (id,template_id,name,body,is_auto,created_at) VALUES (?,?,?,?,?,?)`,
    args: [txt(v.id), txt(v.templateId), txt(v.name), txt(v.body), int(v.isAuto ? 1 : 0), txt(v.createdAt)],
  }];
}

export function deleteVersionStatements(id: string): SqlStmt[] {
  return [{ sql: `DELETE FROM comm_template_versions WHERE id = ?`, args: [txt(id)] }];
}

export function rowsToVersions(res: PipelineResultLike | undefined): CommTemplateVersion[] {
  return rowObjects(res)
    .filter((r) => r.id)
    .map((r): CommTemplateVersion => ({
      id: r.id,
      templateId: r.template_id ?? "",
      name: r.name ?? "",
      body: r.body ?? "",
      isAuto: r.is_auto === "1",
      createdAt: r.created_at ?? "",
    }));
}
