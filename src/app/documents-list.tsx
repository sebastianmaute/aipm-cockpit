"use client";

// src/app/documents-list.tsx — the Documents pane's row table.
//
// PURE presentational (the gantt split): rows arrive already sorted, and every
// handler is a prop. It owns no state, reads no context.

import { useMemo, type Ref } from "react";
import { type Lang, t } from "./i18n";
import type { ProjectDocument } from "./document-model";
import { DataTable } from "./data-table";
import { EmptyState } from "./empty-state";
import { Button } from "./button";
import { type SortDir, SortResizeTh, useSortHeaderProps } from "./report-table";
import { INTERACTIVE } from "./interaction-styles";
import { flashOutlineClass } from "./use-deeplink-row-flash";
import { buildRowTokens, rowLabel } from "./row-tokens";

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
  /** ★★★ THE DEEP-LINK PAIR, and both halves are REQUIRED because either one
   *  alone is a silent no-op. `useDeepLinkRowFlash` scrolls by running
   *  `containerRef.current.querySelector('[data-deeplink-row="<id>"]')`, so a
   *  panel that calls the hook without wiring these gets a query that matches
   *  nothing: no scroll, no outline, and a hook call that reads as if it had
   *  done something. This list is its OWN `overflow-auto` box holding up to
   *  MAX_DOCUMENTS rows, so a deep-linked row really can land below the fold —
   *  the scroll, not the outline, is what this buys here (the arrived-at row
   *  also carries `bg-surface-muted` + `aria-current`, and the pane swaps the
   *  preview). Optional props with a `?? null` fallback would let the next call
   *  site drop one and ship the no-op; required means tsc catches it. */
  flashId: number | null;
  /** Attached to the scroll box. ★ NOT attached on the empty-state branch —
   *  there is no row to find, so the querySelector no-ops either way. */
  containerRef: Ref<HTMLDivElement>;
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
  flashId,
  containerRef,
}: DocumentsListProps) {
  const th = useSortHeaderProps(sortKey, sortDir, onSort, onResize);
  // ★ Derived from `documents` — already sorted/filtered as the orchestrator
  // hands it down, i.e. the order actually rendered — so the occurrence index
  // follows what is on screen.
  const rowTokens = useMemo(
    () => buildRowTokens(documents.map((d) => ({ id: d.id, name: d.title }))),
    [documents],
  );

  if (documents.length === 0) {
    return <EmptyState title={t(lang, "documentsNoneYet")} />;
  }

  return (
    <div ref={containerRef} className="overflow-auto rounded-md border border-line">
      <DataTable
        tbodyClassName="divide-y divide-line"
        head={
          <tr>
            <SortResizeTh
              {...th}
              label={t(lang, "documentsTitleLabel")}
              sortCol="title"
              width={colWidths.title}
            />
            <SortResizeTh
              {...th}
              label={t(lang, "documentsBlockCount")}
              sortCol="blocks"
              width={colWidths.blocks}
              align="right"
            />
            <SortResizeTh
              {...th}
              label={t(lang, "documentsUpdated")}
              sortCol="updated"
              width={colWidths.updated}
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
        {documents.map((doc) => {
          const token = rowTokens.get(doc.id) ?? doc.title;
          return (
          // ★ Same composition as change/milestones/raid/stakeholders rows:
          // the flash outline is ADDITIVE, so a deep-linked row keeps its
          // selected tint underneath rather than swapping one cue for another.
          <tr
            key={doc.id}
            data-deeplink-row={doc.id}
            className={[doc.id === selectedId ? "bg-surface-muted" : "", flashOutlineClass(flashId === doc.id)]
              .filter(Boolean)
              .join(" ")}
          >
            <td className="px-3 py-2 font-medium text-foreground">
              {/* Selection rides a real button so it is keyboard-operable. The
                  name is the DISAMBIGUATED token, not the raw title - titles are
                  NOT unique (uniqueDocumentTitle is bypassed by commitRename and
                  the AI createDocument path). `aria-current` marks the current
                  item in a set, not a toggle, so it is not aria-pressed. */}
              <button
                type="button"
                onClick={() => onSelect(doc.id)}
                aria-current={doc.id === selectedId ? "true" : undefined}
                aria-label={token}
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
                  aria-label={rowLabel(t(lang, "documentsDownload"), token)}
                >
                  {t(lang, "documentsDownload")}
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onOpenHistory(doc)}
                  aria-label={rowLabel(t(lang, "documentsHistory"), token)}
                >
                  {t(lang, "documentsHistory")}
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onRename(doc)}
                  disabled={isReadOnly}
                  aria-label={rowLabel(t(lang, "documentsRename"), token)}
                >
                  {t(lang, "documentsRename")}
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onDuplicate(doc)}
                  disabled={isReadOnly}
                  aria-label={rowLabel(t(lang, "documentsDuplicate"), token)}
                >
                  {t(lang, "documentsDuplicate")}
                </Button>
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={() => onDelete(doc)}
                  disabled={isReadOnly}
                  aria-label={rowLabel(t(lang, "documentsDelete"), token)}
                >
                  {t(lang, "documentsDelete")}
                </Button>
              </div>
            </td>
          </tr>
          );
        })}
      </DataTable>
    </div>
  );
}
