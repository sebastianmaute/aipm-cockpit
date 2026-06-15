// src/app/comm-templates-schema.ts — pure SQL builders + row decoder for the
// GLOBAL comm_templates table. This table is cross-project and MUST stay out of
// turso-schema's TABLE_NAMES so the workspace overwrite never touches it.
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { CommTemplate, CommTemplateCategory } from "./comm-templates";

export const COMM_TEMPLATE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS comm_templates (id TEXT PRIMARY KEY, category TEXT, name TEXT, body TEXT, is_default INTEGER, created_at TEXT, updated_at TEXT)`,
];

const txt = (value: string) => ({ type: "text" as const, value });
const int = (value: number) => ({ type: "integer" as const, value: String(value) });

export const templateSelect = (): SqlStmt[] => [{ sql: `SELECT * FROM comm_templates` }];

export function upsertStatements(t: CommTemplate): SqlStmt[] {
  return [{
    sql: `INSERT INTO comm_templates (id,category,name,body,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET category=excluded.category,name=excluded.name,body=excluded.body,is_default=excluded.is_default,updated_at=excluded.updated_at`,
    args: [txt(t.id), txt(t.category), txt(t.name), txt(t.body), int(t.isDefault ? 1 : 0), txt(t.createdAt), txt(t.updatedAt)],
  }];
}

export function deleteStatements(id: string): SqlStmt[] {
  return [{ sql: `DELETE FROM comm_templates WHERE id = ?`, args: [txt(id)] }];
}

export function setDefaultStatements(category: CommTemplateCategory, id: string): SqlStmt[] {
  return [
    { sql: `UPDATE comm_templates SET is_default = 0 WHERE category = ?`, args: [txt(category)] },
    { sql: `UPDATE comm_templates SET is_default = 1 WHERE id = ?`, args: [txt(id)] },
  ];
}

// Decode helper mirrors snapshot-schema's private rowObjects: cols[i].name -> rows[r][i].value
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

export function rowsToTemplates(res: PipelineResultLike | undefined): CommTemplate[] {
  return rowObjects(res)
    .filter((r) => r.id)
    .map((r): CommTemplate => ({
      id: r.id,
      category: r.category as CommTemplateCategory,
      name: r.name,
      body: r.body ?? "",
      isDefault: r.is_default === "1",
      createdAt: r.created_at ?? "",
      updatedAt: r.updated_at ?? "",
    }));
}
