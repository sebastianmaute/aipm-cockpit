import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentEditor } from "./document-editor";
import { t } from "./i18n";
import type { ProjectDocument } from "./document-model";
import { htmlTextLength } from "./rich-text-plain";

const LANG = "en-US" as const;

/** The heading editor's accessible names, 0-based block index in, en-dash
 *  qualified name out. Spelled once so a convention change is one edit. */
const headingTextName = (index: number) =>
  `${t(LANG, "documentsHeadingText")} – ${t(LANG, "documentsBlockN", String(index + 1))}`;

const doc: ProjectDocument = {
  id: 7,
  title: "Status report",
  blocks: [
    { type: "heading", level: 1, text: "Summary" },
    { type: "paragraph", html: "<p>All good</p>" },
    { type: "pageBreak" },
  ],
  createdAt: "2026-08-18T10:00:00.000Z",
  updatedAt: "2026-08-18T10:00:00.000Z",
};

/** The paragraph editor mounts behind the `rich-text-editor-lazy` next/dynamic
 *  boundary, so the contenteditable is NOT in the DOM on the line after
 *  `render()` — the skeleton is. */
const findParagraphEditable = (blockNumber: string): Promise<HTMLElement> =>
  screen.findByRole(
    "textbox",
    { name: t(LANG, "documentsParagraphLabel", blockNumber) },
  );

