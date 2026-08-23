"use client";

// src/app/documents-panel.tsx — orchestrator for the Documents pane.
//
// Owns sort state, selection, column widths and the create/rename/duplicate/
// delete handlers. The list, preview and toolbar are pure presentational
// siblings (the gantt split).
//
// ★★★ EVERY MUTATION GOES THROUGH `mutateDocuments`, never through a setter of
// this pane's own. That entry point is the ONLY place a before-image version is
// snapshotted, so a pane that wrote `documents` directly would make "every
// mutation snapshots" half-true: a user rename would record no history while an
// AI rename did, and the AI path has no undo stack behind it. It also owns the
// same-tick correctness the functional setter used to buy — it mutates against
// its own refs, which it advances synchronously, so two mutations landing
// before React re-renders both see the first one (see workspace-context.tsx).
// `documents-panel.test.tsx` pins both halves against the REAL provider.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { type ProjectDocument, MAX_TITLE_CHARS } from "./document-model";
import type { DocMutation, DocResult } from "./document-mutations";
import { deletedDocumentVersions, type DocVersion, type DocVersionSource } from "./document-versions";
import type { Workspace } from "./workspace";
import { DocumentsAssetSection, assetPaneLoader, type DocumentAssetPaneProps } from "./documents-asset-section";
import { DocumentsToolbar, DOC_FORMATS } from "./documents-toolbar";
import { DocumentsDeletedSection } from "./documents-deleted-section";
import { DocumentsList, DOCUMENTS_COL_DEFAULTS, type DocumentSortKey, type DocumentsCol } from "./documents-list";
import { useDocumentEditMode, DocumentEditModeBody } from "./document-edit-mode";
import { DocumentsHistoryModal } from "./documents-history-modal";
import { DocumentEntityFilterBanner } from "./document-entity-filter-banner";
import { buildDocLinkCandidates, buildDocRefLookups } from "./document-link-sources";
import { DocumentLinksSection } from "./document-links-section";
import { resolveDocRef } from "./document-ref";
import { useDocumentEntityFilter } from "./use-document-entity-filter";
import { downloadDocument, reportDownloadFailure, type DocFormat } from "./document-download";
import { useColumnResize } from "./use-column-resize";
import { type SortDir, compareStrOrNum, nextSortDir } from "./report-table";
import { useConfirm } from "./confirm-dialog";
import { useToastContext } from "./toast-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { useDeepLinkRowFlash } from "./use-deeplink-row-flash";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { Input } from "./form-controls";

// --- pure presentation helpers --------------------------------------------
// i18n-free and side-effect-free. These are NAMING and ORDERING, not mutation:
// the four transforms that used to sit here (append/duplicate/rename/remove)
// were deleted when the pane moved onto `mutateDocuments`, and their rules —
// including "a no-op must return the caller's OWN array reference, never a
// rebuilt-but-equal one, because Turso's dirty-table detection is by REFERENCE
// equality" — now live in `document-mutations.ts` with their own tests.

/** ★★★ TITLES CARRY AN ACCESSIBILITY INVARIANT, so this is not cosmetic.
 *  `documents-list.tsx` builds every per-row control's accessible name as
 *  `<verb> – <title>`, and the row-title selection button IS the bare title —
 *  so two documents sharing a title give FIVE pairs of identical control names
 *  (title · Download · Rename · Duplicate · Delete), the WCAG 2.4.6 failure
 *  this repo qualifies row labels to avoid. Duplicate and create are the two
 *  operations that produced one by construction: a copy inherited its source's
 *  title, and every create used the same default.
 *
 *  ★★ Documents IS in the axe `A11Y_VIEWS` list, and the gate still cannot
 *  reach this: it scans a STATICALLY SEEDED app and never clicks Duplicate or
 *  New, so the collision does not exist at scan time. The unit tests below are
 *  the only coverage — do not read a green axe run as covering it.
 *
 *  ★★★ IT USED TO LIVE INSIDE THE APPEND/DUPLICATE TRANSFORMS, where a call
 *  site could not forget it. Those transforms are gone — `mutateDocuments`
 *  stores the title it is handed verbatim (only capped and trimmed) and has no
 *  business knowing about accessible names — so the two call sites now apply
 *  this themselves, against `freshDocuments()` rather than the raw `documents`
 *  prop. That is the whole reason `freshDocuments` exists; read its note before
 *  simplifying either call site back to `documents`.
 *
 *  Returns `base` when free, else `base 2`, `base 3`, … Comparison is EXACT
 *  string equality, mirroring how the accessible names actually collide — a
 *  looser (case-insensitive, trimmed) match would rename titles that never
 *  collided in the a11y tree.
 *
 *  ★ Truncation to `MAX_TITLE_CHARS` happens on the BASE, not the result, so a
 *  200-character title's copy cannot be cut back down to its source's exact
 *  bytes by `sanitizeProjectDocuments` on the next load — which would restore
 *  the very collision this removes.
 *
 *  ★ The loop terminates: every candidate has its suffix's single space at a
 *  known distance from the end (the digit count of `n`), so two candidates for
 *  different `n` always differ — either in that space's position or in the
 *  digits themselves — and `prev` is finite. */
