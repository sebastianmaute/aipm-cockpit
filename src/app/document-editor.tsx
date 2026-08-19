// Edit-mode orchestrator: one row per block, a gutter carrying the kind chip,
// and the per-kind editor.
//
// ★★ IN SCOPE IS BLOCK *CONTENT*; the SET of blocks is not. So there is NO drag
//  handle and no add/remove-block control — a handle that does nothing is worse
//  than no handle. That is the structural slice.
import { useState } from "react";
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
import { sanitizeDocumentHtml, plainToHtml } from "./sanitize-html";

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
  /** ★ The third argument is the committing draft's baseline — the engine's
   *   `expect` precondition. See `replaceBlockOp` in document-editor-commit.ts. */
  onCommitBlock: (index: number, block: DocBlock, expect?: DocBlock) => void;
  /** Appends a block. Reached only from the zero-block empty state: the block
   *  SET is otherwise out of scope for this slice (see this file's header).
   *  ★ Optional so the many pre-existing non-empty-document fixtures in this
   *   file's own tests never have to thread a value that branch never calls. */
  onAppendBlock?: (block: DocBlock) => void;
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

export function DocumentEditor({
  lang,
  doc,
  onCommitBlock,
  onAppendBlock,
  narrow = false,
}: DocumentEditorProps) {
  // ★★★ THE DOCK. A callback ref held in STATE, not a `useRef`: the portal
  //  target must exist before the child renders into it, and mutating a ref
  //  object triggers no re-render (nor may a ref be READ during render at all
  //  — react-hooks/refs is fatal in CI). The state assignment on mount gives
  //  the second render a real element to portal into.
  const [dock, setDock] = useState<HTMLElement | null>(null);

  // ★★★ SELECTION, not "the first paragraph". The previous cut collapsed every
  //  paragraph but `doc.blocks.findIndex(b => b.type === "paragraph")` with no
  //  stated reason and no way in — and, because that index had no image test, a
  //  first paragraph holding an image (which ParagraphBlockEditor renders
  //  read-only) left the document with NO editable paragraph anywhere. The
  //  spec asks for "the toolbar docks once above the document and acts on the
  //  SELECTED block"; selection is what makes every paragraph reachable and
  //  what makes the image case a non-event.
  //  ★ `null` means "not chosen yet" and resolves to the first paragraph, so a
  //   document whose blocks change under a selection cannot strand it. The
  //   type re-check is what handles a chosen index that stops being a
  //   paragraph (or leaves the document): it falls back rather than docking a
  //   toolbar onto a block that has none.
  const [chosen, setChosen] = useState<number | null>(null);
  const firstParagraph = doc.blocks.findIndex((b) => b.type === "paragraph");
  const selected =
    chosen !== null && doc.blocks[chosen]?.type === "paragraph" ? chosen : firstParagraph;

  return (
    <div className="flex flex-col gap-3">
      {/* ★★ ABOVE the block list in DOM order, which is both what the design
          spec asks for and what keeps the portal from breaking Tab: the
          recorded failure mode (portaling a menu BREAKS Tab) is content moved
          BELOW its logical position. Tab reads dock → blocks, and a test pins
          that order.
          ★ Rendered only at a narrow pane, and ALWAYS when narrow — an empty
          dock is a stable 0-height box, whereas mounting it conditionally on a
          paragraph existing would move every row the moment one is added. */}
      {narrow && <div ref={setDock} className="sticky top-0 z-10 bg-surface" />}
      {doc.blocks.length === 0 && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-line p-3">
          <p className="text-sm text-muted-foreground">{t(lang, "documentsNoBlocks")}</p>
          {/* ★★★ THE SEED IS NOT EMPTY. document-model.ts drops a paragraph
              whose visible text length is 0, so an empty seed would create a
              block that renders now and is GONE on the next load — the exact
              failure this round's "never commit a block the loader discards"
              task exists to prevent. The user replaces the placeholder.
              ★ `plainToHtml`, not `sanitizeRichText`: the input is a
              compile-time i18n literal, so it is provably plain by
              construction — the same justification the other remaining
              `plainToHtml(` call sites carry. Do NOT copy this to a boundary
              whose input could already be HTML; there the escape corrupts it
              permanently.
              ★ No `aria-label`: the visible text IS the accessible name, so
              WCAG 2.5.3 holds by construction and there is nothing to keep in
              step. This control renders once, so it needs no block qualifier. */}
          <button
            type="button"
            className="rounded-md border border-line px-2 py-1 text-xs"
            onClick={() =>
              onAppendBlock?.({ type: "paragraph", html: plainToHtml(t(lang, "documentsNewBlockText")) })
            }
          >
            {t(lang, "documentsAddBlock")}
          </button>
        </div>
      )}
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
        <div
          key={`${doc.id}-${index}`}
          data-block-row=""
          className="flex gap-2 rounded-md border border-line p-2"
        >
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
              collapseParagraph={narrow && index !== selected}
              onSelect={() => setChosen(index)}
              toolbarContainer={narrow && index === selected ? dock : null}
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
  onSelect,
  toolbarContainer,
}: {
  lang: Lang;
  index: number;
  block: DocBlock;
  onCommit: (index: number, block: DocBlock, expect?: DocBlock) => void;
  collapseParagraph: boolean;
  /** Makes THIS block the selected one. Only the collapsed paragraph branch
   *  wires it up — every other case ignores it. */
  onSelect: () => void;
  /** Where the selected paragraph docks its toolbar; null at a wide pane and
   *  for every block that is not the selected paragraph. */
  toolbarContainer: HTMLElement | null;
  // ★ Explicit non-optional return type is load-bearing for exhaustiveness:
  //  with no declared type an unhandled case would fall through and TS infers
  //  `ReactElement | undefined`, and `undefined` is itself a valid ReactNode
  //  — silent, not an error. `ReactElement` (unlike `ReactNode`) excludes
  //  `undefined`, so a missing case's implicit fall-through is a real
  //  TS2366 ("not all code paths return a value").
}): ReactElement {
  switch (block.type) {
    case "paragraph":
      return collapseParagraph ? (
        <div className="flex flex-col gap-2">
          {/* ★★★ Re-sanitize AT THE SINK (`sanitizeDocumentHtml`, never
              `sanitizeRichHtml` — it drops `<img>`) — mirrors
              `BlockReadOnlyNotice` in document-block-editors.tsx. This branch
              reaches `dangerouslySetInnerHTML` with STORED html; an earlier
              layer regressing must not turn this collapsed view into a
              stored-XSS sink. */}
          <div
            className="prose-sm max-w-none text-foreground"
            dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(block.html) }}
          />
          <p className="text-xs text-muted-foreground">
            {t(lang, "documentsBlockCollapsedNarrow")}
          </p>
          {/* ★★ The reason AND the way out. A read-only render with neither is
              the "disabled control with no reason reads as broken" defect this
              slice states for the image case — and before selection existed
              there was no way back into these paragraphs at all.
              ★ BLOCK-UNIQUE accessible name via the en-dash `documentsBlockN`
              convention: N buttons named "Edit this block" is a WCAG 2.4.6
              failure no axe rule under the gate's four tags can see, at any
              seed size. The VISIBLE label stays unqualified and is CONTAINED
              in the accessible name, so WCAG 2.5.3 holds too. */}
          <button
            type="button"
            aria-label={`${t(lang, "documentsBlockSelect")} – ${t(lang, "documentsBlockN", String(index + 1))}`}
            className="w-fit rounded-md border border-line px-2 py-1 text-xs"
            onClick={onSelect}
          >
            {t(lang, "documentsBlockSelect")}
          </button>
        </div>
      ) : (
        <ParagraphBlockEditor
          lang={lang}
          index={index}
          block={block}
          onCommit={onCommit}
          toolbarContainer={toolbarContainer}
        />
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
