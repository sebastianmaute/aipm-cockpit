// The five per-kind block editors. PRESENTATIONAL: every one takes its block
// and an `onCommit(index, block)` and holds no workspace knowledge.
//
// ★★ Per-block controls take BLOCK-UNIQUE accessible names. Two controls
//  sharing a name is a WCAG 2.4.6 failure that NO axe rule under the four tags
//  e2e/a11y.spec.ts requests can see, at any seed size — the unit tests beside
//  this file are the only detector that exists.
import { useState } from "react";
import { RichTextEditor } from "./rich-text-editor";
import { paragraphHasImage, blockChanged } from "./document-editor-commit";
import { t, type Lang } from "./i18n";
import type { DocBlock } from "./document-model";

export type BlockEditorProps<B extends DocBlock = DocBlock> = {
  lang: Lang;
  /** Position in the document — the op index, and what makes labels unique. */
  index: number;
  block: B;
  onCommit: (index: number, block: DocBlock) => void;
};

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
    return (
      <div className="rounded-md border border-line bg-surface-muted p-3">
        <div
          className="prose-sm max-w-none text-foreground"
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {t(lang, "documentsBlockImageReadOnly")}
        </p>
      </div>
    );
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
  const [html, setHtml] = useState(block.html);

  // ★ `commit` closes over this render's `html` — it is recreated every
  //  render (never memoized), so it always reads the latest state without a
  //  ref. Setting a ref's `.current` during render is itself a lint error
  //  (react-hooks/refs: "Cannot access refs during render").
  const commit = () => {
    const next: DocBlock = { type: "paragraph", html };
    if (blockChanged(block, next)) onCommit(index, next);
  };

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
