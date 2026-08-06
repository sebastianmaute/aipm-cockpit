import { describe, it, expect, vi, beforeEach } from "vitest";
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

// ★★ REQUIRED, not hygiene: the panel now PERSISTS the chosen format to
// localStorage, so without this the format test leaks "pptx" into every later
// test that asserts the docx default — and `test:shuffle` reorders tests WITHIN
// a file, so the failure would be intermittent and seed-dependent rather than
// reproducible.
beforeEach(() => {
  window.localStorage.clear();
});

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

  // ★★★ THE SCROLLABLE PREVIEW MUST BE KEYBOARD-REACHABLE AND NAMED. The pane
  // scrolls and its content is rendered document HTML with nothing focusable in
  // it, so without a tabIndex a keyboard-only user cannot scroll it — axe
  // reported `serious · scrollable-region-focusable` on all five scheme combos
  // once the e2e seed began delivering real documents. This unit guard exists
  // because that gate is an e2e job: it fails in seconds, next to the change,
  // instead of at the end of the slowest pipeline stage.
  // ★ Queried by ROLE, which is the assertion doing the work: a <section> is
  // only exposed as a region once it HAS an accessible name, so getByRole
  // fails if either the name or the element regresses — one query, both halves.
  it("exposes the preview as a focusable region named after the document", () => {
    renderPanel([doc(1, "Steering deck")]);
    const region = screen.getByRole("region", { name: "Steering deck" });
    expect(region).toHaveAttribute("tabindex", "0");
    // The name must come from the rendered heading, not a hardcoded literal —
    // that is what keeps it specific AND correct in German with no new i18n key.
    expect(region).toHaveAttribute(
      "aria-labelledby",
      screen.getByRole("heading", { name: "Steering deck" }).id,
    );
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

  it("honours an explicit initialFormat", () => {
    render(
      <ConfirmProvider lang="en-US">
        <DocumentsPanel
          lang="en-US"
          documents={[doc(1, "Alpha")]}
          setDocuments={(() => {}) as Dispatch<SetStateAction<readonly ProjectDocument[]>>}
          ws={emptyWorkspace()}
          initialFormat="pdf"
        />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(downloadDocument).toHaveBeenCalledWith(expect.anything(), "pdf", expect.anything(), "en-US");
  });

  // ★★ EVERY format must actually REACH downloadDocument. A test that only
  // proved the select changed state would pass with the wiring dropped
  // entirely — the picker would look alive and always download docx. The user's
  // original ask was all four formats, so all four are asserted.
  it.each(["docx", "pptx", "pdf", "html"] as const)(
    "downloads in %s when that format is picked",
    (format) => {
      renderPanel([doc(1, "Alpha")]);
      fireEvent.change(screen.getByRole("combobox", { name: "Download format" }), {
        target: { value: format },
      });
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
      expect(downloadDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        format,
        expect.anything(),
        "en-US",
      );
    },
  );

  it("KEEPS the chosen format across a view switch (unmount + remount)", () => {
    // ★★★ THE ASSERTION WHOSE ABSENCE SHIPPED THE BUG. The shell renders only
    // the active tabpanel, so leaving the view UNMOUNTS this pane and every
    // useState resets. Nothing else in the suite unmounts, so every other test
    // passes with the format reverting to docx on each visit — the user picks
    // PPTX, goes to Gantt, comes back, and silently downloads a .docx.
    const first = renderPanel([doc(1, "Alpha")]);
    fireEvent.change(screen.getByRole("combobox", { name: "Download format" }), {
      target: { value: "pptx" },
    });
    first.unmount();

    renderPanel([doc(1, "Alpha")]);
    expect(screen.getByRole("combobox", { name: "Download format" })).toHaveValue("pptx");
    // And it must reach the DOWNLOAD, not merely repaint the control: a restore
    // that fixed the select but not the state would look identical here.
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(downloadDocument).toHaveBeenCalledWith(expect.anything(), "pptx", expect.anything(), "en-US");
  });

  it("ignores a corrupt stored format rather than passing it through", () => {
    // ★ The stored payload is untrusted. Without validation the raw string is
    // cast to DocFormat and reaches downloadDocument.
    //
    // ★★★ ASSERT AT THE DOWNLOAD, NOT THE SELECT. Measured: with validation
    // REMOVED, `expect(combobox).toHaveValue("docx")` still PASSED — a <select>
    // whose value matches no <option> falls back to option 0 in the DOM, so the
    // control reads "DOCX" while "exe" sits in state and goes on to the
    // renderer. The select's own fallback masks exactly the bug this test
    // exists to catch, so the only honest assertion is what reaches the module.
    window.localStorage.setItem("aipm-cockpit:documents-format", "exe");
    renderPanel([doc(1, "Alpha")]);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(downloadDocument).toHaveBeenCalledWith(expect.anything(), "docx", expect.anything(), "en-US");
  });

  it("passes the picked format to a ROW download too", () => {
    // The row controls share the toolbar's format; without this a picker that
    // only reached the toolbar path would look correct.
    renderPanel([doc(1, "Alpha")]);
    fireEvent.change(screen.getByRole("combobox", { name: "Download format" }), {
      target: { value: "html" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Download – Alpha" }));
    expect(downloadDocument).toHaveBeenCalledWith(expect.anything(), "html", expect.anything(), "en-US");
  });

  it("disables the toolbar download when there is nothing to download", () => {
    renderPanel([]);
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
  });
});

describe("DocumentsPanel — read-only (popout guard)", () => {
  function renderReadOnly() {
    vi.mocked(downloadDocument).mockClear();
    return render(
      <ConfirmProvider lang="en-US">
        <DocumentsPanel
          lang="en-US"
          documents={[doc(1, "Alpha"), doc(2, "Beta")]}
          setDocuments={(() => {
            throw new Error("setDocuments must never be called in a read-only pane");
          }) as Dispatch<SetStateAction<readonly ProjectDocument[]>>}
          ws={emptyWorkspace()}
          isReadOnly
        />
      </ConfirmProvider>,
    );
  }

  it("disables every MUTATING control", () => {
    renderReadOnly();
    expect(screen.getByRole("button", { name: "New document" })).toBeDisabled();
    for (const title of ["Alpha", "Beta"]) {
      for (const verb of ["Rename", "Duplicate", "Delete"]) {
        expect(screen.getByRole("button", { name: `${verb} – ${title}` })).toBeDisabled();
      }
    }
  });

  it("leaves the NON-mutating controls live", () => {
    // ★ The other half of the guard. Disabling everything would be a trivially
    // "passing" read-only mode that makes a popout useless — this pins that
    // reading and downloading still work.
    renderReadOnly();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download – Alpha" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Download format" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
  });

  it("cannot mutate: clicking a disabled control reaches no setter", () => {
    // The setter THROWS if called, so this fails loudly rather than silently if
    // a control is ever left live. A real `disabled` attribute is what makes
    // this hold — an `aria-disabled` lookalike still fires onClick.
    renderReadOnly();
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete – Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename – Alpha" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
