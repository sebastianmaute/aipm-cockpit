// The five per-kind block editors. PRESENTATIONAL: every one takes its block
// and an `onCommit(index, block)` and holds no workspace knowledge.
//
// ★★ Per-block controls take BLOCK-UNIQUE accessible names. Two controls
//  sharing a name is a WCAG 2.4.6 failure that NO axe rule under the four tags
//  e2e/a11y.spec.ts requests can see, at any seed size — the unit tests beside
//  this file are the only detector that exists.
//
// ★ This file is the TEMPLATE for the heading/bullets/table/dataSection
//  editors (Tasks 6-9): `useBlockDraft` + `BlockReadOnlyNotice` below are
//  factored out so the duplication-gate (a BLOCKING total-duplicated-lines
//  check, not per-file) doesn't have to be paid down after four more siblings
//  copy this shape. Keep new editors thin consumers of both.
import { useState } from "react";
import { RichTextEditor } from "./rich-text-editor";
import { paragraphHasImage, blockChanged } from "./document-editor-commit";
import { sanitizeDocumentHtml } from "./sanitize-html";
import { t, type Lang } from "./i18n";
import type { DocBlock } from "./document-model";

export type BlockEditorProps<B extends DocBlock = DocBlock> = {
  lang: Lang;
  /** Position in the document — the op index, and what makes labels unique. */
  index: number;
  block: B;
  onCommit: (index: number, block: DocBlock) => void;
};

/**
 * Shared draft/dirty-check/commit wiring for a block editor whose full
 * editable state fits in one value of type `T` (the paragraph editor's is a
 * plain `string`; a future table editor's could be its row array). Holds the
 * draft in state, and on `commit()` converts it to a `DocBlock` via `toBlock`
 * and calls `onCommit` only if it actually differs from the stored block
 * (`blockChanged` — required, not an optimisation: without it, focusing a
 * block and leaving it would write a version whose before-image equals its
 * after-image).
 *
 * `commit` is a plain closure recreated every render (never memoized), so it
 * always reads the LATEST draft value with no ref — setting a ref's
 * `.current` during render is itself a fatal lint error
 * (react-hooks/refs: "Cannot access refs during render").
 */
function useBlockDraft<T>(
  initialValue: T,
  storedBlock: DocBlock,
  index: number,
  toBlock: (value: T) => DocBlock,
  onCommit: (index: number, block: DocBlock) => void,
) {
  const [value, setValue] = useState(initialValue);

  const commit = () => {
    const next = toBlock(value);
    if (blockChanged(storedBlock, next)) onCommit(index, next);
  };

  return { value, setValue, commit };
}

/**
 * Read-only notice for a block this editor cannot safely edit in place (used
 * today by the paragraph editor's image guard; any future per-kind editor
 * with its own read-only case can reuse it).
 *
 * ★★★ CRITICAL — re-sanitizes `html` AT THE SINK with `sanitizeDocumentHtml`
 *  (DOCUMENT_ALLOWED_TAGS = RICH_ALLOWED_TAGS + img) before the
 *  `dangerouslySetInnerHTML`. NEVER `sanitizeRichHtml` here — it drops `<img>`
 *  outright, which would blank the very image this component exists to keep
 *  visible. Mirrors the repo's documented defense-in-depth pattern
 *  (`rich-text-view.tsx`, `document-preview.tsx`'s header comment): every
 *  render path that reaches an unescaped sink re-sanitizes there even if an
 *  earlier layer (load path, a future data-driven html source) regresses.
 */
function BlockReadOnlyNotice({ html, reason }: { html: string; reason: string }) {
  return (
    <div className="rounded-md border border-line bg-surface-muted p-3">
      <div
        className="prose-sm max-w-none text-foreground"
        dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(html) }}
      />
      <p className="mt-2 text-xs text-muted-foreground">{reason}</p>
    </div>
  );
}

const HEADING_LEVELS = [1, 2, 3] as const;
type HeadingLevel = (typeof HEADING_LEVELS)[number];
type HeadingDraft = { level: HeadingLevel; text: string };

/**
 * `heading.level` + `heading.text` are TWO editable fields, not one — this is
 * why `useBlockDraft` is generic over `T` rather than fixed to `string`. The
 * draft's `T` is simply the composite `{ level; text }` object, so this
 * editor is still a THIN consumer of the shared hook (no second copy of the
 * dirty-check/commit logic): one `commit` closure, wired to the wrapping
 * div's `onBlur` exactly like `ParagraphEditorBody` — changing the level
 * updates the draft immediately (so the select always shows the live value)
 * but the actual commit still waits for blur, same as the text field. That
 * also means level+text changes make ONE combined commit, not two.
 */
export function HeadingBlockEditor({
  lang,
  index,
  block,
  onCommit,
}: BlockEditorProps<Extract<DocBlock, { type: "heading" }>>) {
  const { value, setValue, commit } = useBlockDraft<HeadingDraft>(
    { level: block.level, text: block.text },
    block,
    index,
    (v): DocBlock => ({ type: "heading", level: v.level, text: v.text }),
    onCommit,
  );

  // ★ Every label carries the 1-based block position. N identical "Heading
  //  level" labels is a 2.4.6 failure the axe gate cannot see.
  const suffix = ` ${index + 1}`;

  return (
    <div className="flex flex-wrap items-center gap-2" onBlur={commit}>
      <select
        aria-label={t(lang, "documentsHeadingLevel") + suffix}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground"
        value={String(value.level)}
        onChange={(e) => setValue({ ...value, level: Number(e.target.value) as HeadingLevel })}
      >
        {HEADING_LEVELS.map((l) => (
          <option key={l} value={String(l)}>{`H${l}`}</option>
        ))}
      </select>
      <input
        type="text"
        aria-label={t(lang, "documentsHeadingText") + suffix}
        className="flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground"
        value={value.text}
        onChange={(e) => setValue({ ...value, text: e.target.value })}
      />
    </div>
  );
}

export function ParagraphBlockEditor({
  lang,
  index,
  block,
  onCommit,
}: BlockEditorProps<Extract<DocBlock, { type: "paragraph" }>>) {
  // ★★★ An image in a document paragraph is REACHABLE TODAY (model-authored
  //  HTML goes through sanitizeDocumentHtml, which admits `img`), and the
  //  shared editor commits through sanitizeRichHtml, which does not. `img` is
  //  a VOID element, so it would not unwrap to text — it would vanish. Render
  //  read-only, and SAY WHY: a disabled control with no reason reads as broken.
  if (paragraphHasImage(block.html)) {
    return <BlockReadOnlyNotice html={block.html} reason={t(lang, "documentsBlockImageReadOnly")} />;
  }
  return <ParagraphEditorBody lang={lang} index={index} block={block} onCommit={onCommit} />;
}

/** Split out so the read-only branch above returns BEFORE any hook runs —
 *  a conditional hook call is a lint error and a React rules violation. */
function ParagraphEditorBody({
  lang,
  index,
  block,
  onCommit,
}: BlockEditorProps<Extract<DocBlock, { type: "paragraph" }>>) {
  const { value: html, setValue: setHtml, commit } = useBlockDraft<string>(
    block.html,
    block,
    index,
    (nextHtml): DocBlock => ({ type: "paragraph", html: nextHtml }),
    onCommit,
  );

  return (
    <div onBlur={commit}>
      <RichTextEditor
        value={html}
        onChange={setHtml}
        label={t(lang, "documentsParagraphLabel", String(index + 1))}
        lang={lang}
      />
    </div>
  );
}
