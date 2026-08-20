// Edit-mode orchestrator: one row per block, a gutter carrying the kind chip,
// the reorder grip and the actions menu, and the per-kind editor.
//
// ★★ THE BLOCK *SET* IS NOW IN SCOPE. S3b deliberately shipped no drag handle
//  and no add/remove control ("a handle that does nothing is worse than no
//  handle"); this is the structural slice that gives them something to do.
//  Everything here routes through `structural`, whose three ops are the only
//  way the set changes by hand.
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
import { t, type Lang } from "./i18n";
import type { DocBlock, ProjectDocument } from "./document-model";
import type { BlockStructuralOps } from "./use-document-editor";
import { useListReorderDnd } from "./use-list-reorder-dnd";
import { DocumentBlockGutter, BlockKindMenu } from "./document-block-gutter";
import { blockSeed, type AddableBlockType } from "./document-block-seeds";
import { blockIsTrivial } from "./document-editor-commit";
import { useConfirm } from "./confirm-dialog";
import { sanitizeDocumentHtml } from "./sanitize-html";
import { Button } from "./button";

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
  /** Appends a block. Reached only from the zero-block empty state, where
   *  `structural.insert(0, …)` would be exactly equivalent — the append op
   *  carries no index at all, so it is the spelling that cannot be off by one
   *  on a list that has no positions yet.
   *  ★ Optional so the many pre-existing non-empty-document fixtures in this
   *   file's own tests never have to thread a value that branch never calls. */
  onAppendBlock?: (block: DocBlock) => void;
  /** Add / delete / reorder.
   *  ★★★ REQUIRED, and it used to be optional. Optional means a future wiring
   *   regression that drops the prop silently removes every structural control
   *   — the grip stops reordering, the actions menu stops inserting and
   *   deleting — with NOTHING failing: the controls still render, they just
   *   call an absent handler. The type is the only thing that can catch that,
   *   because a hook that quietly does nothing tests exactly like one whose
   *   list happens not to move (the same reasoning `useListReorderDnd`'s own
   *   `onReorder`/`onMove` union carries). */
  structural: BlockStructuralOps;
  /** Injected. ★ jsdom has no layout, so a measured width would be untestable. */
  narrow?: boolean;
};

