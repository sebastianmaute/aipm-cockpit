// src/app/local-file-backend.ts
//
// File System Access backed storage backend (local-json / local-csv /
// local-md), persisting the picked file handle in the IDB kv store.
// Extracted from storage.ts (which re-exports everything).

import { type ImportDiag, csvToWorkspace, workspaceToCsv } from "./csv-codecs";
import { markdownToWorkspace, workspaceToMarkdown } from "./markdown-codecs";
import {
  type FilePickType,
  type FsHandle,
  hasGrantedPermission,
  pickOpenFile,
  pickSaveFile,
  readHandle,
  tryGrantPermission,
  writeHandle,
} from "./fs-access";
import { idbDelete, idbGet, idbSet } from "./idb";
import {
  type LocalKind,
  type StorageBackend,
  type Workspace,
  StorageNotReadyError,
  emptyWorkspace,
  jsonToWorkspace,
  workspaceToJson,
} from "./workspace";

export class LocalFileBackend implements StorageBackend {
  readonly kind: LocalKind;
  /** Malformed rows dropped by the most recent CSV/MD load() (0 for JSON). */
  lastImportDroppedRows = 0;
  /** Whether the most recent CSV/MD load() hit an unterminated quote (0/false for JSON). */
  lastImportUnterminatedQuote = false;
  /** What the most recent load() discarded to stay inside the document caps. */
  lastLoadTruncation: { entries: number; blocks: number } = { entries: 0, blocks: 0 };
  private readonly idbKey: string;
  private readonly format: FilePickType;

  constructor(kind: LocalKind) {
    this.kind = kind;
    this.format =
      kind === "local-json" ? "json" : kind === "local-csv" ? "csv" : "md";
    this.idbKey = `file-handle:${kind}`;
  }

  private async getHandle(): Promise<FsHandle | null> {
    const handle = await idbGet<FsHandle>(this.idbKey);
    return handle ?? null;
  }

  /**
   * Non-interactive handle hydration. Persists a previously-obtained
   * FileSystemFileHandle into this backend's IndexedDB slot so the next
   * load()/save() targets that file WITHOUT showing a picker. Used by the
   * project switcher, which keeps a per-project handle store and needs to
   * point the active backend at the target project's file.
   *
   * The handle's existing read/write permission may be in the "prompt" state
   * after a page reload; callers should re-grant via requestWriteAccess() from
   * a user gesture if needed.
   */
  async setHandle(handle: FsHandle): Promise<void> {
    await idbSet(this.idbKey, handle);
  }

  /** Reads back the handle currently bound to this backend (after a pick/open),
   *  so callers can mirror it into a per-project handle store. */
  async readHandle(): Promise<FsHandle | null> {
    return this.getHandle();
  }

  async pickFile(): Promise<void> {
    // showSaveFilePicker grants readwrite implicitly when the user picks a file.
    const handle = await pickSaveFile(this.format);
    await idbSet(this.idbKey, handle);
  }

  async openFile(): Promise<void> {
    const handle = await pickOpenFile(this.format);
    // showOpenFilePicker returns a read-only handle. We're still in the
    // user-gesture context from the click that triggered the picker, so
    // request readwrite now while it's allowed. If the user dismisses or
    // the browser denies, we store the handle anyway and surface a clearer
    // "grant access" toast the next time save() runs.
    await tryGrantPermission(handle, "readwrite");
    await idbSet(this.idbKey, handle);
  }

  /**
   * Explicit upgrade to readwrite, intended to be called from a click handler.
   * Returns whether write access is now granted.
   */
  async requestWriteAccess(): Promise<boolean> {
    const handle = await this.getHandle();
    if (!handle) return false;
    return await tryGrantPermission(handle, "readwrite");
  }

  async clearFile(): Promise<void> {
    await idbDelete(this.idbKey);
  }

  async describe(): Promise<string | null> {
    const handle = await this.getHandle();
    return handle?.name ?? null;
  }

  async isReady(): Promise<boolean> {
    const handle = await this.getHandle();
    if (!handle) return false;
    return await hasGrantedPermission(handle, "readwrite");
  }

  async load(): Promise<Workspace> {
    // ★★ ONE accumulator, ONE publish point (mirrors turso-backend.load()).
    // load() has five exits — two StorageNotReadyError throws, the empty-file
    // short-circuit, the JSON return and the CSV/MD return — and an exit that
    // returned without publishing would leave a STALE count from the PREVIOUS
    // load, worse than zero because it would raise a data-loss warning about a
    // file that is fine. The `finally` covers every one of them, including the
    // throwing paths (which correctly publish zeros: nothing was decoded).
    const diag: ImportDiag = { droppedRows: 0 };
    try {
      const handle = await this.getHandle();
      if (!handle) throw new StorageNotReadyError("local-file-not-picked");
      if (!(await hasGrantedPermission(handle, "read"))) {
        throw new StorageNotReadyError("local-file-permission-needed");
      }
      const text = await readHandle(handle);
      this.lastImportDroppedRows = 0;
      this.lastImportUnterminatedQuote = false;
      if (!text.trim()) return emptyWorkspace();
      if (this.format === "json") return jsonToWorkspace(text, { strict: true, diag });
      const ws =
        this.format === "csv" ? csvToWorkspace(text, diag) : markdownToWorkspace(text, diag);
      this.lastImportDroppedRows = diag.droppedRows;
      this.lastImportUnterminatedQuote = diag.unterminatedQuote ?? false;
      return ws;
    } finally {
      this.lastLoadTruncation = {
        entries: diag.truncatedEntries ?? 0,
        blocks: diag.truncatedBlocks ?? 0,
      };
    }
  }

  async save(ws: Workspace): Promise<void> {
    const handle = await this.getHandle();
    if (!handle) throw new StorageNotReadyError("local-file-not-picked");
    // Query only — never call requestPermission here. This path runs from a
    // debounced auto-save effect, which has no user activation, so requesting
    // permission would throw SecurityError. The user re-grants explicitly via
    // the picker buttons or the "Grant write access" button.
    if (!(await hasGrantedPermission(handle, "readwrite"))) {
      throw new StorageNotReadyError("local-file-permission-needed");
    }
    let content: string;
    if (this.format === "json") content = workspaceToJson(ws);
    else if (this.format === "csv") content = workspaceToCsv(ws);
    else content = workspaceToMarkdown(ws);
    await writeHandle(handle, content);
  }
}
