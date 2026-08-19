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
import { paragraphHasImage, blockChanged, normalizeBlockForStorage } from "./document-editor-commit";
import { t, type Lang } from "./i18n";
import type { DocBlock } from "./document-model";
import { ToggleButton } from "./toggle-button";
import { BlockReadOnlyNotice, BlockRefusalNotice, type BlockRefusal } from "./document-block-notices";
import { Button } from "./button";
import { Input, Select } from "./form-controls";
import { EXPORT_SECTION_KEYS, type ExportSectionKey } from "./settings-types";
import { EXPORT_SECTION_LABEL_KEYS } from "./export-section-labels";

export type BlockEditorProps<B extends DocBlock = DocBlock> = {
  lang: Lang;
  /** Position in the document — the op index, and what makes labels unique. */
  index: number;
  block: B;
  /** ★ The THIRD argument is the draft's BASELINE, forwarded to the engine as
   *   the `replace` op's `expect` precondition (see `replaceBlockOp`). */
  onCommit: (index: number, block: DocBlock, expect?: DocBlock) => void;
  /** Narrow-pane docking: the paragraph editor portals its toolbar here.
   *  Absent at a wide pane and for every NON-paragraph editor — those carry
   *  no 20-control toolbar, so they have nothing to dock and read it never. */
  toolbarContainer?: HTMLElement | null;
};

