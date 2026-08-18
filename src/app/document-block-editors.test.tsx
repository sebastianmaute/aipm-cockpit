import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParagraphBlockEditor, HeadingBlockEditor } from "./document-block-editors";
import { t } from "./i18n";

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

  it("commits a level change together with the current text on blur", () => {
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
});
