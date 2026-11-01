// src/app/person-links-store.ts — async CRUD for the shared person_links table
// over the Turso pipeline. Every call prepends the DDL (CREATE IF NOT EXISTS).
// Mirrors chat-threads-store.ts.
import { runTursoPipeline } from "./turso-pipeline";
import {
  PERSON_LINKS_DDL, selectPersonLinks, upsertPersonLinkStatements, deletePersonLinkStatements,
  deletePersonLinksForStatements, rowsToPersonLinks, type PersonLinkPair,
} from "./person-links-schema";
import type { PersonLinkRow } from "./cross-project/person-match";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

const ddl = (): SqlStmt[] => PERSON_LINKS_DDL.map((sql) => ({ sql }));

export async function loadPersonLinks(config: TursoConfig | null): Promise<PersonLinkRow[]> {
  if (!config) return [];
  const results = await runTursoPipeline(config, [...ddl(), ...selectPersonLinks()]);
  return rowsToPersonLinks(results[PERSON_LINKS_DDL.length]);
}

export async function savePersonLink(config: TursoConfig | null, row: PersonLinkRow): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...upsertPersonLinkStatements(row)]);
}

export async function deletePersonLink(config: TursoConfig | null, pair: PersonLinkPair): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...deletePersonLinkStatements(pair)]);
}

/** §788 — remove every answer naming these people of `projectId`, on either side (a person was deleted). */
export async function deletePersonLinksFor(config: TursoConfig | null, projectId: string, resourceIds: readonly number[]): Promise<void> {
  if (!config || resourceIds.length === 0) return;
  await runTursoPipeline(config, [...ddl(), ...deletePersonLinksForStatements(projectId, resourceIds)]);
}