/**
 * Shared draft/dirty-check/commit wiring for a block editor whose full
 * editable state fits in one value of type `T` (the paragraph editor's is a
 * plain `string`; the heading editor's is the composite `{ level; text }`;
 * the table editor's is its caption/columns/rows). Holds the draft in
 * state, and on `commit()` converts it to a `DocBlock` via `toBlock` and
 * calls `onCommit` only if it actually differs from `baselineRef`
 * (`blockChanged` — required, not an optimisation: without it, focusing a
 * block and leaving it would write a version whose before-image equals its
 * after-image).
 *
 * ★ The FIRST parameter is a DERIVER (`fromBlock: (block: B) => T`), not a
 * mount-time value, because rule 3 below has to re-derive the draft from a
 * CHANGED block, not just seed it once.
 *
 * `commit` is a plain closure recreated every render (never memoized), and
 * it reads the draft through `liveValueRef` rather than this render's
 * `value` (see that ref's own comment for why a closure over the render
 * scope is not enough). Refs are what the render body may NOT touch:
 * reading OR writing `.current` during render is a fatal lint error
 * (react-hooks/refs: "Cannot access refs during render"), which is why the
 * dirty flag is mirrored into state for the reconcile below.
 *
 * ★★★ THE CONTRACT, PRECISELY (three rules):
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
 * 2. CONCURRENT-WRITE GUARD, ON EVERY COMMIT PATH, IN TWO LAYERS — this hook
 *    first, then the engine (see the unmount cleanup). If `storedBlock` moved
 *    since the draft's baseline froze — a restore, a concurrent AI write,
 *    another client — the commit ABANDONS rather than silently destroying
 *    that write. ★★★ THIS APPLIES TO A BLUR TOO. An earlier revision of this
 *    comment said a deliberate commit "MAY overwrite whatever is stored —
 *    last-write-wins is defensible there", and that was the bug: the user's
 *    deliberate act is clicking OUT of a field, which carries no intent to
 *    overwrite a restore that landed while it was focused. Losing an
 *    unblurred keystroke burst is recoverable; destroying a committed write
 *    is not, since AI and restore writes carry no undo.
 *
 * 3. UNDIRTY ADOPTION. While the draft is untouched it TRACKS `storedBlock`
 *    via the render-time reconcile, so an external write reaches the field
 *    the user is looking at. Without this the draft went stale while
 *    `baselineRef` advanced past it, and the next blur wrote the stale value
 *    back — the F1 clobber.
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
export function useBlockDraft<T, B extends DocBlock>(
  fromBlock: (block: B) => T,
  storedBlock: B,
  index: number,
  toBlock: (value: T) => DocBlock,
  onCommit: (index: number, block: DocBlock, expect?: DocBlock) => void,
) {
  const [rawValue, setRawValue] = useState(() => fromBlock(storedBlock));

  // Whether the draft has a local edit since the last sync point (mount, a
  // successful commit, or an external storedBlock adoption while untouched
  // — see the reconcile below). Set ONLY by `markDirty` from the wrapped
  // setValue/commit paths, never inferred from comparing draft/baseline
  // content: content alone cannot tell "genuinely edited" apart from
  // "untouched, but the baseline moved out from under it", and conflating
  // the two would make an untouched editor's unmount flush try to commit
  // content nobody typed.
  const dirtyRef = useRef(false);

  // ★★★ A RENDER-VISIBLE MIRROR OF `dirtyRef`, AND IT IS NOT REDUNDANT.
  //  The render-time reconcile below has to know whether the draft is dirty,
  //  and `react-hooks/refs` ("Cannot access refs during render") is FATAL for
  //  READING a ref as well as for writing one. Measured, not assumed: the
  //  reconcile written as `if (!dirtyRef.current)` fails
  //  `npx eslint --max-warnings=0` on this file with that exact message, so
  //  the plan's original one-ref shape could not ship.
  //  Handlers keep reading `dirtyRef` because they can run before the render
  //  a `setDirty` schedules (two calls batched into one event must each see
  //  the other's effect — the same reason `liveValueRef` exists); the render
  //  body reads this state instead. `markDirty` is the ONLY writer of either,
  //  so the two cannot drift — never set one without the other.
  const [dirty, setDirty] = useState(false);
  const markDirty = (next: boolean) => {
    dirtyRef.current = next;
    setDirty(next);
  };

  // A SYNCHRONOUS mirror of the draft's true current value. `rawValue`
  // (React state) is only EVENTUALLY consistent — a `setRawValue` call does
  // not update what a later line in the SAME tick reads, let alone what a
  // second handler invoked later in the same batched event reads. Every
  // value-producing call (`setValue`, `commitValue`) resolves a functional
  // updater against this ref and updates it immediately, so calls stack
  // correctly regardless of render timing.
  const liveValueRef = useRef(rawValue);

  const resolveValue = (next: T | ((prev: T) => T)): T =>
    typeof next === "function" ? (next as (prev: T) => T)(liveValueRef.current) : next;

  const setValue = (next: T | ((prev: T) => T)) => {
    markDirty(true);
    const resolved = resolveValue(next);
    liveValueRef.current = resolved;
    setRawValue(resolved);
  };

  // The block this draft is currently derived from. Advances to `next` on
  // every successful commit; is RE-SEEDED to the live `storedBlock` on every
  // render where the draft is not dirty; and is deliberately FROZEN the moment
  // the draft goes dirty, so a concurrent write arriving WHILE the user has a
  // pending edit stays visible as a mismatch against the live prop — that
  // mismatch is the concurrent-write guard's whole signal.
  const baselineRef = useRef<DocBlock>(storedBlock);

  // ★★★ THE VALUE `storedBlock` HELD IMMEDIATELY BEFORE THIS HOOK'S OWN LAST
  //  COMMIT — and without it the abandon guard below fires on our OWN write.
  //  `onCommit` does not change `storedBlock`; the parent has to apply the op
  //  and re-render us, which cannot happen in the middle of one batched event.
  //  So between our commit and that echo, `baselineRef` (what we sent) and the
  //  live `storedBlock` (what the parent still shows) legitimately differ with
  //  NOBODY else having written. Measured: with a single-ref guard, two
  //  structural clicks batched into one event — the "N saves in one tick"
  //  landmine `commitValue` exists for — had the SECOND one abandoned, because
  //  it read the first one's un-echoed write as a concurrent one
  //  ("keeps BOTH intentions when add and remove are batched into one event"
  //  went red). A stored block equal to EITHER value is therefore unmoved.
  //
  //  ★★★ THE INVARIANT THIS RESTS ON: every `tryCommit` caller must clear the
  //   dirty flag in the SAME statement, so the divergence window stays inside
  //   one synchronous batch and the after-render effect closes it (that effect
  //   re-syncs BOTH refs on the undirty path). A future commit path that left
  //   the draft dirty would hold the window open ACROSS renders, and an
  //   external write restoring the block to the version immediately PRECEDING
  //   this hook's last commit would then equal `preCommitStoredRef` and read
  //   as unmoved — a clobber. Pinned by "treats a restore to the version
  //   before its own last commit as an external write".
  const preCommitStoredRef = useRef<DocBlock>(storedBlock);

  // ★★★ RENDER-TIME RECONCILE, NOT AN EFFECT. `react-hooks/set-state-in-effect`
  //  is a FATAL lint error in CI, so adopting a changed prop uses the repo's
  //  standard `if (prop !== handled) { setState(...) }` shape guarded by
  //  last-seen state.
  //
  //  WHY IT EXISTS: a restore-in-place keeps the document id, so
  //  `DocumentEditor`'s `${doc.id}-${index}` keys do not change and NOTHING
  //  remounts. Without this the draft stayed seeded from the pre-restore block
  //  while `baselineRef` advanced past it, and the next blur wrote the stale
  //  draft back over the restored content — silent data loss (F1).
  //
  //  ★ Only while UNDIRTY. A pending user edit is not discarded by a
  //   concurrent write; the COMMIT is abandoned instead (see below), and the
  //   draft then adopts the external write on the first render after the
  //   abandon clears the dirty flag. ★★★ THE ADOPTION IS THE POINT, NOT A
  //   SIDE EFFECT: an earlier cut let `setHandledBlock` advance while dirty,
  //   so once the reconcile had SEEN the write, `storedBlock === handledBlock`
  //   forever and it could never adopt. The blur abandoned correctly, the
  //   effect then re-synced `baselineRef` to the external write while the
  //   draft still held the stale text, and the user's NEXT keystroke + blur
  //   committed that stale text over the restore — the F1 loss, one keystroke
  //   later. So the user's unblurred text IS replaced on screen, deliberately:
  //   retyping a keystroke burst is recoverable, destroying a committed write
  //   is not.
  //  ★ `fromBlock` cannot receive a wrong-kind block: `BlockEditor` (in
  //   document-editor.tsx) switches on `block.type` and returns a different
  //   component per kind, so a kind change at one position unmounts this
  //   editor rather than re-rendering it with a mismatched prop.
  const [handledBlock, setHandledBlock] = useState<DocBlock>(storedBlock);
  const [seedNonce, setSeedNonce] = useState(0);
  if (storedBlock !== handledBlock && !dirty) {
    // ★ `setHandledBlock` is INSIDE the undirty guard. Advancing it while
    //  dirty makes the adoption unreachable forever after — see the ★★★ note
    //  above. No render loop: while dirty this branch sets no state at all,
    //  and the `setDirty(false)` in commit/commitValue is itself the render
    //  that lets the adoption run.
    setHandledBlock(storedBlock);
    const seeded = fromBlock(storedBlock);
    setRawValue(seeded);
    // ★★★ BUMPED ON A CONTENT CHANGE, NEVER ON IDENTITY — the nonce keys a
    //  REMOUNT of the paragraph's Tiptap surface (a plain value prop cannot
    //  reach a mounted editor), and a remount destroys DOM focus and the
    //  editor's undo history. `applyOps` stores `op.block` verbatim, so this
    //  hook's OWN commit comes straight back as a new object holding the same
    //  content; bumping on identity therefore remounted after every commit.
    //  Measured: React's `onBlur` is `focusout`, which BUBBLES and carries no
    //  relatedTarget check, so moving focus from the contenteditable to this
    //  editor's own toolbar (which renders BEFORE `EditorContent`, i.e. one
    //  Shift+Tab away) fires `commit` — and the remount then dropped the
    //  focused toolbar button on the floor, leaving `document.activeElement`
    //  at `<body>`. Mouse users were spared only because `preventFocusSteal`
    //  suppresses the mousedown default. Comparing through `toBlock` reuses
    //  the hook's one deep comparison rather than adding a second notion of
    //  equality — every other check here is CONTENT, and this one now is too.
    if (blockChanged(toBlock(rawValue), toBlock(seeded))) setSeedNonce((n) => n + 1);
  }

  const latestRef = useRef({ toBlock, onCommit, index, storedBlock: storedBlock as DocBlock });
  useEffect(() => {
    // ★★★ THE ONE LEGAL PLACE TO PROPAGATE A RENDER-TIME RE-SEED.
    //  `react-hooks/refs` bans WRITING a ref during render, so the reconcile
    //  above cannot assign `liveValueRef` itself. This assignment is a NO-OP on
    //  every other path — `setValue`/`commitValue` set the ref and the state to
    //  the SAME resolved value, and effects run after the commit of whatever
    //  render that batch produced, so `rawValue === liveValueRef.current`
    //  already. Do not "simplify" it away: the re-seed is the one path where
    //  they differ, and it is the path this whole reconcile exists for.
    liveValueRef.current = rawValue;
    if (!dirtyRef.current) {
      baselineRef.current = storedBlock;
      // Kept in step so the pair only ever diverges inside the
      // commit-to-echo window described on preCommitStoredRef.
      preCommitStoredRef.current = storedBlock;
    }
    latestRef.current = { toBlock, onCommit, index, storedBlock };
  });

  /**
   * True when `storedBlock` has moved to something this hook did not write.
   *
   * ★ Reads ONLY refs, which is why the unmount cleanup shares it while
   *  deliberately keeping its own copy of everything else: `tryCommit` calls
   *  `onCommit(index, next)` from the RENDER scope, and both of those are
   *  stale inside a mount-only effect's cleanup. The guard itself has no such
   *  problem, and one copy is what stops the two paths drifting apart.
   */
  const externallyWritten = (): boolean => {
    const stored = latestRef.current.storedBlock;
    return blockChanged(baselineRef.current, stored) && blockChanged(preCommitStoredRef.current, stored);
  };

  const [refusal, setRefusal] = useState<BlockRefusal | null>(null);

  /** Shared by `commit` and `commitValue`. Returns true when the write landed.
   *
   * ★★★ NORMALISE FIRST, AND COMMIT THE NORMALISED BLOCK — never the raw draft.
   *  `normalizeBlockForStorage` IS the loader's own per-block rule, so what this
   *  writes is byte-identical to what the next load produces. Committing the raw
   *  draft instead let the two disagree, silently, in three measured ways: a
   *  paragraph over MAX_HTML_TEXT_CHARS came back with every mark flattened to
   *  plain text, a heading kept trailing whitespace the loader trims, and a
   *  freshly ADDED empty bullet item counted as a change — minting a document
   *  version for content the next load drops. Per-editor caps would have been
   *  one copy of each rule per editor, free to drift from the loader's.
   *
   * ★★★ NULL MEANS THE LOADER DISCARDS IT, and refusing is right — an emptied
   *  heading, a paragraph with no visible text or a bullets list with nothing in
   *  it all commit fine, render for the rest of the session, and are GONE on the
   *  next load. Refusing SILENTLY is the same "disabled control with no reason"
   *  defect the image guard exists to avoid, so the consumer renders
   *  `documentsBlockEmptyNotSaved` while this is true. Checked BEFORE the
   *  concurrent-write guard below: a block this hook itself cannot commit is
   *  refused regardless of what any other writer did. */
  const tryCommit = (raw: DocBlock): boolean => {
    const next = normalizeBlockForStorage(raw);
    if (!next) { setRefusal("empty"); return false; }
    if (!blockChanged(baselineRef.current, next)) { setRefusal(null); return false; }
    // ★★★ ABANDON RATHER THAN CLOBBER — and this now applies to a BLUR too,
    //  which is a change of policy from the first cut. It used to hold only on
    //  the unmount path, on the reasoning that a deliberate commit may
    //  last-write-wins. That reasoning does not survive the restore case: the
    //  user's "deliberate" act is clicking OUT of a field, which they do
    //  reflexively and which carries no intent to overwrite a restore that
    //  landed while the field was focused. Losing an unblurred keystroke burst
    //  is recoverable (re-type it); destroying a committed write is not — AI
    //  and restore writes carry no undo.
    if (externallyWritten()) { setRefusal("conflict"); return false; }
    setRefusal(null);
    // ★★ READ BEFORE `baselineRef` ADVANCES: this is the block the edit was
    //  derived from, and the engine applies the write only while it is still
    //  what sits at `index`. Reading it after the assignment below would send
    //  the value we are about to write — matching nothing, guarding nothing.
    const expected = baselineRef.current;
    preCommitStoredRef.current = latestRef.current.storedBlock;
    baselineRef.current = next;
    onCommit(index, next, expected);
    return true;
  };

  const commit = () => {
    // ★ DIRTY GUARD. Without it every focusout on an untouched editor ran the
    //  full toBlock/blockChanged pair against a baseline that may have moved,
    //  which is how the clean-draft ordering of F1 wrote a stale value.
    if (!dirtyRef.current) return;
    tryCommit(toBlock(liveValueRef.current));
    markDirty(false);
  };

  const commitValue = (next: T | ((prev: T) => T)) => {
    // ★ NO dirty guard here, deliberately: a structural click (add/remove/
    //  move/toggle, or picking a select option) IS the edit, and demanding a
    //  prior `setValue` would make the first click a no-op. The abandon guard
    //  inside tryCommit still applies.
    const resolved = resolveValue(next);
    liveValueRef.current = resolved;
    setRawValue(resolved);
    tryCommit(toBlock(resolved));
    markDirty(false);
  };

  useEffect(() => {
    return () => {
      if (!dirtyRef.current) return; // never edited (or already committed) — nothing pending
      const latest = latestRef.current;
      // ★★★ THE LOADER'S RULE APPLIES HERE TOO, and `tryCommit` was its only
      //  call site — i.e. the BLUR path. An emptied paragraph/heading/bullets
      //  list reaches THIS path with no blur at all: narrowing the pane below
      //  NARROW_PANE_PX collapses a non-selected row and unmounts it, and a
      //  resize moves no focus. Committing it would render for the session and
      //  be GONE on the next load. ★ It cannot `setDropped` (the component is
      //  unmounting), so refusing to write IS the fix — do not fake a notice.
      // ★★ NORMALISED FIRST for the same reason `tryCommit` does it, and the
      //  ORDER matters: comparing the RAW draft against the baseline would call
      //  a whitespace-only or empty-item-only change "changed" and flush a block
      //  the loader then rewrites.
      const next = normalizeBlockForStorage(latest.toBlock(liveValueRef.current));
      if (!next) return;
      if (!blockChanged(baselineRef.current, next)) return; // dirty flag set, but content is a no-op (e.g. reverted)
      if (externallyWritten()) return; // concurrent write since baseline froze — abandon
      // ★★★ AND THE ENGINE GETS THE BASELINE, because `externallyWritten()`
      //  is BLIND on exactly this path: every ref it reads advances only when
      //  this row RENDERS, and `BlockEditor` returns a different component per
      //  `block.type` — so a write changing the TYPE here tears the row down
      //  with no final render, all refs frozen pre-write. The engine compares
      //  `expect` against live state at call time.
      latest.onCommit(latest.index, next, baselineRef.current);
    };
    // Deliberately mount-only: the effect body does nothing, and only its
    // cleanup — which fires exactly once, at real unmount — matters. No
    // exhaustive-deps disable needed: everything the cleanup reads comes
    // through a ref, which the rule does not treat as a dependency.
  }, []);

  return { value: rawValue, setValue, commit, commitValue, seedNonce, refusal };
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
  const { value, setValue, commit, refusal } = useBlockDraft(
    (b: Extract<DocBlock, { type: "heading" }>): HeadingDraft => ({ level: b.level, text: b.text }),
    block,
    index,
    (v): DocBlock => ({ type: "heading", level: v.level, text: v.text }),
    onCommit,
  );

  // ★★★ EN-DASH BLOCK QUALIFIER, never a bare trailing digit — the convention
  //  the bullets, table and dataSection editors already state verbatim. It
  //  matters MORE here than anywhere else in the slice: this block's select
  //  offers H1/H2/H3, so "Heading level 1" reads as the LEVEL, and a user
  //  cannot tell the qualifier from the control's own subject. N identical
  //  "Heading text" labels across sibling heading blocks is a WCAG 2.4.6
  //  failure no axe rule under the four tags e2e/a11y.spec.ts requests can
  //  see, at any seed size — this file's multi-block tests are the only
  //  detector that exists.
  const blockQualifier = t(lang, "documentsBlockN", String(index + 1));
  const qualify = (label: string) => `${label} – ${blockQualifier}`;

  return (
    <div className="flex flex-col gap-1" onBlur={commit}>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={qualify(t(lang, "documentsHeadingLevel"))}
          value={String(value.level)}
          onChange={(e) => setValue({ ...value, level: Number(e.target.value) as HeadingLevel })}
        >
          {HEADING_LEVELS.map((l) => (
            <option key={l} value={String(l)}>{`H${l}`}</option>
          ))}
        </Select>
        <Input
          aria-label={qualify(t(lang, "documentsHeadingText"))}
          className="flex-1"
          value={value.text}
          onChange={(e) => setValue({ ...value, text: e.target.value })}
        />
      </div>
      {refusal && <BlockRefusalNotice lang={lang} refusal={refusal} />}
    </div>
  );
}

