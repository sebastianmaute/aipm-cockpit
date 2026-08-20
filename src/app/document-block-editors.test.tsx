import { describe, it, expect, beforeAll, vi } from "vitest";
import { StrictMode } from "react";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ParagraphBlockEditor,
  HeadingBlockEditor,
  BulletsBlockEditor,
  TableBlockEditor,
  DataSectionBlockEditor,
  PageBreakBlockEditor,
} from "./document-block-editors";
import { DocumentEditor } from "./document-editor";
import { replaceBlockOp } from "./document-editor-commit";
import { applyDocMutation, type DocOp, type DocState } from "./document-mutations";
import { t } from "./i18n";
import type { DocBlock, ProjectDocument } from "./document-model";
import { MAX_TABLE_COLUMNS } from "./document-model";
import { EXPORT_SECTION_KEYS } from "./settings-types";

/** `structural` is REQUIRED on `DocumentEditorProps`. The three fixtures in
 *  this file exercise the CONTENT commit path only and never touch the block
 *  set, so one shared stub is enough — and a STABLE identity is what a
 *  `rerender`-based fixture wants, since a fresh object every render would be
 *  a prop change none of these tests mean to make. */
const noStructural = { insert: vi.fn(), remove: vi.fn(), move: vi.fn() };

// ProseMirror touches layout APIs jsdom lacks; stub them so typing works.
// Mirrors rich-text-editor.test.tsx's beforeAll — without it userEvent.type
// on the contenteditable silently no-ops (getClientRects is not a function),
// which reads as "commit never fired" rather than the real jsdom gap.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
  // userEvent's pointer press calls document.elementFromPoint (absent in jsdom).
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
});

const LANG = "en-US" as const;

/** The heading editor's accessible names, 0-based block index in, en-dash
 *  qualified name out. Spelled once so a convention change is one edit. */
const headingTextName = (index: number) =>
  `${t(LANG, "documentsHeadingText")} – ${t(LANG, "documentsBlockN", String(index + 1))}`;
const headingLevelName = (index: number) =>
  `${t(LANG, "documentsHeadingLevel")} – ${t(LANG, "documentsBlockN", String(index + 1))}`;

