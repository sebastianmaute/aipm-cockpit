// Edit-mode orchestrator: one row per block, a gutter carrying the kind chip,
// the reorder grip and the actions menu, and the per-kind editor.
//
// ★★ THE BLOCK *SET* IS NOW IN SCOPE. S3b deliberately shipped no drag handle
//  and no add/remove control ("a handle that does nothing is worse than no
//  handle"); this is the structural slice that gives them something to do.
//  Everything here routes through `structural`, whose three ops are the only
//  way the set changes by hand.
import { useEffect, useId, useRef, useState } from "react";
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
import {
  selectionAfterMove,
  selectionAfterInsert,
  selectionAfterDelete,
} from "./document-block-selection";
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
  /** Add / delete / reorder.
   *  ★★★ REQUIRED, and it used to be optional. Optional means a future wiring
   *   regression that drops the prop silently removes every structural control
   *   — the grip stops reordering, the actions menu stops inserting and
   *   deleting — with NOTHING failing: the controls still render, they just
   *   call an absent handler. The type is the only thing that can catch that,
   *   because a hook that quietly does nothing tests exactly like one whose
   *   list happens not to move (the same reasoning `useListReorderDnd`'s own
   *   `onReorder`/`onMove` union carries).
   *  ★★★ IT IS ALSO THE ONLY WAY A BLOCK IS ADDED, INCLUDING THE FIRST ONE.
   *   The empty state used to route through a SEPARATE optional
   *   `onAppendBlock` prop — the exact hazard the paragraph above exists to
   *   prevent, one prop away: the empty state is the only path into a
   *   zero-block document, so dropping that one line would have left an empty
   *   document permanently uneditable with its controls still rendering, and
   *   no type error to say so. `structural.insert(0, …)` is equivalent on a
   *   list with no positions, and the append op it replaced is now reachable
   *   only from the AI document tools. */
  structural: BlockStructuralOps;
  /** Injected. ★ jsdom has no layout, so a measured width would be untestable. */
  narrow?: boolean;
};