export function ParagraphBlockEditor({
  lang,
  index,
  block,
  onCommit,
  toolbarContainer,
}: BlockEditorProps<Extract<DocBlock, { type: "paragraph" }>>) {
  // ★★★ An image in a document paragraph is REACHABLE TODAY (model-authored
  //  HTML goes through sanitizeDocumentHtml, which admits `img`), and the
  //  shared editor commits through sanitizeRichHtml, which does not. `img` is
  //  a VOID element, so it would not unwrap to text — it would vanish. Render
  //  read-only, and SAY WHY: a disabled control with no reason reads as broken.
  if (paragraphHasImage(block.html)) {
    return <BlockReadOnlyNotice html={block.html} reason={t(lang, "documentsBlockImageReadOnly")} />;
  }
  return (
    <ParagraphEditorBody
      lang={lang}
      index={index}
      block={block}
      onCommit={onCommit}
      toolbarContainer={toolbarContainer}
    />
  );
}

/** Split out so the read-only branch above returns BEFORE any hook runs —
 *  a conditional hook call is a lint error and a React rules violation. */
function ParagraphEditorBody({
  lang,
  index,
  block,
  onCommit,
  toolbarContainer,
}: BlockEditorProps<Extract<DocBlock, { type: "paragraph" }>>) {
  const { value: html, setValue: setHtml, commit, seedNonce, refusal } = useBlockDraft(
    (b: Extract<DocBlock, { type: "paragraph" }>): string => b.html,
    block,
    index,
    (nextHtml): DocBlock => ({ type: "paragraph", html: nextHtml }),
    onCommit,
  );

  return (
    <div onBlur={commit}>
      {/* ★★★ KEYED ON THE SEED NONCE. Tiptap binds `content` ONCE at mount
          (`useEditor({ content: value })` in rich-text-editor.tsx), so a
          changed `value` prop CANNOT reach a mounted editor — the only two
          ways in are the imperative handle (which offers `appendText` alone,
          and cannot replace content) and a remount.
          ★★ A REMOUNT IS EXPENSIVE, NOT FREE: it drops DOM focus and wipes
          ProseMirror's undo history. The nonce therefore bumps only when the
          adopted CONTENT differs from the draft on screen — not merely when a
          new block object arrives. An earlier revision of this comment said
          "ordinary typing never remounts and never loses the caret", which was
          true of typing and false of the blur that follows it: `onBlur` here is
          a bubbling `focusout`, so Shift+Tab from the text into this editor's
          OWN toolbar commits, and the commit echoed a content-identical block
          straight back. See the nonce's own comment in `useBlockDraft`. */}
      <RichTextEditor
        key={seedNonce}
        value={html}
        onChange={setHtml}
        label={t(lang, "documentsParagraphLabel", String(index + 1))}
        lang={lang}
        toolbarContainer={toolbarContainer}
      />
      {refusal && <BlockRefusalNotice lang={lang} refusal={refusal} />}
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
  const { value, setValue, commit, commitValue, refusal } = useBlockDraft(
    (b: Extract<DocBlock, { type: "bullets" }>): BulletsDraft => ({
      items: b.items,
      ordered: b.ordered === true,
    }),
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
            <Input
              aria-label={qualify(t(lang, "documentsListItem", String(i + 1)))}
              className="flex-1"
              size="xs"
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
            <Button
              variant="secondary"
              size="xs"
              aria-label={qualify(t(lang, "documentsMoveItemUp", String(i + 1)))}
              disabled={i === 0}
              onClick={() => moveItem(i, i - 1)}
            >
              <span aria-hidden="true">{"↑"}</span>
            </Button>
            <Button
              variant="secondary"
              size="xs"
              aria-label={qualify(t(lang, "documentsMoveItemDown", String(i + 1)))}
              disabled={i === value.items.length - 1}
              onClick={() => moveItem(i, i + 1)}
            >
              <span aria-hidden="true">{"↓"}</span>
            </Button>
            <Button
              variant="secondary"
              size="xs"
              aria-label={qualify(t(lang, "documentsRemoveItem", String(i + 1)))}
              // ★ Mirrors document-table-editor.tsx's remove-row/remove-column
              //  bounds. Removing the last item produces `items: []`, which
              //  document-model.ts drops on load — the block would render for
              //  the session and vanish, with no add-block control to bring it
              //  back. A real `disabled` attribute, never `aria-disabled`:
              //  the lookalike still fires onClick.
              disabled={value.items.length <= 1}
              onClick={() => removeItem(i)}
            >
              <span aria-hidden="true">{"✕"}</span>
            </Button>
          </li>
        ))}
      </ul>

      <div>
        <Button
          variant="secondary"
          size="xs"
          aria-label={qualify(t(lang, "documentsAddItem"))}
          onClick={addItem}
        >
          {t(lang, "documentsAddItem")}
        </Button>
      </div>
      {refusal && <BlockRefusalNotice lang={lang} refusal={refusal} />}
    </div>
  );
}

