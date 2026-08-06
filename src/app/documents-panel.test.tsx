import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState, type Dispatch, type SetStateAction } from "react";
import {
  DocumentsPanel,
  appendDocument,
  duplicateDocument,
  renameDocument,
  removeDocument,
  sortDocuments,
  uniqueDocumentTitle,
} from "./documents-panel";
import { MAX_TITLE_CHARS } from "./document-model";
import { FOCUS_RING } from "./interaction-styles";
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
  const onResetSize = vi.fn();
  const utils = render(
    <ConfirmProvider lang="en-US">
      <DocumentsPanel
        lang="en-US"
        documents={initial}
        setDocuments={setDocuments}
        ws={emptyWorkspace()}
        onResetSize={onResetSize}
      />
    </ConfirmProvider>,
  );
  return { box, onResetSize, ...utils };
}

/** ★★ The OTHER harness, and it is not interchangeable with `renderPanel`.
 *  That one deliberately does NOT re-render, which is what makes the same-tick
 *  collision reproducible — but it also means the DOM never shows the row a
 *  create/duplicate just added. Every assertion about the RENDERED set of
 *  accessible names therefore needs real state behind the setter. */
function StatefulPanel({ initial }: { initial: readonly ProjectDocument[] }) {
  const [docs, setDocs] = useState<readonly ProjectDocument[]>(initial);
  return (
    <ConfirmProvider lang="en-US">
      <DocumentsPanel
        lang="en-US"
        documents={docs}
        setDocuments={setDocs}
        ws={emptyWorkspace()}
        onResetSize={() => {}}
      />
    </ConfirmProvider>
  );
}

