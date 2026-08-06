// src/app/document-preview.test.tsx
//
// The preview had no test file of its own — it was covered only incidentally by
// documents-panel.test.tsx's region/heading assertions, which say nothing about
// how often it renders. A memo is exactly the kind of thing that regresses
// silently: inline the call again and every assertion in that file still passes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentPreview } from "./document-preview";
import type { ProjectDocument } from "./document-model";
import { emptyWorkspace } from "./workspace";
import { renderDocumentHtml } from "./doc-render-html";

// ★ The real renderer runs DOMPurify per paragraph and projects the whole
// workspace per dataSection — which is the cost the memo exists to avoid, and
// also what makes a CALL COUNT the honest way to measure it.
vi.mock("./doc-render-html", () => ({ renderDocumentHtml: vi.fn(() => "<p>body</p>") }));

const NOW = "2026-08-06T00:00:00.000Z";

function doc(id: number, title: string): ProjectDocument {
  return { id, title, blocks: [], createdAt: NOW, updatedAt: NOW };
}

beforeEach(() => {
  vi.mocked(renderDocumentHtml).mockClear();
});

describe("DocumentPreview", () => {
  it("renders nothing when there is no document", () => {
    // ★ Also the hook-order guard: `useMemo` sits ABOVE this early return, so
    // the null case must still mount cleanly rather than throw.
    const { container } = render(<DocumentPreview lang="en-US" doc={null} ws={emptyWorkspace()} />);
    expect(container).toBeEmptyDOMElement();
    expect(renderDocumentHtml).not.toHaveBeenCalled();
  });

  it("does NOT re-render the document HTML when the parent re-renders unchanged", () => {
    // ★★ THE ASSERTION THAT PINS THE MEMO. Called inline, `renderDocumentHtml`
    // re-ran on every parent render — so each keystroke in the rename modal,
    // which re-renders the panel, re-projected the entire workspace to produce
    // byte-identical HTML. Mutation-proved: drop the useMemo and this reports 2.
    const ws = emptyWorkspace();
    const d = doc(1, "Steering update");
    const { rerender } = render(<DocumentPreview lang="en-US" doc={d} ws={ws} />);
    expect(renderDocumentHtml).toHaveBeenCalledTimes(1);
    rerender(<DocumentPreview lang="en-US" doc={d} ws={ws} />);
    expect(renderDocumentHtml).toHaveBeenCalledTimes(1);
  });

  it("DOES re-render the HTML when the document changes", () => {
    // ★★★ THE CONTROL, and it is not optional: a `useMemo(..., [])` with empty
    // deps satisfies the test above perfectly while permanently freezing the
    // preview on the first document the pane ever showed. Only this can tell a
    // correct dependency list from a broken one.
    const ws = emptyWorkspace();
    const { rerender } = render(<DocumentPreview lang="en-US" doc={doc(1, "Alpha")} ws={ws} />);
    expect(renderDocumentHtml).toHaveBeenCalledTimes(1);
    rerender(<DocumentPreview lang="en-US" doc={doc(2, "Beta")} ws={ws} />);
    expect(renderDocumentHtml).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Beta" })).toBeInTheDocument();
  });

  it("re-renders the HTML when the LANGUAGE changes", () => {
    // The renderer takes `lang` and localises its dataSection tables, so a deps
    // list of just [doc, ws] would leave a language switch showing stale
    // English headings inside the body while the chrome around it flipped.
    const ws = emptyWorkspace();
    const d = doc(1, "Alpha");
    const { rerender } = render(<DocumentPreview lang="en-US" doc={d} ws={ws} />);
    rerender(<DocumentPreview lang="de" doc={d} ws={ws} />);
    expect(renderDocumentHtml).toHaveBeenCalledTimes(2);
    expect(renderDocumentHtml).toHaveBeenLastCalledWith(d, ws, "de", "preview");
  });

  it("names the scrollable region after the document it shows", () => {
    // A <section> is only exposed as a region once it HAS an accessible name,
    // so querying BY ROLE fails if either the name or the element regresses.
    render(<DocumentPreview lang="en-US" doc={doc(1, "Steering update")} ws={emptyWorkspace()} />);
    const region = screen.getByRole("region", { name: "Steering update" });
    expect(region).toHaveAttribute("tabindex", "0");
  });
});
