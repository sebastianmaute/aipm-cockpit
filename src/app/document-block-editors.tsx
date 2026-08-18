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
import { ToggleButton } from "./toggle-button";

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
 * runs after every render) rather than closing over `toBlock`/`onCommit`/
 * `index`/`storedBlock` directly, because those are only ever fresh at
 * MOUNT time inside an empty-deps effect — react-hooks/refs bans reading OR
 * writing a ref during render, so "keep it current" can only happen inside
 * an effect, never the render body. The draft VALUE itself is read from
 * `liveValueRef` instead (see its own comment) — not from `latestRef`,
 * which can lag a render behind.
 *
 * ★★★ `commitValue(next)` — for a control with no blur event to hang a
 *  deferred commit off (add/remove/reorder buttons, a toggle), NOT a text
 *  field. It commits `next` SYNCHRONOUSLY, in the caller's own event
 *  handler, exactly like `commit()` does on a real blur — no effect, no
 *  round trip, so an immediate `unmount()` right after a click can never
 *  race a commit that hasn't happened yet (a bare `setValue` + a later
 *  effect calling `commit()` COULD, and did: bullets shipped that shape
 *  first and a raw-`dispatchEvent`-then-`unmount()` probe lost the edit
 *  outright, because `dirtyRef` was set but the value the effect would
 *  read hadn't landed in `latestRef` yet). Resolves a functional updater
 *  against `liveValueRef.current`, never the render-scope `value` — the
 *  "N saves in one tick" landmine (AGENTS.md) applies here exactly as it
 *  does to any other save handler: two `commitValue(prev => ...)` calls
 *  batched into one event (two clicks, or a double-click) must each see
 *  the OTHER's effect, and a plain `{...value, ...}` spread reading the
 *  render's `value` cannot — both calls would close over the SAME
 *  pre-batch value and the second commit would silently overwrite the
 *  first's change instead of building on it.
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

  // A SYNCHRONOUS mirror of the draft's true current value. `rawValue`
  // (React state) is only EVENTUALLY consistent — a `setRawValue` call does
  // not update what a later line in the SAME tick reads, let alone what a
  // second handler invoked later in the same batched event reads. Every
  // value-producing call (`setValue`, `commitValue`) resolves a functional
  // updater against this ref and updates it immediately, so calls stack
  // correctly regardless of render timing.
  const liveValueRef = useRef(initialValue);

  const resolveValue = (next: T | ((prev: T) => T)): T =>
    typeof next === "function" ? (next as (prev: T) => T)(liveValueRef.current) : next;

  const setValue = (next: T | ((prev: T) => T)) => {
    dirtyRef.current = true;
    const resolved = resolveValue(next);
    liveValueRef.current = resolved;
    setRawValue(resolved);
  };

  // The block this draft is currently derived from. Starts at the block
  // this hook was seeded with; advances to `next` on every successful
  // `commit()`/`commitValue()`; and is RE-SEEDED to the live `storedBlock`
  // prop on every render where the draft is NOT dirty (an untouched editor
  // should track a concurrent write rather than go stale). It is
  // deliberately FROZEN the moment `dirtyRef` goes true, so a concurrent
  // write arriving WHILE the user has a pending edit stays visible as a
  // mismatch between this ref and the live `storedBlock` — that mismatch
  // is the concurrent-write guard's whole signal.
  const baselineRef = useRef(storedBlock);

  const latestRef = useRef({ toBlock, onCommit, index, storedBlock });
  useEffect(() => {
    if (!dirtyRef.current) baselineRef.current = storedBlock;
    latestRef.current = { toBlock, onCommit, index, storedBlock };
  });

  const commit = () => {
    const next = toBlock(liveValueRef.current);
    if (blockChanged(baselineRef.current, next)) {
      baselineRef.current = next;
      onCommit(index, next);
    }
    dirtyRef.current = false;
  };

  const commitValue = (next: T | ((prev: T) => T)) => {
    const resolved = resolveValue(next);
    liveValueRef.current = resolved;
    setRawValue(resolved);
    const nextBlock = toBlock(resolved);
    if (blockChanged(baselineRef.current, nextBlock)) {
      baselineRef.current = nextBlock;
      onCommit(index, nextBlock);
    }
    dirtyRef.current = false;
  };

  useEffect(() => {
    return () => {
      if (!dirtyRef.current) return; // never edited (or already committed) — nothing pending
      const latest = latestRef.current;
      const next = latest.toBlock(liveValueRef.current);
      if (!blockChanged(baselineRef.current, next)) return; // dirty flag set, but content is a no-op (e.g. reverted)
      if (blockChanged(baselineRef.current, latest.storedBlock)) return; // concurrent write since baseline froze — abandon
      latest.onCommit(latest.index, next);
    };
    // Deliberately mount-only: the effect body does nothing, and only its
    // cleanup — which fires exactly once, at real unmount — matters. No
    // exhaustive-deps disable needed: everything the cleanup reads comes
    // through a ref, which the rule does not treat as a dependency.
  }, []);

  return { value: rawValue, setValue, commit, commitValue };
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

type BulletsDraft = { items: readonly string[]; ordered: boolean };

