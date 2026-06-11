import { SharePointBackend } from "./sharepoint-backend";
import { TursoBackend } from "./turso-backend";
import type { TursoConfig } from "./turso-config";
import { type StorageConfig, type StorageBackend } from "./workspace"; // facade-internal
import { type FsHandle } from "./fs-access"; // facade-internal
import { BrowserBackend } from "./browser-backend"; // facade-internal
import { LocalFileBackend } from "./local-file-backend"; // facade-internal

export * from "./workspace";
export * from "./fs-access";
export * from "./csv-codecs";
export * from "./markdown-codecs";
export * from "./browser-backend";
export * from "./local-file-backend";

// --- IndexedDB key/value wrapper ------------------------------------------
//
// Schema:
//   - "kv"   — generic key/value store (legacy). Used by LocalFileBackend to
//              persist picked FsHandles. Created at version 1.
//   - "tasks" / "raid" — record-level storage for the BrowserBackend.
//              Created at version 2. keyPath:"id" pulls the key directly
//              from the stored record, so puts don't need an explicit key.
//   - "absences" — third workspace entity (Resource Planner v1). Created
//              at version 3. Same keyPath:"id" pattern as tasks/raid.
//   - "shifts"  — fourth workspace entity (Resource Planner Phase 4).
//              Created at version 4. Per-assignee weekly hours pattern.
//
// Bumping the version triggers `onupgradeneeded`, which adds missing stores
// idempotently — users coming from earlier versions keep their data and gain
// the new record stores additively.


// --- CSV serialization -----------------------------------------------------



// --- File System Access API helpers ---------------------------------------


// --- Backends --------------------------------------------------------------



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

export function pickFileForBackend(
  backend: StorageBackend,
): Promise<void> | null {
  if (backend instanceof LocalFileBackend) return backend.pickFile();
  return null;
}

export function openFileForBackend(
  backend: StorageBackend,
): Promise<void> | null {
  if (backend instanceof LocalFileBackend) return backend.openFile();
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

