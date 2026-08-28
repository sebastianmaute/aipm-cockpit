"use client";
import type React from "react";
import { useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { logDiag } from "./diagnostics";
import type { StorageBackend, Workspace } from "./storage";

/** What a backend reports about the load it just served — the optional
 *  `StorageBackend.lastLoadTruncation` (`workspace.ts`), published by every
 *  backend and guarded by `backend-truncation-registry.test.ts`. */
export type LoadTruncation = { entries: number; blocks: number } | undefined;

type ShowToast = (kind: "info" | "error" | "success", text: string) => void;

/**
 * The TWO choke points the storage layer routes every load and every
 * best-effort flush through.
 *
 * ★★★ THEY EXIST BECAUSE PER-CALL-SITE PATCHING IS WHAT BROKE THIS. The first
 * cut of the guard reported truncation at ONE of six `backend.load()` call
 * sites and checked `mayCommitAfterIncompleteLoad` at ONE of seven write sites, so
 * a project switch both failed to warn AND committed the loss the banner was
 * meant to prevent. Anything that loads or flushes goes through here; nothing
 * in `use-storage-file-ops.ts` / `use-storage-turso-ops.ts` holds a backend it
 * could write to directly (`backend` is deliberately NOT on either deps
 * object). Adding a new load/flush path means adding a call here, not a new
 * conditional at the call site.
 */
export interface TruncationOps {
  /** Record the outcome of a just-finished load. Call after EVERY
   *  `backend.load()` whose workspace is APPLIED to render scope — including
   *  clean ones, because this both raises AND lowers the flag.
   *
   *  ★★ IT ALSO CARRIES IMPORT DIAGNOSTICS. `lastImportDroppedRows` used to be
   *  read at ONE call site while this channel had five, so four load paths
   *  reported nothing however many rows vanished. Both signals ride one call so
   *  they cannot drift apart, and the `reportFor`-per-`load()` census in this
   *  file's test is what catches a new path that forgets.
   *
   *  ★★★ A NEW CALL SITE MUST FIRE ITS OWN "loaded"/"switched"/"reloaded" TOAST
   *  BEFORE CALLING THIS, NEVER AFTER. The toast surface is SINGLE-SLOT —
   *  `useToast` (`use-toast.ts`) holds a `useState<Toast | null>` and `showToast`
   *  is a bare `setToast(...)` — so of two calls in one stretch only the LAST is
   *  ever seen, and an `await` in between does not help: the second still
   *  replaces the first. Centralising the dropped-rows warning here put it in
   *  FRONT of four call sites' own confirmations and every one of them
   *  overwrote it; the toast was raised, discarded, and nothing was left. The
   *  confirmation is the disposable half (it carries no remedy, and on a clean
   *  load this call shows nothing, so it still paints) — the diagnostic is not.
   *  ★ Ordering is the whole fix, so a test asserting `showToast` was CALLED
   *  cannot see the defect. Assert on the LAST call. */
  reportFor: (
    backend: Pick<
      StorageBackend,
      "lastLoadTruncation" | "lastImportDroppedRows" | "lastImportUnterminatedQuote"
    >,
  ) => void;
  /** Best-effort flush of the live workspace to the ACTIVE backend, SKIPPED
   *  while a truncated load is unresolved. Skipping is the safe outcome: the
   *  source still holds the documents that were not loaded, and a flush is by
   *  definition not the user asking to overwrite them. Does not throw for that
   *  reason (a skip is not a failure); a real save error still propagates to
   *  the caller's own handler. */
  flushCurrent: () => Promise<void>;
  /** Write `ws` to `backend` on behalf of an EXPLICIT user action ("store the
   *  project here", "convert to that format"). Returns FALSE when it refused,
   *  so the caller can skip its own success toast and config repoint.
   *
   *  ★★★ IT REFUSES LOUDLY WHERE `flushCurrent` SKIPS SILENTLY, and the split is
   *  the whole design. A pre-switch flush is housekeeping the user never asked
   *  for, so a silent skip costs them nothing they can see. These two are a
   *  CLICK: staying silent would leave a picked file or a converted store that
   *  the user believes holds their project and does not, and `onRequestStorageSwitch`
   *  then repoints the app AT that short copy — the original becomes the
   *  abandoned one. So the refusal re-toasts the truncation counts and the
   *  caller must not report success. */
  guardedWrite: (backend: Pick<StorageBackend, "save">, ws: Workspace) => Promise<boolean>;
  /** The refusal WITHOUT the write — for a caller that must decline BEFORE its
   *  own irreversible side effect rather than after it.
   *
   *  ★★★ `onPickStorageFile` is why this exists. Its picker runs on the ACTIVE
   *  backend and creates the file on disk AND persists the new handle before any
   *  write is attempted, so guarding only the write left the app pointed at a
   *  new EMPTY file with the original unreferenced — and the next reload loaded
   *  that empty workspace cleanly, LOWERED the flag, and resumed autosaving over
   *  it. Guarding a write is not the same as guarding an ACTION; when the action
   *  has side effects of its own, check first and call this. */
  /** Would a write be refused right now? NON-MUTATING, unlike
   *  `mayCommitAfterIncompleteLoad`, which SPENDS the one-shot bypass when it
   *  answers. A caller that must decline before its own irreversible side effect
   *  has to ask without consuming anything — otherwise merely *checking* burns
   *  the authorisation the user just gave, and the write that follows is refused
   *  for having asked. Pair it with {@link refuseWrite}. */
  wouldRefuseWrite: () => boolean;
  refuseWrite: () => void;
  /** A workspace that did NOT come from a load is now live (create project,
   *  create demo, create Turso project) — so nothing about it is truncated.
   *
   *  ★★★ Without this a brand-new project INHERITS the previous one's pause.
   *  These paths build their workspace rather than loading it, so `reportFor`
   *  never runs, and they set `suppressNextLoadRef`, so the load their
   *  storageConfig change triggers takes the suppress branch and reports nothing
   *  either — leaving `loadWasIncomplete` raised over a project that has no
   *  documents at all. Every edit to it is then silently refused, and the banner
   *  reports the OLD project's counts against it. It is the same invariant
   *  `reportLoadTruncation` holds for a clean load ("scoped to the workspace
   *  that is live RIGHT NOW"), applied to the one family of paths that has no
   *  load to hang it on. */
  clearForFreshWorkspace: () => void;
}

export interface LoadTruncationGuard {
  /** The counts behind an unresolved truncation, or `null` when there is none.
   *  The banner names the magnitude from this — a count that lives only in a
   *  7s single-slot toast is gone by the time the user reads the banner, and
   *  "some data" is not enough to decide whether to accept the loss. */
  truncation: { entries: number; blocks: number } | null;
  /** True while an incomplete load is unresolved. Derived from `truncation` (one
   *  source of truth) — drives the persistent banner and the save-effect dep.
   *  See the lockout note on `allowIncompleteSave`. */
  loadWasIncomplete: boolean;
  /** Lower the flag so saving resumes and the incomplete set may be committed.
   *  ★★★ THIS IS THE ONLY WAY OUT AND IT MUST STAY REACHABLE FROM THE UI. The
   *  user CANNOT get under the cap by editing: the excess entries were never
   *  loaded, so the rows that would have to go are precisely the ones that are
   *  not there. Without a visible escape the sticky flag below is a permanent
   *  save lockout — a worse defect than the one §103 is about. */
  allowIncompleteSave: () => void;
  /** True when a save may proceed. */
  mayCommitAfterIncompleteLoad: () => boolean;
  /** The choke points — see `TruncationOps`. */
  truncationOps: TruncationOps;
}

/**
 * The §103 guard: an over-cap load truncates the documents array, and the next
 * AUTOMATIC save commits that loss permanently across all six write paths — the
 * excess documents are still in the source file, and writing the truncated set
 * over it destroys them.
 *
 * ★★ STICKY, unlike the `suppressNextSaveRef` it sits beside in
 * `use-storage-backend.ts`. That ref is one-shot and is set by EVERY load, so
 * it structurally cannot protect against this: the truncating load already sets
 * it, it clears on the first debounce cycle, and the loss lands on the NEXT
 * save. This flag stays raised until the user decides.
 *
 * ★★★ WHAT THE STRINGS MAY NOT SAY. Both counts are UPPER BOUNDS, never
 * undercounts, and neither means "the cap cut this much off":
 *   • `entries` counts RAW ARRAY ENTRIES past the cap, not validated documents
 *     (counting real documents would mean sanitizing the whole tail, which is
 *     the denial-of-service the cap exists to refuse).
 *   • `blocks` counts RAW BLOCK ENTRIES past `MAX_BLOCKS_PER_DOC`, on the same
 *     terms and for the same reason — some of them may be entries the validator
 *     would have rejected anyway.
 * So the copy says "could not be opened" (accurate for both) and never "were
 * cut off by the limit"; and it says "entries"/"blocks", never "documents".
 *
 * ★★★ `blocks` USED TO BE `raw.blocks.length - sanitized.blocks.length`, WHICH
 * ALSO COUNTED EVERY BLOCK THE VALIDATOR DROPPED AS INVALID — and because any
 * non-zero count raises this sticky flag, ONE unloadable block anywhere in a
 * project's stored documents or version history paused ALL saving for the whole
 * workspace until the user clicked through the banner. Two reachable shapes,
 * and the second needs no foreign input at all: (1) a paragraph whose HTML the
 * load-boundary allow-list empties — `document-rich-fields.ts` runs AFTER the
 * structural pass, so `<script>x</script>` survives `sanitizeBlock` (measured:
 * `htmlTextLength` reads 1) and is rewritten to `html: ""`, which the next save
 * persists and the load after that drops; that one still needs the `<script>`
 * to arrive in an imported or hand-edited file, since every in-app writer
 * sanitizes first. (2) a `dataSection` block whose key leaves
 * `EXPORT_SECTION_KEYS` — an ordinary refactor — is dropped by every load from
 * then on, forever, with no foreign file anywhere. Refusing to save
 * cannot recover any of those: they are unloadable by construction, so the only
 * outcome the guard can reach is the user clicking "Save anyway". Counting only
 * cap overflow keeps the guard on the loss it CAN protect — data the source
 * still holds — and off the loss it cannot.
 *
 * ★★ Only `blocks` moved. `entries` still counts unsanitized tail entries, so
 * the "upper bound" wording above is load-bearing for both.
 *
 * Lives in its own module because `use-storage-backend.ts` sits AT the
 * 800-line ratchet.
 */
export function useLoadTruncation(
  langRef: React.MutableRefObject<Lang>,
  showToast: ShowToast,
  /** Writes the LIVE workspace to the ACTIVE backend. Bound by the caller (it
   *  owns both) and re-supplied every render, so `flushCurrent` can never write
   *  a stale workspace or hit a superseded backend. */
  saveCurrentWorkspace: () => Promise<void>,
): LoadTruncationGuard {
  // ★ The COUNTS are the state, not a boolean — the banner has to name a
  // magnitude, and a second `useState` for it would be a second source of truth
  // that can drift from the flag. `loadWasIncomplete` is derived below.
  const [truncation, setTruncation] = useState<{ entries: number; blocks: number } | null>(null);
  const loadWasIncomplete = truncation !== null;
  // ★★★ DEFENSIVE-ONLY, AND DO NOT DESCRIBE IT AS "THE ONE-SHOT BYPASS" — that
  // wording claims it is what re-opens saving, and it is not. What re-opens
  // saving is the STATE going false: `loadWasIncomplete` is a dep of the save
  // effect (`use-storage-backend.ts`), so lowering it re-runs the effect with
  // the guard already down, and the handler closures the ops hooks hold are
  // rebuilt on that same render. Measured 2026-08-07 by mutation: replacing the
  // whole of `mayCommitAfterIncompleteLoad` with `return !loadWasIncomplete` left all
  // 110 tests across the three suites GREEN, so nothing observes this ref today.
  // It is kept for the one shape a test cannot easily stage — a flush reached
  // from a closure captured BEFORE the click, which would otherwise skip a write
  // the user just authorised. Delete it only with that case in hand.
  const allowIncompleteSaveRef = useRef(false);
  /** The counts last reported, so an explicit-action refusal can restate WHY it
   *  refused. Not derivable from the backend at refusal time: the write target
   *  may be a different backend that never served a load (storage conversion). */
  const lastTruncationRef = useRef<{ entries: number; blocks: number } | null>(null);

  const allowIncompleteSave = () => {
    allowIncompleteSaveRef.current = true;
    lastTruncationRef.current = null;
    setTruncation(null);
  };

  /** The user-facing sentence for a truncation. ★ Entries dominate when both are
   *  present: losing whole documents is the larger loss and the one the user can
   *  act on. The banner carries the generic message either way. */
  const truncationText = (entries: number, blocks: number): string =>
    entries > 0
      ? t(langRef.current, "documentsTruncatedWarning", entries)
      : t(langRef.current, "documentsTruncatedBlocksWarning", blocks);

  const reportLoadTruncation = (truncation: LoadTruncation) => {
    const entries = truncation?.entries ?? 0;
    const blocks = truncation?.blocks ?? 0;
    if (entries <= 0 && blocks <= 0) {
      // ★★ A CLEAN LOAD LOWERS THE FLAG. It is scoped to the workspace that is
      // loaded RIGHT NOW, and the applied one is fine — leaving it raised
      // blocks saves on a healthy project while the banner asserts ITS
      // documents could not be opened, which is simply false. That is the same
      // invariant every backend already holds for `lastLoadTruncation`
      // (`browser-backend.ts` resets it before any early return, because a
      // stale value is worse than zero); the consumer used to break it.
      // React bails on a no-op `false` → `false`, so the common case costs no
      // render.
      lastTruncationRef.current = null;
      setTruncation(null);
      return;
    }
    logDiag("error", "workspace.documentsTruncated", { entries, blocks });
    const counts = { entries, blocks };
    lastTruncationRef.current = counts;
    showToast("error", truncationText(entries, blocks));
    setTruncation(counts);
  };

  // ★★ Deliberately does NOT touch the caller's L3/B baselines
  // (`prevCollectionCountRef` / `prevRecordCountRef`).
  // ★★★ NOT for the reason an earlier revision gave. It said the last-PERSISTED
  // baseline is still the right comparison point; that premise is false. The
  // truncating load sets `suppressNextSaveRef`, and that branch
  // (`use-storage-backend.ts`, above the guard) syncs BOTH refs and returns
  // before this function is ever consulted — so the baselines in force here are
  // already the post-load IN-MEMORY ones. The conclusion survives the correction
  // on different grounds: a refusal persisted nothing, so re-baselining would
  // silently disarm the mass-deletion guard for the eventual "save anyway",
  // which is the exact moment the data is most at risk.
  //
  // ★★★ IT DOES, HOWEVER, OBLIGE THE CALLER TO SPEND ITS OWN ONE-SHOT SAVE
  // AUTHORISATION, and that obligation exists BECAUSE this guard is sticky.
  // `allowDestructiveRef` (`use-storage-backend.ts`) is armed by an explicit
  // bulk op — clear-all, bulk delete — to let the NEXT save through the Layer-B
  // mass-deletion guard. Every other early return in that effect is one-shot
  // bounded, so a bypass survives at most one cycle; this one is not, so a
  // bypass armed while the banner is up stays armed across an UNBOUNDED number
  // of edits. Measured shape: truncated load → "Clear all tasks" arms the
  // bypass → the save is refused here → an hour of work later an accidental
  // bulk delete removes 90% of the records → "Save anyway" lowers the flag →
  // `massDelete` is true but the hour-old bypass is still up, so Layer B waves
  // the mass deletion through and it is persisted. The save effect therefore
  // spends the bypass on THIS refusal: a refused save is still the "next save"
  // the authorisation was for.
  // ★★ The cost is deliberate and is the safe direction. After "Save anyway"
  // the legitimate bulk delete is re-evaluated by Layer B and may be refused —
  // but that refusal is VISIBLE (the `storageRefusedWipe` toast), persists
  // nothing, and is recoverable by reloading or by redoing the bulk op, whereas
  // the leak it replaces is a silent, unrecoverable mass deletion.
  // ★ `flushCurrent`/`guardedWrite` below deliberately do NOT spend it: an
  // explicit bulk op always mutates the workspace, so the save effect runs and
  // the branch above catches every armed bypass. Spending it from a background
  // flush would refuse a deletion the user did authorise, for no added safety.
  const mayCommitAfterIncompleteLoad = (): boolean => {
    if (loadWasIncomplete && !allowIncompleteSaveRef.current) return false;
    allowIncompleteSaveRef.current = false;
    return true;
  };

  /**
   * ★★★ ONE COMPOSED TOAST, BECAUSE THE SURFACE IS SINGLE-SLOT. `useToast`
   * (`use-toast.ts`) holds a `useState<Toast | null>` and `showToast` is a bare
   * `setToast(...)` — it REPLACES, there is no queue and no stacking. So two
   * `showToast` calls in one synchronous tick leave only the LAST one visible.
   *
   * ★★ An earlier revision fired these as two separate toasts and the comment
   * there asserted that was deliberate, "so both can be shown". The surface
   * makes that impossible: on a file that both dropped rows AND ended mid-quote,
   * the dropped-rows toast was created and instantly overwritten, and unlike
   * truncation it has no persistent banner to fall back on — the row count was
   * simply lost.
   *
   * ★ Both strings are complete sentences in EN and DE (`i18n.ts` /
   * `i18n.de.ts`), so joining the applicable ones with a single space is the
   * whole composition and needs no new key. It is a JOIN, never an `else`: the
   * two are different losses with different remedies, so neither may be dropped
   * when both hold.
   */
  const reportImportDiagnostics = (
    backend: Pick<StorageBackend, "lastImportDroppedRows" | "lastImportUnterminatedQuote">,
  ) => {
    const dropped = backend.lastImportDroppedRows ?? 0;
    const parts: string[] = [];
    if (dropped > 0) parts.push(t(langRef.current, "importDroppedRowsWarning", dropped));
    if (backend.lastImportUnterminatedQuote) parts.push(t(langRef.current, "importUnbalancedQuotesWarning"));
    if (parts.length > 0) showToast("error", parts.join(" "));
  };

  const truncationOps: TruncationOps = {
    reportFor: (backend) => {
      // ★★ These two CAN still contend for the single toast slot: a truncated
      // load that also reported import diagnostics raises both, and the import
      // toast — fired second — is the one that survives. That is the acceptable
      // direction, because truncation additionally raises the persistent banner
      // (`truncation` / `loadWasIncomplete`), which names its counts for as long
      // as the user needs them, while import diagnostics have only the toast.
      reportLoadTruncation(backend.lastLoadTruncation);
      reportImportDiagnostics(backend);
    },
    flushCurrent: async () => {
      if (!mayCommitAfterIncompleteLoad()) {
        // Leave a forensic trail: the skip is invisible at the call site (every
        // flush is best-effort and swallows its own errors), so without this a
        // "my project switch did not save" report has nothing to read.
        logDiag("warn", "storage.flushSkippedAfterTruncation", {});
        return;
      }
      await saveCurrentWorkspace();
    },
    clearForFreshWorkspace: () => {
      lastTruncationRef.current = null;
      setTruncation(null);
    },
    wouldRefuseWrite: () => loadWasIncomplete && !allowIncompleteSaveRef.current,
    refuseWrite: () => {
      const last = lastTruncationRef.current;
      logDiag("warn", "storage.writeRefusedAfterTruncation", { ...(last ?? {}) });
      // Say it out loud. The caller returns, so no success toast and no config
      // repoint follow — the user is not left believing a store they just chose
      // holds a project it does not.
      if (last) showToast("error", truncationText(last.entries, last.blocks));
    },
    guardedWrite: async (backend, ws) => {
      // ★ ONE implementation of the refusal, shared with `refuseWrite` above, so
      // a caller that declines early and one that declines at the write cannot
      // report the loss differently.
      if (!mayCommitAfterIncompleteLoad()) {
        truncationOps.refuseWrite();
        return false;
      }
      await backend.save(ws);
      return true;
    },
  };

  return { truncation, loadWasIncomplete, allowIncompleteSave, mayCommitAfterIncompleteLoad, truncationOps };
}