/**
 * The first editor with N controls of the SAME kind per block (per-item move/
 * remove, plus add) — so unlike heading/paragraph, its labels need to be
 * unique on TWO axes at once: across sibling bullets blocks (like every other
 * editor here) AND across items within one block. Two of its labels have no
 * `{0}` placeholder to carry the item number at all (`documentsListOrdered`,
 * `documentsAddItem`), so EVERY control here is qualified with the block
 * position via `documentsBlockN` ("Block {0}"), joined onto the base label
 * with an en dash — never a bare trailing digit, which reads as part of the
 * label's OWN number ("Remove item 1 1" looks like two item numbers, not an
 * item-in-a-block). The qualifier goes in `aria-label`, never the visible
 * text: the Add button's VISIBLE label stays the plain "Add item" a sighted
 * user reads, exactly as `ToggleButton`'s WCAG 4.1.2 contract already keeps
 * the toggle's visible label unqualified below.
 *
 * ★ Still a THIN consumer of `useBlockDraft`: every action (typing, add,
 *  remove, move, toggle) goes through the hook's own `setValue`/`commit`/
 *  `commitValue` — no second copy of the dirty-check/baseline/unmount-flush/
 *  concurrent-write logic. `commitValue` is what add/remove/move/toggle use,
 *  since a button click has no blur event to hang a deferred `commit()`
 *  off; see its doc comment on `useBlockDraft` for why that has to be a
 *  synchronous commit rather than a `setValue` + a later effect.
 */
export function BulletsBlockEditor({
  lang,
  index,
  block,
  onCommit,
}: BlockEditorProps<Extract<DocBlock, { type: "bullets" }>>) {
  const { value, setValue, commit, commitValue } = useBlockDraft<BulletsDraft>(
    { items: block.items, ordered: block.ordered === true },
    block,
    index,
    (v): DocBlock =>
      v.ordered
        ? { type: "bullets", items: [...v.items], ordered: true }
        : { type: "bullets", items: [...v.items] },
    onCommit,
  );

  const blockQualifier = t(lang, "documentsBlockN", String(index + 1));
  const qualify = (label: string) => `${label} – ${blockQualifier}`;

  // Functional updaters throughout: `commitValue` resolves each against the
  // shared `liveValueRef`, not this render's `value`, so two of these fired
  // in one batched event (a real double-click, or `act(() => { a.click();
  // b.click() })`) each see the OTHER's already-applied change instead of
  // both reading the same pre-batch snapshot and one clobbering the other.
  const moveItem = (from: number, to: number) => {
    commitValue((prev) => {
      const items = [...prev.items];
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return { ...prev, items };
    });
  };

  const removeItem = (i: number) => {
    commitValue((prev) => ({ ...prev, items: prev.items.filter((_, j) => j !== i) }));
  };

  const addItem = () => {
    commitValue((prev) => ({ ...prev, items: [...prev.items, ""] }));
  };

  const toggleOrdered = () => {
    commitValue((prev) => ({ ...prev, ordered: !prev.ordered }));
  };

  return (
    <div className="flex flex-col gap-2" onBlur={commit}>
      <ToggleButton
        pressed={value.ordered}
        onToggle={toggleOrdered}
        lang={lang}
        ariaLabel={qualify(t(lang, "documentsListOrdered"))}
      >
        {t(lang, "documentsListOrdered")}
      </ToggleButton>

      <ul className="flex flex-col gap-1">
        {value.items.map((item, i) => (
          <li key={i} className="flex items-center gap-1">
            <input
              type="text"
              aria-label={qualify(t(lang, "documentsListItem", String(i + 1)))}
              className="flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground"
              value={item}
              onChange={(e) => {
                const text = e.target.value;
                setValue((prev) => {
                  const items = [...prev.items];
                  items[i] = text;
                  return { ...prev, items };
                });
              }}
            />
            <button
              type="button"
              aria-label={qualify(t(lang, "documentsMoveItemUp", String(i + 1)))}
              disabled={i === 0}
              className="rounded-md border border-line px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => moveItem(i, i - 1)}
            >
              <span aria-hidden="true">{"↑"}</span>
            </button>
            <button
              type="button"
              aria-label={qualify(t(lang, "documentsMoveItemDown", String(i + 1)))}
              disabled={i === value.items.length - 1}
              className="rounded-md border border-line px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => moveItem(i, i + 1)}
            >
              <span aria-hidden="true">{"↓"}</span>
            </button>
            <button
              type="button"
              aria-label={qualify(t(lang, "documentsRemoveItem", String(i + 1)))}
              className="rounded-md border border-line px-2 py-1 text-xs"
              onClick={() => removeItem(i)}
            >
              <span aria-hidden="true">{"✕"}</span>
            </button>
          </li>
        ))}
      </ul>

      <div>
        <button
          type="button"
          aria-label={qualify(t(lang, "documentsAddItem"))}
          className="rounded-md border border-line px-2 py-1 text-xs"
          onClick={addItem}
        >
          {t(lang, "documentsAddItem")}
        </button>
      </div>
    </div>
  );
}