/** Every button name currently rendered, asserted to be collision-free. */
function expectNoDuplicateButtonNames() {
  const names = buttonNames();
  expect(new Set(names).size).toBe(names.length);
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

  // ★★★ TITLE UNIQUENESS. Every per-row control's accessible name is
  // `<verb> – <title>`, so two equal titles are a WCAG 2.4.6 failure the axe
  // gate structurally cannot see (it scans a single-row app). The UI cases
  // further down drive this through real clicks; these pin the arithmetic.
  it("uniqueDocumentTitle returns the base untouched when it is free", () => {
    // ★ The control. Without it, a minter that ALWAYS appended " 2" would
    // satisfy every collision assertion below while renaming innocent titles.
    expect(uniqueDocumentTitle([doc(1, "A")], "B")).toBe("B");
  });

  it("uniqueDocumentTitle walks past every taken suffix, not just the first", () => {
    const prev = [doc(1, "A"), doc(2, "A 2"), doc(3, "A 3")];
    // A minter that only checked the base and stopped at " 2" returns "A 2",
    // which is itself taken — the collision merely moves.
    expect(uniqueDocumentTitle(prev, "A")).toBe("A 4");
  });

  it("uniqueDocumentTitle compares titles EXACTLY, not loosely", () => {
    // Case and surrounding space are part of the accessible name, so "a" and
    // "A " do not collide with "A" and must not be renamed.
    const prev = [doc(1, "A")];
    expect(uniqueDocumentTitle(prev, "a")).toBe("a");
    expect(uniqueDocumentTitle(prev, "A ")).toBe("A ");
  });

  it("uniqueDocumentTitle keeps the result inside MAX_TITLE_CHARS", () => {
    // ★ Otherwise sanitizeProjectDocuments truncates on the NEXT load and can
    // cut the copy back to its source's exact bytes — restoring the collision
    // this exists to remove. Truncation must bite the BASE, not the suffix.
    const long = "x".repeat(MAX_TITLE_CHARS);
    const out = uniqueDocumentTitle([doc(1, long)], long);
    expect(out.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(out).not.toBe(long);
    expect(out.endsWith(" 2")).toBe(true);
  });

  it("appendDocument mints a title that does not collide with an existing one", () => {
    const next = appendDocument([doc(1, "New document")], "New document", NOW);
    expect(next[1].title).toBe("New document 2");
  });

  it("duplicateDocument never gives the copy its source's exact title", () => {
    // ★ THE SHAPE THE OLD TEST COULD NOT REACH: it passed "A copy", a value
    // the application never produced — the call site handed over `doc.title`.
    const next = duplicateDocument([doc(1, "A", 3)], 1, "A", NOW);
    expect(next[1].title).not.toBe("A");
    expect(next[1].blocks).toHaveLength(3); // still a real copy
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
    expectNoDuplicateButtonNames();
  });

  // ★★★ THE CASE THE FIXTURE ABOVE STRUCTURALLY CANNOT REACH. Seeding
  // Alpha/Beta pins that the names are QUALIFIED, never that anything keeps
  // titles distinct — and nothing did: `handleDuplicate` passed the source's
  // own `doc.title`, so one click produced two rows named "Steering update"
  // and five pairs of identical control names (the four verbs plus the
  // row-title selection button). Measured RED against the pre-fix code: the
  // `getByRole` below threw "Found multiple elements with the role button and
  // name Duplicate – Steering update" — i.e. it fails on the query, before it
  // ever reaches the uniqueness assertion.
  it("keeps every control name unique after DUPLICATING a row", () => {
    render(<StatefulPanel initial={[doc(1, "Steering update"), doc(2, "Beta")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate – Steering update" }));
    expect(screen.getByRole("button", { name: "Duplicate – Steering update (copy)" })).toBeInTheDocument();
    expectNoDuplicateButtonNames();
  });

  it("keeps every control name unique after duplicating the SAME row twice", () => {
    // ★ The second click's base ("… (copy)") is itself taken by then, so a
    // minter that only appended a fixed suffix collides on the second copy —
    // the exact "the collision merely moves" failure.
    render(<StatefulPanel initial={[doc(1, "Steering update")]} />);
    const dup = () => screen.getByRole("button", { name: "Duplicate – Steering update" });
    fireEvent.click(dup());
    fireEvent.click(dup());
    expect(screen.getByRole("button", { name: "Duplicate – Steering update (copy) 2" })).toBeInTheDocument();
    expectNoDuplicateButtonNames();
  });

  it("keeps every control name unique after two CREATES", () => {
    // Same defect on the other call site: every new document was titled with
    // the same string, so two clicks collided.
    render(<StatefulPanel initial={[]} />);
    const create = screen.getByRole("button", { name: "New document" });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(screen.getByRole("button", { name: "Rename – Untitled document" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename – Untitled document 2" })).toBeInTheDocument();
    expectNoDuplicateButtonNames();
  });

  it("does not name a new document after the toolbar button that creates it", () => {
    // ★ The row-title button's accessible name IS the title, so a default title
    // equal to the toolbar's label puts two buttons called "New document" in
    // one pane. `create` is re-queried by an EXACT name after the click, which
    // is the assertion doing the work: a second match throws.
    render(<StatefulPanel initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    expect(screen.getByRole("button", { name: "New document" })).toBeInTheDocument();
    expectNoDuplicateButtonNames();
  });

  it("names the actions column header for what that column holds", () => {
    // ★ It reused `documentsNew`, so a screen reader announced the
    // Download/Rename/Duplicate/Delete column as "New document". axe passes
    // that (a name exists); the name was simply wrong, which is why the
    // NEGATIVE half below is the assertion that would have caught it.
    renderPanel([doc(1, "Alpha")]);
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "New document" })).toBeNull();
  });

  it("gives the row-title button the house focus ring", () => {
    // Asserted against the exported constant, not a class literal: the ring is
    // the app-wide standard and there is no global :focus-visible rule, so a
    // raw button without it is invisible to keyboard users.
    renderPanel([doc(1, "Alpha")]);
    expect(screen.getByRole("button", { name: "Alpha" }).className).toContain(FOCUS_RING);
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
          onResetSize={() => {}}
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
          onResetSize={() => {}}
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

  it("reaches onResetSize from the toolbar's reset-size control", () => {
    // ★ The prop is REQUIRED now, but a required prop only guarantees a value
    // is passed — not that the button is wired to it. It was previously
    // optional with an `onResetSize ?? (() => {})` fallback, which would
    // satisfy tsc and swallow every click.
    const { onResetSize } = renderPanel([doc(1, "Alpha")]);
    fireEvent.click(screen.getByRole("button", { name: "Reset back to the default size." }));
    expect(onResetSize).toHaveBeenCalledTimes(1);
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
          onResetSize={() => {}}
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