describe("DocumentEditor", () => {
  it("renders one row per block, including blocks with no editor", () => {
    render(<DocumentEditor lang={LANG} doc={doc} onCommitBlock={vi.fn()} />);
    expect(screen.getByText(t(LANG, "documentsBlockHeading"))).toBeInTheDocument();
    expect(screen.getByText(t(LANG, "documentsBlockParagraph"))).toBeInTheDocument();
    // The page break is still listed — a block that vanishes reads as data loss.
    expect(screen.getByText(t(LANG, "documentsBlockPageBreak"))).toBeInTheDocument();
  });

  it("passes the block INDEX through to the commit handler", async () => {
    const onCommitBlock = vi.fn();
    render(<DocumentEditor lang={LANG} doc={doc} onCommitBlock={onCommitBlock} />);
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "!");
    text.blur();
    expect(onCommitBlock).toHaveBeenCalledWith(0, expect.objectContaining({ type: "heading" }), expect.anything());
  });

  it("renders NO drag handle — reordering is out of scope for this slice", () => {
    render(<DocumentEditor lang={LANG} doc={doc} onCommitBlock={vi.fn()} />);
    // A handle that does nothing is worse than no handle.
    expect(screen.queryByRole("button", { name: /drag|reorder|move block/i })).toBeNull();
  });

  describe("at a narrow pane", () => {
    // ★★★ THREE BLOCKS, TWO OF THEM PARAGRAPHS. With a single-paragraph
    //  fixture the toolbar count is satisfied by the WIDE branch as well —
    //  one paragraph mounts one editor and therefore one toolbar either way —
    //  so it passed with the narrow branch deleted outright. A count
    //  assertion needs a fixture in which the two branches DISAGREE. The
    //  leading heading also keeps the first PARAGRAPH off block index 0, so a
    //  selection compared against the block's own index cannot pass by luck.
    const threeBlocks: ProjectDocument = {
      ...doc,
      blocks: [
        { type: "heading", level: 1, text: "Summary" },
        { type: "paragraph", html: "<p>First</p>" },
        { type: "paragraph", html: "<p>Second</p>" },
      ],
    };

    it("docks ONE toolbar instead of one per block", async () => {
      const { rerender } = render(
        <DocumentEditor lang={LANG} doc={threeBlocks} onCommitBlock={vi.fn()} narrow />,
      );
      // The only live paragraph is block 2; awaiting it is what proves the
      // lazy editor actually swapped in before the toolbars are counted.
      await findParagraphEditable("2");
      // jsdom has no layout, so the narrow branch is driven by an injected
      // flag, never by a measured width.
      expect(screen.getAllByRole("toolbar")).toHaveLength(1);
      // The wide branch is what proves the fixture can tell the two apart.
      rerender(<DocumentEditor lang={LANG} doc={threeBlocks} onCommitBlock={vi.fn()} />);
      // The wide branch mounts a SECOND editor; await it too rather than
      // assuming the already-resolved chunk renders it in the same tick.
      await findParagraphEditable("3");
      expect(screen.getAllByRole("toolbar")).toHaveLength(2);
    });

    // ★★ THE DOCK IS ABOVE THE DOCUMENT, which is both the spec's wording and
    //  what keeps the portal from breaking Tab: content moved BELOW its
    //  logical position is the recorded failure mode.
    it("renders the docked toolbar before the block list in DOM order", async () => {
      const { container } = render(
        <DocumentEditor lang={LANG} doc={threeBlocks} onCommitBlock={vi.fn()} narrow />,
      );
      const toolbar = await screen.findByRole("toolbar", undefined);
      const firstRow = container.querySelectorAll("[data-block-row]")[0];
      expect(toolbar.compareDocumentPosition(firstRow)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    // ★★★ THE SILENT COLLAPSE WAS THE DEFECT, not the collapse itself. An
    //  unselected paragraph rendering read-only with no reason and no way back
    //  is the "disabled control with no reason reads as broken" failure this
    //  slice states two files away for the image case.
    it("says why an unselected paragraph is read-only, and offers a way in", async () => {
      render(<DocumentEditor lang={LANG} doc={threeBlocks} onCommitBlock={vi.fn()} narrow />);
      expect(screen.getByText(t(LANG, "documentsBlockCollapsedNarrow"))).toBeInTheDocument();
      const select = screen.getByRole("button", {
        name: `${t(LANG, "documentsBlockSelect")} – ${t(LANG, "documentsBlockN", "3")}`,
      });
      await userEvent.click(select);
      // Selection MOVED: the second paragraph is now live and the first is not.
      expect(await findParagraphEditable("3")).toBeInTheDocument();
      expect(
        screen.queryByRole("textbox", { name: t(LANG, "documentsParagraphLabel", "2") }),
      ).toBeNull();
    });

    // ★★★ BLOCK-UNIQUE NAMES. Two "Edit this block" buttons sharing one
    //  accessible name is a WCAG 2.4.6 failure NO axe rule under the four tags
    //  e2e/a11y.spec.ts requests can see, at any seed size — a unit test
    //  rendering two of them is the only detector that can exist. The two
    //  paragraphs above cannot express it (only ONE is ever unselected), so
    //  this fixture carries three.
    it("gives each unselected paragraph a block-unique select button", () => {
      const fourBlocks: ProjectDocument = {
        ...doc,
        blocks: [
          { type: "heading", level: 1, text: "Summary" },
          { type: "paragraph", html: "<p>First</p>" },
          { type: "paragraph", html: "<p>Second</p>" },
          { type: "paragraph", html: "<p>Third</p>" },
        ],
      };
      render(<DocumentEditor lang={LANG} doc={fourBlocks} onCommitBlock={vi.fn()} narrow />);
      const names = screen
        .getAllByRole("button", { name: new RegExp(t(LANG, "documentsBlockSelect")) })
        .map((b) => b.getAttribute("aria-label"));
      expect(names).toEqual([
        `${t(LANG, "documentsBlockSelect")} – ${t(LANG, "documentsBlockN", "3")}`,
        `${t(LANG, "documentsBlockSelect")} – ${t(LANG, "documentsBlockN", "4")}`,
      ]);
      expect(new Set(names).size).toBe(names.length);
    });

    // ★★★ THE IMAGE BUG. `firstParagraphIndex` had no image test, so a first
    //  paragraph holding one made ParagraphBlockEditor return its read-only
    //  notice and left the document with NO editable paragraph anywhere.
    it("leaves another paragraph reachable when the first holds an image", async () => {
      const withImage: ProjectDocument = {
        ...doc,
        blocks: [
          { type: "paragraph", html: '<p>Chart</p><img data-asset-id="a1" alt="chart">' },
          { type: "paragraph", html: "<p>Editable</p>" },
        ],
      };
      render(<DocumentEditor lang={LANG} doc={withImage} onCommitBlock={vi.fn()} narrow />);
      const select = screen.getByRole("button", {
        name: `${t(LANG, "documentsBlockSelect")} – ${t(LANG, "documentsBlockN", "2")}`,
      });
      // ★★ REACHABLE means the click WORKS, not merely that a button is drawn.
      //  Asserting only its presence leaves the test green with the selection
      //  state dropped (`selected` pinned to the first paragraph) — measured:
      //  that mutant killed the sibling test and survived this one.
      await userEvent.click(select);
      expect(await findParagraphEditable("2")).toBeInTheDocument();
    });

    // Non-paragraph editors carry no rich toolbar, so there is nothing to dock
    // and nothing to crowd — they stay live at every width.
    it("leaves non-paragraph editors live", () => {
      render(<DocumentEditor lang={LANG} doc={threeBlocks} onCommitBlock={vi.fn()} narrow />);
      expect(screen.getByRole("textbox", { name: headingTextName(0) })).toBeEnabled();
    });
  });

  // ★ `doc` above has its ONE paragraph as the first-in-document — the exact
  //  block the narrow branch does NOT collapse — so no existing test reaches
  //  the collapsed render's own `sanitizeDocumentHtml` sink. This fixture
  //  carries a SECOND paragraph so it collapses, and asserts on the rendered
  //  DOM (not the input string): the image survives, the script does not.
  it("sanitizes a collapsed paragraph's stored html at the render sink — keeps the image, drops the script", () => {
    const twoParagraphDoc: ProjectDocument = {
      id: 8,
      title: "Two paragraphs",
      blocks: [
        { type: "paragraph", html: "<p>First</p>" },
        {
          // ★ `src` is NOT on `DOCUMENT_ALLOWED_ATTR` (sanitize-html.ts) —
          //  an image is referenced by `data-asset-id`, not a URL, since the
          //  asset store this feeds is inert until S3c. `alt` and
          //  `data-asset-id` are what a sanitized `<img>` can carry.
          type: "paragraph",
          html: '<p>Second</p><img data-asset-id="a1" alt="chart"><script>alert(1)</script>',
        },
      ],
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
    const { container } = render(
      <DocumentEditor lang={LANG} doc={twoParagraphDoc} onCommitBlock={vi.fn()} narrow />,
    );
    // Only the SECOND paragraph collapses (the first keeps its live editor),
    // so its rendered image and dropped script are unambiguous either way.
    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("alt")).toBe("chart");
    expect(images[0].getAttribute("data-asset-id")).toBe("a1");
    expect(container.querySelector("script")).toBeNull();
  });

  // ★★★ Pins the doc-id-keyed row fix directly: two documents each carry a
  //  same-type (heading) block at index 0, so BEFORE the fix React would
  //  reuse the SAME BlockEditor instance across the switch (same position,
  //  same type) and go on showing document A's stale draft.
  describe("switching the selected document while edit mode is open", () => {
    const docA: ProjectDocument = {
      id: 201,
      title: "Doc A",
      blocks: [{ type: "heading", level: 1, text: "Alpha" }],
      createdAt: "2026-08-18T10:00:00.000Z",
      updatedAt: "2026-08-18T10:00:00.000Z",
    };
    const docB: ProjectDocument = {
      id: 202,
      title: "Doc B",
      blocks: [{ type: "heading", level: 1, text: "Beta" }],
      createdAt: "2026-08-18T10:00:00.000Z",
      updatedAt: "2026-08-18T10:00:00.000Z",
    };

    it("shows the new document's content, not the old one's, and commits nothing on an untouched switch", () => {
      const onCommitBlock = vi.fn();
      const { rerender } = render(<DocumentEditor lang={LANG} doc={docA} onCommitBlock={onCommitBlock} />);
      const textBefore = screen.getByRole("textbox", { name: headingTextName(0) });
      expect(textBefore).toHaveValue("Alpha");

      rerender(<DocumentEditor lang={LANG} doc={docB} onCommitBlock={onCommitBlock} />);
      const textAfter = screen.getByRole("textbox", { name: headingTextName(0) });
      expect(textAfter).toHaveValue("Beta");
      expect(textAfter).not.toBe(textBefore); // a NEW element — the row really remounted

      textAfter.focus();
      textAfter.blur();
      expect(onCommitBlock).not.toHaveBeenCalled();
    });

    it("does not carry an unblurred edit from the old document into the DOM after a switch", async () => {
      const onCommitBlock = vi.fn();
      const { rerender } = render(<DocumentEditor lang={LANG} doc={docA} onCommitBlock={onCommitBlock} />);
      const text = screen.getByRole("textbox", { name: headingTextName(0) });
      await userEvent.type(text, "!"); // dirty, unblurred

      rerender(<DocumentEditor lang={LANG} doc={docB} onCommitBlock={onCommitBlock} />);
      // The remounted field reflects B's stored content, never the stray "!".
      expect(screen.getByRole("textbox", { name: headingTextName(0) })).toHaveValue("Beta");
    });
  });

  describe("a document with no blocks", () => {
    const empty: ProjectDocument = {
      id: 11,
      title: "Empty",
      blocks: [],
      createdAt: "2026-08-18T10:00:00.000Z",
      updatedAt: "2026-08-18T10:00:00.000Z",
    };

    // ★★ An empty <div> with no message and no affordance reads as broken — the
    //  same principle this slice states for the image case and for the collapsed
    //  narrow-pane paragraph.
    it("says the document has no blocks yet", () => {
      render(
        <DocumentEditor lang={LANG} doc={empty} onCommitBlock={vi.fn()} onAppendBlock={vi.fn()} />,
      );
      expect(screen.getByText(t(LANG, "documentsNoBlocks"))).toBeInTheDocument();
    });

    // ★★★ THE APPENDED PARAGRAPH CARRIES SEEDED TEXT, NOT AN EMPTY ONE.
    //  document-model.ts drops a paragraph whose visible text length is 0, so an
    //  empty seed would create a block that renders now and is GONE on the next
    //  load — the exact failure Task 7 of this round exists to prevent.
    it("appends a paragraph carrying real text", async () => {
      const onAppendBlock = vi.fn();
      render(
        <DocumentEditor lang={LANG} doc={empty} onCommitBlock={vi.fn()} onAppendBlock={onAppendBlock} />,
      );
      await userEvent.click(screen.getByRole("button", { name: t(LANG, "documentsAddBlock") }));
      expect(onAppendBlock).toHaveBeenCalledTimes(1);
      const block = onAppendBlock.mock.calls[0][0] as { type: string; html: string };
      expect(block.type).toBe("paragraph");
      expect(htmlTextLength(block.html)).toBeGreaterThan(0);
      expect(block.html).toContain(t(LANG, "documentsNewBlockText"));
    });

    // ★ The control is EMPTY-STATE ONLY. A general add-block affordance is the
    //  structural slice (document-editor.tsx's own header scopes the block SET
    //  out of S3b), and it is deliberately not built here.
    it("renders no add-block control once the document has a block", () => {
      render(<DocumentEditor lang={LANG} doc={doc} onCommitBlock={vi.fn()} onAppendBlock={vi.fn()} />);
      expect(screen.queryByRole("button", { name: t(LANG, "documentsAddBlock") })).toBeNull();
      expect(screen.queryByText(t(LANG, "documentsNoBlocks"))).toBeNull();
    });
  });
});
