"use client";
// The per-row gutter in the block editor: kind chip, drag grip, actions menu.
//
// ★ A SEPARATE FILE because document-block-editors.tsx sits at exactly 800 of
//  the 800-line ratchet with zero headroom. Nothing here may move there.
import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { EllipsisHorizontalIcon } from "@heroicons/react/24/outline";
import { t, type Lang, type TranslationKey } from "./i18n";
import type { DocBlock } from "./document-model";
import { ADDABLE_BLOCK_TYPES, type AddableBlockType } from "./document-block-seeds";
import { DragHandle } from "./drag-handle";
import { PopoverPanel } from "./popover-panel";
import { Button } from "./button";

const KIND_LABEL: Record<DocBlock["type"], TranslationKey> = {
  paragraph: "documentsBlockParagraph",
  heading: "documentsBlockHeading",
  bullets: "documentsBlockBullets",
  table: "documentsBlockTable",
  dataSection: "documentsBlockDataSection",
  pageBreak: "documentsBlockPageBreak",
};

/** Spread from `useListReorderDnd`'s `handleProps(index)` — the full contract,
 *  matching that hook's return type exactly. `DragHandle` forwards all four. */
export interface BlockHandleProps {
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

export interface DocumentBlockGutterProps {
  lang: Lang;
  index: number;
  block: DocBlock;
  /** Insert a seeded block of `type` AT `index` — so "add above" passes the
   *  row's own index and "add below" passes `index + 1`. */
  onInsert: (index: number, type: AddableBlockType) => void;
  onDelete: (index: number) => void;
  /** Supplies the drag wiring AND the ArrowUp/ArrowDown reorder — this
   *  component adds no keyboard path of its own. */
  handleProps: BlockHandleProps;
  /** Id of the reorder hint the grip should be DESCRIBED by. A passthrough,
   *  the same shape as `DragHandle`'s `title` — the hint lives in
   *  `document-editor.tsx`, which renders it once above the list and owns its
   *  id, so this component cannot mint one.
   *  ★★ OPTIONAL, and it must stay so: the hint is gated on there being two
   *   blocks to reorder, and an `aria-describedby` pointing at an id nothing
   *   renders is WORSE than none — AT announces that a description exists and
   *   then resolves nothing. Omitted, never an empty string. */
  handleDescribedBy?: string;
}

export function DocumentBlockGutter({
  lang, index, block, onInsert, onDelete, handleProps, handleDescribedBy,
}: DocumentBlockGutterProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // null = the first view (add above / add below / delete). A number = the
  // kind list, and the index the chosen kind will be inserted AT.
  const [addAt, setAddAt] = useState<number | null>(null);

  // ★★ ROW-QUALIFIED, via the en-dash convention S3b's block editors already
  //  use (`document-block-editors.tsx`'s own `qualify`). N buttons named
  //  "Reorder" is a WCAG 2.4.6 failure that no axe rule under the gate's four
  //  tags can see at any seed size — only a multi-row unit test can ever
  //  catch it.
  const rowName = (key: TranslationKey) =>
    `${t(lang, key)} – ${t(lang, "documentsBlockN", String(index + 1))}`;

  // ★ STABLE: PopoverPanel re-subscribes its scroll/resize/mousedown listeners
  //  whenever `onClose` changes identity.
  const close = useCallback(() => { setOpen(false); setAddAt(null); }, []);

  // ★★ PopoverPanel's autoFocus fires only on OPEN (deps [autoFocus, open,
  //  pos]), so swapping view would unmount the focused button and drop focus
  //  to <body> — from which the next Tab leaves the portaled panel entirely.
  //  Inert on open: the panel does not mount until it has measured itself, so
  //  `viewRef` is still null on the render `open` flips, leaving the initial
  //  focus to PopoverPanel exactly as before.
  useEffect(() => {
    if (!open) return;
    viewRef.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [addAt, open]);

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <span className="rounded-md bg-surface-muted px-2 py-1 text-xs text-muted-foreground">
        {t(lang, KIND_LABEL[block.type])}
      </span>
      <div className="flex items-center gap-1">
        {/* ★ `ariaLabel` makes this a real focusable role="button" rather than
            the decorative aria-hidden variant.
            ★★ `documentsBlockReorderHint` reaches this grip as a DESCRIPTION,
            not as a `title` and not as per-row visible text. A `title` is the
            wrong home — hover-only, so it never reaches the keyboard user who
            is the one who needs telling that the arrow keys work, and
            unreachable on touch, where native HTML5 drag does not fire at all.
            Per-row visible text would be N copies of one sentence.
            `document-editor.tsx` renders it ONCE above the block list and
            hands its id down, so every grip is described by the same node. */}
        <DragHandle
          ariaLabel={rowName("documentsBlockReorder")}
          ariaDescribedBy={handleDescribedBy}
          className="h-6 w-6 cursor-grab text-muted-foreground/60 hover:bg-ui-dark-blue/10 hover:text-ui-dark-blue"
          {...handleProps}
        />
        {/* ★★ EllipsisHORIZONTAL, against DragHandle's EllipsisVERTICAL. Two
            identical ⋮ glyphs in one gutter meaning different things is the
            collision this avoids. */}
        <Button
          ref={anchorRef}
          variant="ghost"
          size="xs"
          aria-label={rowName("documentsBlockActions")}
          // ★★ `dialog`, matching the role the PopoverPanel below actually
          //  renders. `aria-expanded` alone says a thing is open or shut
          //  without saying there is anything to open, and axe flags neither
          //  the omission nor a value that contradicts the panel.
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <EllipsisHorizontalIcon aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
      {/* ★★★ ONE PANEL, TWO VIEWS — never a nested popover. A second stacked
          panel would put a second dismissal layer on top of the Escape/Tab
          protocol PopoverPanel already owns. */}
      <PopoverPanel
        open={open}
        anchorRef={anchorRef}
        onClose={close}
        role="dialog"
        ariaLabel={rowName("documentsBlockActions")}
        className="w-56 p-2"
      >
        <div ref={viewRef} className="flex flex-col gap-1">
          {addAt === null ? (
            <>
              <Button variant="ghost" size="xs" className="justify-start" onClick={() => setAddAt(index)}>
                {t(lang, "documentsBlockAddAbove")}
              </Button>
              <Button variant="ghost" size="xs" className="justify-start" onClick={() => setAddAt(index + 1)}>
                {t(lang, "documentsBlockAddBelow")}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="justify-start text-ui-pink hover:bg-ui-pink/10 dark:hover:bg-ui-pink/5"
                onClick={() => { close(); onDelete(index); }}
              >
                {t(lang, "documentsBlockDelete")}
              </Button>
            </>
          ) : (
            <BlockKindList
              lang={lang}
              onPick={(type) => { const at = addAt; close(); onInsert(at, type); }}
              onBack={() => setAddAt(null)}
            />
          )}
        </div>
      </PopoverPanel>
    </div>
  );
}

/** The six-kind list. Shared by the gutter's second view and by
 *  `BlockKindMenu`, so the two can never offer different kinds. `onBack` is
 *  omitted by callers that are not a second view — and then NO back control
 *  renders, rather than a dead one. */
export function BlockKindList({ lang, onPick, onBack }: {
  lang: Lang;
  onPick: (type: AddableBlockType) => void;
  onBack?: () => void;
}) {
  return (
    <>
      {ADDABLE_BLOCK_TYPES.map((type) => (
        <Button
          key={type}
          variant="ghost"
          size="xs"
          className="justify-start"
          onClick={() => onPick(type)}
        >
          {t(lang, KIND_LABEL[type])}
        </Button>
      ))}
      {onBack !== undefined && (
        <Button
          variant="ghost"
          size="xs"
          className="justify-start text-muted-foreground"
          onClick={onBack}
        >
          {t(lang, "documentsBlockAddBack")}
        </Button>
      )}
    </>
  );
}

/** A trigger Button plus a PopoverPanel holding `BlockKindList`. Used for the
 *  zero-block empty state and the trailing add affordance. */
export function BlockKindMenu({ lang, triggerLabel, onPick }: {
  lang: Lang;
  /** Doubles as the panel's accessible name, so the dialog is never unnamed. */
  triggerLabel: string;
  onPick: (type: AddableBlockType) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // ★ STABLE, for the same reason as the gutter's.
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <Button
        ref={anchorRef}
        variant="secondary"
        size="xs"
        // ★ Same convention and same reason as the gutter's actions trigger —
        //  the panel below is `role="dialog"`.
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {triggerLabel}
      </Button>
      <PopoverPanel
        open={open}
        anchorRef={anchorRef}
        onClose={close}
        role="dialog"
        ariaLabel={triggerLabel}
        className="w-56 p-2"
      >
        <div className="flex flex-col gap-1">
          <BlockKindList lang={lang} onPick={(type) => { close(); onPick(type); }} />
        </div>
      </PopoverPanel>
    </>
  );
}
