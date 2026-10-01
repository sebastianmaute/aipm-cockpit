// src/app/sync-scope.ts
//
// §643 — the scope a MAIN window's tab-sync messages carry (`useBroadcastSync`, `useRevisionSync`).
// Two main windows apply each other's slices only when their scopes are equal, and each then
// autosaves what it applied, so the scope must name the STORAGE a window writes. The Turso auth
// token is never part of it: a message must never carry it.
// ★★ Browser storage is ONE IndexedDB store (`new BrowserBackend()` takes no project), so every
// window on it writes the same data whatever registry project it shows: keyed on the kind alone.
// ★★ A LOCAL FILE is not shared that way any more. Since §645 each `LocalFileBackend` writes the
// handle it was bound with, so two windows of one kind can write two different files, and a scope of
// the kind alone let one window apply the other's slices and then save them into its own file (final
// review C1). A local file is therefore keyed on the kind plus `fileBinding`: the binding stored WITH
// the handle this window is bound to (a project's id, or a `picked:` token), never read from the
// registry, whose `currentProjectId` is shared by every tab through localStorage. ★★ An UNKNOWN
// binding (`null`: a failed or refused load, an old bare-handle slot) is NEVER the kind alone: it keys
// on this window's own `isolationToken`, so the window syncs with nobody (final re-review 2 RI2).
// The §629 journal key (`journalProjectKey`) stays the JOURNAL key; changing it would orphan
// journals already written.
//
// `null` means there is no target to name (Turso without a database URL): such a window neither
// sends to nor accepts from other main windows. Pop-outs use no scope; they follow their opener.

import type { StorageConfig } from "./workspace";

export type SyncScopeInput = {
  storageConfig: StorageConfig;
  /** The Turso database URL in use, when the storage is Turso. Never the auth token. */
  tursoDatabaseUrl: string | undefined;
  tursoProjectId: string | null;
  /** The binding of the local file this window is bound to (`LocalFileBackend.fileBinding`); `null` when unknown. Ignored for every other kind. */
  fileBinding: string | null;
  /** This window's own token, the scope of a local file whose binding is UNKNOWN (final re-review 2 RI2). */
  isolationToken: string;
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
      return JSON.stringify([config.kind]);
    case "local-json":
    case "local-csv":
    case "local-md":
      return JSON.stringify([config.kind, input.fileBinding ?? input.isolationToken]);
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
