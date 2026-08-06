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

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { type Lang, t } from "./i18n";
import { type ProjectDocument, nextDocumentId } from "./document-model";
import type { Workspace } from "./workspace";
import { DocumentsToolbar } from "./documents-toolbar";
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

// --- component ------------------------------------------------------------

export interface DocumentsPanelProps {
  lang: Lang;
  documents: readonly ProjectDocument[];
  setDocuments: Dispatch<SetStateAction<readonly ProjectDocument[]>>;
  /** Needed by the preview: dataSection blocks render live workspace data. */
  ws: Workspace;
  /** Output format for both the toolbar and the per-row Download controls.
   *
   *  ★ THERE IS NO FORMAT PICKER YET and the plan specifies none — `downloadDocument`
   *  supports four formats, so three are currently unreachable from the UI. Defaulting
   *  here (rather than hard-coding at the call site) keeps the seam in one place for
   *  whoever adds the picker; it needs one new i18n key for the control's accessible
   *  name, which is why it is not invented here. Raised with the slice owner. */
  format?: DocFormat;
  onResetSize?: () => void;
}

const RENAME_TITLE_ID = "documents-rename-title";

export function DocumentsPanel({
  lang,
  documents,
  setDocuments,
  ws,
  format = "docx",
  onResetSize,
}: DocumentsPanelProps) {
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
        onResetColumns={resetColWidths}
        onResetSize={onResetSize ?? (() => {})}
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
