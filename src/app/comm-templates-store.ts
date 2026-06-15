// src/app/comm-templates-store.ts — async CRUD for comm templates over the shared
// Turso pipeline. Every call prepends COMM_TEMPLATE_DDL (CREATE TABLE IF NOT EXISTS).
import { runTursoPipeline } from "./turso-pipeline";
import {
  COMM_TEMPLATE_DDL, templateSelect, upsertStatements, deleteStatements, setDefaultStatements, rowsToTemplates,
} from "./comm-templates-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { CommTemplate, CommTemplateCategory } from "./comm-templates";

const ddl = (): SqlStmt[] => COMM_TEMPLATE_DDL.map((sql) => ({ sql }));

export async function loadTemplates(config: TursoConfig | null): Promise<CommTemplate[]> {
  const results = await runTursoPipeline(config, [...ddl(), ...templateSelect()]);
  return rowsToTemplates(results[COMM_TEMPLATE_DDL.length]);
}
export async function upsertTemplate(config: TursoConfig | null, t: CommTemplate): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...upsertStatements(t)]);
}
export async function deleteTemplate(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...deleteStatements(id)]);
}
export async function setDefaultTemplate(config: TursoConfig | null, category: CommTemplateCategory, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...setDefaultStatements(category, id)]);
}
