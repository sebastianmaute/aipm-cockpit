"use client";
import type React from "react";
import { useRef, useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import { IMPORT_SECTION_KEYS, type ImportSectionKey } from "./csv-codecs-sections";
import { logDiag } from "./diagnostics";
import type { StorageBackend, Workspace } from "./storage";

/** What a backend reports about the load it just served — the optional
 *  `StorageBackend.lastLoadTruncation` (`workspace.ts`), published by every
 *  backend and guarded by `backend-truncation-registry.test.ts`. */
export type LoadTruncation = { entries: number; blocks: number } | undefined;

type ShowToast = (kind: "info" | "error" | "success", text: string) => void;

/**
 * What each import section is CALLED when a diagnostic names it.
 *
 * ★★★ A TOTAL `Record`, not a `Partial` and not a lookup with a fallback. A new
 * member of `IMPORT_SECTION_KEYS` then fails `tsc` — which is the only thing
 * that can catch it, since a section with no label would simply be omitted from
 * the sentence and the report would silently under-name the loss. A `?? key`
 * fallback would render an internal identifier to the user instead.
 *
 * ★★ ITS OWN `importSection*` KEYS RATHER THAN THE NAV/VIEW LABELS. Those name
 * what a user clicks; these name what a FILE SECTION holds, and the two drift
 * independently — `i18n.ts` already carries a `tasks: "Tasks"` that belongs to
 * the UI and would silently reword this diagnostic if it were ever relabelled.
 */
const IMPORT_SECTION_LABELS: Record<ImportSectionKey, TranslationKey> = {
  tasks: "importSectionTasks",
  raid: "importSectionRaid",
  absences: "importSectionAbsences",
  shifts: "importSectionShifts",
  calendarEvents: "importSectionCalendarEvents",
  documentAssets: "importSectionDocumentAssets",
  milestones: "importSectionMilestones",
  changes: "importSectionChanges",
  stakeholders: "importSectionStakeholders",
  resources: "importSectionResources",
  roles: "importSectionRoles",
  budgets: "importSectionBudgets",
  disciplines: "importSectionDisciplines",
  grades: "importSectionGrades",
};

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
      | "lastLoadTruncation"
      | "lastImportDroppedRows"
      | "lastImportDroppedBySection"
      | "lastImportUnterminatedQuote"
      | "lastImportMalformedQuotes"
      | "lastDecodeFailures"
    >,
  ) => void;
  /** The DECODE half of `reportFor`, RAISE-ONLY — for a load whose workspace was
   *  REFUSED rather than applied (the two empty-load data-loss guards in
   *  `use-storage-backend.ts`).
   *
   *  ★★★ THOSE PATHS MUST NOT CALL `reportFor`, AND MUST NOT STAY SILENT
   *  EITHER. `reportFor` reports three things about the load, and only one of
   *  them survives a refusal:
   *    • TRUNCATION is a property of documents that were never applied, so
   *      neither raising nor lowering it would describe the live workspace —
   *      that is the reasoning the `reportFor` call sites carry, and it stands.
   *    • A DECODE failure is not about the applied workspace at all. It is a
   *      fact about the STORED BYTES that autosave is about to overwrite, and
   *      autosave stays armed against exactly that backend after a refusal.
   *      Measured shape: a documents-only project whose `documents` blob is
   *      corrupt loads EMPTY, the reload confirm appears, the user picks the
   *      SAFE option, the early return skips the report, `loadWasIncomplete`
   *      stays false, and the next edit runs `DELETE FROM meta` over the blob.
   *      Choosing the cautious option was what disarmed the guard.
   *
   *  ★★★ RAISE-ONLY IS THE LOAD-BEARING HALF, not an omission. `reportFor`
   *  lowers the flag on a clean read because it is "scoped to the workspace that
   *  is live RIGHT NOW" and that workspace was just applied. After a refusal
   *  NOTHING was applied — the live workspace is still the PREVIOUS load's, and
   *  so is any flag raised over it — so lowering here would clear a warning that
   *  is still true, resuming autosave over a database that failed to decode
   *  minutes ago on the strength of one suspicious empty read. Same rule as
   *  `reportFor`, applied to a path where the two directions come apart.
   *
   *  ★ Import diagnostics are deliberately NOT published here either: they are
   *  the same class as truncation (a property of rows that were not applied),
   *  and the known gap around them is recorded at `onOpenStorageFile`. */
  raiseDecodeFailuresFor: (backend: Pick<StorageBackend, "lastDecodeFailures">) => void;
  /** The IMPORT half of `reportFor`, for a load that APPLIES SOME ROWS into the
   *  live workspace rather than replacing it (`onOpenStorageFile`,
   *  `use-storage-backend.ts`, which takes `loaded.tasks` + `loaded.raid` and
   *  discards every other slice).
   *
   *  ★★★ THAT PATH MUST NOT CALL `reportFor`, AND ITS SILENCE WAS A REAL GAP
   *  (§152). The truncation reason it carries is sound and is sound ONLY for
   *  truncation: the documents the §103 flag is about were never applied, so
   *  raising would warn about documents the user still holds and lowering would
   *  clear a warning still true of them. The IMPORT channel is the opposite —
   *  the rows a malformed file dropped MAY BE the tasks and RAID this path is
   *  about to apply — so bundling both signals on one call left a file that
   *  silently lost task rows reporting nothing at all.
   *  ★ "May be", not "are": `droppedRows` is one workspace-wide counter bumped
   *  for every section, so a drop confined to milestones raises it too and this
   *  path discards milestones. Per-section attribution is §152's second half.
   *
   *  ★★★ RAISE-ONLY on the quoting hold, and NEVER either direction on
   *  truncation or decode. Same rule as {@link raiseDecodeFailuresFor}: this
   *  load replaced nothing, so the live workspace still carries the PREVIOUS
   *  load's reading and any flag raised over it is still true. Lowering here
   *  would resume autosave on the strength of a partial merge.
   *  ★★ It raises for a malformed file ONLY WHEN THE CALLER SAYS THE BACKEND
   *  NOW POINTS AT THE FILE IT JUST READ, which is what `backendNowPointsAtLoadedFile`
   *  is for, and reading the "import-only" name as "toast-only" is the trap. When the
   *  backend IS re-pointed, the next debounced save writes the merged live workspace
   *  back OVER that file — exactly the overwrite-the-only-copy case the quoting hold
   *  exists for, arriving through a narrower door.
   *
   *  ★★★ THE FLAG IS NOT A CONVENIENCE, AND ITS ABSENCE WAS A REAL FALSE POSITIVE.
   *  Until §287 this op could assume the re-point: `LocalFileBackend.openFile()`
   *  ended `await idbSet(this.idbKey, handle)`, so BOTH exits of the overwrite confirm
   *  left the active backend on the picked file and raising unconditionally was right.
   *  §287 moved the commit inside the ACCEPT branch — `openFile()` now ends
   *  `return handle;` and persists nothing — so on DECLINE the backend still points at
   *  the user's previous file, which the malformed one has nothing to do with. Raising
   *  there halts autosave of an untouched project over a file the user just refused to
   *  open, and nothing lowers it again for the rest of the session.
   *  ★★ THE DIAGNOSTICS STILL FIRE ON BOTH EXITS and must keep doing so — a malformed
   *  file dropped the same rows whichever way the confirm went, and §152 is the record
   *  of what an early `return` that skipped the report cost. Only the STATE CHANGE is
   *  conditional. Do not collapse the two back together.
   *
   *  ★★★ THE CALLER MUST FIRE ITS OWN "opened" TOAST BEFORE THIS, NEVER AFTER —
   *  the surface is single-slot, see the landmine on {@link reportFor}. */
  reportImportFor: (
    backend: Pick<
      StorageBackend,
      | "lastImportDroppedRows"
      | "lastImportDroppedBySection"
      | "lastImportUnterminatedQuote"
      | "lastImportMalformedQuotes"
    >,
    /** TRUE when the active backend is now bound to the file this load read, so a
     *  pending save would write over it. FALSE when the caller loaded from a handle it
     *  did not commit to (the declined overwrite confirm). REQUIRED, and deliberately
     *  not defaulted: every call site must state which it is, because the wrong default
     *  is silent in both directions — `true` halts autosave over a file nothing points
     *  at, `false` re-opens the overwrite this hold exists to prevent. */
    backendNowPointsAtLoadedFile: boolean,
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
  /** How many meta slices the last load could not read, 0 when none. ★ A COUNT,
   *  not the keys: the keys are internal identifiers (`documentVersions`,
   *  `settings_overrides`) and the diagnostics ring already carries them for an
   *  operator. */
  decodeFailureCount: number;
  /** Bumped once per LOAD that reported at least one undecodable slice — the
   *  identity a dismissal-reconcile needs, and NOT a magnitude.
   *
   *  ★★★ THE COUNT CANNOT SERVE AS THAT KEY, which is the whole reason this
   *  exists. `task-manager.tsx` re-opens a dismissed banner by comparing what it
   *  last saw against what the guard reports now; on the decode path `truncation`
   *  is `null` on both sides, so the counts object never moves, and
   *  `decodeFailureCount` is a NUMBER — two projects in a row failing the same
   *  two slices compare equal. Either way the second project's banner arrives
   *  already dismissed while saving is paused, and nothing tells the user.
   *
   *  ★★ MONOTONIC, and never reset — not by `allowIncompleteSave`, not by
   *  `clearForFreshWorkspace`. Resetting would make a later value compare equal
   *  to one a consumer had already seen, which is the same collision one level
   *  down. Consumers must treat it as opaque: only `!==` against their own last
   *  seen value is meaningful, never its size or its delta.
   *
   *  ★ A NONCE RATHER THAN THE `decodeFailures` ARRAY ITSELF, though that array
   *  is freshly minted per failing load today (`turso-backend.ts` builds a new
   *  `diag` per `load()`, and `turso-schema.ts` mints the array into it with
   *  `??=`). Depending on that would make the reconcile correct by accident of
   *  how one backend happens to allocate; a backend publishing a reused array
   *  would silently reintroduce the pre-dismissed banner. It also keeps the slice
   *  KEYS off the guard's public surface — see `decodeFailureCount` above. */
  decodeFailureNonce: number;
  /** How many RFC 4180 quoting violations the imported file carried, 0 when
   *  none. ★ Threaded to the banner so the THIRD cause names a magnitude on the
   *  one surface that persists: the toast is single-slot and gone in seconds,
   *  while the banner's count line feeds the "Save anyway" confirm — a permanent
   *  discard, which shipped for a release showing no magnitude at all on this
   *  cause. */
  malformedQuoteCount: number;
  /** Per-raising-load identity for the malformed cause, the exact analogue of
   *  `decodeFailureNonce` above and opaque in the same way — only `!==` against
   *  a consumer's own last-seen value is meaningful. Without it the banner's
   *  re-show reconcile cannot see a malformed-only load at all. */
  malformedQuotesNonce: number;
  /** True while an incomplete load is unresolved — from ANY of THREE causes: a
   *  truncating load, a meta slice that could not be decoded, or an imported
   *  file that violates CSV quoting. Derived from the three states below it (one
   *  derivation, so they cannot disagree) — drives the persistent banner and the
   *  save-effect dep. See the lockout note on `allowIncompleteSave`.
   *  ★★★ EVERY SURFACE THAT ENUMERATES THE CAUSES MUST ENUMERATE ALL THREE.
   *  Adding the third one here without revisiting them shipped three separate
   *  defects at once — a silent `refuseWrite`, a magnitude-less discard confirm,
   *  and a banner that could not re-show. Grep `malformedQuoteCount` before
   *  adding a fourth. */
  loadWasIncomplete: boolean;
  /** Lower the flag so saving resumes and the incomplete set may be committed.
   *  ★★★ THIS IS THE ONLY WAY OUT AND IT MUST STAY REACHABLE FROM THE UI. The
   *  user CANNOT get under the cap by editing: the excess entries were never
   *  loaded, so the rows that would have to go are precisely the ones that are
   *  not there. Without a visible escape the sticky flag below is a permanent
   *  save lockout — a worse defect than the one §103 is about.
   *  ★★★ STICKIER STILL FOR A DECODE FAILURE. A truncation at least has a
   *  theoretical repair outside the app (trim the source under the cap); a
   *  malformed meta blob has none the user can reach from anywhere, so this is
   *  their ONLY exit, not merely the convenient one. Clears BOTH causes. */
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
  // ★★ A SEPARATE state, not a second copy of the flag. The note above warns
  // against a boolean duplicating the counts — that is about restating the SAME
  // fact twice. This is a DIFFERENT fact with different data (which slices, not
  // how many entries), and `loadWasIncomplete` below is the single derivation
  // over both, so the two causes cannot disagree about whether saving is paused.
  const [decodeFailures, setDecodeFailures] = useState<readonly string[] | null>(null);
  // ★★ NOT a third source of truth about whether saving is paused — it says
  // nothing about that, and `loadWasIncomplete` below still derives from the two
  // states alone. It is a per-failing-load IDENTITY, the one fact neither of
  // those two carries: see `decodeFailureNonce` on `LoadTruncationGuard` for
  // what breaks without it.
  const [decodeFailureNonce, setDecodeFailureNonce] = useState(0);
  // ★★ THE THIRD CAUSE, and a separate slot for the same reason `decodeFailures`
  // is one: a different fact with different data (how many RFC 4180 violations,
  // not which slices or how many entries). The warning against a second
  // `useState` above is about restating ONE fact twice; this is not that.
  // ★★★ IT IS NOT AN IMPORT DIAGNOSTIC IN THE `reportImportDiagnostics` SENSE,
  // however much it arrives on the same channel. Dropped rows and an
  // unterminated quote describe rows that never made it in, and the source file
  // is still on disk to re-import — they toast and nothing more. A file
  // carrying quoting VIOLATIONS was REINTERPRETED, applied to render scope, and
  // the next save writes that reading back OVER the source. The hold exists to
  // stop a silent overwrite of the only copy, which is exactly why truncation
  // and undecodable slices hold too.
  // ★★ It says the file is MALFORMED, never that a section marker was
  // swallowed — that question is undecidable (§150) and nothing here may be
  // relabelled to imply it.
  const [malformedQuotes, setMalformedQuotes] = useState<number | null>(null);
  // ★★ A PER-RAISING-LOAD IDENTITY for the third cause, exactly as
  // `decodeFailureNonce` is for the second, and added for the same measured
  // reason: the banner's re-show reconcile keys on the truncation OBJECT and the
  // decode nonce, so a malformed-only load moves neither and project #2's banner
  // arrives ALREADY DISMISSED. A COUNT will not do here — two projects violating
  // the same NUMBER of quoting rules compare equal, which reads as fixed while
  // the defect survives. Not reset by `clearForFreshWorkspace`, for the reason
  // spelled out on `decodeFailureNonce`: resetting makes a later value compare
  // equal to one a consumer already saw.
  const [malformedQuotesNonce, setMalformedQuotesNonce] = useState(0);
  const loadWasIncomplete =
    truncation !== null || decodeFailures !== null || malformedQuotes !== null;
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
  /** The same, for the decode cause — and for the same reason: the write target
   *  of an explicit action may be a backend that never served a load, so its
   *  `lastDecodeFailures` is empty and reading it would report "clean". */
  const lastDecodeCountRef = useRef(0);
  /** The same, for the quoting cause, and for the same reason: an explicit
   *  action may write to a backend that never served a load. */
  const lastMalformedQuotesRef = useRef(0);

  const allowIncompleteSave = () => {
    allowIncompleteSaveRef.current = true;
    lastTruncationRef.current = null;
    lastDecodeCountRef.current = 0;
    lastMalformedQuotesRef.current = 0;
    setMalformedQuotes(null);
    setTruncation(null);
    // ★ BOTH causes, or the escape hatch is not one: clearing only the
    // truncation leaves `loadWasIncomplete` derived-true off the other state and
    // the user's click does nothing they can see.
    setDecodeFailures(null);
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

  /**
   * The SECOND cause of an incomplete load: a stored meta blob the load could
   * not decode (`rowsToWorkspace` → `StorageBackend.lastDecodeFailures`).
   *
   * ★★★ IT IS THE SAME LOSS AS §103, ARRIVING BY A DIFFERENT ROUTE, which is
   * why it routes into this guard rather than a mechanism of its own. A
   * malformed blob leaves its slice undefined and the load carries on —
   * `isWorkspaceEmpty` refuses only a TOTALLY empty read — and the next save
   * runs `DELETE FROM meta` and re-inserts only the rows it has, destroying the
   * blob. Nothing document-related has to happen for that to land: `meta` is
   * dirty whenever any of its slices changes reference, and `activityLog` is
   * auto-appended by ordinary use.
   *
   * ★ Lowers the flag on a clean read, exactly as `reportLoadTruncation` does —
   * this is scoped to the workspace that is live RIGHT NOW.
   */
  const reportDecodeFailures = (backend: Pick<StorageBackend, "lastDecodeFailures">) => {
    const failed = backend.lastDecodeFailures ?? [];
    if (failed.length === 0) {
      lastDecodeCountRef.current = 0;
      setDecodeFailures(null);
      return;
    }
    // ★ The KEYS go to the operator channel, never to the user: `documentVersions`
    // / `settings_overrides` are internal identifiers, and a label map for them
    // is a translation surface nobody asked for. The user gets the magnitude.
    logDiag("error", "workspace.metaSlicesUnreadable", { slices: failed.join(","), count: failed.length });
    lastDecodeCountRef.current = failed.length;
    showToast("error", t(langRef.current, "documentsUnreadableWarning", failed.length));
    setDecodeFailures(failed);
    // ★ Bumped HERE, in the failing branch only, so it marks a load that
    // actually reported a loss. A clean load lowers the flag above and returns;
    // moving this out of the branch would make every clean load look like a new
    // failure to a consumer keying on it.
    setDecodeFailureNonce((n) => n + 1);
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
  // ★★ The cost is deliberate and safe. After "Save anyway" the legitimate bulk
  // delete is re-evaluated by Layer B and may be refused — but that refusal is
  // VISIBLE (the standing `SavingPausedBanner` and footer indicator, NOT the
  // announcement-only `storageRefusedWipe` toast, which `!refusalWasStanding`
  // silences after the first), persists nothing, and is recoverable by reload
  // or redo; the leak it replaces is silent and permanent.
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
  /**
   * The THIRD cause of an incomplete load: the imported CSV violates RFC 4180.
   *
   * ★★★ WHY THIS HOLDS SAVING WHILE ITS TWO CHANNEL-MATES DO NOT. Dropped rows
   * and an unterminated quote are toast-only because they describe rows that
   * never entered the workspace, and the file they came from is untouched on
   * disk. A malformed file was REINTERPRETED — our reading of it is now in
   * render scope, and the next save writes that reading back over the source.
   * Holding is the only thing between a mis-parse and the loss of the only copy.
   *
   * ★★★ IT REPORTS MALFORMEDNESS, NOT A SWALLOWED SECTION MARKER. Whether a
   * `# SECTION` line was absorbed into a quoted cell is UNDECIDABLE — the
   * swallowed and the legitimate cases are byte-identical (§150) — so this may
   * never be relabelled as "a section may have been lost". What it says is that
   * the file breaks the format, which is weaker and actually true.
   *
   * ★ Lowers on a clean read, exactly as the other two do: the flag is scoped to
   * the workspace live RIGHT NOW.
   */
  const reportMalformedQuotes = (backend: Pick<StorageBackend, "lastImportMalformedQuotes">) => {
    const count = backend.lastImportMalformedQuotes ?? 0;
    if (count <= 0) {
      lastMalformedQuotesRef.current = 0;
      setMalformedQuotes(null);
      return;
    }
    logDiag("error", "workspace.importMalformedQuotes", { count });
    lastMalformedQuotesRef.current = count;
    setMalformedQuotes(count);
    // ★ Bumped only on the RAISING branch, mirroring `setDecodeFailureNonce`: a
    // nonce that also moved on the clearing branch would re-show the banner for
    // a load that found nothing wrong.
    setMalformedQuotesNonce((n) => n + 1);
  };

  const reportImportDiagnostics = (
    backend: Pick<
      StorageBackend,
      | "lastImportDroppedRows"
      | "lastImportDroppedBySection"
      | "lastImportUnterminatedQuote"
      | "lastImportMalformedQuotes"
    >,
    // ★★★ WHETHER THE CALLER IS ABOUT TO RAISE THE QUOTING HOLD. It decides ONE sentence,
    // and getting it wrong states a falsehood about the user's own data: the malformed-quotes
    // warning used to END with "Saving is paused until you confirm." baked in, true while every
    // caller raised the hold, and §287 made the raise conditional — so the declined-overwrite
    // exit announced a pause it had deliberately not applied. Only the CONSEQUENCE is gated; the
    // FACT is always shown, which is why the string was SPLIT rather than suppressed whole.
    holdWillBeRaised: boolean,
  ) => {
    const dropped = backend.lastImportDroppedRows ?? 0;
    const parts: string[] = [];
    if (dropped > 0) {
      parts.push(t(langRef.current, "importDroppedRowsWarning", dropped));
      // ★★ WALKED IN `IMPORT_SECTION_KEYS` ORDER, never `Object.keys` order.
      // The breakdown is built as the decoder happens to encounter sections, so
      // the same data in a CSV and in a Markdown file would name them in
      // different orders — a difference the reader would be left to interpret.
      // ★ A ZERO IS SKIPPED, not rendered: `countDroppedRow` only ever writes a
      // positive count, so this is defensive, but a section named as affected
      // while it lost nothing is a false statement rather than a cosmetic one.
      const by = backend.lastImportDroppedBySection;
      const names = by
        ? IMPORT_SECTION_KEYS.filter((k) => (by[k] ?? 0) > 0).map((k) =>
            t(langRef.current, IMPORT_SECTION_LABELS[k]),
          )
        : [];
      // ★ Nothing published (JSON, Turso) or nothing positive → no sentence at
      // all. "Affected sections: ." reads as a bug, which it would be.
      if (names.length > 0) {
        parts.push(t(langRef.current, "importDroppedRowsSections", names.join(", ")));
      }
    }
    if (backend.lastImportUnterminatedQuote) parts.push(t(langRef.current, "importUnbalancedQuotesWarning"));
    // ★ A THIRD complete sentence on the same join. It is a different loss from
    // the two above — those rows are absent, these are present but possibly
    // mis-parsed — so it is added, never substituted.
    const malformed = backend.lastImportMalformedQuotes ?? 0;
    if (malformed > 0) {
      parts.push(t(langRef.current, "importMalformedQuotesWarning", malformed));
      if (holdWillBeRaised) parts.push(t(langRef.current, "importMalformedQuotesPaused"));
    }
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
      // ★ The decode report sits between them for the same reason: it too has
      // the persistent banner behind it, so losing its toast to the import one
      // costs the user nothing they cannot read back.
      reportLoadTruncation(backend.lastLoadTruncation);
      reportDecodeFailures(backend);
      // ★★ RAISES THE HOLD, and is deliberately NOT inside
      // `reportImportDiagnostics` even though its toast text is. That function
      // is now reachable from `reportImportFor` too, and the two ops need
      // DIFFERENT state behaviour over the same sentences: this one both raises
      // AND lowers, that one raises only. Keeping the state change out here is
      // what lets the sentence be shared while the direction is not.
      reportMalformedQuotes(backend);
      // ★ `true`: this op raises the hold whenever the count is positive, and the
      // sentence is only pushed when it is positive, so the two cannot disagree.
      reportImportDiagnostics(backend, true);
    },
    raiseDecodeFailuresFor: (backend) => {
      // ★ The RAISE-ONLY gate, and the only line that differs from the shared
      // implementation below — see this member's doc for why lowering a flag
      // here would clear a warning that is still true of the live workspace.
      if ((backend.lastDecodeFailures ?? []).length === 0) return;
      // ★ Delegated rather than re-spelled: `reportDecodeFailures` reaches only
      // its raising branch with a non-empty list, so the toast, the diagnostics
      // row, the state and the nonce cannot drift from the `reportFor` path.
      reportDecodeFailures(backend);
    },
    reportImportFor: (backend, backendNowPointsAtLoadedFile) => {
      // ★ Sentences first, state second — the reverse of `reportFor`'s ordering
      // note and for the same single-slot reason read from the other end: the
      // raise below shows nothing, so nothing can overwrite this toast.
      reportImportDiagnostics(backend, backendNowPointsAtLoadedFile);
      // ★★★ THE DIAGNOSTICS ABOVE ARE UNCONDITIONAL, THE HOLD BELOW IS NOT. See the
      // member's doc: a load the backend was never bound to cannot be overwritten by a
      // pending save, so raising there refuses saves of a project that is not at risk.
      if (!backendNowPointsAtLoadedFile) return;
      // ★ The RAISE-ONLY gate, spelled exactly as `raiseDecodeFailuresFor`'s is
      // and for the same reason: `reportMalformedQuotes` reaches only its
      // raising branch with a positive count, so the diagnostics row, the state
      // and the ref cannot drift from the `reportFor` path.
      if ((backend.lastImportMalformedQuotes ?? 0) <= 0) return;
      reportMalformedQuotes(backend);
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
      lastDecodeCountRef.current = 0;
      lastMalformedQuotesRef.current = 0;
      setMalformedQuotes(null);
      setTruncation(null);
      // ★ Both causes, for the reason in this member's doc: a brand-new project
      // has no load to hang either flag on, so anything left raised is the
      // PREVIOUS project's and refuses every edit to this one.
      setDecodeFailures(null);
    },
    wouldRefuseWrite: () => loadWasIncomplete && !allowIncompleteSaveRef.current,
    refuseWrite: () => {
      const last = lastTruncationRef.current;
      const decoded = lastDecodeCountRef.current;
      const malformed = lastMalformedQuotesRef.current;
      logDiag("warn", "storage.writeRefusedAfterTruncation", { ...(last ?? {}), decodeFailures: decoded, malformedQuotes: malformed });
      // Say it out loud. The caller returns, so no success toast and no config
      // repoint follow — the user is not left believing a store they just chose
      // holds a project it does not.
      // ★★ A decode-only refusal MUST speak too. Without this the refusal is a
      // silent no-op on an explicit click — precisely what separates this from
      // `flushCurrent`, which the user never asked for.
      // ★★★ EVERY CAUSE IN `loadWasIncomplete` MUST HAVE AN ARM HERE, and the
      // malformed one shipped without one. `loadWasIncomplete` is a THREE-cause
      // derivation (`truncation !== null || decodeFailures !== null ||
      // malformedQuotes !== null`), but this list enumerated only two — and
      // malformed-only is the NORMAL shape on the import path, since a file
      // backend has no meta blob to fail decoding and typically no document
      // truncation. So `wouldRefuseWrite()` returned true, this ran, `parts` was
      // empty, and the user's explicit "Pick storage file" click did nothing and
      // said nothing: the exact silent no-op the note above forbids, reintroduced
      // by adding a cause to the derivation without revisiting the surfaces that
      // enumerate them. Adding a fourth cause means adding a fourth arm.
      const parts: string[] = [];
      if (last) parts.push(truncationText(last.entries, last.blocks));
      if (decoded > 0) parts.push(t(langRef.current, "documentsUnreadableWarning", decoded));
      // ★★ UNCONDITIONAL HERE, unlike in `reportImportDiagnostics`: this is the REFUSAL path — the user asked to write and was declined, so the pause is not a prediction but what just happened.
      if (malformed > 0) {
        parts.push(t(langRef.current, "importMalformedQuotesWarning", malformed));
        parts.push(t(langRef.current, "importMalformedQuotesPaused"));
      }
      if (parts.length > 0) showToast("error", parts.join(" "));
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

  return {
    truncation,
    decodeFailureCount: decodeFailures?.length ?? 0,
    decodeFailureNonce,
    malformedQuoteCount: malformedQuotes ?? 0,
    malformedQuotesNonce,
    loadWasIncomplete,
    allowIncompleteSave,
    mayCommitAfterIncompleteLoad,
    truncationOps,
  };
}
