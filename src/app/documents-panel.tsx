"use client";

// src/app/documents-panel.tsx — orchestrator for the Documents pane.
//
// Owns sort state, selection, column widths and the create/rename/duplicate/
// delete handlers. The list, preview and toolbar are pure presentational
// siblings (the gantt split).
//
// ★★★ EVERY MUTATION IS A FUNCTIONAL SETTER — `setDocuments(prev => …)`, never
// `setDocuments([...documents, x])`. A closure-read setter drops a concurrent
// write landing in the SAME tick, which is the bulk-edit landmine this codebase
// has already shipped once. The type cannot catch it (both spellings satisfy
// `Dispatch<SetStateAction<…>>`), so `documents-panel.test.tsx` pins it by
// driving two creates through one setter with no intervening render.

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { type Lang, t } from "./i18n";
import { type ProjectDocument, nextDocumentId } from "./document-model";
import type { Workspace } from "./workspace";
import { DocumentsToolbar, DOC_FORMATS } from "./documents-toolbar";
import { DocumentsList, DOCUMENTS_COL_DEFAULTS, type DocumentSortKey, type DocumentsCol } from "./documents-list";
import { DocumentPreview } from "./document-preview";
import { downloadDocument, type DocFormat } from "./document-download";
import { useColumnResize } from "./use-column-resize";
import { type SortDir, compareStrOrNum, nextSortDir } from "./report-table";
import { useConfirm } from "./confirm-dialog";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { INTERACTIVE } from "./interaction-styles";

// --- pure transforms ------------------------------------------------------
// i18n-free and side-effect-free, so they can be unit-tested directly and
// composed to reproduce a same-tick collision without React in the loop.

/** Append a new empty document. `title` and `now` are injected — no clock read
 *  here, so the result is a deterministic function of its inputs. */
export function appendDocument(
  prev: readonly ProjectDocument[],
  title: string,
  now: string,
): ProjectDocument[] {
  return [...prev, { id: nextDocumentId(prev), title, blocks: [], createdAt: now, updatedAt: now }];
}

/** Copy `id`'s document under a new id. A no-op when `id` is absent — the row
 *  may have been deleted by a concurrent writer between click and commit. */
export function duplicateDocument(
  prev: readonly ProjectDocument[],
  id: number,
  title: string,
  now: string,
): ProjectDocument[] {
  const src = prev.find((d) => d.id === id);
  if (!src) return [...prev];
  return [...prev, { ...src, id: nextDocumentId(prev), title, createdAt: now, updatedAt: now }];
}

/** Retitle exactly one document, stamping `updatedAt`. */
export function renameDocument(
  prev: readonly ProjectDocument[],
  id: number,
  title: string,
  now: string,
): ProjectDocument[] {
  return prev.map((d) => (d.id === id ? { ...d, title, updatedAt: now } : d));
}

export function removeDocument(
  prev: readonly ProjectDocument[],
  id: number,
): ProjectDocument[] {
  return prev.filter((d) => d.id !== id);
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
  setDocuments: Dispatch<SetStateAction<readonly ProjectDocument[]>>;
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
  onResetSize?: () => void;
}

const RENAME_TITLE_ID = "documents-rename-title";

export function DocumentsPanel({
  lang,
  documents,
  setDocuments,
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
  const confirm = useConfirm();

  const { colWidths, startColResize, resetColWidths } = useColumnResize<DocumentsCol>(
    "documents",
    DOCUMENTS_COL_DEFAULTS,
  );

  const rows = useMemo(() => sortDocuments(documents, sort.key, sort.dir), [documents, sort]);

  // ★ Selection is RESOLVED at read time, never written back. A selected
  // document that a concurrent writer deletes would otherwise leave the pane
  // pointing at nothing; falling back to the first row makes that self-healing,
  // and there is no effect to fight `react-hooks/set-state-in-effect`. Same
  // shape as `resolveEffectiveFilters` for orphaned list filters.
  const selected = documents.find((d) => d.id === selectedId) ?? documents[0] ?? null;

  function handleSort(key: DocumentSortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: nextSortDir(prev.dir) } : { key, dir: "asc" }));
  }

  function handleCreate() {
    const now = new Date().toISOString();
    setDocuments((prev) => appendDocument(prev, t(lang, "documentsNew"), now));
  }

  function handleDuplicate(doc: ProjectDocument) {
    const now = new Date().toISOString();
    setDocuments((prev) => duplicateDocument(prev, doc.id, doc.title, now));
  }

  function commitRename() {
    if (!renaming) return;
    const title = renaming.draft.trim();
    const id = renaming.id;
    setRenaming(null);
    // An empty title would render an unclickable, unnameable row — drop the
    // edit rather than store one.
    if (!title) return;
    const now = new Date().toISOString();
    setDocuments((prev) => renameDocument(prev, id, title, now));
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
    setDocuments((prev) => removeDocument(prev, doc.id));
  }

  return (
    <div className="flex min-h-0 flex-col">
      <DocumentsToolbar
        lang={lang}
        onNew={handleCreate}
        onDownload={() => { if (selected) downloadDocument(selected, format, ws, lang); }}
        canDownload={selected !== null}
        format={format}
        onFormatChange={chooseFormat}
        onResetColumns={resetColWidths}
        onResetSize={onResetSize ?? (() => {})}
        isReadOnly={isReadOnly}
      />
      <div className="flex min-h-0 flex-col gap-3">
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
          isReadOnly={isReadOnly}
        />
        <DocumentPreview lang={lang} doc={selected} ws={ws} />
      </div>

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
