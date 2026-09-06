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
import { AddFirstItemButton } from "./add-first-item-button";
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
  /** The id of the document actually OPEN — `documents-panel.tsx` passes
   *  `selected?.id`, which falls back to `selectionPool[0]`. Deliberately NOT
   *  named `selectedId`: the panel's own `selectedId` STATE can be null while a
   *  document is open, and a ★★★ warning there forbids comparing against it. */
  openDocumentId: number | null;
  /** Whether the OPEN document's body is collapsed. Drives `aria-expanded` on
   *  that one row's title button; every other row is not a disclosure and
   *  carries no `aria-expanded` at all. */
  collapsed?: boolean;
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
  /** Offered ONLY for a truly-empty register. ★★★ The orchestrator decides:
   *  this component receives `visibleRows`, which is FILTERED, so its own
   *  `documents.length === 0` is also true for a filtered-empty list — and
   *  `AddFirstItemButton` is contractually never rendered filtered-empty.
   *  Omit to render the passive message; NEVER pass a no-op, which would draw
   *  a box that looks clickable and does nothing.
   *  ★★ THE FILTERED REASON IS NOT THE ONLY ONE — read-only is the other, and
   *  this prop does NOT encode it. The panel omits `onCreate` when read-only,
   *  but the render below ALSO checks `isReadOnly` directly rather than
   *  trusting that: every other control on this surface self-guards on it
   *  (rename/duplicate/delete), and a create box that guarded only at the one
   *  call site would silently become live the day a second call site appears. */
  onCreate?: () => void;
}

export function DocumentsList({
  lang,
  documents,
  openDocumentId,
  collapsed = false,
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
  onCreate,
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
    if (!onCreate || isReadOnly) return <EmptyState title={t(lang, "documentsNoneYet")} />;
    return (
      <AddFirstItemButton
        onAdd={onCreate}
        text={t(lang, "documentsNoneYet")}
        addLabel={`+ ${t(lang, "documentsCreateFirst")}…`}
        ariaLabel={t(lang, "documentsCreateFirst")}
        rounded="xl"
      />
    );
  }

  return (
    // ★★★ `shrink-0` IS LOAD-BEARING AND IS NOT COSMETIC. This box and the
    // preview's are both `overflow-auto` children of the pane's fixed-height
    // flex column, and `overflow` other than `visible` makes `min-height: auto`
    // resolve to 0 — so both are crushable to nothing, and flex distributes the
    // shrink in PROPORTION to content height, leaving each the same FRACTION of
    // itself — so whatever fraction survives, a tall preview stays usable at it
    // and a short list does not: the fewer documents there were, the worse it
    // got. Without `shrink-0` that returns, and no unit test can see it — jsdom
    // has no layout engine.
    // ★★ `max-h-80` (20rem) is the other half: uncrushable ALONE would let a
    // large register push the preview off screen. ★ The sticky header lives
    // INSIDE the capped box, so the usable row budget is the cap MINUS the
    // header, not the cap — `e2e/documents-list-geometry.spec.ts` computes it
    // against the live row height rather than trusting a figure written here.
    // Past the cap `overflow-auto` scrolls the list internally. All three
    // classes are pinned in `documents-panel.test.tsx`; drop any one and the
    // behaviour breaks in a different direction.
    <div ref={containerRef} className="max-h-80 shrink-0 overflow-auto rounded-md border border-line">
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
            className={[doc.id === openDocumentId ? "bg-surface-muted" : "", flashOutlineClass(flashId === doc.id)]
              .filter(Boolean)
              .join(" ")}
          >
            <td className="px-3 py-2 font-medium text-foreground">
              {/* Selection rides a real button so it is keyboard-operable. The
                  name is the DISAMBIGUATED token, not the raw title - titles are
                  NOT unique (uniqueDocumentTitle is bypassed by commitRename and
                  the AI createDocument path).
                  `aria-current` marks the current item in the set; `aria-expanded`
                  marks the same row as a disclosure, because clicking an
                  already-open document's name now collapses its body. Both are
                  correct together and neither replaces the other — a row that is
                  not open carries `aria-expanded` NOT AT ALL rather than "false",
                  which would announce every closed row as a collapsed section.
                  Superseded the earlier "not a toggle" note, which described the
                  behaviour before the collapse landed. */}
              {/* ★★ THE GLYPH RENDERS ON EXACTLY THE ROW THAT CARRIES
                  `aria-expanded`, under the same condition, so the visible cue
                  and the announced one cannot disagree. Drawing it on every row
                  would tell a sighted user that every row is a disclosure —
                  which is precisely the semantics the `undefined` above takes
                  care to avoid. Without it `aria-expanded` is the ONLY signal
                  the collapse gesture exists, and a mouse user cannot perceive
                  it.
                  ★ `aria-hidden` because `aria-expanded` already carries the
                  state for AT. It also cannot alter the accessible name here —
                  `aria-label` wins over content — which is what keeps the
                  row-unique naming (2.4.6) and containment (2.5.3) intact.
                  ★ Same two characters as the `dashboard-shelf.tsx` toggle,
                  which is the family this follows; there is no shared
                  Disclosure primitive in this repo to reach for. */}
              <button
                type="button"
                onClick={() => onSelect(doc.id)}
                aria-current={doc.id === openDocumentId ? "true" : undefined}
                aria-expanded={doc.id === openDocumentId ? !collapsed : undefined}
                aria-label={token}
                className={`text-left underline-offset-2 hover:underline ${INTERACTIVE}`}
              >
                {doc.id === openDocumentId ? (
                  <span aria-hidden className="mr-1 text-muted-foreground">{collapsed ? "▸" : "▾"}</span>
                ) : null}
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