export function uniqueDocumentTitle(prev: readonly ProjectDocument[], base: string): string {
  const taken = new Set(prev.map((d) => d.title));
  let candidate = base.slice(0, MAX_TITLE_CHARS);
  for (let n = 2; taken.has(candidate); n++) {
    const suffix = ` ${n}`;
    candidate = base.slice(0, MAX_TITLE_CHARS - suffix.length) + suffix;
  }
  return candidate;
}

/** Sort a copy. `dir === "off"` returns workspace order — the order the user's
 *  own data is in, which no derived ordering can reconstruct once lost. */
export function sortDocuments(
  docs: readonly ProjectDocument[],
  key: DocumentSortKey,
  dir: SortDir,
): readonly ProjectDocument[] {
  if (dir === "off") return docs;
  const value = (d: ProjectDocument): string | number =>
    key === "title" ? d.title : key === "blocks" ? d.blocks.length : d.updatedAt;
  const sorted = [...docs].sort((a, b) => compareStrOrNum(value(a), value(b)));
  return dir === "desc" ? sorted.reverse() : sorted;
}

// --- per-device download format -------------------------------------------
//
// ★★ The pane is CONDITIONALLY RENDERED by the shell (`workspace-section`
// renders only the active tabpanel), so it unmounts on every view switch and
// all of its useState resets. Column widths already survive that via
// localStorage; an explicitly-CHOSEN download format has to as well, or the
// user picks PPTX, visits another view, comes back to a select still reading
// "DOCX", and downloads the wrong file type with nothing to indicate it. This
// deliberately reuses the same mechanism (`aipm-cockpit:`-namespaced
// localStorage) rather than introducing a second one — and the key is inside
// the app namespace so `clearAppConfig` sweeps it.
const FORMAT_KEY = "aipm-cockpit:documents-format";

/** ★ The stored payload is UNTRUSTED — validated against `DOC_FORMATS`, not
 *  cast. An unvalidated value would flow straight into `downloadDocument` as a
 *  `DocFormat` and select whatever its fallback branch happens to be. */
function readStoredFormat(fallback: DocFormat): DocFormat {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(FORMAT_KEY);
    return DOC_FORMATS.some((f) => f.value === raw) ? (raw as DocFormat) : fallback;
  } catch {
    return fallback; // private mode / storage disabled — never fatal
  }
}

// --- component ------------------------------------------------------------

export interface DocumentsPanelProps {
  lang: Lang;
  documents: readonly ProjectDocument[];
  /** ★★★ THE ONLY WRITE PATH. Deliberately NOT `setDocuments` — a setter would
   *  let this pane rewrite `documents` without touching `documentVersions`, and
   *  the before-image snapshot every mutation records is the entire safety net
   *  for the AI tools that share this entry point (their writes have no undo
   *  capture at all). The signature matches `WorkspaceValue.mutateDocuments`
   *  exactly so the call site passes it through with no wrapper; this pane
   *  always passes `"user"` as the source. */
  mutateDocuments: (m: DocMutation, source: DocVersionSource) => DocResult;
  /** ★★ A PROP, not `ws.documentVersions`. The field does exist on `Workspace`,
   *  so reading it off `ws` would compile and would even work in production —
   *  but `ws` is here for the PREVIEW's live data, and overloading it is the
   *  implicit coupling that decays into a wrong claim later. It is also
   *  untestable: the pane's live harness passes a static `emptyWorkspace()` as
   *  `ws` while driving the real provider for everything else, so a modal fed
   *  from `ws` would render an empty history in every test while production
   *  worked. Threaded explicitly, exactly like `mutateDocuments`. */
  documentVersions: readonly DocVersion[];
  /** Needed by the preview: dataSection blocks render live workspace data. */
  ws: Workspace;
  /** Initial output format. The toolbar picker owns it from then on; this only
   *  seeds it, so a caller can preselect one. All four of `DocFormat` are
   *  reachable from the picker — the original ask was ".pptx, .docx, .pdf, or
   *  html", so shipping one would not have met it. */
  initialFormat?: DocFormat;
  /** Popout mirrors are read-only: create/rename/duplicate/delete go inert.
   *  Every other pane guards this; without it a popout could mutate documents. */
  isReadOnly?: boolean;
  /** ★★ REQUIRED, and deliberately so. It was optional with an
   *  `onResetSize ?? (() => {})` fallback, and the one production call site
   *  never passed it — so the toolbar drew a reset-size control that was inert
   *  twice over: a no-op handler AND nothing resizable behind it. That is the
   *  false affordance `SortResizeTh.onResize` is documented to avoid ("never
   *  pass a no-op — it draws a grip that looks draggable and does nothing").
   *  Required means tsc, not a reviewer, catches the next dropped call site. */
  onResetSize: () => void;
  // Asset gate + byte-store scope + documentAssets, as ONE bag (house
  // convention). OPTIONAL — absent here means "disabled", not broken.
  assetPane?: DocumentAssetPaneProps;
}