describe("ParagraphBlockEditor", () => {
  it("renders an editor for a paragraph with no image", () => {
    render(
      <ParagraphBlockEditor
        lang={LANG}
        index={0}
        block={{ type: "paragraph", html: "<p>hello</p>" }}
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.queryByText(t(LANG, "documentsBlockImageReadOnly"))).toBeNull();
  });

  it("renders READ-ONLY with a stated reason when the paragraph holds an image", () => {
    const onCommit = vi.fn();
    render(
      <ParagraphBlockEditor
        lang={LANG}
        index={0}
        block={{ type: "paragraph", html: '<p>a</p><img src="x.png">' }}
        onCommit={onCommit}
      />,
    );
    // The reason is stated, not merely implied by a disabled control.
    expect(screen.getByText(t(LANG, "documentsBlockImageReadOnly"))).toBeInTheDocument();
    // No toolbar means no editor mounted.
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // ★★★ CRITICAL fix: the read-only branch renders `block.html` via
  //  dangerouslySetInnerHTML and MUST re-sanitize at the sink (sanitizeDocumentHtml
  //  — never sanitizeRichHtml, which drops <img> outright and would blank the
  //  image this branch exists to display). Assert on the rendered DOM, not the
  //  input string — a substring check on the source HTML cannot tell "stripped"
  //  from "present but escaped as text".
  it("sanitizes the read-only sink: keeps the image, drops a script", () => {
    const container = render(
      <ParagraphBlockEditor
        lang={LANG}
        index={0}
        block={{
          type: "paragraph",
          html: '<p>a</p><img src="x.png"><script>window.__xss = true</script>',
        }}
        onCommit={vi.fn()}
      />,
    ).container;
    expect(container.querySelector("img")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("__xss");
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();
  });

  it("gives two sibling paragraph editors DISTINCT accessible names", async () => {
    // ★★★ The axe gate cannot see a duplicate accessible name at ANY seed size.
    // This test is the only possible detector, and it needs TWO blocks to
    // express the property at all.
    render(
      <>
        <ParagraphBlockEditor lang={LANG} index={0} block={{ type: "paragraph", html: "<p>one</p>" }} onCommit={vi.fn()} />
        <ParagraphBlockEditor lang={LANG} index={1} block={{ type: "paragraph", html: "<p>two</p>" }} onCommit={vi.fn()} />
      </>,
    );
    const toolbars = screen.getAllByRole("toolbar");
    expect(toolbars).toHaveLength(2);
    const names = toolbars.map((el) => el.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
  });

  // ★ Strengthened from a single-chunk type: one chunk cannot distinguish a
  //  live closure from a closure captured once at first render (both would
  //  commit the same final value after exactly one edit). Two separate
  //  `userEvent.type` calls force an intervening re-render, so this is the
  //  only shape that could have caught a stale-closure regression.
  it("commits the LATEST value on blur after two separate edits", async () => {
    const onCommit = vi.fn();
    render(
      <ParagraphBlockEditor lang={LANG} index={2} block={{ type: "paragraph", html: "<p>x</p>" }} onCommit={onCommit} />,
    );
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    editable.focus();
    editable.blur();
    // Focused and left untouched — nothing to save.
    expect(onCommit).not.toHaveBeenCalled();

    editable.focus();
    // ★ Pin the caret to end-of-content before typing. A prior ProseMirror
    //  mount/unmount elsewhere in the suite can leave async selection
    //  residue in jsdom, and `.focus()` alone does not set a caret position —
    //  without this, the first typed chunk sometimes lands at the START
    //  ("yxz" instead of "xyz"), an intermittent flake (~24% of runs) that
    //  happens inside ProseMirror before `onChange` even fires, not a
    //  product bug. Keep the TWO separate `userEvent.type` calls below (see
    //  the comment above this test) — collapsing them to one call would stop
    //  exercising the stale-closure shape this test exists to catch.
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(false); // end
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    await userEvent.type(editable, "y");
    await userEvent.type(editable, "z");
    editable.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [index, block] = onCommit.mock.calls[0];
    expect(index).toBe(2);
    expect(block.type).toBe("paragraph");
    // Both chunks reached the commit, not just the one from the render the
    // handler might have been stale-closed over.
    expect(block.html).toContain("xyz");
  });

  // ★ IMPORTANT per review: type, then revert to the original text, then blur.
  //  onChange delivers a ProseMirror RE-SERIALIZATION (editor.getHTML(), already
  //  passed through sanitizeRichHtml by RichTextEditor) while `block.html` arrived
  //  by a different path (the document-editor-commit's stored form). If that
  //  round-trip is not byte-identical, blockChanged reports a change and every
  //  touched-but-unedited block would mint a spurious document version.
  //
  //  MEASURED: for a plain "<p>x</p>" with no formatting, Tiptap's serialization
  //  round-trips byte-identical after type+backspace — this test asserts NO
  //  commit fires, and it currently PASSES. This does not generalise to every
  //  stored shape (attribute order, self-closing empty elements, whitespace
  //  normalisation are all real ProseMirror serializer choices this block editor
  //  does not control) — only the plain-paragraph case is exercised here.
  it("does NOT commit when typed content is reverted to the original before blur", async () => {
    const onCommit = vi.fn();
    render(
      <ParagraphBlockEditor lang={LANG} index={3} block={{ type: "paragraph", html: "<p>x</p>" }} onCommit={onCommit} />,
    );
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    editable.focus();
    // ★ Pin the caret to end-of-content before typing — same cross-test
    //  ProseMirror selection residue as the two-chunk blur test above. If
    //  "y" landed at the START instead of the end, Backspace would remove a
    //  DIFFERENT character than the one just typed, the content would no
    //  longer equal the original, and this test would flake into a spurious
    //  commit (~24% of runs when preceded by another rich-text mount).
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(false); // end
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    await userEvent.type(editable, "y");
    await userEvent.type(editable, "{Backspace}");
    editable.blur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // ★★★ Shared useBlockDraft behaviour, pinned here because a hook change
  //  affects every block editor. A pending edit with no blur used to be
  //  silently discarded on unmount (leaving edit mode, navigating away, a
  //  block-list re-render dropping the block — none of those fire the DOM
  //  blur event `commit` relies on). These three pin the fix's full
  //  contract: something to flush, nothing to flush, and no double-flush
  //  of an edit a blur already committed.
  it("flushes a pending edit on unmount when there was no blur", async () => {
    const onCommit = vi.fn();
    const { unmount } = render(
      <ParagraphBlockEditor lang={LANG} index={4} block={{ type: "paragraph", html: "<p>x</p>" }} onCommit={onCommit} />,
    );
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    editable.focus();
    await userEvent.type(editable, "y");
    unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [index, block] = onCommit.mock.calls[0];
    expect(index).toBe(4);
    expect(block.type).toBe("paragraph");
    expect(block.html).toContain("y");
  });

  it("commits nothing on unmount when the draft was never touched", () => {
    const onCommit = vi.fn();
    const { unmount } = render(
      <ParagraphBlockEditor lang={LANG} index={5} block={{ type: "paragraph", html: "<p>x</p>" }} onCommit={onCommit} />,
    );
    unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not double-commit on unmount after a blur already committed the edit", async () => {
    const onCommit = vi.fn();
    const { unmount } = render(
      <ParagraphBlockEditor lang={LANG} index={6} block={{ type: "paragraph", html: "<p>x</p>" }} onCommit={onCommit} />,
    );
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    editable.focus();
    await userEvent.type(editable, "y");
    editable.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  // ★★★ THE CONCURRENT-WRITE GUARD. Losing an unblurred keystroke burst is
  //  recoverable — silently overwriting a concurrent AI write is not (AI
  //  writes carry no undo). `storedBlock` moves to "concurrent-write" WHILE
  //  the draft is dirty, so baselineRef must have frozen at "base" instead
  //  of tracking the move — the unmount flush has to see that mismatch and
  //  abandon rather than commit the stale pre-conflict draft over it.
  it("abandons the unmount flush when storedBlock changed underneath a dirty draft", async () => {
    const onCommit = vi.fn();
    const { rerender, unmount } = render(
      <ParagraphBlockEditor lang={LANG} index={7} block={{ type: "paragraph", html: "<p>base</p>" }} onCommit={onCommit} />,
    );
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    editable.focus();
    await userEvent.type(editable, "X");
    rerender(
      <ParagraphBlockEditor
        lang={LANG}
        index={7}
        block={{ type: "paragraph", html: "<p>concurrent-write</p>" }}
        onCommit={onCommit}
      />,
    );
    unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // The other half of the same guard: an UNTOUCHED editor's baseline tracks
  // a live storedBlock change (so a LATER edit starts from the right
  // place), but that must never be mistaken for something to flush — no
  // local edit ever happened.
  it("commits nothing on unmount when untouched but storedBlock changed underneath", () => {
    const onCommit = vi.fn();
    const { rerender, unmount } = render(
      <ParagraphBlockEditor lang={LANG} index={8} block={{ type: "paragraph", html: "<p>base</p>" }} onCommit={onCommit} />,
    );
    rerender(
      <ParagraphBlockEditor lang={LANG} index={8} block={{ type: "paragraph", html: "<p>changed</p>" }} onCommit={onCommit} />,
    );
    unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // ★★★ StrictMode PINNED, not merely probed. `render(<StrictMode>{ui}</StrictMode>)`
  //  literally wraps the root's child in StrictMode — nothing else sits
  //  between them, satisfying strictmode.meta.test.tsx's Corollary 1 for the
  //  MOUNT commit (a wrapper FUNCTION composing <StrictMode> inside it would
  //  NOT satisfy this and would make the test vacuous-but-green). React
  //  therefore double-invokes this editor's mount effects (mount → cleanup →
  //  mount) BEFORE the edit below ever happens, while the draft is still
  //  clean — that synthetic cleanup must flush nothing, and only the REAL
  //  unmount (after the edit) may flush, exactly once total.
  it("flushes exactly once on unmount under StrictMode (double-invoked mount effects)", async () => {
    const onCommit = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <ParagraphBlockEditor lang={LANG} index={9} block={{ type: "paragraph", html: "<p>x</p>" }} onCommit={onCommit} />
      </StrictMode>,
    );
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    editable.focus();
    await userEvent.type(editable, "y");
    unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][1].html).toContain("y");
  });
});

describe("HeadingBlockEditor", () => {
  it("offers only levels 1-3", () => {
    render(
      <HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 1, text: "H" }} onCommit={vi.fn()} />,
    );
    const select = screen.getByRole("combobox", { name: headingLevelName(0) });
    expect(within(select).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["1", "2", "3"]);
  });

  it("gives two sibling headings ROW-UNIQUE control names", () => {
    // ★★★ The axe gate cannot see a duplicate accessible name at ANY seed
    //  size — this test is the only possible detector, and it needs TWO
    //  blocks (at different indices) to express the property at all.
    render(
      <>
        <HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 1, text: "A" }} onCommit={vi.fn()} />
        <HeadingBlockEditor lang={LANG} index={1} block={{ type: "heading", level: 2, text: "B" }} onCommit={vi.fn()} />
      </>,
    );
    const selectNames = screen.getAllByRole("combobox").map((el) => el.getAttribute("aria-label"));
    expect(new Set(selectNames).size).toBe(2);
    const textNames = screen.getAllByRole("textbox").map((el) => el.getAttribute("aria-label"));
    expect(new Set(textNames).size).toBe(2);
  });

  it("does not commit when nothing changed", () => {
    const onCommit = vi.fn();
    render(
      <HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 2, text: "Same" }} onCommit={onCommit} />,
    );
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    text.focus();
    text.blur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // ★ Strengthened from a single-chunk type per the paragraph editor's own
  //  precedent: one chunk cannot distinguish a live closure from one
  //  captured once at first render. Two separate `userEvent.type` calls
  //  force an intervening re-render — the only shape that could catch a
  //  stale-closure regression.
  it("commits the LATEST text value on blur after two separate edits", async () => {
    const onCommit = vi.fn();
    render(
      <HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 2, text: "Old" }} onCommit={onCommit} />,
    );
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.clear(text);
    await userEvent.type(text, "Ne");
    await userEvent.type(text, "w");
    text.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0, { type: "heading", level: 2, text: "New" }, expect.anything());
  });

  // ★ NOT a combined-commit test — it blurs the select alone, with the text
  //  field never focused, so this only exercises a single control's own
  //  blur firing the group's onBlur. Tabbing to the text field afterward
  //  fires a SECOND, independent commit (see HeadingBlockEditor's docstring).
  // ★★ THE WIRING PROOF for the normalise-at-commit rule, and it needs BOTH
  //  halves. The loader trims a heading, so committing the raw draft stored
  //  "Q3 review  " while the next load held "Q3 review" — a stored-vs-loaded
  //  mismatch with no user-visible cause. Pinned at the COMPONENT because the
  //  pure rule holding (document-editor-commit.test.ts) says nothing about
  //  whether `tryCommit` actually calls it.
  it("commits the heading text TRIMMED, matching what the loader stores", async () => {
    const onCommit = vi.fn();
    render(
      <HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 2, text: "Q3" }} onCommit={onCommit} />,
    );
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, " review  ");
    text.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    // Internal whitespace survives; only the edges go.
    expect(onCommit).toHaveBeenCalledWith(0, { type: "heading", level: 2, text: "Q3 review" }, expect.anything());
  });

  // ★ The other half: an edit that normalises back to the stored value is NOT
  //  a change, so it mints no document version. Without this the test above
  //  passes on a hook that trims but still commits every whitespace keystroke.
  it("does not commit when the only edit is trailing whitespace", async () => {
    const onCommit = vi.fn();
    render(
      <HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 2, text: "Q3" }} onCommit={onCommit} />,
    );
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "   ");
    text.blur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits a level change on its own blur", () => {
    const onCommit = vi.fn();
    render(
      <HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 1, text: "Title" }} onCommit={onCommit} />,
    );
    const select = screen.getByRole("combobox", { name: headingLevelName(0) });
    select.focus();
    fireEvent.change(select, { target: { value: "3" } });
    select.blur();
    expect(onCommit).toHaveBeenCalledWith(0, { type: "heading", level: 3, text: "Title" }, expect.anything());
  });

  // ★★★ Pins the docstring's corrected claim: onBlur is a bubbling
  //  focusout, so moving focus from the select to the text field (a real
  //  tab-through) already fires ONE commit for the select alone, before
  //  the text field is even touched — it does NOT wait for a combined
  //  commit that never happens on this path.
  it("fires an independent commit for the level change when focus moves to the text field", () => {
    const onCommit = vi.fn();
    render(
      <HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 1, text: "Title" }} onCommit={onCommit} />,
    );
    const select = screen.getByRole("combobox", { name: headingLevelName(0) });
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    select.focus();
    fireEvent.change(select, { target: { value: "3" } });
    text.focus(); // tab-through: blurs the select, which bubbles to the group's onBlur
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0, { type: "heading", level: 3, text: "Title" }, expect.anything());
  });

  // ★★★ A BARE TRAILING DIGIT IS AMBIGUOUS HERE IN A WAY IT IS NOT ELSEWHERE.
  //  The select's options are H1/H2/H3, so "Heading level 1" reads as LEVEL
  //  one, not BLOCK one — the qualifier and the control's own subject collide.
  //  Three other editors in this slice already state this rule verbatim; this
  //  one shipped against it.
  it("qualifies both heading controls with the en-dash block convention, not a bare digit", () => {
    const block: Extract<DocBlock, { type: "heading" }> = { type: "heading", level: 2, text: "Q3" };
    render(<HeadingBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const expected = `${t(LANG, "documentsBlockN", "1")}`;
    const select = screen.getByRole("combobox", {
      name: `${t(LANG, "documentsHeadingLevel")} – ${expected}`,
    });
    const text = screen.getByRole("textbox", {
      name: `${t(LANG, "documentsHeadingText")} – ${expected}`,
    });
    expect(select).toBeInTheDocument();
    expect(text).toBeInTheDocument();
    // The old bare-digit form must be GONE, or both spellings would resolve and
    // the rename would be cosmetic.
    expect(screen.queryByRole("textbox", { name: `${t(LANG, "documentsHeadingText")} 1` })).toBeNull();
  });
});