// The table editor repeats controls on THREE axes (block, row, column) and
// pushed this file past the file-size gate's headroom — split out to keep
// `useBlockDraft`/`BlockReadOnlyNotice` here as the shared template while the
// per-kind editor bodies stay one file each. Re-exported so callers (and this
// file's own test imports) don't need to know it moved.
export { TableBlockEditor } from "./document-table-editor";

/**
 * A `select` over the fifteen `ExportSectionKey`s — never free text. An
 * arbitrary key would resolve to no section at render time
 * (`resolveDataSection` looks it up by exact match) and render as nothing —
 * a silently missing section rather than a visible error — so free text
 * would be actively worse than no editor at all.
 *
 * `EXPORT_SECTION_KEYS` is imported directly from `./settings-types` — the
 * SAME way `document-model.ts`'s own `isSectionKey` reads it, and NOT
 * through `document-model.ts`, which documents a runtime import cycle
 * through this exact pair of modules ("There is a runtime import cycle
 * around this module: settings-types.ts imports [...], and this file
 * imports EXPORT_SECTION_KEYS back from ./settings-types" — its own header
 * comment). A direct top-level import here sits OUTSIDE that cycle and is
 * read fresh at CALL time on every render (a plain module-level array,
 * never memoized into a derived `Set` this component owns) — the shape
 * that cycle's own comment warns against freezing.
 *
 * A `<select>` has no meaningful "finished editing" blur to hang a deferred
 * commit off — picking an option IS the finished edit — so it commits
 * synchronously via `commitValue`, exactly like the bullets/table editors'
 * structural (add/remove/move) controls do.
 */
