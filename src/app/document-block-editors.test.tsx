import { describe, it, expect, beforeAll, vi } from "vitest";
import { StrictMode } from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParagraphBlockEditor, HeadingBlockEditor, BulletsBlockEditor } from "./document-block-editors";
import { t } from "./i18n";
import type { DocBlock } from "./document-model";

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
    const select = screen.getByRole("combobox", { name: `${t(LANG, "documentsHeadingLevel")} 1` });
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
    const text = screen.getByRole("textbox", { name: `${t(LANG, "documentsHeadingText")} 1` });
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
    const text = screen.getByRole("textbox", { name: `${t(LANG, "documentsHeadingText")} 1` });
    await userEvent.clear(text);
    await userEvent.type(text, "Ne");
    await userEvent.type(text, "w");
    text.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0, { type: "heading", level: 2, text: "New" });
  });

  // ★ NOT a combined-commit test — it blurs the select alone, with the text
  //  field never focused, so this only exercises a single control's own
  //  blur firing the group's onBlur. Tabbing to the text field afterward
  //  fires a SECOND, independent commit (see HeadingBlockEditor's docstring).
  it("commits a level change on its own blur", () => {
    const onCommit = vi.fn();
    render(
      <HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 1, text: "Title" }} onCommit={onCommit} />,
    );
    const select = screen.getByRole("combobox", { name: `${t(LANG, "documentsHeadingLevel")} 1` });
    select.focus();
    fireEvent.change(select, { target: { value: "3" } });
    select.blur();
    expect(onCommit).toHaveBeenCalledWith(0, { type: "heading", level: 3, text: "Title" });
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
    const select = screen.getByRole("combobox", { name: `${t(LANG, "documentsHeadingLevel")} 1` });
    const text = screen.getByRole("textbox", { name: `${t(LANG, "documentsHeadingText")} 1` });
    select.focus();
    fireEvent.change(select, { target: { value: "3" } });
    text.focus(); // tab-through: blurs the select, which bubbles to the group's onBlur
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0, { type: "heading", level: 3, text: "Title" });
  });
});

describe("BulletsBlockEditor", () => {
  const block: Extract<DocBlock, { type: "bullets" }> = { type: "bullets", items: ["one", "two"] };

  // ★★★ Every label here carries the BLOCK-position suffix (` ${index+1}`) on
  //  top of whatever `{0}` item number the key already interpolates —
  //  `documentsListOrdered` and `documentsAddItem` have NO placeholder at
  //  all, so without the suffix two sibling bullets blocks would render
  //  identically-named controls (see the block-uniqueness test below, the
  //  only thing that can catch that collision — axe cannot).

  it("gives every per-item control an ITEM-UNIQUE accessible name", () => {
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const removes = screen.getAllByRole("button", { name: /^Remove item/ });
    expect(removes).toHaveLength(2);
    expect(new Set(removes.map((b) => b.getAttribute("aria-label"))).size).toBe(2);
  });

  it("adds an item", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: `${t(LANG, "documentsAddItem")} 1` }));
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["one", "two", ""] });
  });

  it("removes an item", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(
      screen.getByRole("button", { name: `${t(LANG, "documentsRemoveItem", "1")} 1` }),
    );
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["two"] });
  });

  it("moves an item down", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(
      screen.getByRole("button", { name: `${t(LANG, "documentsMoveItemDown", "1")} 1` }),
    );
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["two", "one"] });
  });

  it("cannot move the first item up or the last item down", () => {
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: `${t(LANG, "documentsMoveItemUp", "1")} 1` }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: `${t(LANG, "documentsMoveItemDown", "2")} 1` }),
    ).toBeDisabled();
  });

  it("toggles ordered", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: `${t(LANG, "documentsListOrdered")} 1` }));
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["one", "two"], ordered: true });
  });

  // ★★★ The axe gate cannot see a duplicate accessible name at ANY seed size
  //  (measured against axe 4.12.1 in AGENTS.md) — this is the only possible
  //  detector, and it needs TWO blocks to express the collision at all.
  //  Covers BOTH axes at once: the toggle and Add-item labels (no `{0}` to
  //  fall back on) and a per-item control (which already varies by item
  //  number WITHIN a block but collides ACROSS blocks without the suffix).
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
    expect(new Set(adds.map((b) => b.textContent)).size).toBe(2);

    const removeItem1 = screen.getAllByRole("button", { name: new RegExp(`^${t(LANG, "documentsRemoveItem", "1")}`) });
    expect(removeItem1).toHaveLength(2);
    expect(new Set(removeItem1.map((b) => b.getAttribute("aria-label"))).size).toBe(2);
  });

  it("does not commit when nothing changed", () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    const text = screen.getByRole("textbox", { name: `${t(LANG, "documentsListItem", "1")} 1` });
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
    const text = screen.getByRole("textbox", { name: `${t(LANG, "documentsListItem", "1")} 1` });
    await userEvent.clear(text);
    await userEvent.type(text, "on");
    await userEvent.type(text, "e2");
    text.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["one2", "two"] });
  });

  // ★★★ Shared useBlockDraft behaviour, pinned here for the SAME reason the
  //  paragraph editor pins it: a pending edit with no blur must still be
  //  flushed on unmount. Bullets is the one editor where a STRUCTURAL action
  //  (add/remove/move/toggle) is bridged into the hook's own `commit` rather
  //  than calling it directly (see the docstring on the effect above) — this
  //  proves that bridge lands in the SAME baseline/dirty state a normal
  //  blur-commit would, so the unmount-flush guard still works afterward.
  //  ★ The `rerender` with the post-add block mirrors what a real parent
  //   does after `onCommit` fires (apply the op, pass the new block back
  //   down) — without it `storedBlock` never advances past the ORIGINAL
  //   prop, and the concurrent-write guard would (correctly, for an
  //   isolated fixture that never re-feeds its own commits) read that gap
  //   as a concurrent write and abandon the flush.
  it("flushes a pending item-text edit on unmount after a structural action already committed", async () => {
    const onCommit = vi.fn();
    const { rerender, unmount } = render(
      <BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />,
    );
    await userEvent.click(screen.getByRole("button", { name: `${t(LANG, "documentsAddItem")} 1` }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const afterAdd: Extract<DocBlock, { type: "bullets" }> = { type: "bullets", items: ["one", "two", ""] };
    expect(onCommit).toHaveBeenCalledWith(0, afterAdd);
    rerender(<BulletsBlockEditor lang={LANG} index={0} block={afterAdd} onCommit={onCommit} />);
    const text = screen.getByRole("textbox", { name: `${t(LANG, "documentsListItem", "1")} 1` });
    await userEvent.type(text, "!");
    unmount();
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenNthCalledWith(2, 0, { type: "bullets", items: ["one!", "two", ""] });
  });
});