export function DocumentEditor({
  lang,
  doc,
  onCommitBlock,
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
  //  ★★★ THAT FALLBACK IS NOT ENOUGH ON ITS OWN, AND THE MISSING HALF WAS A
  //   REAL BUG. `chosen` is a bare INDEX, so a structural op moves the blocks
  //   out from under it — and in a document OF PARAGRAPHS the stale index is
  //   still a paragraph, so the type re-check never fires and a DIFFERENT
  //   block is silently adopted. Traced on [A, B]: select B, ArrowUp on its
  //   grip → move(1, 0) → [B, A] with `chosen` still 1, so A expands and B —
  //   the block the user selected and just moved — collapses read-only.
  //   Every op below therefore carries the selection through the SAME index
  //   arithmetic the op itself performs (`document-block-selection.ts`), and
  //   only when the engine says the op LANDED.
  const [chosen, setChosen] = useState<number | null>(null);
  const firstParagraph = doc.blocks.findIndex((b) => b.type === "paragraph");
  const selected =
    chosen !== null && doc.blocks[chosen]?.type === "paragraph" ? chosen : firstParagraph;

  // ★ `useId`, not a module constant: two editors could in principle mount at
  //  once (a popout beside the main window), and two `<p>` nodes sharing one
  //  id makes every describedby on this surface resolve to whichever the
  //  browser found first.
  const hintId = useId();
  // ★★ ONE source for "is the hint on screen": the `<p>` and the id handed to
  //  every grip must never disagree, or a describedby points at nothing.
  const hintShown = doc.blocks.length > 1;

  const confirm = useConfirm();

  // ★★★ FOCUS FOLLOWS THE MOVED BLOCK, and without it the arrow keys TOGGLE
  //  instead of moving. The rows are index-keyed (see below), so a move leaves
  //  the key SET unchanged and React reconciles IN PLACE — the focused grip
  //  therefore still belongs to row `from`, which now holds the block that was
  //  displaced. Traced on [A,B,C] with focus on row 0: ArrowDown gives
  //  [B,A,C], a second ArrowDown gives [A,B,C] back, so no block could ever
  //  move more than ONE position by keyboard. Native HTML5 drag does not fire
  //  on touch at all, so per this component's own reorder hint the arrow keys
  //  are the ONLY reorder path a keyboard or touch user has.
  //  ★★ A REF PLUS AN EFFECT, not a `focus()` in the handler: the row the grip
  //   must land on does not exist until the parent has re-rendered in the new
  //   order, and this component is controlled — it owns no blocks and cannot
  //   produce that render itself. (`react-hooks/refs` also bans reading a ref
  //   during render, so the read has to be in an effect regardless.)
  //  ★ NO DEP ARRAY: the effect must fire on whichever render finally carries
  //   the new order, and nothing in scope names that render. A parent that
  //   never re-renders — a static test fixture — simply leaves the request
  //   pending rather than focusing a row that did not move.
  //  ★★★ A REFUSED MOVE IS NOT THAT CASE, AND THIS COMMENT USED TO SAY IT WAS.
  //   It read "a static test fixture, or a refused move", and argued from that
  //   to leaving the request UNGATED because gating "would buy nothing". The
  //   real parent re-renders on a refusal too: `documents-panel.tsx`'s
  //   `mutate` opens with `clearRestoreRejected()` → `setRestoreRejected([])`
  //   on EVERY call, a fresh array literal is never `Object.is`-equal to the
  //   current state so React cannot bail, and nothing from `DocumentsPanel`
  //   down to here is memoised — no React.memo on documents-panel.tsx,
  //   document-edit-mode.tsx or this file.
  //   Ungated, a refused move would focus the grip at `to` — a row that did
  //   not move. Hence the `r?.changed` gate below.
  //  ★ That refusal is close to unreachable FROM HERE — `useListReorderDnd`'s
  //   `move` RETURNS EARLY when the target index falls outside the list — it
  //   does NOT clamp — its `commit` returns early on a no-op, and the `expect`
  //   below is read from the latest render — so the gate is cheap insurance
  //   rather than a hot path. `changed` comes off `DocResult`, which
  //   `structural.move` returns.
  //  ★★ BOTH PATHS, not only the keyboard one: `onMove` is shared, so a mouse
  //   DROP moves focus onto the dropped block's grip as well. That is right —
  //   the user just acted on that grip — and it is invisible to a mouse user,
  //   because the grip's ring is `focus-visible:`, never plain `focus:`.
  const listRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<number | null>(null);
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    // ★ Scoped to THIS editor's own subtree, and structural rather than by
    //  accessible name — a name is i18n text, and component code must never
    //  have to know a translation to find its own DOM.
    //  ★★ The grip is the only EXPLICIT `role="button"` in a row: the actions
    //   trigger beside it is a native `<button>`, which carries the role
    //   implicitly and so does not match this selector. A test pins the
    //   focused control's accessible name, which is what would catch that
    //   changing.
    const rows = listRef.current?.querySelectorAll("[data-block-row]");
    rows?.[target]?.querySelector<HTMLElement>('[role="button"]')?.focus();
  });

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
    //  ★★★ The third argument is the engine's `expect` precondition — and what
    //   it is worth HERE is narrower than an earlier revision of this comment
    //   claimed. That text said a concurrent write shifting indices "makes the
    //   move REFUSE rather than reorder a block nobody pointed at", which is
    //   FALSE on both of this consumer's paths: `onMove` runs inside the drop
    //   handler (or the keydown handler) built by the LATEST render, so
    //   `doc.blocks[from]` is the block sitting at that index right now —
    //   exactly what `applyOps` compares it against. The check cannot fail.
    //   The residue it does cover is a write that landed AFTER React's last
    //   commit and before the gesture completed, i.e. a window of about one
    //   frame. Wrapping `onDragStart` to stash the block at dragstart would
    //   widen that to the whole drag; deliberately not done — a drag is
    //   seconds at most and the extra ref is not worth it here.
    //   ★★ It IS load-bearing on the DELETE path below, where `block` is
    //    captured before an `await confirm(...)` that stays open for as long
    //    as the user takes to answer. See `moveBlockOp` / `deleteBlockOp` in
    //    document-editor-commit.ts.
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
    onMove: (from, to) => {
      const r = structural.move(from, to, doc.blocks[from]);
      // ★ ONE `changed` gate for both follow-ups: focus and selection must
      //  agree about whether the move happened, and the moved block lands at
      //  `to` for both of them.
      if (r?.changed) {
        pendingFocusRef.current = to;
        setChosen((c) => selectionAfterMove(c, from, to));
      }
    },
  });

  const insertSeeded = (at: number, type: AddableBlockType) => {
    const r = structural.insert(at, blockSeed(lang, type));
    if (r?.changed) setChosen((c) => selectionAfterInsert(c, at));
  };

  const deleteBlock = async (index: number) => {
    const block = doc.blocks[index];
    if (!block) return;
    // ★ The seed for THIS block's kind. `blockIsTrivial` is i18n-free by
    //  contract and so takes the seed rather than computing it — a page break,
    //  or a block still holding its untouched placeholder, is nothing to lose.
    //  Everything else is content, recoverable only by restoring an earlier
    //  version of the WHOLE document and discarding every edit since.
    //  ★ The seed is built from the CURRENT `lang`, so a placeholder inserted
    //   in German and deleted after switching to English no longer matches its
    //   seed and DOES raise the confirm. That fails SAFE — extra friction on an
    //   untouched placeholder, never a silent delete of real content — so it is
    //   left as is rather than storing the seeding language on the block.
    if (!blockIsTrivial(block, blockSeed(lang, block.type))) {
      const ok = await confirm({
        title: t(lang, "documentsBlockDelete"),
        message: t(lang, "documentsBlockDeleteConfirm"),
        confirmLabel: t(lang, "documentsBlockDelete"),
      });
      if (!ok) return;
    }
    // ★★ `block` is the baseline the engine's `expect` precondition checks, and
    //  what it buys HERE is the `await confirm(...)` window above: `block` is
    //  read before the await, so a write that lands while the prompt is open
    //  makes the engine REFUSE rather than delete whatever slid into `index`.
    //  ★★ It is NOT "the row the user pointed at", which is what this comment
    //   used to claim. `const block = doc.blocks[index]` runs when the MENU
    //   ITEM IS CLICKED, from whichever render is current then — not when the
    //   menu was opened on that row. A concurrent write between those two
    //   moments re-renders the editor, so this handler closes over the NEW
    //   `doc` and `expect` compares the new block against itself. Widening the
    //   capture to menu-OPEN is a design change, deliberately not made here.
    const r = structural.remove(index, block);
    if (r?.changed) setChosen((c) => selectionAfterDelete(c, index));
  };

  return (
    <div ref={listRef} className="flex flex-col gap-3">
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
              ★★★ It routes through `structural.insert(0, …)`, the SAME bag
              every other add/remove/reorder uses, and NOT through a prop of
              its own. It had one — an optional `onAppendBlock` — and this is
              the only path into a zero-block document, so a wiring regression
              dropping it would have made an empty document permanently
              uneditable while still rendering this menu. `insert` omits
              `coalesce` exactly as the append op did, so it still writes a
              before-image (see `use-document-editor.ts`).
              ★ MUTUALLY EXCLUSIVE with the trailing control below — two
              triggers named "Add a block" in one document would be a WCAG 2.4.6
              failure that no axe rule under the gate's four tags can see. */}
          <BlockKindMenu
            lang={lang}
            triggerLabel={t(lang, "documentsAddBlock")}
            onPick={(type) => insertSeeded(0, type)}
          />
        </div>
      )}
      {/* ★★★ ONCE, not per row. `documentsBlockReorderHint` was added intending
          a `title` on the grip. This used to read "it sat UNUSED in both
          dictionaries because `DragHandle` forwards no `title`", which the
          reorder-grip migration made false — it forwards one now, so putting
          the hint here is a CHOICE, not a limitation. A `title` would still be
          the wrong home: hover-only, so it never reaches the keyboard user who
          is the one who needs telling that the arrow keys work, and
          unreachable on touch — where native HTML5 drag does not fire at all,
          making the arrow keys the ONLY reorder path.
          ★★ It reaches every grip as `aria-describedby`. Rendered as a bare
          `<p>` it was announced to NOBODY: a keyboard or screen-reader user
          tabbing to a grip hears only "Reorder – Block 1, button" and is never
          told the arrow keys reorder — which for them is the whole feature.
          ONE id serves every row, because the hint renders once.
          ★ Gated on TWO blocks: with one there is nowhere to move it, and a
          hint about an impossible gesture is noise. ★★ The SAME condition
          gates the id handed to the grips (`hintShown`), so a describedby can
          never point at an element this branch did not render — one that
          resolves to nothing is worse than none, since AT announces a
          description and then reads nothing. */}
      {hintShown && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {t(lang, "documentsBlockReorderHint")}
        </p>
      )}
      {doc.blocks.map((block, index) => {
        const dropEdge = reorder.dropEdgeFor(index);
        return (
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
            // ★ `data-drop-edge` is the assertable half of the indicator, and the
            //  spelling `reports.tsx` already uses: the border colours below are
            //  what a user sees, but a test reading them would pin styling rather
            //  than the splice semantics `reorderIds` defines.
            data-drop-edge={dropEdge ?? undefined}
            // ★★ THE 2px BORDER IS ALWAYS PRESENT AND ONLY CHANGES COLOUR. Adding
            //  width on the marked edge would move every row below it DURING a
            //  drag, which is exactly when the hit target has to hold still —
            //  reports.tsx reached the same conclusion.
            // ★★★ EVERY BRANCH NAMES BOTH y EDGES, so no two classes here target
            //  the same CSS property. Leaving a `border-line` shorthand as the
            //  baseline and layering `border-t-…` over it pits `border-color`
            //  against `border-top-color` at identical specificity, and which
            //  wins is decided by Tailwind's emit order rather than by the order
            //  written here — invisible to jsdom, so the indicator would either
            //  work or render grey depending on a detail of the generated CSS.
            //  The x edges are their own longhand pair for the same reason.
            // ★★ COLOUR IS NOT THE SOLE CHANNEL, measured rather than assumed:
            //  `--ui-green-strong` is DERIVED PER SCHEME (`scheme-tokens.ts` runs
            //  `nudgeToAa` against `--surface-muted`), and against `--line` it
            //  lands at 4.06:1 harbor-light · 5.62 harbor-dark · 4.90/4.96
            //  meridian · 4.40/6.90 umber · 5.68 beacon. All clear the 3:1
            //  lightness difference Understanding 1.4.1 accepts as the required
            //  additional distinction, and 1.4.11's 3:1 for a graphical object
            //  carrying state. The dimming below is a second channel besides.
            className={[
              "flex gap-2 rounded-md border-2 border-x-line p-2",
              reorder.isDragging && reorder.dragId !== index ? "opacity-70" : "",
              dropEdge === "before" ? "border-t-ui-green-strong border-b-line" : "",
              dropEdge === "after" ? "border-b-ui-green-strong border-t-line" : "",
              dropEdge === null ? "border-y-line" : "",
            ]
              .filter(Boolean)
              .join(" ")}
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
              handleDescribedBy={hintShown ? hintId : undefined}
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
        );
      })}
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