const RENAME_TITLE_ID = "documents-rename-title";

export function DocumentsPanel({
  lang,
  documents,
  mutateDocuments,
  documentVersions,
  ws,
  initialFormat = "docx",
  isReadOnly,
  onResetSize,
  assetPane,
}: DocumentsPanelProps) {
  // Lazy initialiser: reads storage ONCE at mount, never during a render body
  // (the react-hooks purity rule) and never in an effect (`set-state-in-effect`
  // is banned).
  const [format, setFormat] = useState<DocFormat>(() => readStoredFormat(initialFormat));

  // ★ Persist on CHOICE, in the handler — never from an effect. An effect would
  // fire on mount too and write back a value the user never picked, which is
  // exactly how the column-width v1 blob ended up storing a defaults snapshot
  // for every table anyone merely LOOKED AT (see use-column-resize's note).
  const chooseFormat = useCallback((next: DocFormat) => {
    setFormat(next);
    try {
      window.localStorage.setItem(FORMAT_KEY, next);
    } catch {
      // Storage unavailable — the choice still applies for this session.
    }
  }, []);
  const [sort, setSort] = useState<{ key: DocumentSortKey; dir: SortDir }>({ key: "title", dir: "off" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; draft: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  // ★ The reasons the LAST restore was refused. `mutateDocuments` returns them
  // synchronously, so the surface has them without re-reading state — and a
  // Restore button that silently does nothing is the worst outcome available
  // here.
  //
  // ★★★ IT IS A STATEMENT ABOUT ONE CLICK, AND NOTHING ABOUT THE PANE KEEPS IT
  // TRUE. The region used to render INSIDE the `showDeleted` block, where
  // closing that section unmounted the message — an accidental clear, but a
  // clear. Hoisting it into the always-visible pane body (so a refusal raised
  // from the history modal could draw at all, which is the other half of the
  // same fix) removed that and nothing replaced it: the reason then sat above
  // the preview through document switches, renames, deletes and modal
  // open/close until the next restore attempt happened to overwrite it.
  //
  // ★★ CLEARED IN THE HANDLERS, never from an effect. `set-state-in-effect` is
  // fatal in CI, and the render-time reconcile that usually answers it does not
  // apply — that pattern syncs state to a CHANGED PROP against a last-seen key,
  // and this value is derived from no prop at all. The user action that
  // invalidates the message is the action that should clear it.
  //
  // Four clearing contexts, each one the reason cannot outlive:
  //  · every MUTATION — folded into `mutate` below, so a future call site
  //    cannot forget it and `handleRestore` re-sets it in the same handler
  //    (later write wins). A delete in particular FALSIFIES the commonest
  //    reason: `document limit reached (${MAX_DOCUMENTS})` no longer binds once a row is
  //    gone, so leaving it up reads as a live blocker that is not one.
  //  · SELECTION — the region renders immediately above `DocumentPreview`, i.e.
  //    directly above the selected document's content, so a reason left behind
  //    re-parents a refusal about one document onto another.
  //  · HISTORY MODAL OPEN — one of the two restore surfaces. A reason from the
  //    last session would still be there when this one closes, indistinguishable
  //    from a fresh refusal.
  //  · the DELETED-DOCUMENTS TOGGLE — the other restore surface. Hiding the
  //    Restore buttons that produced the reason leaves it with no visible cause.
  //
  // ★ ONE selection change deliberately does NOT clear it: the deep-link effect
  // below. Adding `setRestoreRejected([])` there needs a SECOND
  // `set-state-in-effect` suppression, and the cost is not worth the case — it
  // requires a refused restore followed by a chat-card deep link, and the
  // outcome is a stale line of text, not a wrong action. Stated rather than
  // silently skipped.
  const [restoreRejected, setRestoreRejected] = useState<readonly string[]>([]);
  const confirm = useConfirm();
  // Ambient, exactly like every other panel's — `useToastContext` defaults to a
  // no-op when no provider is above, so this adds no required wiring anywhere.
  const showToast = useToastContext();
  const { pendingOpen, clearPendingOpen, pendingDocEntityFilter, clearDocEntityFilter, requestOpen } = useWorkspaceTab();
  // ★★★ THE ARRIVAL AFFORDANCE, and it is the SCROLL that matters here. The
  // effect below moves the SELECTION, which is invisible if the row is below
  // the fold — `documents-list` is its own `overflow-auto` box holding up to
  // MAX_DOCUMENTS rows, so a deep link from the chat transcript's document card
  // could select a row the user never sees move. This hook scrolls it into
  // view (centered) and flashes it, exactly as raid / change / milestones /
  // stakeholders do.
  //
  // ★★ IT IS HALF A MECHANISM ON ITS OWN. The scroll is
  // `containerRef.current.querySelector('[data-deeplink-row="<id>"]')`, so BOTH
  // returned values have to reach `documents-list` — the ref onto its scroll
  // box and `flashId` onto the row. Wiring the hook alone gives a query that
  // matches nothing: no scroll, no outline, and a call site that reads as if
  // the pane had an arrival cue. Both props are REQUIRED on `DocumentsListProps`
  // so that stays a typecheck error rather than a silent no-op.
  //
  // ★ Deliberately SEPARATE from the effect below, not folded into it: the hook
  // owns its own render-time reconcile and rAF timing (see its notes on why a
  // `pendingOpen` dep would tear the scroll down), and this pane's effect owns
  // the selection + the clear. One signal, two consumers, neither reaching into
  // the other.
  const { flashId, containerRef } = useDeepLinkRowFlash("documents");

  const { colWidths, startColResize, resetColWidths } = useColumnResize<DocumentsCol>(
    "documents",
    DOCUMENTS_COL_DEFAULTS,
  );

  const rows = useMemo(() => sortDocuments(documents, sort.key, sort.dir), [documents, sort]);

  // The request/reconcile/filter trio, incl. the sentinel-seed remount-swallow
  // guard — see `use-document-entity-filter.ts`, which carries the reasoning.
  const { entityFilter, visibleRows, clearEntityFilter } = useDocumentEntityFilter(
    documents,
    rows,
    pendingDocEntityFilter,
  );
  const lookups = useMemo(() => buildDocRefLookups(ws), [ws]);
  const candidates = useMemo(() => buildDocLinkCandidates(ws), [ws]);
  // ★★★ DERIVED, never a stored flag — a flag would have to be cleared on
  // restore and can desync from the documents array.
  //
  // ★★ THIS LIST CAN CONTAIN THINGS THAT WERE NEVER DELETED, and the pane
  // cannot tell. `deletedDocumentVersions` reports any version whose
  // `documentId` is absent from `documents`, which is also true of
  // (a) TRUNCATION ARTIFACTS — an over-cap file loads as MAX_DOCUMENTS
  // documents but keeps ALL its versions, because `sanitizeProjectDocuments`
  // caps the count while `sanitizeDocumentVersions` structurally cannot. (The
  // cap was raised to 1000 and a truncating load now warns and pauses saving
  // — open-followups §103 — so this is rarer than it was, but a file built
  // against the old limit can still arrive in this shape.) And (b) ORPHANS from
  // a partial import, or a text-backend load where the `documents` blob failed
  // to parse and the `documentVersions` blob succeeded (they have independent
  // try/catch on every backend). In that last case EVERY version reads as a
  // deleted document. The toolbar shows the COUNT for exactly that reason —
  // "Deleted documents (200)" beside an empty pane is the signal.
  // ★ The engine-side narrowing (requiring `op === "delete"`) is a separate
  // change; this pane deliberately does not duplicate it, so it inherits the
  // fix rather than masking whether it landed.
  const deleted = useMemo(
    () => deletedDocumentVersions(documentVersions, documents),
    [documentVersions, documents],
  );

  // ★ Resolved at read time like `selected` below, never written back: a
  // concurrent delete (an AI tool writing through the same entry point) would
  // otherwise leave the modal open over a document that no longer exists.
  const historyDoc = documents.find((d) => d.id === historyFor) ?? null;

  // ★★ NEWEST FIRST, and the tie-break is not decoration. Two mutations in the
  // same tick carry an IDENTICAL `savedAt` — `mutateDocuments` stamps one
  // `new Date()` per call and React has not re-rendered between them — so a
  // sort on `savedAt` alone leaves their relative order to `Array.prototype
  // .sort`'s stability, i.e. to insertion order, which is oldest-first and
  // therefore backwards. Descending `id` breaks it correctly because ids are
  // minted monotonically. This mirrors `byNewest` in document-versions.ts,
  // which is private to that module.
  const historyVersions = useMemo(
    () =>
      documentVersions
        .filter((v) => v.documentId === historyFor)
        .slice()
        .sort((a, b) => (a.savedAt === b.savedAt ? b.id - a.id : a.savedAt < b.savedAt ? 1 : -1)),
    [documentVersions, historyFor],
  );

  // ★ Selection is RESOLVED at read time, never written back. A selected
  // document that a concurrent writer deletes would otherwise leave the pane
  // pointing at nothing; falling back to the first row makes that self-healing,
  // and there is no effect to fight `react-hooks/set-state-in-effect`. Same
  // shape as `resolveEffectiveFilters` for orphaned list filters.
  // ★★ WHILE FILTERED, FALL BACK WITHIN THE VISIBLE ROWS. The link field below
  // is bound to `selected`, so a fallback to `documents[0]` lets an attach made
  // from a filtered view land on a document the list is not showing — silently,
  // and with no undo on document writes.
  const selectionPool = entityFilter && visibleRows.length > 0 ? visibleRows : documents;
  const selected = selectionPool.find((d) => d.id === selectedId) ?? selectionPool[0] ?? null;
  const { editing, narrowPane, paneRef, commitBlock, structural, editToolbar } = useDocumentEditMode({ documentId: selected?.id ?? -1, versions: documentVersions, mutateDocuments: mutate });

  // ★★★ DEEP LINK. The chat transcript's document card calls
  // `requestOpen("documents", id)` (workspace-tab-context), which switches the
  // active tab and arms `pendingOpen`. Without a consumer here that landed on
  // the Documents view with nothing selected — the navigation half worked and
  // the "open THIS document" half silently did not.
  //
  // ★★ The shape is copied from `raid-panel` / `change-panel` /
  // `milestones-panel` / `stakeholders-panel`, deliberately and unchanged in
  // structure, including the `set-state-in-effect` suppression. That rule is
  // fatal in CI and the render-time reconcile pattern is the usual answer to it
  // — but it cannot be the answer HERE, because consuming the signal also means
  // CLEARING it, and `clearPendingOpen` is a setState in an ANCESTOR. React
  // forbids that during render, so the clear has to live in an effect either
  // way; splitting the selection into a render reconcile would leave two
  // mechanisms for one signal and no reader able to tell which owns it.
  //
  // ★★★ THE REMOUNT-SWALLOW IS WHY NOTHING IS SEEDED FROM THE LIVE SIGNAL. This
  // pane is conditionally mounted (the shell renders only the active view), so
  // the deep link's ARRIVAL is a fresh mount — the exact case a `useRef(prop)`
  // "last seen" seed swallows, since prop === seed on the first run. That would
  // make the feature never work while reading as correct. There is no seed at
  // all: the effect runs on mount, sees the armed signal and honours it.
  //
  // ★★ And it CLEARS, so the signal cannot re-fire from a later render. A genuine
  // re-arm (back/forward → `use-hash-view` re-invokes `requestOpen`) is a new
  // navigation and is honoured on purpose; the `selectedId` guard keeps a
  // re-arm for the row the user is ALREADY on from queueing a redundant render.
  //
  // ★ Both narrowing checks matter: another view's request must be left alone
  // for that view's own consumer to take (clearing it here would steal it), and
  // an id no live document holds must NOT blank the selection — a deep link to
  // a deleted or unknown document leaves the pane exactly as it was.
  useEffect(() => {
    if (pendingOpen?.view !== "documents") return;
    const target = documents.find((d) => d.id === pendingOpen.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-way deep-link
    if (target && selectedId !== target.id) setSelectedId(target.id);
    clearPendingOpen();
  }, [pendingOpen, documents, selectedId, clearPendingOpen]);

  // ★★★ WHAT THE FUNCTIONAL SETTER USED TO BUY, FOR TITLES ONLY.
  // `mutateDocuments` reads its own refs and advances them synchronously, so
  // IDS and the version trail are already same-tick correct without any help
  // from here. Titles are not: `uniqueDocumentTitle` runs at the CALL SITE now
  // (see its note), and the only list a render body can hand a call site is the
  // `documents` PROP — which is one render behind any mutation React has not
  // flushed yet. Two creates in one tick would then both uniquify against the
  // pre-mutation list and mint the SAME title, which is five pairs of identical
  // control names (WCAG 2.4.6) and precisely the defect the minting exists to
  // remove.
  //
  // So every mutation records the list it produced, KEYED BY the prop reference
  // it was computed from. A later handler trusts that record only while the
  // prop is still that same reference; once the prop changes — a load, or an AI
  // tool writing through the same entry point — the PROP wins again, so the
  // memo can never pin the pane to a stale world.
  //
  // ★ Both halves run in EVENT HANDLERS only: no ref is read or written during
  // render (the purity rule) and there is no effect (`set-state-in-effect` is
  // banned). A `useState` here would be worse, not better — it would re-render
  // on every mutation for a value nothing renders.
  const freshRef = useRef<{ from: readonly ProjectDocument[]; latest: readonly ProjectDocument[] } | null>(null);

  function freshDocuments(): readonly ProjectDocument[] {
    const seen = freshRef.current;
    return seen && seen.from === documents ? seen.latest : documents;
  }

  /** ★ RETURNS the result. It used to swallow it, and the one caller that
   *  needed it (`handleRestore`) worked around that by calling
   *  `mutateDocuments` directly — which is how the OTHER restore surface (the
   *  history modal) came to drop its refusal entirely: the shape that reads
   *  like "a mutation returns nothing" invites a call site to discard one. */
  function mutate(m: DocMutation): DocResult {
    // ★ Every mutation clears the last refusal (see `restoreRejected`'s note).
    // Here rather than in the four callers so a fifth cannot forget it.
    // `handleRestore` calls this FIRST and writes the new value after — both
    // land in one event handler, so the later write wins and a FRESH refusal
    // survives. The refused-restore cases pin that ordering.
    clearRestoreRejected();
    const result = mutateDocuments(m, "user");
    // ★★ A REFUSAL REACHES THE USER FROM HERE, not from each call site — the
    // note above is that "a mutation returns nothing" invites a call site to
    // discard one, and the attach path did exactly that: at MAX_LINKS_PER_DOC
    // the engine refuses, the option stays in the dropdown (it is not linked),
    // and clicking it did nothing, repeatedly, with nothing said.
    if (!result.changed && result.rejected.length > 0) setRestoreRejected(result.rejected);
    freshRef.current = { from: documents, latest: result.documents };
    return result;
  }

  /** See `restoreRejected`'s note: the message describes one click, so every
   *  later user action that is not itself a restore takes it down. */
  function clearRestoreRejected() {
    setRestoreRejected([]);
  }

  function handleSelect(id: number) {
    clearRestoreRejected();
    setSelectedId(id);
  }

  function handleOpenHistory(doc: ProjectDocument) {
    clearRestoreRejected();
    setHistoryFor(doc.id);
  }

  function handleShowDeletedChange(next: boolean) {
    clearRestoreRejected();
    setShowDeleted(next);
  }

  // ★★★ A RESTORE CAN BE REFUSED, and at the cap it always is. After a
  // truncating load the document count sits EXACTLY at MAX_DOCUMENTS, so the
  // engine's cap guard rejects every restore with
  // `["document limit reached (${MAX_DOCUMENTS})"]` — and a genuine tombstone restored into
  // a full document set hits the same wall. `mutateDocuments` hands back
  // `rejected` synchronously, so the only way to get this wrong is to discard
  // it. Rendered below the list, not swallowed.
  //
  // ★★★ BOTH RESTORE SURFACES GO THROUGH HERE — the deleted-documents list AND
  // the history modal. The modal used to inline `mutate({kind:"restore"…})` and
  // throw the result away, then CLOSE, so a refusal read as a successful
  // dismissal: nothing changed and nothing said so. Two refusals reach it
  // today — a version trimmed away by a concurrent AI write between render and
  // click (`version #N not found`), and the block cap on the restore-in-place
  // path. Do not re-inline a second call site; there is exactly one for a
  // reason.
  // ★★★ THE TITLE ANNOUNCED IS THE ONE THE LIST WILL SHOW, NOT THE VERSION'S.
  // `applyDocMutation` runs `uniqueTitle` on BOTH restore branches — in-place
  // (against the other live documents) and recreate-a-deleted-one (against all
  // of them) — so a version stored as "Charter" restores as "Charter 2"
  // whenever that title has since been taken. Announcing `version.title` would
  // therefore name a document that does not exist, which is worse than no toast
  // at all. The result carries `documentId` (the row the mutation landed on)
  // and the NEW `documents` list, so reading the title back out of the two is
  // the only spelling that cannot drift from what the user sees.
  // ★ Success only. A refusal already renders a `role="status"` reason below;
  // a toast on the same event would announce it twice to a screen reader.
  // ★ `documentId` is non-null on every `changed` restore branch — the lookup
  // is type narrowing, not a suspected failure mode, and a missing row would
  // mean the engine changed shape, so there is nothing truthful to announce.
  function handleRestore(versionId: number) {
    const result = mutate({ kind: "restore", versionId });
    setRestoreRejected(result.changed ? [] : result.rejected);
    if (!result.changed) return;
    const restored = result.documents.find((d) => d.id === result.documentId);
    if (restored) showToast("success", t(lang, "documentsRestored", restored.title));
  }

  function handleSort(key: DocumentSortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: nextSortDir(prev.dir) } : { key, dir: "asc" }));
  }

  function handleCreate() {
    // ★★ `documentsNewTitle`, NOT `documentsNew`. The latter is the toolbar
    // BUTTON's label; reusing it as the default title meant a freshly created
    // document rendered a row-title button with that same accessible name, so
    // the pane held two buttons called "New document". It also coupled two
    // unrelated strings — retitling the button silently renamed new documents.
    mutate({ kind: "create", title: uniqueDocumentTitle(freshDocuments(), t(lang, "documentsNewTitle")) });
  }

  function handleDuplicate(doc: ProjectDocument) {
    // ★ A distinguishing BASE, not the source's own title: the copy would
    // otherwise be indistinguishable in every per-row control's accessible
    // name. `uniqueDocumentTitle` resolves a repeat copy to "… (copy) 2".
    const base = t(lang, "documentsCopySuffix", doc.title);
    mutate({ kind: "duplicate", id: doc.id, title: uniqueDocumentTitle(freshDocuments(), base) });
  }

  function commitRename() {
    if (!renaming) return;
    const title = renaming.draft.trim();
    const id = renaming.id;
    setRenaming(null);
    // An empty title would render an unclickable, unnameable row — drop the
    // edit rather than store one. `mutateDocuments` would reject it too, but
    // dropping it here keeps a whitespace-only rename out of the `rejected`
    // channel entirely — it is not a failure, it is a cancelled edit.
    if (!title) return;
    mutate({ kind: "rename", id, title });
  }

  async function handleDelete(doc: ProjectDocument) {
    // The lighter destructive tier: one row, so the branded confirm dialog
    // rather than TypeToConfirmDialog — and never `window.confirm`.
    const ok = await confirm({
      message: `${t(lang, "documentsDelete")} – ${doc.title}`,
      title: t(lang, "documentsDelete"),
      confirmLabel: t(lang, "documentsDelete"),
    });
    if (!ok) return;
    // ★ A delete is the one mutation whose before-image is the ONLY surviving
    // copy of the document — `mutateDocuments` writes that tombstone version,
    // which is what makes the deleted-documents list and Restore possible.
    mutate({ kind: "delete", id: doc.id });
  }

  return (
    // `flex-1` so the pane the tabpanel wrapper now owns (the resizable card)
    // is actually filled — without it the content sits at its natural height
    // and the preview never gets a scroll box of its own.
    <div className="flex min-h-0 flex-1 flex-col">
      <DocumentsToolbar
        lang={lang}
        onNew={handleCreate}
        onDownload={() => { if (selected) void downloadDocument(selected, format, ws, lang, assetPaneLoader(assetPane)).catch((e) => reportDownloadFailure(showToast, lang, e)); }}
        canDownload={selected !== null}
        format={format}
        onFormatChange={chooseFormat}
        onResetColumns={resetColWidths}
        onResetSize={onResetSize}
        showDeleted={showDeleted}
        onShowDeletedChange={handleShowDeletedChange}
        deletedCount={deleted.length}
        isReadOnly={isReadOnly}
        editToolbar={editToolbar}
      />
      <div ref={paneRef} className="flex min-h-0 flex-1 flex-col gap-3">
        {/* ★ Title falls back to `#id` — an entity deleted since the badge was clicked
            must still name what is filtered. ★★ Clear does BOTH, or a re-visit re-applies. */}
        {entityFilter && (
          <DocumentEntityFilterBanner
            lang={lang}
            title={resolveDocRef(entityFilter, lookups).title || `#${entityFilter.id}`}
            isEmpty={visibleRows.length === 0}
            onClear={() => { clearEntityFilter(); clearDocEntityFilter(); }}
          />
        )}
        <DocumentsList
          lang={lang}
          documents={visibleRows}
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
          sortKey={sort.key}
          sortDir={sort.dir}
          onSort={handleSort}
          colWidths={colWidths}
          onResize={(col, e) => startColResize(col as DocumentsCol, e)}
          onRename={(doc) => setRenaming({ id: doc.id, draft: doc.title })}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onDownload={(doc) => void downloadDocument(doc, format, ws, lang, assetPaneLoader(assetPane)).catch((e) => reportDownloadFailure(showToast, lang, e))}
          onOpenHistory={handleOpenHistory}
          isReadOnly={isReadOnly}
          flashId={flashId}
          containerRef={containerRef}
        />
        {showDeleted && (
          <DocumentsDeletedSection
            lang={lang}
            deleted={deleted}
            documentCount={documents.length}
            isReadOnly={isReadOnly}
            onRestore={handleRestore}
          />
        )}
        {/* ★★★ OUTSIDE the `showDeleted` block, and that placement is the whole
            fix on this half. It used to live INSIDE the section above, which
            made it unreachable from the OTHER restore surface: the history
            modal is opened from a row control and is completely independent of
            the show-deleted toggle, which is OFF by default — so a refusal
            raised there set state nothing rendered, and the modal closed on
            top of it. A reason that cannot draw is the same silent no-op as a
            discarded result, one layer down. Mutation-proved in
            `documents-panel.test.tsx`: moving this back inside the section
            reddens the modal-refusal case on its own.
            ★ `role="status"` so the refusal is ANNOUNCED rather than only
            drawn. The reasons are the engine's own strings and are not
            translated — an i18n key for this was not available to add; see the
            report. An untranslated reason beats a silent no-op.
            ★★ AND THAT HOIST IS WHY THE CLEARING IS EXPLICIT. Inside the
            section, closing it took the message down; out here nothing does,
            so the four clearing contexts listed on `restoreRejected` are what
            keep this from becoming a line of permanent furniture. */}
        {restoreRejected.length > 0 && (
          <p role="status" className="text-sm text-ui-pink">
            {restoreRejected.join("; ")}
          </p>
        )}
        <DocumentLinksSection
          lang={lang}
          doc={selected}
          lookups={lookups}
          candidates={candidates}
          isReadOnly={isReadOnly}
          onLink={(docId, ref) => mutate({ kind: "link", id: docId, ref })}
          onUnlink={(docId, ref) => mutate({ kind: "unlink", id: docId, ref })}
          onOpenView={requestOpen}
        />
        <DocumentsAssetSection lang={lang} assetPane={assetPane}
          documents={documents} structural={structural} selected={selected} isReadOnly={isReadOnly} />
        <DocumentEditModeBody lang={lang} doc={selected} ws={ws} editing={editing} narrow={narrowPane} isReadOnly={isReadOnly} onCommitBlock={commitBlock} structural={structural}
          assetsTursoConfig={assetPane?.tursoConfig ?? null} assetsProjectId={assetPane?.projectId} />
      </div>

      <DocumentsHistoryModal
        open={historyFor !== null}
        doc={historyDoc}
        versions={historyVersions}
        // The Preview inside each history row renders the version's blocks
        // through `renderDocumentHtml`, which needs a workspace to resolve a
        // `dataSection` block — the same value, for the same reason,
        // `DocumentPreview` gets above. Without it the modal falls back to an
        // empty workspace and a `dataSection` renders as NOTHING: a missing
        // section rather than broken markup.
        // ★★ THAT SILENCE IS WHY THIS PROP IS PINNED EXPLICITLY RATHER THAN
        // LEFT TO A TEST THAT MERELY OPENS THE MODAL. It throws nothing and
        // breaks no layout, so a case asserting the panel has SOME text passes
        // with `ws` dropped. It is pinned from BOTH sides, because neither side
        // covers the other's half: `documents-panel.test.tsx` ("the history
        // modal's Preview") asserts the resolved section's own content
        // end-to-end and reddens on this very prop going missing — it is the
        // only one that can, since the component's own suite mounts the modal
        // itself; and `documents-history-modal.test.tsx` ("a version's
        // dataSection in the Preview") pins the contract from the component
        // side in both directions, including the `ws: undefined` branch this
        // pane can never produce. Assert the SECTION'S CONTENT, never that
        // some text exists.
        // Deliberately NOT `ws.documentVersions` for the `versions` prop above
        // — see that prop's own note.
        ws={ws}
        onClose={() => setHistoryFor(null)}
        // ★★ A restore is a mutation like any other, so it goes through the
        // same single entry point — and through `handleRestore`, not a
        // hand-rolled `mutate({kind:"restore"…})`, so the refusal reaches the
        // surface exactly as it does from the deleted-documents list. The
        // inline form discarded it.
        // ★ The modal closes either way, INCLUDING on a refusal, which is why
        // the reason renders in the pane body rather than in here: a reason
        // drawn inside a dialog that is closing is a reason nobody reads.
        onRestore={(versionId) => {
          handleRestore(versionId);
          setHistoryFor(null);
        }}
        lang={lang}
        isReadOnly={isReadOnly}
      />

      {renaming && (
        <Modal open onClose={() => setRenaming(null)} ariaLabelledby={RENAME_TITLE_ID} align="center">
          <div
            data-modal-panel
            className="relative flex w-[420px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
          >
            <ModalHeader
              lang={lang}
              title={t(lang, "documentsRename")}
              titleId={RENAME_TITLE_ID}
              onClose={() => setRenaming(null)}
            />
            <div className="flex flex-col gap-4 p-6">
              <label className="flex flex-col gap-1 text-sm text-foreground">
                {/* A visible <label> IS the accessible name — a placeholder is
                    not, and a placeholder-only input fails the axe gate even
                    though it looks labeled. */}
                {t(lang, "documentsTitleLabel")}
                <Input
                  autoFocus
                  value={renaming.draft}
                  onChange={(e) => setRenaming((prev) => (prev ? { ...prev, draft: e.target.value } : prev))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) commitRename();
                  }}
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setRenaming(null)}>
                  {t(lang, "cancel")}
                </Button>
                <Button variant="primary" size="sm" onClick={commitRename}>
                  {t(lang, "documentsRename")}
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
