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
import { useState, useRef, useEffect } from "react";
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
 * plain `string`; the heading editor's is the composite `{ level; text }`;
 * a future table editor's could be its row array). Holds the draft in
 * state, and on `commit()` converts it to a `DocBlock` via `toBlock` and
 * calls `onCommit` only if it actually differs from `baselineRef`
 * (`blockChanged` — required, not an optimisation: without it, focusing a
 * block and leaving it would write a version whose before-image equals its
 * after-image).
 *
 * `commit` is a plain closure recreated every render (never memoized), so it
 * always reads the LATEST draft value with no ref — setting a ref's
 * `.current` during render is itself a fatal lint error
 * (react-hooks/refs: "Cannot access refs during render").
 *
 * ★★★ THE CONTRACT, PRECISELY (two failure modes, two different rules):
 *
 * 1. UNMOUNT FLUSH. A pending, genuinely-changed draft with no blur is real
 *    data loss: leaving edit mode, navigating away, or a block-list
 *    re-render dropping this block all skip the DOM blur event `commit`
 *    relies on, discarding the user's edit with no warning. The mount-only
 *    effect below flushes such a draft on teardown — but ONLY if `dirtyRef`
 *    is set (the wrapped `setValue` below sets it on every draft edit), so
 *    an editor that was never touched, or one whose blur already committed
 *    (which resets `dirtyRef`), flushes nothing.
 *
 * 2. CONCURRENT-WRITE GUARD. A DELIBERATE commit (blur) may overwrite
 *    whatever is stored — the user chose to finish editing, last-write-wins
 *    is defensible there. An INCIDENTAL one (the unmount flush) may NOT: if
 *    `storedBlock` moved since the draft's baseline — a concurrent AI
 *    write, another client, anything — the flush ABANDONS the pending
 *    draft rather than silently destroying that write. Losing an unblurred
 *    keystroke burst is recoverable (the user re-types it); silently
 *    overwriting someone else's committed edit is not (AI writes carry no
 *    undo). This is why `baselineRef` freezes the moment the draft goes
 *    dirty (see its own comment) — that frozen value is what the flush
 *    compares the LIVE `storedBlock` against to detect the concurrent
 *    write.
 *
 * Reads at unmount go through `latestRef` (kept current by the effect that
 * runs after every render) rather than closing over `value`/`toBlock`/
 * `onCommit`/`index`/`storedBlock` directly, because those are only ever
 * fresh at MOUNT time inside an empty-deps effect — react-hooks/refs bans
 * reading OR writing a ref during render, so "keep it current" can only
 * happen inside an effect, never the render body.
 */
function useBlockDraft<T>(
  initialValue: T,
  storedBlock: DocBlock,
  index: number,
  toBlock: (value: T) => DocBlock,
  onCommit: (index: number, block: DocBlock) => void,
) {
  const [rawValue, setRawValue] = useState(initialValue);

  // Whether the draft has a local edit since the last sync point (mount, a
  // successful commit, or an external storedBlock adoption while
  // untouched — see below). Set ONLY by the wrapped setValue this hook
  // returns, never inferred from comparing draft/baseline content: content
  // alone cannot tell "genuinely edited" apart from "untouched, but the
  // baseline moved out from under it" (see baselineRef), and conflating
  // the two would make an untouched editor's unmount flush try to commit
  // content nobody typed.
  const dirtyRef = useRef(false);
  const setValue = (next: T | ((prev: T) => T)) => {
    dirtyRef.current = true;
    setRawValue(next);
  };

  // The block this draft is currently derived from. Starts at the block
  // this hook was seeded with; advances to `next` on every successful
  // `commit()`; and is RE-SEEDED to the live `storedBlock` prop on every
  // render where the draft is NOT dirty (an untouched editor should track
  // a concurrent write rather than go stale). It is deliberately FROZEN
  // the moment `dirtyRef` goes true, so a concurrent write arriving WHILE
  // the user has a pending edit stays visible as a mismatch between this
  // ref and the live `storedBlock` — that mismatch is the concurrent-write
  // guard's whole signal.
  const baselineRef = useRef(storedBlock);

  const latestRef = useRef({ value: rawValue, toBlock, onCommit, index, storedBlock });
  useEffect(() => {
    if (!dirtyRef.current) baselineRef.current = storedBlock;
    latestRef.current = { value: rawValue, toBlock, onCommit, index, storedBlock };
  });

  const commit = () => {
    const next = toBlock(rawValue);
    if (blockChanged(baselineRef.current, next)) {
      baselineRef.current = next;
      onCommit(index, next);
    }
    dirtyRef.current = false;
  };

  useEffect(() => {
    return () => {
      if (!dirtyRef.current) return; // never edited (or already committed) — nothing pending
      const latest = latestRef.current;
      const next = latest.toBlock(latest.value);
      if (!blockChanged(baselineRef.current, next)) return; // dirty flag set, but content is a no-op (e.g. reverted)
      if (blockChanged(baselineRef.current, latest.storedBlock)) return; // concurrent write since baseline froze — abandon
      latest.onCommit(latest.index, next);
    };
    // Deliberately mount-only: the effect body does nothing, and only its
    // cleanup — which fires exactly once, at real unmount — matters. No
    // exhaustive-deps disable needed: everything the cleanup reads comes
    // through a ref, which the rule does not treat as a dependency.
  }, []);

  return { value: rawValue, setValue, commit };
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
 * div's `onBlur` exactly like `ParagraphEditorBody`.
 *
 * ★ THIS DOES NOT MEAN level+text always land in ONE combined commit.
 *  React's `onBlur` is a delegated `focusout`, which BUBBLES — so moving
 *  focus from the `<select>` to the sibling `<input>` (a tab-through, the
 *  realistic workflow) already fires the group's `onBlur` once, for the
 *  select alone, before the text field is even touched. Each control
 *  commits independently as focus LEAVES it; the two only land in one
 *  commit when the SAME blur is the first one either control has fired
 *  (e.g. editing only the level, or only the text, then leaving the whole
 *  group). Two close-together commits are not a problem in themselves —
 *  Task 2's `shouldCoalesce` exists precisely so they fold into one
 *  document version rather than each minting one.
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
