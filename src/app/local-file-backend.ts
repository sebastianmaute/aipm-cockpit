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
import type { ImportSectionKey } from "./csv-codecs-sections";

export class LocalFileBackend implements StorageBackend {
  readonly kind: LocalKind;
  /** Malformed rows dropped by the most recent CSV/MD load() (0 for JSON). */
  lastImportDroppedRows = 0;
  /** Which SECTIONS those rows came from — CSV *and* MD, unlike the two quote
   *  fields below. ★ ABSENT means "not known to have lost anything", never
   *  "verified clean": a section missing from the file is never decoded. */
  lastImportDroppedBySection: Partial<Record<ImportSectionKey, number>> | undefined = undefined;
  /**
   * Whether the most recent load() hit an unterminated quote.
   *
   * ★ CSV ONLY, despite `lastImportDroppedRows` above covering CSV *and* MD.
   * `splitCsvSections` (csv-codecs-decode.ts) is the sole writer of
   * `diag.unterminatedQuote`; `markdownToWorkspace` routes through
   * `splitMarkdownSections` and never touches it. So this stays `false` on an
   * MD load and on a JSON load alike — a `false` here is NOT evidence that an
   * MD file is well quoted.
   * Verify the sole-writer claim with the ASSIGNMENT form, which this comment
   * does not itself match: `grep -rn "diag\.unterminatedQuote =" src/app`.
   */
  lastImportUnterminatedQuote = false;

  /** ★ CSV ONLY, like `lastImportUnterminatedQuote`. Counts RFC 4180 quoting
   *  violations, NOT a swallowed section marker -- that question is undecidable
   *  (see the field docs on StorageBackend). */
  lastImportMalformedQuotes = 0;
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

