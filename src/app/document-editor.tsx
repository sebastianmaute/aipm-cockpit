// Edit-mode orchestrator: one row per block, a gutter carrying the kind chip,
// and the per-kind editor.
//
// ★★ IN SCOPE IS BLOCK *CONTENT*; the SET of blocks is not. So there is NO drag
//  handle and no add/remove-block control — a handle that does nothing is worse
//  than no handle. That is the structural slice.
import {
  ParagraphBlockEditor,
  HeadingBlockEditor,
  BulletsBlockEditor,
  TableBlockEditor,
  DataSectionBlockEditor,
  PageBreakBlockEditor,
} from "./document-block-editors";
import type { ReactElement } from "react";
import { t, type Lang, type TranslationKey } from "./i18n";
import type { DocBlock, ProjectDocument } from "./document-model";
import { sanitizeDocumentHtml } from "./sanitize-html";

/** Pane width, in px, at or below which the toolbar docks once instead of
 *  rendering per block.
 *  ★ PANE width, not device width — the pane is user-resizable and has a
 *   popout path, so a desktop user reaches this by dragging. Measured by
 *   `use-narrow-element.ts` (a ResizeObserver over the pane element) and
 *   passed down as `narrow`; this component never measures anything itself.
 *  ★★ It used to be a `matchMedia` string consumed by `use-media-query.ts`,
 *   which reads the VIEWPORT — so the "reaches this by dragging" claim above
 *   was false for the whole S3b slice. */
export const NARROW_PANE_PX = 640;

export type DocumentEditorProps = {
  lang: Lang;
  doc: ProjectDocument;
  onCommitBlock: (index: number, block: DocBlock) => void;
  /** Injected. ★ jsdom has no layout, so a measured width would be untestable. */
  narrow?: boolean;
};

const KIND_LABEL: Record<DocBlock["type"], TranslationKey> = {
  paragraph: "documentsBlockParagraph",
  heading: "documentsBlockHeading",
  bullets: "documentsBlockBullets",
  table: "documentsBlockTable",
  dataSection: "documentsBlockDataSection",
  pageBreak: "documentsBlockPageBreak",
};

export function DocumentEditor({ lang, doc, onCommitBlock, narrow = false }: DocumentEditorProps) {
  // ★ At a narrow pane only ONE paragraph in the whole document mounts a rich
  //  editor (with its own toolbar) — every other paragraph collapses to a
  //  read-only render. This is a document-wide index (the FIRST paragraph
  //  block, by position), not a per-row toggle, which is why it is computed
  //  once here and threaded down rather than compared against a block's own
  //  index — comparing against the block's own index would collapse a
  //  document whose only paragraph is not literally the first block (e.g.
  //  one led by a heading), leaving NO toolbar docked anywhere.
  const firstParagraphIndex = narrow ? doc.blocks.findIndex((b) => b.type === "paragraph") : -1;

  return (
    <div className="flex flex-col gap-3">
      {doc.blocks.map((block, index) => (
        // ★★★ The key carries `doc.id`, not just `index` — otherwise switching
        //  the SELECTED document while edit mode is open lets React reuse this
        //  row's editor instance for the new document (same position, same
        //  block type), leaving a stale useBlockDraft mounted over the wrong
        //  document. A blur (or an unblurred edit's unmount flush) then writes
        //  the OLD document's content into the NEW one. Composing the doc id
        //  into every row's key forces a full remount of the block-editor
        //  subtree on any switch, so no draft can outlive the document it was
        //  seeded from.
        <div key={`${doc.id}-${index}`} className="flex gap-2 rounded-md border border-line p-2">
          <div className="shrink-0">
            <span className="rounded-md bg-surface-muted px-2 py-1 text-xs text-muted-foreground">
              {t(lang, KIND_LABEL[block.type])}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <BlockEditor
              lang={lang}
              index={index}
              block={block}
              onCommit={onCommitBlock}
              collapseParagraph={narrow && index !== firstParagraphIndex}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function BlockEditor({
  lang,
  index,
  block,
  onCommit,
  collapseParagraph,
}: {
  lang: Lang;
  index: number;
  block: DocBlock;
  onCommit: (index: number, block: DocBlock) => void;
  collapseParagraph: boolean;
  // ★ Explicit non-optional return type is load-bearing for exhaustiveness:
  //  with no declared type an unhandled case would fall through and TS infers
  //  `ReactElement | undefined`, and `undefined` is itself a valid ReactNode
  //  — silent, not an error. `ReactElement` (unlike `ReactNode`) excludes
  //  `undefined`, so a missing case's implicit fall-through is a real
  //  TS2366 ("not all code paths return a value").
}): ReactElement {
  switch (block.type) {
    case "paragraph":
      // ★★★ Re-sanitize AT THE SINK (`sanitizeDocumentHtml`, never `sanitizeRichHtml` —
      //  it drops `<img>`) — mirrors `BlockReadOnlyNotice` in document-block-editors.tsx.
      //  This branch reaches `dangerouslySetInnerHTML` with STORED html; an earlier
      //  layer regressing must not turn this collapsed view into a stored-XSS sink.
      return collapseParagraph ? (
        <div
          className="prose-sm max-w-none text-foreground"
          dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(block.html) }}
        />
      ) : (
        <ParagraphBlockEditor lang={lang} index={index} block={block} onCommit={onCommit} />
      );
    case "heading":
      return <HeadingBlockEditor lang={lang} index={index} block={block} onCommit={onCommit} />;
    case "bullets":
      return <BulletsBlockEditor lang={lang} index={index} block={block} onCommit={onCommit} />;
    case "table":
      return <TableBlockEditor lang={lang} index={index} block={block} onCommit={onCommit} />;
    case "dataSection":
      return <DataSectionBlockEditor lang={lang} index={index} block={block} onCommit={onCommit} />;
    case "pageBreak":
      return <PageBreakBlockEditor lang={lang} index={index} block={block} onCommit={onCommit} />;
  }
}
