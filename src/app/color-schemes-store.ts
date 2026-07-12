// Dual-backend persistence for the USER color-scheme LIBRARY (mirrors
// scheduled-jobs-store.ts). GLOBAL store — its Turso table MUST stay OUT of
// TABLE_NAMES or the workspace save's per-table DELETE would wipe it.
//   config === null -> localStorage (sync cache, the always-available default)
//   config !== null -> global color_schemes table (cross-device), out of TABLE_NAMES.
// Built-in schemes are code-owned (reconcileBuiltins) and NEVER persisted here.
// activeId is per-device and lives in the localStorage cache only, never the DB.
import { runTursoPipeline } from "./turso-pipeline";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import { loadSchemes, saveSchemes, type ColorScheme } from "./color-schemes";

export const COLOR_SCHEMES_TABLE = "color_schemes";

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS ${COLOR_SCHEMES_TABLE} (id TEXT PRIMARY KEY, data TEXT)`,
];
const ddl = (): SqlStmt[] => DDL.map((sql) => ({ sql }));
const txt = (value: string) => ({ type: "text" as const, value });
const schemesSelect = (): SqlStmt[] => [{ sql: `SELECT id, data FROM ${COLOR_SCHEMES_TABLE}` }];

function replaceAll(schemes: readonly ColorScheme[]): SqlStmt[] {
  // small set (<=30), edited whole → wipe-then-reinsert keeps load == save.
  const stmts: SqlStmt[] = [{ sql: `DELETE FROM ${COLOR_SCHEMES_TABLE}` }];
  for (const s of schemes) {
    stmts.push({
      sql: `INSERT INTO ${COLOR_SCHEMES_TABLE} (id, data) VALUES (?, ?)`,
      args: [txt(String(s.id)), txt(JSON.stringify(s))],
    });
  }
  return stmts;
}

export function rowsToSchemes(res: PipelineResultLike | undefined): ColorScheme[] {
  const cols = (res?.response?.result?.cols ?? []).map((c) => c?.name ?? "");
  const dataIdx = cols.indexOf("data");
  const rows = res?.response?.result?.rows ?? [];
  const out: ColorScheme[] = [];
  for (const row of rows) {
    const cell = dataIdx >= 0 ? row[dataIdx] : undefined;
    if (cell == null || cell.value == null) continue;
    try {
      const s = JSON.parse(String(cell.value)) as ColorScheme;
      if (s && typeof s === "object" && typeof s.id === "string" && !s.builtIn) out.push(s);
    } catch {
      /* skip an unparseable row rather than fail the whole load */
    }
  }
  return out;
}

/** Load the user-scheme library. Turso config → DB (cross-device); else the
 *  localStorage cache. Never throws — a pipeline error falls back to the cache. */
export async function loadSchemesAsync(config: TursoConfig | null): Promise<ColorScheme[]> {
  const localUser = loadSchemes().schemes.filter((s) => !s.builtIn);
  if (!config) return localUser;
  try {
    const results = await runTursoPipeline(config, [...ddl(), ...schemesSelect()]);
    const dbUser = rowsToSchemes(results[DDL.length]);
    if (dbUser.length === 0 && localUser.length > 0) {
      // one-time migration: connecting Turso must not make local schemes vanish.
      await saveSchemesAsync(config, localUser);
      return localUser;
    }
    return dbUser;
  } catch {
    return localUser;
  }
}

/** Persist the user-scheme library. Always writes the localStorage cache
 *  (preserving activeId); Turso config → also mirror to the DB. */
export async function saveSchemesAsync(
  config: TursoConfig | null,
  schemes: readonly ColorScheme[],
): Promise<void> {
  const cur = loadSchemes();
  const builtins = cur.schemes.filter((s) => s.builtIn);
  const userOnly = schemes.filter((s) => !s.builtIn);
  saveSchemes({ schemes: [...builtins, ...userOnly], activeId: cur.activeId });
  if (!config) return;
  await runTursoPipeline(config, [...ddl(), ...replaceAll(userOnly)]);
}