  /**
   * Pick a file and return its handle WITHOUT persisting it.
   *
   * ★★★ THE CALLER COMMITS (§287). This used to end `idbSet(this.idbKey,
   * handle)`, which pointed the ACTIVE backend at the picked file BEFORE the
   * caller asked the user whether to overwrite their live tasks — so declining
   * kept the workspace and re-pointed storage anyway, and the next debounced
   * save wrote the live project over a file the user had just refused. The
   * `idbKey` is derived from the backend KIND, not the instance, so it really
   * was the active slot.
   * ★★ `tryGrantPermission` STAYS here: showOpenFilePicker returns a read-only
   * handle, and we are still in the user-gesture context from the click that
   * opened the picker, so readwrite must be requested now while it is allowed.
   * If the user dismisses or the browser denies, the handle is returned anyway
   * and `save()` surfaces a clearer "grant access" toast later.
   * ★ Commit with `setHandle(handle)` once the user has accepted.
   */
  async openFile(): Promise<FsHandle> {
    const handle = await pickOpenFile(this.format);
    await tryGrantPermission(handle, "readwrite");
    return handle;
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

  /**
   * Load from an EXPLICIT handle, without consulting or touching stored state.
   *
   * ★★★ THIS IS THE READ HALF OF THE COMMIT-ON-ACCEPT SPLIT (§287). A caller
   * that has picked a file but not yet been authorised to adopt it reads
   * through here; nothing it does can re-point the backend. `load()` is the
   * thin wrapper that supplies the STORED handle.
   * ★★ Both diagnostic mechanisms live in this body — the `finally` publishing
   * `lastLoadTruncation`, and the `resetLoadDiagnostics()` call above the first
   * possible exit. Adding an early return here is the shape that broke
   * `sharepoint-backend.load()`; do not add one.
   * ★★★ THAT COVERS THIS BODY AND SAYS NOTHING ABOUT ITS CALLERS, and an earlier
   * wording of it claimed otherwise. Splitting `load()` out (§287) put ONE exit
   * ABOVE these resets: `load()` has to `await this.getHandle()` before it can call
   * here, and `idbGet`/`openIdb` genuinely reject — on a missing `indexedDB` and on
   * a store error. A rejection there would have left BOTH mechanisms carrying the
   * PREVIOUS load's values, the exact staleness the placement below exists to
   * prevent. `load()` therefore resets on that path too. Any future wrapper that
   * awaits something before calling here owes the same.
   */
  async loadFrom(handle: FsHandle | null): Promise<Workspace> {
    // ★★ ONE accumulator, and every diagnostic field written on every exit.
    // An exit that left a field unwritten would keep a STALE value from the
    // PREVIOUS load, worse than zero because it would raise a data-loss warning
    // about a file that is fine. The exits are the two StorageNotReadyError
    // throws, a rejecting `readHandle` (getFile() on a file the user has since
    // deleted, moved or made unreadable), the empty-file short-circuit, a
    // throwing codec, the JSON return and the CSV/MD return.
    //
    // ★★★ TWO MECHANISMS, NOT ONE, AND THE `finally` IS NOT THE GENERAL ONE.
    // It publishes `lastLoadTruncation` ONLY. The two import flags are reset
    // HERE instead, BEFORE the first exit can be taken, because that is the one
    // placement no exit can skip: they used to sit below BOTH throws and below
    // `readHandle`, so a CSV load that hit an unterminated quote, followed by a
    // load of a file that had since been DELETED or un-picked, left the stale
    // `true` standing and would have said a file that no longer exists has an
    // unclosed quotation mark. Same defect, same placement, same fix as
    // `sharepoint-backend.load()`; anything added here that can return or throw
    // must leave both mechanisms intact — a new early return is the exact shape
    // that broke the sibling.
    //
    // ★ THE STALE FLAGS WERE NOT OBSERVABLE, AND THAT IS A PROPERTY OF THE
    // CALLERS, NOT OF THIS METHOD. Every consumer reads them through
    // `truncationOps.reportFor`, and each of those calls sits after an
    // `await …load()` that RESOLVED, inside the same `try` — so a throwing load
    // is never reported on, and any later resolving load rewrote both fields
    // below. Re-check that before relying on it, since it is what makes the
    // difference between a latent defect and a user-visible one:
    //   grep -rn "reportFor(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
    // Move one into a `catch`, or read these public fields from anywhere else,
    // and the stale value goes live. The reset placement is what makes that
    // safe to do rather than a second bug.
    const diag: ImportDiag = { droppedRows: 0 };
    this.resetLoadDiagnostics();
    try {
      if (!handle) throw new StorageNotReadyError("local-file-not-picked");
      if (!(await hasGrantedPermission(handle, "read"))) {
        throw new StorageNotReadyError("local-file-permission-needed");
      }
      const text = await readHandle(handle);
      if (!text.trim()) return emptyWorkspace();
      if (this.format === "json") return jsonToWorkspace(text, { strict: true, diag });
      const ws =
        this.format === "csv" ? csvToWorkspace(text, diag) : markdownToWorkspace(text, diag);
      this.lastImportDroppedRows = diag.droppedRows;
      this.lastImportDroppedBySection = diag.droppedBySection;
      this.lastImportUnterminatedQuote = diag.unterminatedQuote ?? false;
      this.lastImportMalformedQuotes = diag.malformedQuotes ?? 0;
      return ws;
    } finally {
      this.lastLoadTruncation = {
        entries: diag.truncatedEntries ?? 0,
        blocks: diag.truncatedBlocks ?? 0,
      };
    }
  }

  /**
   * Zero every field the two load-diagnostic mechanisms publish.
   *
   * ★★★ EXTRACTED SO THE ONE EXIT ABOVE `loadFrom` CAN RUN IT TOO. These four
   * import flags plus `lastLoadTruncation` are read by `truncationOps.reportFor`
   * to decide whether a load lost rows; a stale value is WORSE than a zero,
   * because it raises a data-loss warning about a file that is fine. `loadFrom`
   * calls this above its first possible exit, and `load()` calls it when handle
   * lookup rejects before `loadFrom` is even entered.
   * ★★ Zeroing `lastLoadTruncation` here is harmless on the `loadFrom` path — its
   * `finally` overwrites the field on every exit, including the throwing ones.
   */
  private resetLoadDiagnostics(): void {
    this.lastImportDroppedRows = 0;
    this.lastImportDroppedBySection = undefined;
    this.lastImportUnterminatedQuote = false;
    this.lastImportMalformedQuotes = 0;
    this.lastLoadTruncation = { entries: 0, blocks: 0 };
  }

  async load(): Promise<Workspace> {
    // ★★★ THE `await` IS THE POINT. It is the only exit that can be taken before
    // `loadFrom` resets anything, so it resets on the way out rather than leaving the
    // previous load's diagnostics standing. The original error is RETHROWN, not
    // swallowed — a rejecting handle store is a real failure and the caller's own
    // handler must still see it.
    let handle: FsHandle | null;
    try {
      handle = await this.getHandle();
    } catch (err) {
      this.resetLoadDiagnostics();
      throw err;
    }
    return this.loadFrom(handle);
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