describe("BulletsBlockEditor", () => {
  const block: Extract<DocBlock, { type: "bullets" }> = { type: "bullets", items: ["one", "two"] };

  // ★★★ Every label here is qualified with the block position via
  //  `documentsBlockN` ("Block {0}"), joined onto the base label with an en
  //  dash — `documentsListOrdered` and `documentsAddItem` have NO `{0}`
  //  placeholder at all, so without a qualifier two sibling bullets blocks
  //  would render identically-named controls (see the block-uniqueness test
  //  below, the only thing that can catch that collision — axe cannot). A
  //  bare trailing digit ("Remove item 1 1") was tried and rejected — it
  //  reads as a second item number, not a stated block relationship.
  const blockQ = (n: number) => t(LANG, "documentsBlockN", String(n));
  const qualified = (label: string, n = 1) => `${label} – ${blockQ(n)}`;

  it("gives every per-item control an ITEM-UNIQUE accessible name", () => {
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const removes = screen.getAllByRole("button", { name: /^Remove item/ });
    expect(removes).toHaveLength(2);
    expect(new Set(removes.map((b) => b.getAttribute("aria-label"))).size).toBe(2);
  });

  // ★★★ ADDING AN ITEM RENDERS A ROW AND COMMITS NOTHING, and the second half
  //  is the point. `addItem` appends `""`, which the loader drops — so the old
  //  behaviour (commit `["one","two",""]`) stored a block the next load rewrote
  //  to `["one","two"]`, burning one of the document's MAX_VERSIONS_PER_DOC (20)
  //  history slots and making the row the user just added vanish on reload.
  //  `tryCommit` now normalises first, so the add is a no-op against the
  //  baseline and no version is minted until the item carries text.
  it("adds an item ROW without committing an empty item", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: qualified(t(LANG, "documentsAddItem")) }));
    expect(screen.getAllByRole("textbox", { name: /^Item \d+/ })).toHaveLength(3);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the added item once it carries text", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: qualified(t(LANG, "documentsAddItem")) }));
    const added = screen.getByRole("textbox", { name: qualified(t(LANG, "documentsListItem", "3")) });
    await userEvent.type(added, "three");
    added.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(
      0,
      { type: "bullets", items: ["one", "two", "three"] },
      expect.anything(),
    );
  });

  // ★★★ THE ADDED ROW MUST SURVIVE OUR OWN WRITE COMING BACK. `addItem` appends
  //  an empty item that `normalizeBlockForStorage` drops, so the add commits
  //  nothing and the row lives ONLY in the draft. Committing a SIBLING edit then
  //  hands `applyOps` a new object, and a reconcile keyed on identity re-seeded
  //  the draft from storage and silently deleted the row the user had just added
  //  (measured: 3 rows on screen before the sibling edit, 2 after). The guard
  //  compares CONTENT against the last committed baseline instead, so an echo of
  //  our own write is not treated as an external one.
  it("keeps an added row when this hook's OWN commit echoes back", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />,
    );
    await userEvent.click(screen.getByRole("button", { name: qualified(t(LANG, "documentsAddItem")) }));
    expect(screen.getAllByRole("textbox", { name: /^Item \d+/ })).toHaveLength(3);

    const first = screen.getByRole("textbox", { name: qualified(t(LANG, "documentsListItem", "1")) });
    await userEvent.type(first, "!");
    act(() => {
      first.blur();
    });
    expect(onCommit).toHaveBeenCalledWith(
      0,
      { type: "bullets", items: ["one!", "two"] },
      expect.anything(),
    );

    // The engine stores `op.block` verbatim, so the parent re-renders with a NEW
    // object carrying exactly what we just committed.
    rerender(
      <BulletsBlockEditor
        lang={LANG}
        index={0}
        block={{ type: "bullets", items: ["one!", "two"] }}
        onCommit={onCommit}
      />,
    );
    expect(screen.getAllByRole("textbox", { name: /^Item \d+/ })).toHaveLength(3);
  });

  // ★ The CONTRAST case: a genuinely EXTERNAL write (content this hook never
  //  committed) still wins, draft-only row and all. Without this the guard above
  //  could be widened to "never re-seed" and both tests would still pass.
  it("re-seeds from a genuinely external write, dropping the draft-only row", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />,
    );
    await userEvent.click(screen.getByRole("button", { name: qualified(t(LANG, "documentsAddItem")) }));
    expect(screen.getAllByRole("textbox", { name: /^Item \d+/ })).toHaveLength(3);

    rerender(
      <BulletsBlockEditor
        lang={LANG}
        index={0}
        block={{ type: "bullets", items: ["externally", "rewritten"] }}
        onCommit={onCommit}
      />,
    );
    const rows = screen.getAllByRole("textbox", { name: /^Item \d+/ });
    expect(rows).toHaveLength(2);
    expect((rows[0] as HTMLInputElement).value).toBe("externally");
  });

  // ★ The visible label stays the plain, unqualified "Add item" — only the
  //  accessible name carries the block qualifier (mirrors ToggleButton's
  //  WCAG 4.1.2 contract: visible text vs. aria-label are allowed to differ,
  //  never the visible text alone growing a number that misreads as part of
  //  the label). WCAG 2.5.3 still holds: the accessible name CONTAINS the
  //  visible text.
  it("keeps the Add-item VISIBLE label unqualified", () => {
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const addButton = screen.getByRole("button", { name: qualified(t(LANG, "documentsAddItem")) });
    expect(addButton.textContent).toBe(t(LANG, "documentsAddItem"));
  });

  it("removes an item", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(
      screen.getByRole("button", { name: qualified(t(LANG, "documentsRemoveItem", "1")) }),
    );
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["two"] }, expect.anything());
  });

  it("moves an item down", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(
      screen.getByRole("button", { name: qualified(t(LANG, "documentsMoveItemDown", "1")) }),
    );
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["two", "one"] }, expect.anything());
  });

  it("cannot move the first item up or the last item down", () => {
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: qualified(t(LANG, "documentsMoveItemUp", "1")) }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: qualified(t(LANG, "documentsMoveItemDown", "2")) }),
    ).toBeDisabled();
  });

  it("toggles ordered", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(
      screen.getByRole("button", { name: qualified(t(LANG, "documentsListOrdered")) }),
    );
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["one", "two"], ordered: true }, expect.anything());
  });

  // ★★★ The axe gate cannot see a duplicate accessible name at ANY seed size
  //  (measured against axe 4.12.1 in AGENTS.md) — this is the only possible
  //  detector, and it needs TWO blocks to express the collision at all.
  //  Covers BOTH axes at once: the toggle and Add-item labels (no `{0}` to
  //  fall back on) and a per-item control (which already varies by item
  //  number WITHIN a block but collides ACROSS blocks without the qualifier).
  it("gives block-position-dependent controls DISTINCT names across sibling bullets blocks", () => {
    render(
      <>
        <BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />
        <BulletsBlockEditor lang={LANG} index={1} block={block} onCommit={vi.fn()} />
      </>,
    );
    const toggles = screen.getAllByRole("button", { name: new RegExp(`^${t(LANG, "documentsListOrdered")}`) });
    expect(toggles).toHaveLength(2);
    expect(new Set(toggles.map((b) => b.getAttribute("aria-label"))).size).toBe(2);

    const adds = screen.getAllByRole("button", { name: new RegExp(`^${t(LANG, "documentsAddItem")}`) });
    expect(adds).toHaveLength(2);
    expect(new Set(adds.map((b) => b.getAttribute("aria-label"))).size).toBe(2);
    // Visible text is deliberately IDENTICAL across blocks — only the
    // aria-label differs. That is the point of keeping it unqualified.
    expect(new Set(adds.map((b) => b.textContent)).size).toBe(1);

    const removeItem1 = screen.getAllByRole("button", { name: new RegExp(`^${t(LANG, "documentsRemoveItem", "1")}`) });
    expect(removeItem1).toHaveLength(2);
    expect(new Set(removeItem1.map((b) => b.getAttribute("aria-label"))).size).toBe(2);
  });

  it("does not commit when nothing changed", () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    const text = screen.getByRole("textbox", { name: qualified(t(LANG, "documentsListItem", "1")) });
    text.focus();
    text.blur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // ★ Strengthened from a single-chunk type per the paragraph/heading
  //  editors' own precedent: one chunk cannot distinguish a live closure
  //  from one captured once at first render. Two separate `userEvent.type`
  //  calls force an intervening re-render.
  it("commits the LATEST item text on blur after two separate edits", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    const text = screen.getByRole("textbox", { name: qualified(t(LANG, "documentsListItem", "1")) });
    await userEvent.clear(text);
    await userEvent.type(text, "on");
    await userEvent.type(text, "e2");
    text.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["one2", "two"] }, expect.anything());
  });

  // ★★★ CRITICAL regression test. Add/remove/move/toggle commit via the
  //  shared hook's `commitValue`, which fires `onCommit` SYNCHRONOUSLY
  //  inside this very click handler — not via a `setValue` + a later effect
  //  reading the value back out. The prior shape (a `pendingCommit` ref
  //  drained by a post-render effect) had a real window: `dirtyRef` was set
  //  synchronously, but the VALUE the effect would commit only became
  //  visible to it once a render had completed, so an unmount that
  //  preempted that render read a stale, unchanged value, saw no diff, and
  //  dropped the edit — the item vanished with `onCommit` never called.
  //  A raw `.click()` (bypassing RTL/userEvent's automatic `act()` flush, so
  //  no render or effect is guaranteed before the very next line) followed
  //  by an immediate `unmount()` is exactly the shape that exposed it.
  //  ★★ The structural action is a REMOVE, not an add, and it has to be: an
  //   add appends `""`, which normalises away, so it commits nothing and the
  //   assertion below would pass for the wrong reason on both the fixed and
  //   the broken hook. Any action whose normalised result differs from the
  //   baseline works; remove is the cheapest.
  it("commits a structural change on immediate unmount with NO intervening render", () => {
    const onCommit = vi.fn();
    const { unmount } = render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    const removeItem1 = screen.getByRole("button", {
      name: qualified(t(LANG, "documentsRemoveItem", "1")),
    });
    removeItem1.click();
    unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["two"] }, expect.anything());
  });

  // ★★★ The "N saves in one tick" landmine (AGENTS.md), for a block editor:
  //  `commitValue` resolves its functional updater against the hook's own
  //  `liveValueRef`, never this render's `value`, so two structural actions
  //  batched into ONE event (a real double-click, or React 18 batching two
  //  `.click()` calls inside one `act`) each build on the OTHER's already-
  //  applied change. A `{...value, ...}` spread reading the render-scope
  //  `value` would have both handlers close over the SAME pre-batch
  //  snapshot, and the second commit would silently overwrite the first's
  //  change instead of building on it.
  //  ★★ THE PAIR IS REMOVE-THEN-TOGGLE, and the choice is load-bearing twice
  //   over. An ADD commits nothing now (it appends `""`, which normalises
  //   away), so it cannot be the first half. And a remove+remove pair would be
  //   VACUOUS: dropping index 0 from the stale 2-item snapshot and from the
  //   live list both yield `["two"]`, so the assertion would pass whichever
  //   value the second handler read. Toggling `ordered` second makes the two
  //   readings differ — live gives `{items:["two"], ordered:true}`, stale would
  //   give `{items:["one","two"], ordered:true}`.
  it("keeps BOTH intentions when remove and toggle are batched into one event", () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    const removeItem1 = screen.getByRole("button", {
      name: qualified(t(LANG, "documentsRemoveItem", "1")),
    });
    const orderedToggle = screen.getByRole("button", {
      name: qualified(t(LANG, "documentsListOrdered")),
    });
    act(() => {
      removeItem1.click();
      orderedToggle.click();
    });
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenNthCalledWith(1, 0, { type: "bullets", items: ["two"] }, expect.anything());
    expect(onCommit).toHaveBeenNthCalledWith(
      2,
      0,
      { type: "bullets", items: ["two"], ordered: true },
      expect.anything(),
    );
  });

  // ★★★ Shared useBlockDraft behaviour, pinned here for the SAME reason the
  //  paragraph editor pins it: a pending edit with no blur must still be
  //  flushed on unmount. Bullets is the one editor whose structural actions
  //  (add/remove/move/toggle) commit through `commitValue` instead of a
  //  blur — this proves that path leaves the SAME baseline/dirty state a
  //  normal blur-commit would, so the unmount-flush guard for a LATER,
  //  genuinely pending text edit still works afterward.
  //  ★ The structural action is a REMOVE because an add commits nothing (it
  //   appends `""`, which `normalizeBlockForStorage` drops) — there would be
  //   no "already committed" state for the rest of the test to build on.
  //  ★★ WHY THE `rerender`, PRECISELY — and why it is NOT what makes the
  //   second flush succeed, contrary to what an earlier revision of this
  //   comment (and the plan text that first proposed replacing it) both
  //   claimed. `commitValue`'s own `tryCommit` moves `baselineRef` to the
  //   post-add block synchronously; the after-every-render effect that runs
  //   next then resyncs `baselineRef`, `preCommitStoredRef` AND (via
  //   `latestRef`) `externallyWritten`'s `stored` comparator to whatever
  //   `storedBlock` that render actually held — which, with NO `rerender`,
  //   is still the pre-add object this test originally passed to `render`.
  //   All three move together, off the SAME unchanged prop, so they stay
  //   equal to each other on every undirty render regardless — the abandon
  //   guard has no live prop change to ever read as a concurrent write.
  //   Nor does the render-time reconcile fire and undo the add on screen:
  //   it is gated on `storedBlock !== handledBlock`, and without a
  //   `rerender` that identity comparison never flips. Measured, not
  //   assumed — deleting the `rerender` call above and re-running this file
  //   (`npx vitest run src/app/document-block-editors.test.tsx`) still
  //   passes every test, this one included. What the `rerender` actually
  //   buys is narrower: it is what a real parent does after `onCommit`
  //   fires (apply the op, hand the new block back down), and keeping the
  //   fixture honest to that shape — not preventing a clobber — is the
  //   only thing this line is for.
  it("flushes a pending item-text edit on unmount after a structural action already committed", async () => {
    const onCommit = vi.fn();
    const { rerender, unmount } = render(
      <BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: qualified(t(LANG, "documentsRemoveItem", "1")) }),
    );
    expect(onCommit).toHaveBeenCalledTimes(1);
    const afterRemove: Extract<DocBlock, { type: "bullets" }> = { type: "bullets", items: ["two"] };
    expect(onCommit).toHaveBeenCalledWith(0, afterRemove, expect.anything());
    rerender(<BulletsBlockEditor lang={LANG} index={0} block={afterRemove} onCommit={onCommit} />);
    const text = screen.getByRole("textbox", { name: qualified(t(LANG, "documentsListItem", "1")) });
    await userEvent.type(text, "!");
    unmount();
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenNthCalledWith(2, 0, { type: "bullets", items: ["two!"] }, expect.anything());
  });
});

