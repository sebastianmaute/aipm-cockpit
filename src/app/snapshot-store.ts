// src/app/snapshot-store.ts
//
// Async store for snapshots over the shared Turso pipeline. Independent of the
// workspace StorageBackend.save() cycle. Every call prepends SNAPSHOT_DDL so the
// append-only tables exist (CREATE TABLE IF NOT EXISTS).
//
// All calls inherit DEFAULT_PIPELINE_TIMEOUT_MS: snapshots are background work
// that never blocks UI hydration, so the shorter LOAD_TIMEOUT_MS is not used.

import { runTursoPipeline } from "./turso-pipeline";
import {
  SNAPSHOT_DDL, appendStatements, deleteStatements, rowsToSnapshots,
  setBaselineStatements, snapshotColumnEnsureStatements, snapshotSelectStatements,
} from "./snapshot-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { SnapshotRecord } from "./snapshot";

const ddl = (): SqlStmt[] => SNAPSHOT_DDL.map((sql) => ({ sql }));

export async function loadSnapshots(config: TursoConfig | null, projectId: string): Promise<SnapshotRecord[]> {
  const stmts: SqlStmt[] = [...ddl(), ...snapshotSelectStatements(projectId)];
  const results = await runTursoPipeline(config, stmts);
  const base = SNAPSHOT_DDL.length;
  return rowsToSnapshots(results[base], results[base + 1]);
}

/** The only INSERT path. Two round-trips: the DDL plus a column read, then the
 *  insert transaction with any missing-column ALTERs AHEAD of its INSERTs.
 *  ★★ The ALTERs cannot ride behind the INSERT, nor be skipped: a libSQL
 *  pipeline does not abort at a failing statement, so an INSERT naming a column
 *  an older table lacks would fail alone while COMMIT still ran (see
 *  `snapshotColumnEnsureStatements`). */
export async function appendSnapshot(config: TursoConfig | null, rec: SnapshotRecord, projectId: string): Promise<void> {
  const head = await runTursoPipeline(config, [...ddl(), { sql: 'PRAGMA table_info("snapshot")' }]);
  const ensure = snapshotColumnEnsureStatements(head[SNAPSHOT_DDL.length]);
  await runTursoPipeline(config, appendStatements(rec, projectId, ensure));
}

export async function setBaseline(config: TursoConfig | null, id: string, projectId: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...setBaselineStatements(id, projectId)]);
}

export async function deleteSnapshot(config: TursoConfig | null, id: string, projectId: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...deleteStatements(id, projectId)]);
}

export async function deleteSnapshots(config: TursoConfig | null, ids: readonly string[], projectId: string): Promise<void> {
  if (ids.length === 0) return;
  await runTursoPipeline(config, [...ddl(), ...ids.flatMap((id) => deleteStatements(id, projectId))]);
}
