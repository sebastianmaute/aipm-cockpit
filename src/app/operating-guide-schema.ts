// src/app/operating-guide-schema.ts — pure SQL builders + row decode for the
// GLOBAL operating_guides table. Cross-project; MUST stay out of TABLE_NAMES so
// the workspace overwrite never touches it (mirrors comm-templates-schema).
import { rowObjects, txt, int, type PipelineResultLike, type SqlStmt } from "./turso-schema";
import type { GuideScope, OperatingGuide } from "./operating-guide";

export const OPERATING_GUIDE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS operating_guides (id TEXT PRIMARY KEY, name TEXT, content TEXT, enabled INTEGER, priority INTEGER, scope TEXT, built_in INTEGER, created_at TEXT, updated_at TEXT)`,
];

export const guideSelect = (): SqlStmt[] => [{ sql: `SELECT * FROM operating_guides` }];

export function upsertStatements(g: OperatingGuide, now = ""): SqlStmt[] {
  return [{
    sql: `INSERT INTO operating_guides (id,name,content,enabled,priority,scope,built_in,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,content=excluded.content,enabled=excluded.enabled,priority=excluded.priority,scope=excluded.scope,built_in=excluded.built_in,updated_at=excluded.updated_at`,
    args: [
      txt(g.id), txt(g.name), txt(g.content), int(g.enabled ? 1 : 0),
      int(g.priority), txt(JSON.stringify(g.scope)), int(g.builtIn ? 1 : 0),
      txt(now), txt(now),
    ],
  }];
}

export function deleteStatements(id: string): SqlStmt[] {
  return [{ sql: `DELETE FROM operating_guides WHERE id = ?`, args: [txt(id)] }];
}

function parseScope(raw: string): GuideScope {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as GuideScope) : {};
  } catch {
    return {};
  }
}

export function rowsToGuides(res: PipelineResultLike | undefined): OperatingGuide[] {
  return rowObjects(res)
    .filter((r) => r.id)
    .map((r): OperatingGuide => ({
      id: r.id,
      name: r.name ?? "",
      content: r.content ?? "",
      enabled: r.enabled === "1",
      priority: Number(r.priority) || 0,
      scope: parseScope(r.scope),
      builtIn: r.built_in === "1",
    }));
}
