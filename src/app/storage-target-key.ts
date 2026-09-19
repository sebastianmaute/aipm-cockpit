import type { StorageConfig } from "./workspace";

/**
 * §591 — the inputs that decide WHICH stored project a backend reads. They mirror `createBackend`'s
 * inputs with ONE deliberate omission: `acquireToken`. It names no target, so IF its identity ever
 * changed and rebuilt the backend against the SAME target, a load after it would keep MERGING the
 * activity log and budget history (see `applyWorkspace`'s `logMode`). Today `useMsAuth`'s
 * `acquireToken` is a stable `useCallback`, so an M365 sign-in or sign-out does not rebuild at all.
 * ★ `useStorageBackend` passes the Turso URL and token only for kind "turso" (the same values its
 * backend memo reads); the key ignores them for every other kind either way.
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
    case "browser":
    case "local-json":
    case "local-csv":
    case "local-md":
      return JSON.stringify([config.kind]);
    default: {
      // Exhaustiveness check: an unhandled StorageConfig kind is a compile error here, not a silent
      // fall-through to a key some other kind might collide with.
      const exhaustiveCheck: never = config;
      throw new Error(`storageTargetKey: unhandled StorageConfig kind ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