describe("TableBlockEditor", () => {
  const block: Extract<DocBlock, { type: "table" }> = {
    type: "table",
    columns: ["Name", "Owner"],
    rows: [
      ["Alpha", "Ada"],
      ["Beta", "Bob"],
    ],
  };

  // ★★★ Table repeats controls on THREE axes (block, row, column), so every
  //  label here carries the bullets editor's block qualifier ON TOP of
  //  whatever row/column number its own placeholder already carries — see
  //  document-table-editor.tsx's header comment. Row/column numbers alone
  //  only disambiguate WITHIN one table block.
  const blockQ = (n: number) => t(LANG, "documentsBlockN", String(n));
  const qualified = (label: string, n = 1) => `${label} – ${blockQ(n)}`;

  it("gives every cell a ROW-AND-COLUMN-unique accessible name", () => {
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const cells = screen.getAllByRole("textbox", { name: /^Row \d+, column \d+/ });
    expect(cells).toHaveLength(4);
    expect(new Set(cells.map((c) => c.getAttribute("aria-label"))).size).toBe(4);
  });

  it("gives every remove-row and remove-column control a unique name", () => {
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const rows = screen.getAllByRole("button", { name: /^Remove row/ });
    const cols = screen.getAllByRole("button", { name: /^Remove column/ });
    expect(new Set(rows.map((b) => b.getAttribute("aria-label"))).size).toBe(rows.length);
    expect(new Set(cols.map((b) => b.getAttribute("aria-label"))).size).toBe(cols.length);
  });

  // ★ Mirrors the bullets editor's "keeps the Add-item VISIBLE label
  //  unqualified" test: only the accessible name carries the block
  //  qualifier, never the text a sighted user reads.
  it("keeps the Add-row/Add-column VISIBLE labels unqualified", () => {
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const addRow = screen.getByRole("button", { name: qualified(t(LANG, "documentsAddRow")) });
    const addCol = screen.getByRole("button", { name: qualified(t(LANG, "documentsAddColumn")) });
    expect(addRow.textContent).toBe(t(LANG, "documentsAddRow"));
    expect(addCol.textContent).toBe(t(LANG, "documentsAddColumn"));
  });

  it("adds a row with the right number of cells", async () => {
    const onCommit = vi.fn();
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: qualified(t(LANG, "documentsAddRow")) }));
    expect(onCommit).toHaveBeenCalledWith(0, {
      type: "table",
      columns: ["Name", "Owner"],
      rows: [
        ["Alpha", "Ada"],
        ["Beta", "Bob"],
        ["", ""],
      ],
    }, expect.anything());
  });

  it("adds a column to the header AND every row", async () => {
    const onCommit = vi.fn();
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: qualified(t(LANG, "documentsAddColumn")) }));
    expect(onCommit).toHaveBeenCalledWith(0, {
      type: "table",
      columns: ["Name", "Owner", ""],
      rows: [
        ["Alpha", "Ada", ""],
        ["Beta", "Bob", ""],
      ],
    }, expect.anything());
  });

  // ★★★ THE RECONCILE'S SKIP IS NOT "the draft normalises onto storage" — it is
  //  that AND "the draft could still commit AS IT STANDS". A draft the CAP
  //  flattened onto storage satisfies the first and fails the second:
  //  `tryCommit` finds no change, returns false WITHOUT a notice, and the
  //  extra control would sit there swallowing keystrokes. The identity-keyed
  //  re-seed this branch replaced removed it — destructively, but visibly — so
  //  dropping the cap arm turns a self-correcting phantom into a permanent
  //  silent sink.
  //  ★★ "as it stands" is load-bearing: removing any column routes the whole
  //   draft through `commitValue`, which then fits and SAVES the over-cap
  //   text, so this re-seed does discard a recoverable edit (§191).
  //  ★ Counting remove-column buttons rather than header inputs: one per
  //   column, and it is the control the user would actually be stuck with.
  it("re-seeds away a column that cannot commit while the draft stays over the cap", async () => {
    const wide: Extract<DocBlock, { type: "table" }> = {
      type: "table",
      columns: Array.from({ length: MAX_TABLE_COLUMNS }, (_, i) => `C${i + 1}`),
      rows: [Array.from({ length: MAX_TABLE_COLUMNS }, (_, i) => `v${i + 1}`)],
    };
    const columnCount = () => screen.getAllByRole("button", { name: /^Remove column/ }).length;
    const onCommit = vi.fn();
    const { rerender } = render(
      <TableBlockEditor lang={LANG} index={0} block={wide} onCommit={onCommit} />,
    );
    expect(columnCount()).toBe(MAX_TABLE_COLUMNS);

    await userEvent.click(
      screen.getByRole("button", { name: qualified(t(LANG, "documentsAddColumn")) }),
    );
    // The cap ate it: normalising slices back to MAX_TABLE_COLUMNS, so the
    // block is unchanged and nothing is written — silently.
    expect(onCommit).not.toHaveBeenCalled();
    expect(columnCount()).toBe(MAX_TABLE_COLUMNS + 1);

    // Any later parent render — our own commit echoing back, an AI write, a
    // second tab — must clear the phantom. A NEW object carrying the SAME
    // content, which is exactly what `applyOps` hands back.
    rerender(
      <TableBlockEditor
        lang={LANG}
        index={0}
        block={{ ...wide, columns: [...wide.columns], rows: wide.rows.map((r) => [...r]) }}
        onCommit={onCommit}
      />,
    );
    expect(columnCount()).toBe(MAX_TABLE_COLUMNS);
  });

  it("removes a column from the header AND every row", async () => {
    const onCommit = vi.fn();
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(
      screen.getByRole("button", { name: qualified(t(LANG, "documentsRemoveColumn", "1")) }),
    );
    expect(onCommit).toHaveBeenCalledWith(0, {
      type: "table",
      columns: ["Owner"],
      rows: [["Ada"], ["Bob"]],
    }, expect.anything());
  });

  it("removes a row", async () => {
    const onCommit = vi.fn();
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: qualified(t(LANG, "documentsRemoveRow", "1")) }));
    expect(onCommit).toHaveBeenCalledWith(0, {
      type: "table",
      columns: ["Name", "Owner"],
      rows: [["Beta", "Bob"]],
    }, expect.anything());
  });

  it("keeps an existing caption when editing structurally", async () => {
    const onCommit = vi.fn();
    render(
      <TableBlockEditor lang={LANG} index={0} block={{ ...block, caption: "Q3" }} onCommit={onCommit} />,
    );
    await userEvent.click(screen.getByRole("button", { name: qualified(t(LANG, "documentsAddRow")) }));
    expect(onCommit.mock.calls[0][1].caption).toBe("Q3");
  });

  it("commits a cell edit on blur", async () => {
    const onCommit = vi.fn();
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    const cell = screen.getByRole("textbox", { name: qualified(t(LANG, "documentsTableCell", "1", "1")) });
    await userEvent.clear(cell);
    await userEvent.type(cell, "Gamma");
    cell.blur();
    expect(onCommit).toHaveBeenCalledWith(0, {
      type: "table",
      columns: ["Name", "Owner"],
      rows: [
        ["Gamma", "Ada"],
        ["Beta", "Bob"],
      ],
    }, expect.anything());
  });

  // ★★★ The axe gate cannot see a duplicate accessible name at ANY seed size
  //  (AGENTS.md) — this is the only possible detector, and it needs TWO
  //  blocks to express the collision at all. Covers all five repeating
  //  families at once: a cell (already row/column-unique WITHIN a block, but
  //  collides ACROSS blocks without the qualifier), Add-row and Add-column
  //  (neither has a `{0}` to fall back on), Remove-row and Remove-column
  //  (vary by row/column number, still collide across blocks without the
  //  qualifier), and the column-header input (varies by column number only).
  it("gives block-position-dependent controls DISTINCT names across sibling table blocks", () => {
    render(
      <>
        <TableBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />
        <TableBlockEditor lang={LANG} index={1} block={block} onCommit={vi.fn()} />
      </>,
    );

    const cells = screen.getAllByRole("textbox", { name: /^Row 1, column 1/ });
    expect(cells).toHaveLength(2);
    expect(new Set(cells.map((c) => c.getAttribute("aria-label"))).size).toBe(2);

    const adds = screen.getAllByRole("button", { name: new RegExp(`^${t(LANG, "documentsAddRow")}`) });
    expect(adds).toHaveLength(2);
    expect(new Set(adds.map((b) => b.getAttribute("aria-label"))).size).toBe(2);
    // Visible text is deliberately IDENTICAL across blocks — only the
    // aria-label differs. That is the point of keeping it unqualified.
    expect(new Set(adds.map((b) => b.textContent)).size).toBe(1);

    const addCols = screen.getAllByRole("button", { name: new RegExp(`^${t(LANG, "documentsAddColumn")}`) });
    expect(addCols).toHaveLength(2);
    expect(new Set(addCols.map((b) => b.getAttribute("aria-label"))).size).toBe(2);
    expect(new Set(addCols.map((b) => b.textContent)).size).toBe(1);

    const removeRow1 = screen.getAllByRole("button", { name: /^Remove row 1/ });
    expect(removeRow1).toHaveLength(2);
    expect(new Set(removeRow1.map((b) => b.getAttribute("aria-label"))).size).toBe(2);

    const removeCol1 = screen.getAllByRole("button", { name: /^Remove column 1/ });
    expect(removeCol1).toHaveLength(2);
    expect(new Set(removeCol1.map((b) => b.getAttribute("aria-label"))).size).toBe(2);

    const colHeader1 = screen.getAllByRole("textbox", { name: /^Column 1 heading/ });
    expect(colHeader1).toHaveLength(2);
    expect(new Set(colHeader1.map((c) => c.getAttribute("aria-label"))).size).toBe(2);
  });

  // ★ Real `disabled`, not `aria-disabled` — the lookalike still fires
  //  `onClick`. Mirrors the bullets editor's move-up/down boundary disable.
  it("disables Remove-row once only one row remains", () => {
    const single = { ...block, rows: [block.rows[0]] };
    render(<TableBlockEditor lang={LANG} index={0} block={single} onCommit={vi.fn()} />);
    const removeRow = screen.getByRole("button", { name: qualified(t(LANG, "documentsRemoveRow", "1")) });
    expect(removeRow).toBeDisabled();
  });

  it("disables Remove-column once only one column remains", () => {
    const single = { ...block, columns: ["Name"], rows: block.rows.map((r) => [r[0]]) };
    render(<TableBlockEditor lang={LANG} index={0} block={single} onCommit={vi.fn()} />);
    const removeColumn = screen.getByRole("button", {
      name: qualified(t(LANG, "documentsRemoveColumn", "1")),
    });
    expect(removeColumn).toBeDisabled();
  });

  it("does not disable Remove-row/Remove-column while more than one remains", () => {
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const removeRow = screen.getByRole("button", { name: qualified(t(LANG, "documentsRemoveRow", "1")) });
    const removeColumn = screen.getByRole("button", {
      name: qualified(t(LANG, "documentsRemoveColumn", "1")),
    });
    expect(removeRow).not.toBeDisabled();
    expect(removeColumn).not.toBeDisabled();
  });

  // ★★ THE ACTION COLUMN HAD NO HEADER, so every body row carried one more
  //  <td> than the header had <th>. Header/body column counts must agree —
  //  the renderers assume rectangularity, and a screen reader navigating the
  //  grid lands in a column with no name.
  it("gives the remove-row column a header, so the header and body agree on width", () => {
    const table: Extract<DocBlock, { type: "table" }> = {
      type: "table",
      columns: ["A", "B"],
      rows: [["1", "2"], ["3", "4"]],
    };
    const { container } = render(
      <TableBlockEditor lang={LANG} index={0} block={table} onCommit={vi.fn()} />,
    );
    const headerCells = container.querySelectorAll("thead th");
    const firstBodyRowCells = container.querySelectorAll("tbody tr:first-child td");
    expect(headerCells).toHaveLength(firstBodyRowCells.length);
    // ...and the extra header is NAMED, not an empty cell.
    expect(screen.getByText(t(LANG, "documentsTableRowActions"))).toBeInTheDocument();
  });
});

