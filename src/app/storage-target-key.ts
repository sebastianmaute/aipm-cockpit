import type { StorageConfig } from "./workspace";

/**
 * §591 — the inputs that decide WHICH stored project a backend reads. They mirror `createBackend`'s
 * inputs with ONE deliberate omission: `acquireToken`. An M365 sign-in or sign-out rebuilds the
 * backend against the SAME target, and a load after it must keep MERGING the activity log and budget
 * history (see `applyWorkspace`'s `logMode`).
 */
export interface StorageTargetInput {
  storageConfig: StorageConfig;
  tursoDatabaseUrl: string | undefined;
  tursoAuthToken: string | undefined;
  tursoProjectId: string | null;
}

/**
 * A stable string naming the storage target. Equal keys = the same stored project.
 * - Turso: the URL, the token and the tenant project id. A token-only edit on the same URL counts as a
 *   NEW target: the app cannot tell "same database, new token" from a switch, and wrongly replacing
 *   loses at most a bounded in-flight append, while wrongly merging leaks another project's audit trail.
 * - SharePoint: the hostname, the site path and the item path.
 * - IndexedDB and local files: the kind alone. The config carries no file identity; a different file
 *   is reached only through a project op or "Pick storage file".
 * JSON-encoded so no field value can collide with a delimiter.
 * ★ The key CONTAINS the Turso auth token. Keep it in memory: never log, persist or display it.
 */
export function storageTargetKey(input: StorageTargetInput): string {
  const config = input.storageConfig;
  switch (config.kind) {
    case "turso":
      return JSON.stringify([config.kind, input.tursoDatabaseUrl ?? "", input.tursoAuthToken ?? "", input.tursoProjectId ?? ""]);
    case "sp-json":
    case "sp-csv":
      return JSON.stringify([config.kind, config.hostname, config.sitePath, config.itemPath]);
    default:
      return JSON.stringify([config.kind]);
  }
}