export function DataSectionBlockEditor({
  lang,
  index,
  block,
  onCommit,
}: BlockEditorProps<Extract<DocBlock, { type: "dataSection" }>>) {
  const { value, commitValue, refusal } = useBlockDraft(
    (b: Extract<DocBlock, { type: "dataSection" }>): ExportSectionKey => b.key,
    block,
    index,
    (key): DocBlock => ({ type: "dataSection", key }),
    onCommit,
  );

  // ★ Qualified with the block position via `documentsBlockN`, joined with
  //  an en dash — never a bare trailing digit (rejected in review). Unlike
  //  HeadingBlockEditor's per-block `<select>`, whose bare index already
  //  disambiguates because a heading block has only ONE such control, this
  //  select has no item/row/column-local number of its own to fall back on,
  //  so it follows the bullets/table editors' qualifier pattern instead.
  const blockQualifier = t(lang, "documentsBlockN", String(index + 1));

  // ★ The wrapper exists ONLY so the refusal notice has somewhere to render.
  //  A concurrent write reaches this editor exactly like any other; before the
  //  wrapper the abandon was silent here and the select simply snapped back to
  //  the external write's key.
  return (
    <div className="flex flex-col gap-1">
      <Select
        aria-label={`${t(lang, "documentsDataSectionKey")} – ${blockQualifier}`}
        value={value}
        onChange={(e) => commitValue(e.target.value as ExportSectionKey)}
      >
        {EXPORT_SECTION_KEYS.map((k) => (
          <option key={k} value={k}>
            {t(lang, EXPORT_SECTION_LABEL_KEYS[k])}
          </option>
        ))}
      </Select>
      {refusal && <BlockRefusalNotice lang={lang} refusal={refusal} />}
    </div>
  );
}

/** A page break has no editable content. It still renders a row in the block
 *  list so it stays reachable and announced — a block that silently vanishes
 *  in edit mode reads as data loss. */
export function PageBreakBlockEditor({
  lang,
}: BlockEditorProps<Extract<DocBlock, { type: "pageBreak" }>>) {
  return <p className="text-xs text-muted-foreground">{t(lang, "documentsBlockNoEditor")}</p>;
}