export function DocumentEditor({
  lang,
  doc,
  onCommitBlock,
  onAppendBlock,
  structural,
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

  const confirm = useConfirm();

  // ★★ INDEX-AS-ID, with no `blockId` added to the model. `DocBlock` is a
  //  positional array — every op in document-ops.ts addresses a block by index
  //  — and the hook is generic over `Id`, controlled (it never owns the list)
  //  and reads `ids` fresh on every render, so one gesture resolves against one
  //  snapshot and identity WITHIN that snapshot is all `reorderIds` needs.
  //  ★ It also means the row keys and the reorder ids are the same numbers, so
  //   a reorder re-renders the rows IN PLACE rather than remounting them —
  //   which is what keeps the dragged grip mounted long enough to receive its
  //   own `dragend`.
  const reorder = useListReorderDnd<number>({
    ids: doc.blocks.map((_, i) => i),
    // ★ `useListReorderDnd` hands `onMove` the dragged and target IDS, which
    //  here ARE the from/to indices — and its `reorderIds` splice (remove at
    //  `from`, insert at the target's pre-removal index) is the same arithmetic
    //  `applyOps`' `move` arm performs, so the pair needs no translation.
    //  ★★ The third argument is the engine's `expect` precondition: the block
    //   the user actually picked up. A concurrent write that shifts indices
    //   then makes the move REFUSE rather than reorder a block nobody pointed
    //   at. See `moveBlockOp` in document-editor-commit.ts.
    //  ★★★ AND NO `reorder.endDrag()` HERE, which is the opposite of what this
    //   slice was specified to do — the reasoning it was specified WITH is
    //   false in both halves. (a) The hook's own `onDrop` already calls
    //   `endDrag()` immediately after `commit`, in the same event, so the drop
    //   path self-resets; the arrow-key path never sets `dragId` at all, so
    //   there is nothing there to reset either. (b) The premise that "index
    //   keys make a move remount every row from the lower index down" is
    //   backwards: an index-keyed list is precisely the case React reconciles
    //   IN PLACE, since the key SET is unchanged — so the grip is never
    //   detached and its `dragend` always lands.
    //  ★★ MEASURED, not reasoned, because the hook's own docstring makes the
    //   opposite case forcefully for consumers whose drop UNMOUNTS the dragged
    //   item (and it is right about those). Deleting `endDrag()` from the
    //   HOOK's `onDrop` turns the "does not reorder on a drop when no drag is
    //   in flight" test RED; adding `reorder.endDrag()` here on top of that
    //   turns it GREEN again. So the call is a working substitute for a reset
    //   this consumer already gets — an equivalent mutant, and a redundant
    //   call carrying a false justification is worse than none. The TEST is
    //   what guards the property; if this ever grows a drop that removes a
    //   block, add the call and that test will still be the thing watching it.
    onMove: (from, to) => structural.move(from, to, doc.blocks[from]),
  });

  const insertSeeded = (at: number, type: AddableBlockType) =>
    structural.insert(at, blockSeed(lang, type));

  const deleteBlock = async (index: number) => {
    const block = doc.blocks[index];
    if (!block) return;
    // ★ The seed for THIS block's kind. `blockIsTrivial` is i18n-free by
    //  contract and so takes the seed rather than computing it — a page break,
    //  or a block still holding its untouched placeholder, is nothing to lose.
    //  Everything else is content, recoverable only by restoring an earlier
    //  version of the WHOLE document and discarding every edit since.
    if (!blockIsTrivial(block, blockSeed(lang, block.type))) {
      const ok = await confirm({
        title: t(lang, "documentsBlockDelete"),
        message: t(lang, "documentsBlockDeleteConfirm"),
        confirmLabel: t(lang, "documentsBlockDelete"),
      });
      if (!ok) return;
    }
    // ★ `block` is the baseline the engine's `expect` precondition checks — the
    //  row the user pointed at. The same shift that merely misplaces an insert
    //  would make this delete the wrong block.
    structural.remove(index, block);
  };

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
          {/* ★★★ EVERY SEED IS NON-EMPTY, and that is `document-block-seeds.ts`'s
              whole reason for existing: document-model.ts drops an empty
              heading, a paragraph with no visible text and a bullets list with
              no non-empty item, so an empty seed would create a block that
              renders now and is GONE on the next load.
              ★★ THE SAME `BlockKindMenu` AS THE TRAILING CONTROL, over the same
              `BlockKindList` — one kind list in the app, so the empty state and
              a populated document can never offer different kinds. It replaced
              a paragraph-only button, which made starting a document with a
              heading a two-step job.
              ★ It routes through `onAppendBlock` rather than
              `structural.insert(0, …)`. The two are equivalent on an empty list
              and the append op carries no index at all, so it is the spelling
              that cannot be off by one. Both omit `coalesce`, so both write a
              before-image (see `use-document-editor.ts`).
              ★ MUTUALLY EXCLUSIVE with the trailing control below — two
              triggers named "Add a block" in one document would be a WCAG 2.4.6
              failure that no axe rule under the gate's four tags can see. */}
          <BlockKindMenu
            lang={lang}
            triggerLabel={t(lang, "documentsAddBlock")}
            onPick={(type) => onAppendBlock?.(blockSeed(lang, type))}
          />
        </div>
      )}
      {/* ★★★ ONCE, not per row. `documentsBlockReorderHint` was added intending
          a `title` on the grip, and it sat UNUSED in both dictionaries because
          `DragHandle` forwards no `title`. A `title` would have been the wrong
          home regardless: it is hover-only, so it never reaches the keyboard
          user who is the only one who needs to be told the arrow keys work, and
          it is unreachable on touch — where native HTML5 drag does not fire at
          all, making the arrow keys the ONLY reorder path.
          ★ Gated on TWO blocks: with one there is nowhere to move it, and a
          hint about an impossible gesture is noise. */}
      {doc.blocks.length > 1 && (
        <p className="text-xs text-muted-foreground">{t(lang, "documentsBlockReorderHint")}</p>
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
          // ★ The DROP TARGET is the whole row, not the grip: a drag has to be
          //  releasable over the block you can see, and a 24px grip is a target
          //  nobody can hit. `itemProps` is the only thing spread here, so it
          //  cannot collide with the row's own handlers (it has none).
          {...reorder.itemProps(index)}
        >
          <DocumentBlockGutter
            lang={lang}
            index={index}
            block={block}
            onInsert={insertSeeded}
            onDelete={deleteBlock}
            handleProps={reorder.handleProps(index)}
          />
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
      {/* ★★ AFTER the rows in DOM order, which is where "append" belongs and
          what keeps it in the natural Tab sequence: a reader tabbing through
          the document reaches it having passed every block, not before the
          first one.
          ★ Only when the document HAS blocks — the empty state renders its own
          trigger under the same label, and both must never be on screen at
          once (see there). */}
      {doc.blocks.length > 0 && (
        <BlockKindMenu
          lang={lang}
          triggerLabel={t(lang, "documentsAddBlock")}
          onPick={(type) => insertSeeded(doc.blocks.length, type)}
        />
      )}
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
          <Button
            variant="secondary"
            size="xs"
            aria-label={`${t(lang, "documentsBlockSelect")} – ${t(lang, "documentsBlockN", String(index + 1))}`}
            className="w-fit"
            onClick={onSelect}
          >
            {t(lang, "documentsBlockSelect")}
          </Button>
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
