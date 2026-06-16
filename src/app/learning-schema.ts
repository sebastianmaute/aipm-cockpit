// src/app/learning-schema.ts — pure SQL builders + row decoder for the GLOBAL
// action_learning table. This table is cross-project and MUST stay out of
// turso-schema's TABLE_NAMES so the workspace overwrite never touches it.
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { OutcomeStats, LearningOverride } from "./action-learning";
import type { LearningSnapshot } from "./learning-store";

export const LEARNING_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS action_learning (kind TEXT PRIMARY KEY, acted TEXT, snoozed TEXT, dismissed TEXT, last_at TEXT, override TEXT)`,
];

const txt = (value: string) => ({ type: "text" as const, value });

export const learningSelect = (): SqlStmt[] => [{ sql: `SELECT * FROM action_learning` }];

export function learningUpsert(kind: string, stats: OutcomeStats, override: LearningOverride): SqlStmt[] {
  return [{
    sql: `INSERT INTO action_learning (kind,acted,snoozed,dismissed,last_at,override) VALUES (?,?,?,?,?,?) ON CONFLICT(kind) DO UPDATE SET acted=excluded.acted,snoozed=excluded.snoozed,dismissed=excluded.dismissed,last_at=excluded.last_at,override=excluded.override`,
    args: [txt(kind), txt(String(stats.acted)), txt(String(stats.snoozed)), txt(String(stats.dismissed)), txt(String(stats.lastAt)), txt(override)],
  }];
}

export function learningDeleteAll(): SqlStmt[] {
  return [{ sql: `DELETE FROM action_learning` }];
}

// Decode helper mirrors comm-templates-schema's rowObjects: cols[i].name -> rows[r][i].value
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

export function rowsToSnapshot(res: PipelineResultLike | undefined): LearningSnapshot {
  const snap: LearningSnapshot = { state: {}, overrides: {} };
  for (const r of rowObjects(res)) {
    if (!r.kind) continue;
    snap.state[r.kind] = {
      acted: Number(r.acted) || 0,
      snoozed: Number(r.snoozed) || 0,
      dismissed: Number(r.dismissed) || 0,
      lastAt: Number(r.last_at) || 0,
    };
    if (r.override && r.override !== "auto") {
      snap.overrides[r.kind] = r.override as LearningOverride;
    }
  }
  return snap;
}
