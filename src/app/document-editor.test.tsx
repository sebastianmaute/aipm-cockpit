import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentEditor } from "./document-editor";
import { t } from "./i18n";
import type { ProjectDocument } from "./document-model";

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
    expect(onCommitBlock).toHaveBeenCalledWith(0, expect.objectContaining({ type: "heading" }));
  });

  it("renders NO drag handle — reordering is out of scope for this slice", () => {
    render(<DocumentEditor lang={LANG} doc={doc} onCommitBlock={vi.fn()} />);
    // A handle that does nothing is worse than no handle.
    expect(screen.queryByRole("button", { name: /drag|reorder|move block/i })).toBeNull();
  });

  it("docks ONE toolbar at a narrow pane instead of one per block", () => {
    render(<DocumentEditor lang={LANG} doc={doc} onCommitBlock={vi.fn()} narrow />);
    // jsdom has no layout, so the narrow branch is driven by an injected flag,
    // never by a measured width.
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
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
});
