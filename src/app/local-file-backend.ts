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
import { SaveConflictError, SaveLockTimeoutError } from "./storage-error";

/** §4 fix round 1 (R10 change 7) — the local-file revision encoding:
 *  `lastModified` ALONE is not fine-grained enough on filesystems/OSes with a
 *  coarse mtime resolution (some report whole seconds), so two different
 *  writes landing in the same tick would be indistinguishable and a real
 *  conflict could go undetected. Pairing it with `size` catches any write
 *  that also changed the byte length, which is true of almost every real
 *  edit. Revisions are opaque strings to callers — nothing outside this file
 *  parses the encoding. */
function fileRevision(file: File): string {
  return `${file.lastModified}:${file.size}`;
}

/** Upper bound on waiting for the per-kind save Web Lock, on the pattern of
 *  `turso-backend.ts`'s `LOCK_WAIT_TIMEOUT_MS`. Local file I/O has no network
 *  round-trip, so a much shorter bound than Turso's 20s is still generous for
 *  a healthy lock holder (open a writable, write, close) to finish first. */
const LOCAL_LOCK_WAIT_TIMEOUT_MS = 10_000;

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
  /** §620 — meta slices the last load decoded to NOTHING (see `jsonToWorkspace`).
   *  Read by `truncationOps.reportFor`, which pauses saving. Reset and published
   *  exactly like `lastLoadTruncation`, for the same stale-value reason. */
  lastDecodeFailures: readonly string[] = [];
  private readonly idbKey: string;
  private readonly format: FilePickType;
  /** §645 — the cross-tab/cross-window Web Lock name `save()` acquires (when
   *  available) around the compare-then-write critical section, per KIND so
   *  two windows on the SAME format can't both read the same file's
   *  `lastModified` before either has written. */
  private readonly lockName: string;
  /** §645 — the handle THIS instance (this window) treats as active, once
   *  bound by `setHandle`/`pickFile` or by a `getHandle()` fallback read of
   *  the shared IDB slot. `getHandle()` returns this instead of re-reading
   *  the slot on every call, so a SECOND instance's later `setHandle()` —
   *  which rewrites the shared slot — cannot silently redirect THIS
   *  instance's next `save()` at a different file (the §645 bug: previously
   *  every call re-read the slot, so any window's re-point/project-switch
   *  retargeted every other window's next save too). */
  private boundHandle: FsHandle | null = null;
  /** §645 fix round 1 (R10 change 1) — the revision this instance last loaded
   *  or wrote from `boundHandle`; `null` means UNKNOWN (never loaded/written
   *  that handle, and not adopted or forced) — `save()` now FAILS CLOSED on
   *  `null` rather than skipping the compare, so `setHandle`/`pickFile`
   *  resetting this to `null` on every NEW bind means the very next save on a
   *  freshly bound/switched handle refuses until a real load (or
   *  `adoptFrom`/`adoptRevision`/`forceNextSave`) establishes a baseline. */
  private currentRevision: string | null = null;
  /** §645 — one-shot: set by `forceNextSave()`, consumed by `saveLocked()`
   *  only once its write has actually succeeded (R10 change 4) — a forced
   *  save that fails (e.g. the write throws) keeps the flag set for the
   *  retry, rather than silently falling back to a compare it was never
   *  meant to face. */
  private forceNext = false;
  /**
   * §645 fix round 1 (R10 change 2, "R6 one-shot pre-read") — the
   * `{handle, revision}` pair from the MOST RECENT `loadFrom()` read of ANY
   * handle, bound or not. This is what lets the §287/§590 preview-before-
   * commit flow (`openFile()`/`pickFileHandle()` → `loadFromHandleForBackend`
   * → accept → `setHandle()`) establish a real baseline instead of forcing
   * the caller to reload the very file it just previewed: `setHandle(h)`
   * adopts `revision` when `h === handle`, and always CONSUMES (clears) this
   * regardless of whether it matched. Any LATER `loadFrom()` call — for a
   * different candidate, or the bound handle's own regular `load()` — simply
   * overwrites it; only the single most recent read is ever remembered.
   */
  private pendingRead: { handle: FsHandle; revision: string } | null = null;

  constructor(kind: LocalKind) {
    this.kind = kind;
    this.format =
      kind === "local-json" ? "json" : kind === "local-csv" ? "csv" : "md";
    this.idbKey = `file-handle:${kind}`;
    this.lockName = `aipm-cockpit:save:${kind}`;
  }

  /**
   * §645 — returns the handle THIS instance is bound to, binding it from the
   * shared IDB slot on first use (so a fresh instance still restores the last
   * file on startup). Once bound, `boundHandle` — never whatever the slot
   * currently holds — is what gets returned: a second instance's
   * `setHandle()`, which rewrites the ONE shared slot, must not retarget this
   * instance's next `load()`/`save()` at the other instance's file.
   *
   * ★ Still calls `idbGet` on EVERY call, even when already bound — the read
   * is deliberately not skipped. `local-file-backend.test.ts`'s "resets
   * diagnostics when the handle store rejects" suite models IndexedDB itself
   * becoming unavailable mid-session and expects THAT rejection to propagate
   * out of `load()` even for an already-bound backend; skipping the read once
   * bound would silently swallow that failure behind a stale cached handle.
   * The resolved value is simply discarded once bound — only a REJECTION
   * (the store itself is broken) is allowed to override the cache.
   */
  private async getHandle(): Promise<FsHandle | null> {
    const stored = await idbGet<FsHandle>(this.idbKey);
    if (this.boundHandle) return this.boundHandle;
    if (stored) this.boundHandle = stored;
    return stored ?? null;
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
    // §645 — bind THIS instance to the handle it just committed.
    this.boundHandle = handle;
    // R10 change 2 (R6 one-shot pre-read) — adopt the revision from a PRIOR
    // `loadFrom(handle)` read of this EXACT handle (the §287/§590 preview
    // flow), so committing a file the caller just previewed does not
    // immediately fail-closed on the very next save. Any other case — no
    // prior read, or a read of a DIFFERENT handle — leaves the revision
    // UNKNOWN (`null`): comparing a new file's real revision against an old
    // file's would either falsely conflict (near-certain — the two are
    // unrelated) or, by sheer coincidence, falsely pass, and fabricating a
    // baseline for a handle never actually read would defeat the whole
    // fail-closed rule (R10 change 1). Consumed either way — cleared so a
    // stale pre-read can never be adopted by a LATER, unrelated setHandle.
    this.currentRevision =
      this.pendingRead && this.pendingRead.handle === handle ? this.pendingRead.revision : null;
    this.pendingRead = null;
  }

  /** Reads back the handle currently bound to this backend (after a pick/open),
   *  so callers can mirror it into a per-project handle store. */
  async readHandle(): Promise<FsHandle | null> {
    return this.getHandle();
  }

  /**
   * Pick a save target AND bind it in one step.
   *
   * ★★ THE BIND-AND-GO HALF OF THE PICK PAIR, left in place for its two callers —
   * but NOT because there is nothing in their files worth reading. An earlier
   * revision said exactly that and it is FALSE of `createProject`, which builds an
   * EMPTY workspace and `save()`s it over whatever file the user picks, unread:
   * the same shape of damage §590 is about.
   * ★★★ What makes it acceptable there, and what does NOT: both callers reach
   * `showSaveFilePicker`, an OS SAVE dialog that has already asked the user about
   * replacing that file, and in both the user has just asked for this explicitly
   * — a new project HERE, or a conversion of the project in scope. Neither can be
   * reached in §590's state: `onRequestStorageSwitch` is gated on
   * `loadSucceeded()`, and `createProject` writes a workspace it built rather than
   * whatever scope happened to hold. §590 is the user who does NOT know their
   * workspace is empty, because a load failed.
   * ★ The residual risk is real and is a judgement, not an absence: a user who
   * picks an existing project file while creating a new project still loses it,
   * with only the OS prompt between them and that.
   * ★★★ NOT for "Pick storage file". That one must read what the chosen file
   * already holds before committing to overwrite it — see {@link pickFileHandle}
   * and §590. Enumerate today's callers of this one with the pattern below — it returns the facade
   * helper's declaration plus exactly those two call sites (three lines on 2026-09-20):
   *   grep -rnE "pickFileForBackend[(]" src --include=*.ts --include=*.tsx | grep -v "[.]test[.]"
   * ★★ THE `[(]` IS NOT DECORATION. The bare name matches the import line, two prose mentions in
   * `use-storage-file-ops.ts` AND this very comment, so a name-only grep answers SEVEN and reads as
   * a refutation of the sentence above it. Writing the pattern in brackets also stops it matching
   * itself — an earlier revision here claimed "exactly those two call sites" beside a grep that did
   * not produce them.
   */
  async pickFile(): Promise<void> {
    // showSaveFilePicker grants readwrite implicitly when the user picks a file.
    const handle = await pickSaveFile(this.format);
    await idbSet(this.idbKey, handle);
    // §645 — same bind-and-reset as setHandle() above; this is the other path
    // that commits a NEW handle to the active slot.
    this.boundHandle = handle;
    this.currentRevision = null;
  }

  /**
   * Pick a save target and return its handle WITHOUT binding it.
   *
   * ★★★ THE PICK HALF OF THE COMMIT-ON-ACCEPT SPLIT (§590), exactly mirroring
   * what {@link openFile} is to `load` under §287. `pickFile` above binds before
   * the caller can ask anything, and `idbKey` is derived from the backend KIND
   * rather than the instance — so it really is the ACTIVE slot, and after a
   * FAILED load the very next `save()` wrote the empty boot workspace into a file
   * that may already have held the user's project.
   * ★ Commit with {@link setHandle} once the user has accepted; a decline leaves
   * the backend on the previous file with nothing to undo.
   * ★ §645: deliberately does NOT touch `boundHandle`/`currentRevision` — only
   * `setHandle`/`pickFile` do that. A caller previewing a candidate file must
   * not have this instance's save-revision baseline silently swapped to a file
   * it has not committed to.
   * ★★ No `tryGrantPermission` here, unlike `openFile`: `showSaveFilePicker`
   * grants readwrite implicitly when the user picks a file, which is why
   * `pickFile` never asked either.
   */
  async pickFileHandle(): Promise<FsHandle> {
    return pickSaveFile(this.format);
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
   * ★ §645: same non-binding contract as `pickFileHandle` — this must NOT set
   * `boundHandle`/`currentRevision`, or the §287 "does not commit the handle"
   * guarantee (and its test) would break the moment `getHandle()` started
   * caching a bound handle.
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
    // §645 — must also drop this instance's own cache, or `getHandle()` would
    // keep returning the now-cleared `boundHandle` instead of `null` (it only
    // falls back to re-reading the slot when NOT already bound).
    this.boundHandle = null;
    this.currentRevision = null;
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
   * `lastLoadTruncation` and `lastDecodeFailures`, and the `resetLoadDiagnostics()` call above the first
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
    // It publishes `lastLoadTruncation` and (since §620) `lastDecodeFailures`
    // only (`resetLoadDiagnostics()` below also zeroes both). The two import
    // flags are reset HERE instead, BEFORE the first exit can be taken, because
    // that is the one placement no exit can skip: they used to sit below BOTH
    // throws and below `readHandle`, so a CSV load that hit an unterminated quote, followed by a
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
      // §645 — read getFile() ONCE and take both the content and revision
      // (lastModified + size) from that SAME File object (not two separate
      // getFile() calls), so a concurrent writer between them can never make
      // this instance adopt a revision that is newer than the content it
      // actually read. Inlined rather than calling the shared `readHandle`
      // helper for exactly this reason — that helper only returns the text.
      const file = await handle.getFile();
      const text = await file.text();
      const revision = fileRevision(file);
      // R10 change 2 — remember this exact read for `setHandle()`'s one-shot
      // pre-read adoption, for ANY handle (bound or not): overwrites whatever
      // the previous `loadFrom()` call remembered, so only the most recent
      // read is ever available to adopt.
      this.pendingRead = { handle, revision };
      // Only when `handle` is the ACTIVE bound handle: `loadFrom` is also the
      // read half of the commit-on-accept split (§287/§590), called directly
      // with a candidate handle nobody has committed to yet. Adopting THAT
      // file's revision here would silently swap this instance's save baseline
      // to a file it may never bind.
      if (handle === this.boundHandle) {
        this.currentRevision = revision;
      }
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
      this.lastDecodeFailures = diag.decodeFailedSlices ?? [];
    }
  }

  /**
   * Zero every field the two load-diagnostic mechanisms publish.
   *
   * ★★★ EXTRACTED SO THE ONE EXIT ABOVE `loadFrom` CAN RUN IT TOO. These four
   * import flags plus `lastLoadTruncation` and `lastDecodeFailures` are read by
   * `truncationOps.reportFor` to decide whether a load lost rows; a stale value
   * is WORSE than a zero, because it raises a data-loss warning about a file
   * that is fine. `loadFrom` calls this above its first possible exit, and
   * `load()` calls it when handle lookup rejects before `loadFrom` is even
   * entered.
   * ★★ Zeroing `lastLoadTruncation`/`lastDecodeFailures` here is harmless on the
   * `loadFrom` path — its `finally` overwrites both fields on every exit,
   * including the throwing ones.
   */
  private resetLoadDiagnostics(): void {
    this.lastImportDroppedRows = 0;
    this.lastImportDroppedBySection = undefined;
    this.lastImportUnterminatedQuote = false;
    this.lastImportMalformedQuotes = 0;
    this.lastLoadTruncation = { entries: 0, blocks: 0 };
    this.lastDecodeFailures = [];
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
    // §645 — run the compare-then-write critical section under the cross-tab/
    // cross-window Web Lock when it's available, so two windows racing a save
    // can't both read the same file's revision before either has written.
    // jsdom (and older browsers) has no `navigator.locks`: fall back to a
    // direct call — the compare still runs, just without cross-window mutual
    // exclusion.
    //
    // R10 change 6 — bounded wait, on the pattern of `turso-backend.ts`'s
    // `withWriteLock`: if the lock is not GRANTED within
    // `LOCAL_LOCK_WAIT_TIMEOUT_MS`, the wait itself is aborted and this
    // throws `SaveLockTimeoutError` instead of hanging forever — nothing is
    // written. `granted` distinguishes that from a real failure INSIDE
    // `saveLocked()` (a genuine `SaveConflictError`/write failure once the
    // lock WAS granted), which must pass through unchanged.
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) {
      await this.saveLocked(ws);
      return;
    }
    let granted = false;
    try {
      await locks.request(
        this.lockName,
        { mode: "exclusive", signal: AbortSignal.timeout(LOCAL_LOCK_WAIT_TIMEOUT_MS) },
        () => {
          granted = true;
          return this.saveLocked(ws);
        },
      );
    } catch (err) {
      if (!granted) throw new SaveLockTimeoutError(this.kind, { cause: err });
      throw err;
    }
  }

  /**
   * §645 — the actual save. Reads this instance's bound handle's CURRENT
   * revision (`fileRevision()`, `lastModified:size`) and compares it with the
   * revision this instance last loaded or wrote, BEFORE any write: a mismatch
   * means another writer (another window, or another program) has changed
   * the file since, and throws `SaveConflictError` — nothing here is written.
   *
   * R10 change 1 (fail closed) — `currentRevision === null` means UNKNOWN
   * (never loaded that handle, and not adopted or forced), and now REFUSES
   * with the same `SaveConflictError` rather than skipping the compare: a
   * save on an instance that has never established a real baseline must not
   * silently win against whatever another window already put there. An
   * intentional blind write — Save-As, a brand-new file, create, demo,
   * conversion — goes through `forceNextSave()`.
   *
   * `forceNextSave()` (one-shot) skips the compare and writes regardless. The
   * force flag is cleared, and the revision adopted, only AFTER the write has
   * actually succeeded (R10 change 4) — a forced save that fails keeps the
   * flag set for the retry instead of silently reverting to a compare it was
   * never meant to face.
   */
  private async saveLocked(ws: Workspace): Promise<void> {
    const force = this.forceNext;

    const handle = await this.getHandle();
    if (!handle) throw new StorageNotReadyError("local-file-not-picked");
    // Query only — never call requestPermission here. This path runs from a
    // debounced auto-save effect, which has no user activation, so requesting
    // permission would throw SecurityError. The user re-grants explicitly via
    // the picker buttons or the "Grant write access" button.
    if (!(await hasGrantedPermission(handle, "readwrite"))) {
      throw new StorageNotReadyError("local-file-permission-needed");
    }

    if (!force) {
      if (this.currentRevision === null) throw new SaveConflictError(this.kind);
      const current = await handle.getFile();
      if (fileRevision(current) !== this.currentRevision) {
        throw new SaveConflictError(this.kind);
      }
    }

    let content: string;
    if (this.format === "json") content = workspaceToJson(ws);
    else if (this.format === "csv") content = workspaceToCsv(ws);
    else content = workspaceToMarkdown(ws);
    await writeHandle(handle, content);

    // §645 — clear the force flag + adopt the new revision only now that the
    // write has succeeded (R10 change 4).
    if (force) this.forceNext = false;
    const written = await handle.getFile();
    this.currentRevision = fileRevision(written);
  }

  /** §645: the revision this instance last loaded or wrote from its bound
   *  handle; `null` before any load/write of that handle. */
  revision(): string | null {
    return this.currentRevision;
  }

  /** §645: adopt `rev` as this instance's current revision without a load/save. */
  adoptRevision(rev: string): void {
    this.currentRevision = rev;
  }

  /** §645: make the next `save()` skip the revision compare and write
   *  regardless, then clear itself (R10 change 4 — only once that save's
   *  write actually succeeds; see `saveLocked()`). */
  forceNextSave(): void {
    this.forceNext = true;
  }

  /**
   * §645 fix round 1 (R10 change 3) — copies another `LocalFileBackend`
   * instance's bound handle and revision, so a throwaway backend used to
   * perform an op (e.g. a preview read, or a create/convert helper) can hand
   * its resulting state to the LIVE instance in one step. Same-class only,
   * not part of `StorageBackend` — a later task calls this at the one site
   * that needs it. `other` must have loaded or written the SAME target this
   * instance should now treat as current; this does not verify that itself.
   */
  adoptFrom(other: LocalFileBackend): void {
    this.boundHandle = other.boundHandle;
    this.currentRevision = other.currentRevision;
  }
}
