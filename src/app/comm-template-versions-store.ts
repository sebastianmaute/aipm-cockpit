// src/app/comm-template-versions-store.ts — async CRUD for comm-template versions
// over the shared Turso pipeline. Every call prepends the DDL (CREATE IF NOT EXISTS).
import { runTursoPipeline } from "./turso-pipeline";
import {
  COMM_TEMPLATE_VERSION_DDL, versionsSelect, insertVersionStatements, deleteVersionStatements, rowsToVersions,
  type CommTemplateVersion,
} from "./comm-template-versions-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

const ddl = (): SqlStmt[] => COMM_TEMPLATE_VERSION_DDL.map((sql) => ({ sql }));

export async function loadVersions(config: TursoConfig | null, templateId: string): Promise<CommTemplateVersion[]> {
  const results = await runTursoPipeline(config, [...ddl(), ...versionsSelect(templateId)]);
  return rowsToVersions(results[COMM_TEMPLATE_VERSION_DDL.length]);
}
export async function saveVersion(config: TursoConfig | null, v: CommTemplateVersion): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...insertVersionStatements(v)]);
}
export async function deleteVersion(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...deleteVersionStatements(id)]);
}
