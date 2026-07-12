// src/app/fs-access.ts
//
// File System Access API helpers: support detection, save/open pickers,
// permission queries and readHandle/writeHandle (with the .crswap abort
// guard). Extracted from storage.ts (which re-exports everything).

import { StorageNotReadyError } from "./workspace";

export function isFileSystemAccessSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "showSaveFilePicker" in window;
}

export type FilePickType = "json" | "csv" | "md";

/** Public alias for the three file formats a local project can be created in.
 *  Re-exported so callers (e.g. the project switcher) can talk about formats
 *  without depending on the internal `FilePickType`. */
export type LocalStorageFormat = FilePickType;

// `id` gives each format its own remembered directory + filename in the
// browser's File System Access pickers. Without distinct ids, every format
// shares one remembered location, so opening the CSV picker lands on the
// last-picked .md file (and vice versa). Allowed: [A-Za-z0-9_-], <=32 chars.
const PICK_OPTS: Record<
  FilePickType,
  {
    id: string;
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }
> = {
  json: {
    id: "lopfile_json",
    suggestedName: "aipm-cockpit-tasks.json",
    types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
  },
  csv: {
    id: "lopfile_csv",
    suggestedName: "aipm-cockpit-tasks.csv",
    types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }],
  },
  md: {
    id: "lopfile_md",
    suggestedName: "aipm-cockpit-tasks.md",
    types: [
      {
        description: "Markdown",
        accept: { "text/markdown": [".md", ".markdown"] },
      },
    ],
  },
};

export interface FsHandle {
  queryPermission(opts: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(opts: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string | Blob): Promise<void>;
    close(): Promise<void>;
  }>;
  name?: string;
}

export async function pickSaveFile(type: FilePickType): Promise<FsHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new StorageNotReadyError("file-system-access-unsupported");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = await (window as any).showSaveFilePicker(PICK_OPTS[type]);
  return handle as FsHandle;
}

export async function pickOpenFile(type: FilePickType): Promise<FsHandle> {
  if (
    typeof window === "undefined" ||
    !("showOpenFilePicker" in window)
  ) {
    throw new StorageNotReadyError("file-system-access-unsupported");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [handle] = await (window as any).showOpenFilePicker({
    multiple: false,
    id: PICK_OPTS[type].id,
    types: PICK_OPTS[type].types,
  });
  return handle as FsHandle;
}

/**
 * Open picker that accepts every supported local format (JSON / CSV / Markdown)
 * in a single dialog. The caller derives the actual format from the picked
 * file's name via {@link formatFromFileName}. Used by the "Load from file"
 * flows (empty state, project switcher) so the user is not forced to pre-select
 * a format. Uses its own remembered-location `id` distinct from the per-format
 * pickers.
 */
export async function pickOpenFileAny(): Promise<FsHandle> {
  if (typeof window === "undefined" || !("showOpenFilePicker" in window)) {
    throw new StorageNotReadyError("file-system-access-unsupported");
  }
  const types = (["json", "csv", "md"] as const).flatMap((f) => PICK_OPTS[f].types);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [handle] = await (window as any).showOpenFilePicker({
    multiple: false,
    id: "lopfile_any",
    types,
  });
  return handle as FsHandle;
}

/**
 * Infer the local storage format from a file name's extension. `.csv` → "csv",
 * `.md`/`.markdown` → "md", everything else (incl. `.json` and unknown) → "json".
 * JSON is the safe default: it is the lossless round-trip format.
 */
export function formatFromFileName(name: string | undefined): LocalStorageFormat {
  const lower = (name ?? "").toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  return "json";
}

export async function hasGrantedPermission(
  handle: FsHandle,
  mode: "read" | "readwrite",
): Promise<boolean> {
  try {
    return (await handle.queryPermission({ mode })) === "granted";
  } catch {
    return false;
  }
}

/**
 * Attempts to upgrade to the requested permission level. Must be called from
 * a user-gesture context (a click handler or the picker's resolution) — the
 * File System Access API throws SecurityError otherwise. Returns true only on
 * "granted"; never throws (SecurityError, AbortError, etc. all become false).
 */
export async function tryGrantPermission(
  handle: FsHandle,
  mode: "read" | "readwrite",
): Promise<boolean> {
  if (await hasGrantedPermission(handle, mode)) return true;
  try {
    return (await handle.requestPermission({ mode })) === "granted";
  } catch {
    return false;
  }
}

export async function readHandle(handle: FsHandle): Promise<string> {
  const file = await handle.getFile();
  return await file.text();
}

export async function writeHandle(handle: FsHandle, content: string): Promise<void> {
  let writable: {
    write(data: BlobPart): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  };
  try {
    writable = await handle.createWritable();
  } catch {
    // createWritable() throws AbortError / SecurityError when Chrome's security
    // policy blocks the path (corporate policy, externally-modified file, certain
    // NTFS zones). queryPermission() reports "granted" but the actual write is
    // still blocked — surface a targeted message instead of the raw DOMException.
    throw new StorageNotReadyError("local-file-write-blocked");
  }
  try {
    await writable.write(content);
    await writable.close();
  } catch {
    // The write/close failed AFTER the writable opened — e.g. the browser
    // blocked the atomic swap. Abort so the .crswap temp is discarded and the
    // rename over the original never runs, leaving the original file intact.
    // Without this, a blocked close can delete the original (data loss).
    try {
      await writable.abort?.();
    } catch {
      // abort is best-effort; ignore secondary failures.
    }
    throw new StorageNotReadyError("local-file-write-blocked");
  }
}