describe("DataSectionBlockEditor", () => {
  const blockQ = (n: number) => t(LANG, "documentsBlockN", String(n));
  const qualified = (label: string, n = 1) => `${label} – ${blockQ(n)}`;

  it("offers every export section key and no free text", () => {
    render(
      <DataSectionBlockEditor
        lang={LANG}
        index={0}
        block={{ type: "dataSection", key: EXPORT_SECTION_KEYS[0] }}
        onCommit={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", { name: qualified(t(LANG, "documentsDataSectionKey")) });
    expect(within(select).getAllByRole("option")).toHaveLength(EXPORT_SECTION_KEYS.length);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("commits the chosen key", async () => {
    const onCommit = vi.fn();
    render(
      <DataSectionBlockEditor
        lang={LANG}
        index={4}
        block={{ type: "dataSection", key: EXPORT_SECTION_KEYS[0] }}
        onCommit={onCommit}
      />,
    );
    const select = screen.getByRole("combobox", { name: qualified(t(LANG, "documentsDataSectionKey"), 5) });
    await userEvent.selectOptions(select, EXPORT_SECTION_KEYS[1]);
    expect(onCommit).toHaveBeenCalledWith(4, { type: "dataSection", key: EXPORT_SECTION_KEYS[1] }, expect.anything());
  });

  // ★★★ The axe gate cannot see a duplicate accessible name at ANY seed size
  //  (AGENTS.md) — a `<select>` doubly so, since axe's `label-content-name-
  //  mismatch` rule cannot even MATCH a combobox role. This multi-block test
  //  is the only possible detector.
  it("gives sibling dataSection blocks DISTINCT accessible names", () => {
    render(
      <>
        <DataSectionBlockEditor
          lang={LANG}
          index={0}
          block={{ type: "dataSection", key: EXPORT_SECTION_KEYS[0] }}
          onCommit={vi.fn()}
        />
        <DataSectionBlockEditor
          lang={LANG}
          index={1}
          block={{ type: "dataSection", key: EXPORT_SECTION_KEYS[0] }}
          onCommit={vi.fn()}
        />
      </>,
    );
    const selects = screen.getAllByRole("combobox", {
      name: new RegExp(`^${t(LANG, "documentsDataSectionKey")}`),
    });
    expect(selects).toHaveLength(2);
    expect(new Set(selects.map((s) => s.getAttribute("aria-label"))).size).toBe(2);
  });

  // ★ Raw registry keys ("knowledgeItems") were rendered as user-visible text.
  //  Every option must carry the same translated label Settings → Export shows
  //  for the same section, so the two surfaces cannot name one thing twice.
  it("renders translated option labels, not raw registry keys", () => {
    const block: Extract<DocBlock, { type: "dataSection" }> = { type: "dataSection", key: "tasks" };
    render(<DataSectionBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const select = screen.getByRole("combobox");
    expect(select).toHaveTextContent(t(LANG, "exportLabelKnowledgeItems"));
    expect(select).not.toHaveTextContent("knowledgeItems");
  });
});

describe("PageBreakBlockEditor", () => {
  it("states that there is nothing to edit rather than rendering an empty box", () => {
    render(<PageBreakBlockEditor lang={LANG} index={0} block={{ type: "pageBreak" }} onCommit={vi.fn()} />);
    expect(screen.getByText(t(LANG, "documentsBlockNoEditor"))).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("useBlockDraft — an external write to the block being edited", () => {
  const heading: Extract<DocBlock, { type: "heading" }> = { type: "heading", level: 1, text: "Alpha" };
  const restored: Extract<DocBlock, { type: "heading" }> = { type: "heading", level: 1, text: "Restored" };

  // ★★★ THE RESTORE CLOBBER, CLEAN-DRAFT ORDERING. Restore-in-place keeps the
  //  document id, so nothing remounts. Before the fix the effect advanced
  //  `baselineRef` to the restored block while the draft still held "Alpha",
  //  so the next blur read them as different and wrote "Alpha" back over the
  //  restore. The draft must ADOPT the new block instead.
  it("adopts a changed storedBlock while the draft is untouched, and commits nothing on blur", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <HeadingBlockEditor lang={LANG} index={0} block={heading} onCommit={onCommit} />,
    );
    rerender(<HeadingBlockEditor lang={LANG} index={0} block={restored} onCommit={onCommit} />);

    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    expect(text).toHaveValue("Restored");
    text.focus();
    text.blur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // ★★★ THE SAME CLOBBER, DIRTY-DRAFT ORDERING. Here `baselineRef` is frozen
  //  (that is the concurrent-write signal), and the UNMOUNT path already
  //  abandoned — but `commit()` did not, so a blur wrote the stale draft over
  //  the restore. Losing an unblurred keystroke burst is recoverable; silently
  //  destroying a committed write is not.
  //
  //  ★ THE CONCURRENT WRITE IS SEEDED BETWEEN THE DRAFT GOING DIRTY AND THE
  //   BLUR, and that ordering is the whole fixture: the `rerender` sits AFTER
  //   the `type` and BEFORE the `blur`. Move it before the type and the draft
  //   adopts instead (the clean-draft path above), so the test would pass
  //   whichever way `commit()` decides — it would stop being able to express
  //   the bug.
  it("abandons a dirty draft on blur when the stored block moved underneath it", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <HeadingBlockEditor lang={LANG} index={0} block={heading} onCommit={onCommit} />,
    );
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "!"); // dirty, unblurred
    expect(text).toHaveValue("Alpha!");
    rerender(<HeadingBlockEditor lang={LANG} index={0} block={restored} onCommit={onCommit} />);

    text.blur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // ★★★ THE ABANDON MUST SAY SO. Refusing the commit is correct and was
  //  already pinned above — but it used to be entirely SILENT, and the
  //  render-time reconcile then adopts the external write, so from the user's
  //  seat their typing was replaced on screen by text they did not write with
  //  no statement that anything happened. That is indistinguishable from an
  //  editor eating input. The notice names the reason; asserting on the
  //  RENDERED string (not a flag) is what makes this able to fail.
  it("says WHY when it abandons a dirty draft on blur", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <HeadingBlockEditor lang={LANG} index={0} block={heading} onCommit={onCommit} />,
    );
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "!");
    expect(screen.queryByText(t(LANG, "documentsBlockConflictNotSaved"))).toBeNull();
    rerender(<HeadingBlockEditor lang={LANG} index={0} block={restored} onCommit={onCommit} />);

    // ★ act() because the assertion is on RENDERED output: a bare .blur() runs
    //  the handler, but the setState it schedules needs a flushed render to be
    //  visible. The sibling abandon test above asserts on a MOCK, which is why
    //  it can get away without one.
    act(() => { text.blur(); });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(t(LANG, "documentsBlockConflictNotSaved"))).toBeTruthy();
    // ★★★ ANNOUNCED, not merely RENDERED — the two are different claims and only
    //  this one is about the user this notice was added for. The element mounts
    //  after blur has already moved focus elsewhere, so with no live region a
    //  screen-reader user gets nothing: the silent abandon the test above exists
    //  to prevent, still silent for them. `role="status"` is polite by default,
    //  so it does not cut across the keystrokes they are about to type.
    expect(screen.getByRole("status")).toHaveTextContent(
      t(LANG, "documentsBlockConflictNotSaved"),
    );
    // ★ Distinct from the empty-content refusal: one state, two reasons, and a
    //  reader must be able to tell which one fired.
    expect(screen.queryByText(t(LANG, "documentsBlockEmptyNotSaved"))).toBeNull();
  });

  // ★ Tiptap binds `content` ONCE at mount, so the paragraph editor cannot
  //  adopt a new value by prop alone — the hook's seed nonce keys a remount.
  //  Asserting on the rendered TEXT (not a prop) is what makes this able to
  //  fail: a passed-but-ignored `value` prop looks identical from the outside.
  it("re-renders the paragraph editor's content when the stored block is replaced", () => {
    const before: Extract<DocBlock, { type: "paragraph" }> = { type: "paragraph", html: "<p>Alpha</p>" };
    const after: Extract<DocBlock, { type: "paragraph" }> = { type: "paragraph", html: "<p>Restored</p>" };
    const onCommit = vi.fn();
    const { rerender, container } = render(
      <ParagraphBlockEditor lang={LANG} index={0} block={before} onCommit={onCommit} />,
    );
    expect(container.textContent).toContain("Alpha");
    rerender(<ParagraphBlockEditor lang={LANG} index={0} block={after} onCommit={onCommit} />);
    expect(container.textContent).toContain("Restored");
    expect(container.textContent).not.toContain("Alpha");
  });

  // ★★★ THE F1 CLOBBER, ONE KEYSTROKE LATER — the shape the first cut of this
  //  task shipped. Abandoning the blur is only half the job: if the draft never
  //  ADOPTS the write it abandoned for, the after-render effect re-syncs
  //  `baselineRef` to the external write while the draft still holds the stale
  //  text, and the very next edit commits that stale text over it. The
  //  assertion that matters is the LAST one — the committed text must be built
  //  on "Restored", not on "Alpha!".
  //
  //  ★ It also states the user-visible trade plainly: the typed "!" is GONE
  //   from the field. That is the correct side of the policy — retyping a
  //   keystroke burst is recoverable, destroying a committed write is not.
  it("adopts the external write after abandoning, so the next edit cannot resurrect the stale draft", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <HeadingBlockEditor lang={LANG} index={0} block={heading} onCommit={onCommit} />,
    );
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "!");
    rerender(<HeadingBlockEditor lang={LANG} index={0} block={restored} onCommit={onCommit} />);
    // ★ act-wrapped because the ASSERTION below needs the re-render that the
    //  abandon's own `setDirty(false)` schedules. A bare `.blur()` runs the
    //  handler — so the abandon itself is observable without act, which is
    //  what the test above does — but leaves the follow-up render unflushed.
    act(() => {
      text.blur();
    });
    expect(onCommit).not.toHaveBeenCalled();

    // The abandon cleared the dirty flag, so the reconcile adopts on the very
    // next render — the field shows the restore, not the abandoned draft.
    expect(text).toHaveValue("Restored");

    await userEvent.type(text, "x");
    text.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0, { type: "heading", level: 1, text: "Restoredx" }, expect.anything());
  });

  // ★★★ THE COMMIT-TO-ECHO WINDOW MUST NOT OUTLIVE ONE BATCH. `preCommitStoredRef`
  //  makes a stored block equal to the value it held BEFORE this hook's own
  //  commit read as unmoved — necessary, because `onCommit` cannot change
  //  `storedBlock` inside one batched event. The after-render effect closes
  //  that window by re-syncing BOTH refs on the undirty path. If it did not,
  //  a restore to the version immediately PRECEDING this hook's last commit
  //  would equal the stale `preCommitStoredRef` and be waved through as "our
  //  own write", clobbering it.
  //
  //  ★ The fixture has to COMMIT first (so the two refs diverge at all), then
  //   let the echo render (so the effect can close the window), and only then
  //   restore to the pre-commit content. Skip the echo and the window is still
  //   legitimately open, so the test would pass with the re-sync deleted.
  it("treats a restore to the version before its own last commit as an external write", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <HeadingBlockEditor lang={LANG} index={0} block={heading} onCommit={onCommit} />,
    );
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "!");
    text.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);

    // The parent echoes what we committed (applyOps stores op.block verbatim).
    const echoed: Extract<DocBlock, { type: "heading" }> = { type: "heading", level: 1, text: "Alpha!" };
    rerender(<HeadingBlockEditor lang={LANG} index={0} block={echoed} onCommit={onCommit} />);

    await userEvent.type(text, "x");
    // A restore to the PRE-commit content — a distinct object with the content
    // preCommitStoredRef held before the commit above.
    rerender(
      <HeadingBlockEditor
        lang={LANG}
        index={0}
        block={{ type: "heading", level: 1, text: "Alpha" }}
        onCommit={onCommit}
      />,
    );
    text.blur();
    expect(onCommit).toHaveBeenCalledTimes(1); // still just the first commit — the restore stands
  });

  // ★★★ A REMOUNT IS NOT FREE. The nonce keys a remount of the paragraph's
  //  Tiptap surface, and `onBlur` here is a bubbling `focusout` — so
  //  Shift+Tab from the text into this editor's OWN toolbar commits, and
  //  `applyOps` echoes that block back verbatim. Bumping the nonce on object
  //  IDENTITY therefore remounted on the editor's own commit and left
  //  `document.activeElement` at `<body>`, every time a keyboard user reached
  //  for the toolbar after typing. No gate in this repo can see that: Edit
  //  blocks is not in A11Y_VIEWS, and axe has no rule for it regardless.
  //
  //  ★ The fixture passes a DISTINCT object with IDENTICAL content, which is
  //   exactly what the echo is. An object-identical rerender would not enter
  //   the reconcile at all and could not express the bug.
  it("keeps the paragraph editor mounted, and keyboard focus alive, across a content-identical replacement", () => {
    const html = "<p>Alpha</p>";
    const onCommit = vi.fn();
    const { rerender } = render(
      <ParagraphBlockEditor lang={LANG} index={0} block={{ type: "paragraph", html }} onCommit={onCommit} />,
    );
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    const toolbarButton = within(screen.getByRole("toolbar")).getAllByRole("button")[0];
    toolbarButton.focus();
    expect(document.activeElement).toBe(toolbarButton);

    rerender(
      <ParagraphBlockEditor lang={LANG} index={0} block={{ type: "paragraph", html }} onCommit={onCommit} />,
    );

    expect(document.querySelector('[contenteditable="true"]')).toBe(editable);
    expect(document.activeElement).toBe(toolbarButton);
  });

  // ★★ A WITHDRAWN EXTERNAL WRITE — the abandon path run twice. The write
  //  arrives under a dirty draft (abandoned), then the parent hands the
  //  ORIGINAL block back, and the reconcile adopts a second time. Nothing may
  //  be committed at either blur: the user's "!" was abandoned, and the revert
  //  is not an edit.
  //
  //  ★★★ THIS TEST DOES **NOT** SEPARATE THE DIRTY GUARD FROM THE ABANDON
  //   GUARD, and it was written believing it would — recorded here because the
  //   reasoning is the interesting part. Deleting `if (!dirtyRef.current)
  //   return;` from `commit()` leaves all 56 tests GREEN (measured, twice: once
  //   before this test existed and once after). The predicted separating state
  //   was "abandon leaves a stale draft that a later bare blur commits", and
  //   the reconcile makes it unreachable — the abandon clears the dirty flag,
  //   which is itself the render on which the draft ADOPTS. Whenever the draft
  //   diverges from `baselineRef` while undirty, `externallyWritten()` is
  //   already true. Keep the guard anyway: it is what makes "no edit since the
  //   last commit or abandon" mean "write nothing" LOCALLY, rather than by
  //   three other mechanisms happening to agree. A surviving mutant is a
  //   question, not a licence to delete the line.
  //
  //  ★ The revert deliberately hands back the SAME object. The reconcile
  //   triggers on IDENTITY, so a fresh object holding "Alpha" would take a
  //   different branch than the one this test is about. (Reachable either way:
  //   `applyOps` assigns `op.block` verbatim, so an undo restoring a retained
  //   document object hands the original block identity straight back.)
  //
  //  ★ It is not vacuous — it dies with the `tryCommit` abandon guard removed
  //   (the first blur then commits "Alpha!"), the same mutant the dirty-draft
  //   test above kills.
  it("commits nothing across an external write that is then withdrawn", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <HeadingBlockEditor lang={LANG} index={0} block={heading} onCommit={onCommit} />,
    );
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "!");
    rerender(<HeadingBlockEditor lang={LANG} index={0} block={restored} onCommit={onCommit} />);
    act(() => {
      text.blur();
    });
    expect(onCommit).not.toHaveBeenCalled();

    // The external write is withdrawn — the SAME object the editor mounted on.
    rerender(<HeadingBlockEditor lang={LANG} index={0} block={heading} onCommit={onCommit} />);
    act(() => {
      text.blur();
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  // ★ A blur on an editor nobody touched must not even ASK the toBlock/
  //  blockChanged pair — and, more importantly, must not be able to commit.
  it("commits nothing on a blur with no edit", () => {
    const onCommit = vi.fn();
    render(<HeadingBlockEditor lang={LANG} index={0} block={heading} onCommit={onCommit} />);
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    text.focus();
    text.blur();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("blocks the loader would discard", () => {
  // ★ Local qualifier, matching the pattern each describe block above already
  //  uses — `qualified` in the BulletsBlockEditor describe above is scoped to
  //  that callback and unreachable here.
  const blockQ = (n: number) => t(LANG, "documentsBlockN", String(n));
  const qualified = (label: string, n = 1) => `${label} – ${blockQ(n)}`;

  it("cannot remove the last bullet item", () => {
    const single: Extract<DocBlock, { type: "bullets" }> = { type: "bullets", items: ["only"] };
    render(<BulletsBlockEditor lang={LANG} index={0} block={single} onCommit={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: qualified(t(LANG, "documentsRemoveItem", "1")) }),
    ).toBeDisabled();
  });

  it("refuses to commit an emptied heading and says why", async () => {
    const onCommit = vi.fn();
    const block: Extract<DocBlock, { type: "heading" }> = { type: "heading", level: 1, text: "Alpha" };
    render(<HeadingBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.clear(text);
    // ★ act-wrapped: the assertion below needs the `setRefusal("empty")` render
    //  that the refusal schedules — a bare `.blur()` runs the handler (so
    //  onCommit not being called is observable either way) but leaves that
    //  follow-up render unflushed, per this file's own note above.
    act(() => {
      text.blur();
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(t(LANG, "documentsBlockEmptyNotSaved"))).toBeInTheDocument();
    // ★ Same live region in the OTHER state — one assertion per state, because a
    //  role added to one branch of the ternary's consumer is no evidence about
    //  the other. (Here it is one element for both, and that is worth pinning.)
    expect(screen.getByRole("status")).toHaveTextContent(t(LANG, "documentsBlockEmptyNotSaved"));
  });
});

// ★★★ THE TWO UNMOUNT-FLUSH DEFECTS, PINNED THROUGH THE REAL ENGINE.
//  `useBlockDraft`'s in-component `externallyWritten()` reads refs that only
//  advance when THIS row renders — and the row that matters here NEVER gets a
//  final render, because `BlockEditor` returns a DIFFERENT component per
//  `block.type` under an unchanged key, so a write that changes the type at an
//  index tears the row down with every ref frozen at the pre-write value. The
//  guard therefore cannot live in the component alone; the engine reads live
//  state at call time, so the commit carries its baseline as `expect` and the
//  engine refuses a stale one.
//
//  ★ THE FIXTURE MOUNTS `DocumentEditor`, not a per-kind editor, and that is
//   load-bearing: the type-driven component swap is what makes the row unmount
//   without rendering, and only the real block-list reproduces it. A same-type
//   fixture re-renders the row (advancing `latestRef`), the in-component guard
//   fires, and the test passes with the engine check deleted.
describe("an unmount flush cannot clobber a concurrent write", () => {
  const STAMP = "2026-08-01T08:00:00.000Z";

  /** A real `applyDocMutation` behind `onCommitBlock`, so "the block at that
   *  index is unchanged" is a claim about STORED state rather than about which
   *  arguments a spy saw. */
  function engineHarness(initial: readonly DocBlock[]) {
    let versionId = 1;
    let state: DocState = {
      documents: [{ id: 1, title: "Doc", blocks: initial, createdAt: STAMP, updatedAt: STAMP }],
      versions: [],
    };
    const ctx = () => ({
      now: STAMP,
      source: "user" as const,
      mintDocId: () => 99,
      mintVersionId: () => versionId++,
    });
    const run = (op: DocOp) => {
      state = applyDocMutation(state, { kind: "ops", id: 1, ops: [op] }, ctx());
    };
    return {
      /** What the block editors call. */
      onCommitBlock: (index: number, block: DocBlock, expected?: DocBlock) =>
        run(replaceBlockOp(index, block, expected)),
      /** A concurrent writer (an AI write, a restore, a second tab): no
       *  expectation, because it is not resolving a draft of its own. */
      external: (index: number, block: DocBlock) => run({ op: "replace", index, block }),
      docNow: (): ProjectDocument => state.documents[0],
      blocksNow: (): readonly DocBlock[] => state.documents[0].blocks,
    };
  }

  it("refuses the flush when a concurrent write changed the block TYPE at that index", async () => {
    const h = engineHarness([{ type: "heading", level: 1, text: "Alpha" }]);
    const { rerender } = render(
      <DocumentEditor lang={LANG} structural={noStructural} doc={h.docNow()} onCommitBlock={h.onCommitBlock} />,
    );
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "!"); // dirty, never blurred
    expect(text).toHaveValue("Alpha!");

    // The concurrent write lands and CHANGES THE KIND, so the heading row is
    // torn down with no final render of its own.
    const written: DocBlock = { type: "paragraph", html: "<p>concurrent</p>" };
    h.external(0, written);
    act(() => {
      rerender(<DocumentEditor lang={LANG} structural={noStructural} doc={h.docNow()} onCommitBlock={h.onCommitBlock} />);
    });

    expect(h.blocksNow()).toEqual([written]);
  });

  // The control, and it is what keeps the guard from being a blanket refusal:
  // an ordinary unmount with nobody else writing must still flush.
  it("still flushes a pending edit when nothing wrote underneath it", async () => {
    const h = engineHarness([{ type: "heading", level: 1, text: "Alpha" }]);
    const { unmount } = render(
      <DocumentEditor lang={LANG} structural={noStructural} doc={h.docNow()} onCommitBlock={h.onCommitBlock} />,
    );
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "!");
    act(() => {
      unmount();
    });
    expect(h.blocksNow()).toEqual([{ type: "heading", level: 1, text: "Alpha!" }]);
  });
});

describe("the unmount flush honours the loader's drop rule", () => {
  // ★★★ REACHABLE WITH NO CONCURRENT WRITER AT ALL: empty a paragraph or
  //  heading you are not focused on, then narrow the pane below NARROW_PANE_PX
  //  so the row collapses and unmounts. A resize moves no focus, so nothing
  //  blurs — and `tryCommit`'s drop-rule refusal is on the BLUR path, not this
  //  one. (`blockSurvivesLoad` named that rule when this was written; the hook
  //  now calls `normalizeBlockForStorage` directly, at three sites, and
  //  `blockSurvivesLoad` has no production caller left.) The draft would have
  //  committed, rendered for the rest of the session and been GONE on the next
  //  load, with no add-block control to recreate it.
  //  ★ It cannot call `setRefusal` — the component is unmounting — so refusing
  //   to write IS the whole fix; there is no notice to assert.
  it("commits nothing when an emptied draft unmounts without a blur", async () => {
    const onCommit = vi.fn();
    const { unmount } = render(
      <HeadingBlockEditor
        lang={LANG}
        index={0}
        block={{ type: "heading", level: 1, text: "Alpha" }}
        onCommit={onCommit}
      />,
    );
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.clear(text);
    // No commit has been ATTEMPTED yet — the refusal notice would be on screen
    // if a blur had already run the commit path, which would make the
    // assertion below pass for the wrong reason.
    expect(screen.queryByText(t(LANG, "documentsBlockEmptyNotSaved"))).toBeNull();
    act(() => {
      unmount();
    });
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("every commit carries the draft's baseline", () => {
  // ★ The BLUR path's half of the same guard. The engine needs to know which
  //  block this edit was derived from, and the only layer that knows is the
  //  draft — so it has to travel with the commit rather than be re-derived.
  //  ★ ONE commit, deliberately: with a spy parent the write is never echoed
  //   back as a new `storedBlock`, so the after-render effect re-syncs the
  //   baseline to the (unchanged) prop and a second commit would send the same
  //   value again. That is an artefact of the fixture, not of the hook — the
  //   engine-backed tests above cover the advancing case for real.
  it("forwards the block the draft was derived from, on a blur commit", async () => {
    const onCommit = vi.fn();
    const original: DocBlock = { type: "heading", level: 1, text: "Alpha" };
    render(<HeadingBlockEditor lang={LANG} index={3} block={original} onCommit={onCommit} />);
    const text = screen.getByRole("textbox", { name: headingTextName(3) });
    await userEvent.type(text, "!");
    act(() => {
      text.blur();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenNthCalledWith(
      1,
      3,
      { type: "heading", level: 1, text: "Alpha!" },
      original,
    );
  });
});
