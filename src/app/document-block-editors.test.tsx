import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParagraphBlockEditor } from "./document-block-editors";
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

  it("commits on blur only when the content changed", async () => {
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
    editable.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [index, block] = onCommit.mock.calls[0];
    expect(index).toBe(2);
    expect(block.type).toBe("paragraph");
  });
});
