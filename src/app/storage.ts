// src/app/storage.ts
//
// Storage facade. The implementation lives in focused modules — workspace
// (Workspace type, migrations, JSON codec, config/error/backend types), idb,
// fs-access, csv-codecs, markdown-codecs, browser-backend, local-file-backend —
// and everything they export is re-exported here, so existing importers keep
// using "./storage". This file itself only owns the createBackend factory and
// the LocalFileBackend pick/open/handle helpers.

import { SharePointBackend } from "./sharepoint-backend";
import { TursoBackend } from "./turso-backend";
import type { TursoConfig } from "./turso-config";
import { type StorageConfig, type StorageBackend, type Workspace } from "./workspace"; // facade-internal
import { type FsHandle } from "./fs-access"; // facade-internal
import { BrowserBackend } from "./browser-backend"; // facade-internal
import { LocalFileBackend } from "./local-file-backend"; // facade-internal

export * from "./workspace";
export * from "./fs-access";
export * from "./csv-codecs";
export * from "./markdown-codecs";
export * from "./browser-backend";
export * from "./local-file-backend";

// --- Factory ---------------------------------------------------------------

export interface CreateBackendDeps {
  acquireToken?: (
    scopes: readonly string[],
    options?: { interactive?: boolean },
  ) => Promise<string | null>;
  tursoConfig?: TursoConfig | null;
  /** Active Turso project id. When kind="turso" AND this is a non-empty string,
   *  createBackend returns a per-project (tenant-mode) TursoBackend (Phase 2
   *  multi-tenant portfolio mode). Otherwise single-tenant mode is used. */
  tursoProjectId?: string | null;
}

export function createBackend(
  config: StorageConfig,
  deps: CreateBackendDeps = {},
): StorageBackend {
  switch (config.kind) {
    case "browser":
      return new BrowserBackend();
    case "local-json":
      return new LocalFileBackend("local-json");
    case "local-csv":
      return new LocalFileBackend("local-csv");
    case "local-md":
      return new LocalFileBackend("local-md");
    case "sp-json":
    case "sp-csv": {
      const acquireToken = deps.acquireToken ?? (async () => null);
      return new SharePointBackend(
        {
          kind: config.kind,
          hostname: config.hostname,
          sitePath: config.sitePath,
          itemPath: config.itemPath,
        },
        acquireToken,
      );
    }
    case "turso": {
      const tursoProjectId = deps.tursoProjectId;
      if (typeof tursoProjectId === "string" && tursoProjectId.length > 0) {
        return new TursoBackend(deps.tursoConfig ?? null, tursoProjectId);
      }
      return new TursoBackend(deps.tursoConfig ?? null);
    }
  }
}

/**
 * Pick a save target and bind it to the backend in one step. For callers that
 * are creating or converting INTO a file and have nothing to read first — see
 * the landmine on {@link LocalFileBackend.pickFile}.
 */
export function pickFileForBackend(
  backend: StorageBackend,
): Promise<void> | null {
  if (backend instanceof LocalFileBackend) return backend.pickFile();
  return null;
}

/**
 * Pick a save target from a file-based backend WITHOUT binding it — the pick
 * half of the commit-on-accept split (§590), so a caller can read what the
 * chosen file already contains before committing to overwrite it. Pair it with
 * {@link loadFromHandleForBackend} to read, then {@link setBackendFileHandle}
 * to commit; mirrors {@link openFileForBackend}, which does the same for open.
 */
export function pickFileHandleForBackend(
  backend: StorageBackend,
): Promise<FsHandle> | null {
  if (backend instanceof LocalFileBackend) return backend.pickFileHandle();
  return null;
}

/**
 * Pick a file and RETURN its handle, committing nothing (§287). The caller
 * decides when — and whether — to bind it with {@link setBackendFileHandle};
 * pair it with {@link loadFromHandleForBackend} to read the picked file first.
 */
export function openFileForBackend(
  backend: StorageBackend,
): Promise<FsHandle> | null {
  if (backend instanceof LocalFileBackend) return backend.openFile();
  return null;
}

/**
 * Read a workspace from an EXPLICIT handle, without consulting or touching the
 * backend's stored handle — the read half of the commit-on-accept split (§287),
 * so a caller can show the user what a picked file contains before binding it.
 */
export function loadFromHandleForBackend(
  backend: StorageBackend,
  handle: FsHandle,
): Promise<Workspace> | null {
  if (backend instanceof LocalFileBackend) return backend.loadFrom(handle);
  return null;
}

export function requestWriteAccessForBackend(
  backend: StorageBackend,
): Promise<boolean> | null {
  if (backend instanceof LocalFileBackend) return backend.requestWriteAccess();
  return null;
}

/**
 * Hydrate a file-based backend with an already-known FileSystemFileHandle,
 * without an interactive picker. Returns the persistence promise for local
 * backends, or null for non-file backends (browser / SharePoint / Turso),
 * mirroring the pick/open/requestWriteAccess helpers above.
 *
 * The project switcher uses this to point the active LocalFileBackend at the
 * target project's stored handle before triggering a load.
 */
export function setBackendFileHandle(
  backend: StorageBackend,
  handle: FsHandle,
): Promise<void> | null {
  if (backend instanceof LocalFileBackend) return backend.setHandle(handle);
  return null;
}

/**
 * Read the FileSystemFileHandle a file-based backend is currently bound to
 * (after a pick/open). Returns null for non-file backends or when none is set.
 * The project switcher uses this to mirror the just-picked handle into its
 * per-project handle store.
 */
export function getBackendFileHandle(
  backend: StorageBackend,
): Promise<FsHandle | null> | null {
  if (backend instanceof LocalFileBackend) return backend.readHandle();
  return null;
}

