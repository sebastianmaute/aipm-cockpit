"use client";

// src/app/documents-list.tsx — the Documents pane's row table.
//
// PURE presentational (the gantt split): rows arrive already sorted, and every
// handler is a prop. It owns no state, reads no context.

import { type Lang, t } from "./i18n";
import type { ProjectDocument } from "./document-model";
import { DataTable } from "./data-table";
import { EmptyState } from "./empty-state";
import { Button } from "./button";
import { type SortDir, SortResizeTh } from "./report-table";
import { INTERACTIVE } from "./interaction-styles";

/** Only these three carry an order a user could act on. The actions column
 *  holds controls — sorting it would be an affordance promising nothing. */
export type DocumentSortKey = "title" | "blocks" | "updated";

/** Width/resize keys. `actions` is deliberately absent: it is not resizable. */
export type DocumentsCol = DocumentSortKey;

export const DOCUMENTS_COL_DEFAULTS: Readonly<Record<DocumentsCol, number>> = {
  title: 280,
  blocks: 90,
  updated: 130,
};

export interface DocumentsListProps {
  lang: Lang;
  /** Already sorted by the orchestrator. */
  documents: readonly ProjectDocument[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  sortKey: DocumentSortKey;
  sortDir: SortDir;
  onSort: (col: DocumentSortKey) => void;
  colWidths: Record<DocumentsCol, number>;
  onResize: (col: string, e: React.MouseEvent) => void;
  onRename: (doc: ProjectDocument) => void;
  onDuplicate: (doc: ProjectDocument) => void;
  onDelete: (doc: ProjectDocument) => void;
  onDownload: (doc: ProjectDocument) => void;
  /** ★ NOT gated by `isReadOnly`: opening history only READS. The Restore
   *  buttons inside the modal are what carry the guard. */
  onOpenHistory: (doc: ProjectDocument) => void;
  /** Popout mirrors are read-only: rename/duplicate/delete go inert. Download
   *  and selection stay live — neither mutates the workspace. */
  isReadOnly?: boolean;
}

export function DocumentsList({
  lang,
  documents,
  selectedId,
  onSelect,
  sortKey,
  sortDir,
  onSort,
  colWidths,
  onResize,
  onRename,
  onDuplicate,
  onDelete,
  onDownload,
  onOpenHistory,
  isReadOnly,
}: DocumentsListProps) {
  if (documents.length === 0) {
    return <EmptyState title={t(lang, "documentsNoneYet")} />;
  }

  return (
    <div className="overflow-auto rounded-md border border-line">
      <DataTable
        tbodyClassName="divide-y divide-line"
        head={
          <tr>
            <SortResizeTh
              label={t(lang, "documentsTitleLabel")}
              sortCol="title"
              width={colWidths.title}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              onResize={onResize}
            />
            <SortResizeTh
              label={t(lang, "documentsBlockCount")}
              sortCol="blocks"
              width={colWidths.blocks}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              onResize={onResize}
              align="right"
            />
            <SortResizeTh
              label={t(lang, "documentsUpdated")}
              sortCol="updated"
              width={colWidths.updated}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              onResize={onResize}
            />
            {/* Non-sortable, non-resizable — a raw <th> with no handle, per the
                convention for header cells with nothing to sort. The label is
                sr-only because the column shows only icon-free action buttons
                whose own names already say what they do.
                ★ Its OWN key. It read `documentsNew` ("New document"), so a
                screen-reader user heard the column of Download/Rename/
                Duplicate/Delete controls announced as "New document" — axe
                passes it (a name exists), the name was simply wrong. That key
                also doubles as the default document TITLE, so sharing it here
                coupled two unrelated strings. */}
            <th className="px-3 py-2 font-medium">
              <span className="sr-only">{t(lang, "documentsActions")}</span>
            </th>
          </tr>
        }
      >
        {documents.map((doc) => (
          <tr key={doc.id} className={doc.id === selectedId ? "bg-surface-muted" : undefined}>
            <td className="px-3 py-2 font-medium text-foreground">
              {/* Selection rides a real button so it is keyboard-operable; the
                  document's own title is the accessible name, which is
                  row-unique by construction. `aria-current` marks the selected
                  one — this is "the current item in a set", not a toggle, so it
                  is not aria-pressed. */}
              <button
                type="button"
                onClick={() => onSelect(doc.id)}
                aria-current={doc.id === selectedId ? "true" : undefined}
                className={`text-left underline-offset-2 hover:underline ${INTERACTIVE}`}
              >
                {doc.title}
              </button>
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
              {doc.blocks.length}
            </td>
            <td className="px-3 py-2 tabular-nums text-muted-foreground">
              {/* ISO prefix: locale-free, deterministic, and lexically sortable
                  by the same string the orchestrator compares. */}
              {doc.updatedAt.slice(0, 10)}
            </td>
            <td className="px-3 py-2">
              {/* ★★ Every per-row control carries a ROW-UNIQUE accessible name.
                  N identical "Delete" labels is a WCAG 2.4.6 failure that the
                  axe gate can PASS when the live app seeds only one row — the
                  collision never renders at scan time. Do not shorten these. */}
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onDownload(doc)}
                  aria-label={`${t(lang, "documentsDownload")} – ${doc.title}`}
                >
                  {t(lang, "documentsDownload")}
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onOpenHistory(doc)}
                  aria-label={`${t(lang, "documentsHistory")} – ${doc.title}`}
                >
                  {t(lang, "documentsHistory")}
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onRename(doc)}
                  disabled={isReadOnly}
                  aria-label={`${t(lang, "documentsRename")} – ${doc.title}`}
                >
                  {t(lang, "documentsRename")}
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onDuplicate(doc)}
                  disabled={isReadOnly}
                  aria-label={`${t(lang, "documentsDuplicate")} – ${doc.title}`}
                >
                  {t(lang, "documentsDuplicate")}
                </Button>
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={() => onDelete(doc)}
                  disabled={isReadOnly}
                  aria-label={`${t(lang, "documentsDelete")} – ${doc.title}`}
                >
                  {t(lang, "documentsDelete")}
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
