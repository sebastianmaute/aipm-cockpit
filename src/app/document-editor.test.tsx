import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentEditor } from "./document-editor";
import { t } from "./i18n";
import type { ProjectDocument } from "./document-model";

const LANG = "en-US" as const;

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
    const text = screen.getByRole("textbox", { name: `${t(LANG, "documentsHeadingText")} 1` });
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
});
