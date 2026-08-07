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

import { useCallback, useMemo, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { type ProjectDocument, MAX_TITLE_CHARS } from "./document-model";
import type { DocMutation, DocResult } from "./document-mutations";
import { deletedDocumentVersions, type DocVersion, type DocVersionSource } from "./document-versions";
import type { Workspace } from "./workspace";
import { DocumentsToolbar, DOC_FORMATS } from "./documents-toolbar";
import { DocumentsList, DOCUMENTS_COL_DEFAULTS, type DocumentSortKey, type DocumentsCol } from "./documents-list";
import { DocumentPreview } from "./document-preview";
import { DocumentsHistoryModal } from "./documents-history-modal";
import { downloadDocument, type DocFormat } from "./document-download";
import { useColumnResize } from "./use-column-resize";
import { type SortDir, compareStrOrNum, nextSortDir } from "./report-table";
import { useConfirm } from "./confirm-dialog";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { INTERACTIVE } from "./interaction-styles";

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
  // here. Cleared on the next attempt so a stale reason cannot outlive the
  // click that produced it.
  const [restoreRejected, setRestoreRejected] = useState<readonly string[]>([]);
  const confirm = useConfirm();

  const { colWidths, startColResize, resetColWidths } = useColumnResize<DocumentsCol>(
    "documents",
    DOCUMENTS_COL_DEFAULTS,
  );

  const rows = useMemo(() => sortDocuments(documents, sort.key, sort.dir), [documents, sort]);

  // ★★★ DERIVED, never a stored flag — a flag would have to be cleared on
  // restore and can desync from the documents array.
  //
  // ★★ THIS LIST CAN CONTAIN THINGS THAT WERE NEVER DELETED, and the pane
  // cannot tell. `deletedDocumentVersions` reports any version whose
  // `documentId` is absent from `documents`, which is also true of
  // (a) TRUNCATION ARTIFACTS — a 205-document file loads as 200 documents and
  // 205 versions, because `sanitizeProjectDocuments` caps at MAX_DOCUMENTS
  // while `sanitizeDocumentVersions` structurally cannot; and (b) ORPHANS from
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
  const selected = documents.find((d) => d.id === selectedId) ?? documents[0] ?? null;

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

  function mutate(m: DocMutation) {
    const result = mutateDocuments(m, "user");
    freshRef.current = { from: documents, latest: result.documents };
  }

  // ★★ A RESTORE CAN BE REFUSED, and at the cap it always is. After a
  // truncating load the document count sits EXACTLY at MAX_DOCUMENTS, so the
  // engine's cap guard rejects every restore with
  // `["document limit reached (200)"]` — and a genuine tombstone restored into
  // a full document set hits the same wall. `mutateDocuments` hands back
  // `rejected` synchronously, so the only way to get this wrong is to discard
  // it. Rendered below the list, not swallowed.
  function handleRestore(versionId: number) {
    const result = mutateDocuments({ kind: "restore", versionId }, "user");
    freshRef.current = { from: documents, latest: result.documents };
    setRestoreRejected(result.changed ? [] : result.rejected);
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
        onDownload={() => { if (selected) downloadDocument(selected, format, ws, lang); }}
        canDownload={selected !== null}
        format={format}
        onFormatChange={chooseFormat}
        onResetColumns={resetColWidths}
        onResetSize={onResetSize}
        showDeleted={showDeleted}
        onShowDeletedChange={setShowDeleted}
        deletedCount={deleted.length}
        isReadOnly={isReadOnly}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <DocumentsList
          lang={lang}
          documents={rows}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          sortKey={sort.key}
          sortDir={sort.dir}
          onSort={handleSort}
          colWidths={colWidths}
          onResize={(col, e) => startColResize(col as DocumentsCol, e)}
          onRename={(doc) => setRenaming({ id: doc.id, draft: doc.title })}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onDownload={(doc) => downloadDocument(doc, format, ws, lang)}
          onOpenHistory={(doc) => setHistoryFor(doc.id)}
          isReadOnly={isReadOnly}
        />
        {showDeleted && (
          <section aria-label={t(lang, "documentsShowDeleted")} className="rounded-md border border-line p-3">
            {deleted.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t(lang, "documentsNoVersions")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {deleted.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 text-foreground">
                      <span className="font-medium">{v.title}</span>
                      {" · "}
                      <span className="tabular-nums text-muted-foreground">
                        {v.savedAt.slice(0, 16).replace("T", " ")}
                      </span>
                    </span>
                    {/* ★★ ROW-UNIQUE accessible name. Title alone is not
                        enough — nothing uniquifies titles outside this pane's
                        own create/duplicate handlers, so two tombstones can
                        share one; the version id is unique by construction and
                        is language-neutral. Same reasoning as the history
                        modal's Restore labels. */}
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => handleRestore(v.id)}
                      disabled={isReadOnly}
                      aria-label={`${t(lang, "documentsRestore")} – ${v.title} · #${v.id}`}
                    >
                      {t(lang, "documentsRestore")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {restoreRejected.length > 0 && (
              // `role="status"` so the refusal is announced rather than only
              // drawn. The reasons are the engine's own strings and are not
              // translated — an i18n key for this was not available to add;
              // see the report. An untranslated reason beats a silent no-op.
              <p role="status" className="mt-2 text-sm text-ui-pink">
                {restoreRejected.join("; ")}
              </p>
            )}
          </section>
        )}
        <DocumentPreview lang={lang} doc={selected} ws={ws} />
      </div>

      <DocumentsHistoryModal
        open={historyFor !== null}
        doc={historyDoc}
        versions={historyVersions}
        onClose={() => setHistoryFor(null)}
        // ★ A restore is a mutation like any other, so it goes through the same
        // single entry point — and through `mutate`, not `mutateDocuments`
        // directly, so the same-tick title record stays in step with every
        // other handler here.
        onRestore={(versionId) => {
          mutate({ kind: "restore", versionId });
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
                <input
                  type="text"
                  autoFocus
                  value={renaming.draft}
                  onChange={(e) => setRenaming((prev) => (prev ? { ...prev, draft: e.target.value } : prev))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) commitRename();
                  }}
                  className={`rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground ${INTERACTIVE}`}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenaming(null)}
                  className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
                >
                  {t(lang, "cancel")}
                </button>
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
