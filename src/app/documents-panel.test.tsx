import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import {
  DocumentsPanel,
  appendDocument,
  duplicateDocument,
  renameDocument,
  removeDocument,
  sortDocuments,
} from "./documents-panel";
import { ConfirmProvider } from "./confirm-dialog";
import type { ProjectDocument } from "./document-model";
import { emptyWorkspace } from "./workspace";
import { buttonNames } from "../test/toolbar-order";
import { downloadDocument } from "./document-download";

// The real one opens tabs and triggers blob downloads — neither works in jsdom,
// and the module has its own suite. Here we only pin that the panel calls it
// with the right document and format.
vi.mock("./document-download", () => ({ downloadDocument: vi.fn() }));

const NOW = "2026-08-06T00:00:00.000Z";

function doc(id: number, title: string, blocks = 0): ProjectDocument {
  return {
    id,
    title,
    blocks: Array.from({ length: blocks }, () => ({ type: "pageBreak" as const })),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** Renders the panel against a setter that does NOT trigger a re-render, so the
 *  `documents` PROP stays at its initial value for the whole test. That is what
 *  makes the same-tick collision reproducible: a closure-reading setter would
 *  compute from the stale prop every time. Returns a live handle to the array. */
function renderPanel(initial: readonly ProjectDocument[] = []) {
  const box = { docs: initial };
  const setDocuments = ((updater: SetStateAction<readonly ProjectDocument[]>) => {
    box.docs = typeof updater === "function" ? updater(box.docs) : updater;
  }) as Dispatch<SetStateAction<readonly ProjectDocument[]>>;
  vi.mocked(downloadDocument).mockClear();
  const utils = render(
    <ConfirmProvider lang="en-US">
      <DocumentsPanel
        lang="en-US"
        documents={initial}
        setDocuments={setDocuments}
        ws={emptyWorkspace()}
      />
    </ConfirmProvider>,
  );
  return { box, ...utils };
}

describe("documents-panel pure transforms", () => {
  it("appendDocument mints the next free id and leaves prev untouched", () => {
    const prev = [doc(1, "A"), doc(7, "B")];
    const next = appendDocument(prev, "New", NOW);
    expect(next.map((d) => d.id)).toEqual([1, 7, 8]);
    expect(prev).toHaveLength(2); // immutability
  });

  it("duplicateDocument copies blocks under a fresh id", () => {
    const next = duplicateDocument([doc(1, "A", 3)], 1, "A copy", NOW);
    expect(next).toHaveLength(2);
    expect(next[1].id).toBe(2);
    expect(next[1].blocks).toHaveLength(3);
  });

  it("duplicateDocument is a no-op for an id a concurrent writer removed", () => {
    const prev = [doc(1, "A")];
    expect(duplicateDocument(prev, 99, "x", NOW)).toEqual(prev);
  });

  it("renameDocument retitles ONLY the targeted document", () => {
    const next = renameDocument([doc(1, "A"), doc(2, "B")], 2, "Renamed", NOW);
    expect(next.map((d) => d.title)).toEqual(["A", "Renamed"]);
  });

  it("removeDocument removes ONLY the targeted document", () => {
    const next = removeDocument([doc(1, "A"), doc(2, "B"), doc(3, "C")], 2);
    expect(next.map((d) => d.id)).toEqual([1, 3]);
  });

  it("sortDocuments returns workspace order when the direction is off", () => {
    // ★ Control for the two sort assertions below: without it, a sort that
    // ignored `dir` entirely would still satisfy an ascending-only test.
    const docs = [doc(2, "B"), doc(1, "A")];
    expect(sortDocuments(docs, "title", "off")).toBe(docs);
  });

  it("sortDocuments orders by title in both directions", () => {
    const docs = [doc(2, "B"), doc(1, "A"), doc(3, "C")];
    expect(sortDocuments(docs, "title", "asc").map((d) => d.title)).toEqual(["A", "B", "C"]);
    expect(sortDocuments(docs, "title", "desc").map((d) => d.title)).toEqual(["C", "B", "A"]);
  });

  it("sortDocuments orders by block count numerically, not lexically", () => {
    // 10 vs 9: a string compare would put "10" first and pass a 1-vs-2 fixture.
    const docs = [doc(1, "ten", 10), doc(2, "nine", 9)];
    expect(sortDocuments(docs, "blocks", "asc").map((d) => d.blocks.length)).toEqual([9, 10]);
  });
});

describe("DocumentsPanel", () => {
  it("renders the empty state when there are no documents", () => {
    renderPanel([]);
    expect(screen.getByText("No documents yet.")).toBeInTheDocument();
  });

  it("creates a document with a fresh id", () => {
    const { box } = renderPanel([doc(4, "Existing")]);
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    expect(box.docs).toHaveLength(2);
    expect(box.docs[1].id).toBe(5);
  });

  it("keeps BOTH documents when two creates land in one tick", () => {
    // ★★★ THE FUNCTIONAL-SETTER GUARD. `renderPanel`'s setter does not
    // re-render, so the `documents` prop is stale for the second click — which
    // is exactly the concurrent-write shape. A non-functional
    // `setDocuments([...documents, x])` computes from the stale prop both times
    // and ends at length 1; only `setDocuments(prev => …)` reaches 2. Every
    // single-create test above passes either way, so this is the only assertion
    // that can tell them apart.
    const { box } = renderPanel([]);
    const create = screen.getByRole("button", { name: "New document" });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(box.docs).toHaveLength(2);
    expect(new Set(box.docs.map((d) => d.id)).size).toBe(2);
  });

  it("renames only the targeted document through the rename dialog", () => {
    const { box } = renderPanel([doc(1, "Alpha"), doc(2, "Beta")]);
    fireEvent.click(screen.getByRole("button", { name: "Rename – Beta" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(box.docs.map((d) => d.title)).toEqual(["Alpha", "Renamed"]);
  });

  it("drops a rename to an empty title rather than storing one", () => {
    const { box } = renderPanel([doc(1, "Alpha")]);
    fireEvent.click(screen.getByRole("button", { name: "Rename – Alpha" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(box.docs.map((d) => d.title)).toEqual(["Alpha"]);
  });

  it("deletes only the targeted document, and only after the confirm is accepted", async () => {
    const { box } = renderPanel([doc(1, "Alpha"), doc(2, "Beta")]);
    fireEvent.click(screen.getByRole("button", { name: "Delete – Alpha" }));
    // The row buttons are named "Delete – <title>", so an EXACT "Delete" match
    // reaches the dialog's confirm button and nothing else.
    const confirmBtn = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(box.docs.map((d) => d.id)).toEqual([2]));
  });

  it("does NOT delete when the confirm is cancelled", async () => {
    // ★ Control for the delete test: without it, a handler that deleted BEFORE
    // awaiting the confirm would pass the assertion above.
    const { box } = renderPanel([doc(1, "Alpha"), doc(2, "Beta")]);
    fireEvent.click(screen.getByRole("button", { name: "Delete – Alpha" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(box.docs.map((d) => d.id)).toEqual([1, 2]);
  });

  it("gives every per-row control a row-unique accessible name", () => {
    // ★★ WCAG 2.4.6. The axe gate can PASS N identical "Delete" labels when the
    // live app seeds only one row — the collision never renders at scan time —
    // so two rows are seeded here deliberately and this is the only coverage.
    renderPanel([doc(1, "Alpha"), doc(2, "Beta")]);
    for (const verb of ["Download", "Rename", "Duplicate", "Delete"]) {
      expect(screen.getByRole("button", { name: `${verb} – Alpha` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `${verb} – Beta` })).toBeInTheDocument();
    }
    const names = buttonNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("shows the selected document's title above the preview", () => {
    // ★★ Preview mode renders a FRAGMENT with no title, so the chrome must
    // supply it. Without this the pane shows an untitled body.
    renderPanel([doc(1, "Steering deck")]);
    expect(screen.getByRole("heading", { name: "Steering deck" })).toBeInTheDocument();
  });

  it("falls back to the first document when the selection is stale", () => {
    // Selection is resolved at read time, never written back, so a selected
    // document deleted by a concurrent writer self-heals to the first row
    // instead of leaving the preview blank.
    const { rerender } = renderPanel([doc(1, "Alpha"), doc(2, "Beta")]);
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(screen.getByRole("heading", { name: "Beta" })).toBeInTheDocument();
    rerender(
      <ConfirmProvider lang="en-US">
        <DocumentsPanel
          lang="en-US"
          documents={[doc(1, "Alpha")]}
          setDocuments={(() => {}) as Dispatch<SetStateAction<readonly ProjectDocument[]>>}
          ws={emptyWorkspace()}
        />
      </ConfirmProvider>,
    );
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
  });

  it("downloads the SELECTED document from the toolbar, in the default format", () => {
    renderPanel([doc(1, "Alpha"), doc(2, "Beta")]);
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    // ★ Seeding TWO documents and selecting the second is what makes this
    // meaningful: with one document, or without the select, a handler that
    // always downloaded documents[0] would pass.
    expect(downloadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2 }),
      "docx",
      expect.anything(),
      "en-US",
    );
  });

  it("downloads the ROW's document, not the selected one, from a row control", () => {
    renderPanel([doc(1, "Alpha"), doc(2, "Beta")]);
    // Selection stays on Alpha (the read-time fallback); the row control must
    // still act on Beta.
    fireEvent.click(screen.getByRole("button", { name: "Download – Beta" }));
    expect(downloadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2 }),
      "docx",
      expect.anything(),
      "en-US",
    );
  });

  it("honours an explicit format prop", () => {
    render(
      <ConfirmProvider lang="en-US">
        <DocumentsPanel
          lang="en-US"
          documents={[doc(1, "Alpha")]}
          setDocuments={(() => {}) as Dispatch<SetStateAction<readonly ProjectDocument[]>>}
          ws={emptyWorkspace()}
          format="pdf"
        />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(downloadDocument).toHaveBeenCalledWith(
      expect.anything(),
      "pdf",
      expect.anything(),
      "en-US",
    );
  });

  it("disables the toolbar download when there is nothing to download", () => {
    renderPanel([]);
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
  });
});
