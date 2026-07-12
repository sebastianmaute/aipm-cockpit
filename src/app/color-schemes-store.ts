// Dual-backend persistence for the USER color-scheme LIBRARY. GLOBAL store —
// its Turso table MUST stay OUT of TABLE_NAMES or the workspace save's per-table
// DELETE would wipe it.
//   config === null -> localStorage only (the sync cache is the source of truth)
//   config !== null -> global color_schemes table (cross-device), out of TABLE_NAMES.
// Built-in schemes are code-owned (reconcileBuiltins) and NEVER persisted here.
// activeId is per-device and lives in the localStorage cache only, never the DB.
//
// ★ Writes are PER-ROW (upsert / targeted delete), NOT a wipe-then-reinsert of a
// local snapshot. color_schemes is a MULTI-WRITER surface (every device sharing
// the Turso project writes it); a `DELETE FROM color_schemes` + reinsert-local
// would drop rows written by other devices whenever the local cache was stale
// (fresh device, mid-mount-refresh window) — a lost-update wipe. Per-row ops only
// ever touch the row being changed, so other devices' schemes are never lost.
import { runTursoPipeline } from "./turso-pipeline";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import { loadSchemes, cleanScheme, type ColorScheme } from "./color-schemes";

export const COLOR_SCHEMES_TABLE = "color_schemes";

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS ${COLOR_SCHEMES_TABLE} (id TEXT PRIMARY KEY, data TEXT)`,
];
const ddl = (): SqlStmt[] => DDL.map((sql) => ({ sql }));
const txt = (value: string) => ({ type: "text" as const, value });
const schemesSelect = (): SqlStmt[] => [{ sql: `SELECT id, data FROM ${COLOR_SCHEMES_TABLE}` }];

/** Decode + SANITIZE DB rows. color_schemes is a SHARED-TENANT surface (any
 *  project member can write a row), so every decoded scheme MUST go through the
 *  same `cleanScheme` gate the localStorage path uses — HEX/token allowlist on
 *  colors + `sanitizeBranding` (raster-only logo/favicon, no SVG) — or unsanitized
 *  colors reach `setProperty` (CSS injection) and unsafe branding reaches
 *  `<img>`/favicon. A row that fails validation is dropped, not trusted. */
export function rowsToSchemes(res: PipelineResultLike | undefined): ColorScheme[] {
  const cols = (res?.response?.result?.cols ?? []).map((c) => c?.name ?? "");
  const dataIdx = cols.indexOf("data");
  const rows = res?.response?.result?.rows ?? [];
  const out: ColorScheme[] = [];
  for (const row of rows) {
    const cell = dataIdx >= 0 ? row[dataIdx] : undefined;
    if (cell == null || cell.value == null) continue;
    try {
      const parsed = JSON.parse(String(cell.value)) as { id?: unknown };
      const id = typeof parsed?.id === "string" ? parsed.id : "";
      if (!id) continue;
      const clean = cleanScheme(parsed, id);
      if (clean && !clean.builtIn) out.push(clean);
    } catch {
      /* skip an unparseable row rather than fail the whole load */
    }
  }
  return out;
}

/** Load the user-scheme library. Turso config → DB (cross-device, sanitized);
 *  else the localStorage cache. Never throws — a pipeline error falls back to the
 *  cache. Local-only schemes (an id not yet in the DB) are MERGED into the DB
 *  additively (upsert) so connecting Turso never drops a scheme created offline,
 *  and no other device's rows are touched. (User ids are per-device `u-<n>`, so a
 *  cross-device id collision keeps the DB copy and shadows the local one — a known
 *  limitation of incremental ids without a central minter; rare in practice since,
 *  once connected, the cache mirrors the DB and new ids mint past the DB max.) */
export async function loadSchemesAsync(config: TursoConfig | null): Promise<ColorScheme[]> {
  const localUser = loadSchemes().schemes.filter((s) => !s.builtIn);
  if (!config) return localUser;
  try {
    const results = await runTursoPipeline(config, [...ddl(), ...schemesSelect()]);
    const dbUser = rowsToSchemes(results[DDL.length]);
    const dbIds = new Set(dbUser.map((s) => s.id));
    const localOnly = localUser.filter((s) => !dbIds.has(s.id));
    if (localOnly.length > 0) {
      await Promise.all(localOnly.map((s) => upsertSchemeAsync(config, s)));
      return [...dbUser, ...localOnly];
    }
    return dbUser;
  } catch {
    return localUser;
  }
}

/** Upsert ONE user scheme into the DB (no-op without config or for a built-in).
 *  INSERT OR REPLACE keeps the write idempotent + concurrency-safe (two devices
 *  or the hook+editor mount-refresh can't PK-conflict). Does NOT touch any other
 *  row. The localStorage cache is written separately by the sync mutator. */
export async function upsertSchemeAsync(
  config: TursoConfig | null,
  scheme: ColorScheme,
): Promise<void> {
  if (!config || scheme.builtIn) return;
  await runTursoPipeline(config, [
    ...ddl(),
    {
      sql: `INSERT OR REPLACE INTO ${COLOR_SCHEMES_TABLE} (id, data) VALUES (?, ?)`,
      args: [txt(String(scheme.id)), txt(JSON.stringify(scheme))],
    },
  ]);
}

/** Delete ONE user scheme from the DB by id (no-op without config). Targeted —
 *  never a full-table wipe. */
export async function deleteSchemeAsync(config: TursoConfig | null, id: string): Promise<void> {
  if (!config) return;
  await runTursoPipeline(config, [
    ...ddl(),
    { sql: `DELETE FROM ${COLOR_SCHEMES_TABLE} WHERE id = ?`, args: [txt(String(id))] },
  ]);
}
