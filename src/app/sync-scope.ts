// src/app/sync-scope.ts
//
// §643 — the scope a MAIN window's tab-sync messages carry (`useBroadcastSync`). Two main windows
// apply each other's slices only when their scopes are equal, and each then autosaves what it
// applied, so the scope must name the DATA a window edits. `journalProjectKey` (the §629 journal
// key) was used first and is too coarse for that: every non-Turso kind without a registry entry
// fell back to "browser", and Turso keyed on the bare project id, so two databases holding the
// same id collided. It stays the JOURNAL key; changing it would orphan journals already written.
//
// `null` means "nothing identifies this data": such a window neither sends to nor accepts from
// other main windows. Pop-outs do not use a scope at all; they follow their opener's window id.

import type { StorageConfig } from "./workspace";

export type SyncScopeInput = {
  storageConfig: StorageConfig;
  /** The Turso database URL in use, when the storage is Turso. Never the auth token. */
  tursoDatabaseUrl: string | undefined;
  tursoProjectId: string | null;
  /** The projects registry's current project id (`loadRegistry().currentProjectId`). */
  registryProjectId: string | null;
};

export function syncScopeKey(input: SyncScopeInput): string | null {
  const config = input.storageConfig;
  switch (config.kind) {
    case "turso":
      // The URL names the database; the project id names the project inside it (empty for a
      // single-project database). Without a URL there is no database to name.
      return input.tursoDatabaseUrl ? JSON.stringify(["turso", input.tursoDatabaseUrl, input.tursoProjectId ?? ""]) : null;
    case "sp-json":
    case "sp-csv":
      return JSON.stringify([config.kind, config.hostname, config.sitePath, config.itemPath]);
    case "browser":
      // Browser storage is ONE store (`new BrowserBackend()` takes no project), so every window
      // without a registry entry is on the same data and shares one scope.
      return JSON.stringify(["browser", input.registryProjectId ?? ""]);
    case "local-json":
    case "local-csv":
    case "local-md":
      // A local file is identified only by its registry entry, which owns the file handle.
      return input.registryProjectId ? JSON.stringify([config.kind, input.registryProjectId]) : null;
    default: {
      const exhaustiveCheck: never = config;
      throw new Error(`syncScopeKey: unhandled StorageConfig kind ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/** The opener's `windowId` a pop-out follows (`?popout=<tab>&opener=<id>`, written by
 *  `openPopoutWindow`), or `null`. Lives here rather than in `broadcast-sync.ts`, which many test
 *  files mock whole. */
export function readPopoutOpenerFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("opener") || null;
}
