// e2e/live-turso-schema.ts
//
// Schema setup for the live-Turso specs. Kept apart from `live-turso-env.ts` on
// purpose: `playwright.config.ts` imports that module (for `appHasTursoToken`), so
// it must stay free of app code, and this one pulls in the app's tenant schema.

import { tenantSchemaDdl } from "../src/app/turso-tenant-schema";
import { rawPipeline } from "./live-turso-env";

/** Create the multi-project (tenant) schema on the throwaway database, as the
 *  app's own tenant load does (`CREATE TABLE IF NOT EXISTS`, so a no-op where the
 *  tables exist). For a tenant-layout spec that seeds or cleans rows before the app
 *  has loaded: the specs that DROP tables leave none behind. ★ It cannot repair a
 *  table that exists in the SINGLE-project shape; the destructive specs drop
 *  theirs rather than leave one. Fails unless every statement reports ok, so an
 *  empty or short answer cannot pass for success. Reports counts only. */
export async function ensureTenantSchema(): Promise<void> {
  const ddl = tenantSchemaDdl();
  const results = await rawPipeline(ddl.map((sql) => ({ sql })));
  const ok = results.filter((r) => r.type === "ok").length;
  if (results.length !== ddl.length || ok !== ddl.length) {
    throw new Error(`ensureTenantSchema: ${ok} of ${ddl.length} statement(s) succeeded (${results.length} answered)`);
  }
}
