import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { DocumentsPanel, sortDocuments, uniqueDocumentTitle } from "./documents-panel";
import { MAX_DOCUMENTS, MAX_TITLE_CHARS } from "./document-model";
import { FOCUS_RING } from "./interaction-styles";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider } from "./confirm-dialog";
import type { ProjectDocument } from "./document-model";
import { applyDocMutation, type DocMutation, type DocResult } from "./document-mutations";
import type { DocVersion, DocVersionSource } from "./document-versions";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { emptyWorkspace } from "./workspace";
import { buttonNames } from "../test/toolbar-order";
import { downloadDocument } from "./document-download";
import { __resetMintStateForTests, mintId } from "./id-mint-session";

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
  __resetMintStateForTests();
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

/** Renders the panel against a mutation entry point that does NOT trigger a
 *  re-render, so the `documents` PROP stays at its initial value for the whole
 *  test while the underlying state really advances. That is what makes the
 *  same-tick shape reproducible — the pane sees a world one mutation behind.
 *
 *  ★★ It drives the REAL `applyDocMutation`, not a hand-written stand-in, so
 *  the state it advances to is the state production would reach. What it does
 *  NOT reproduce is workspace-context's ref mirroring; `renderLive` below is
 *  the harness for anything that depends on that. Returns a live handle to
 *  both slices. */
/** For cases that never mutate. A real no-op `DocResult`, not a cast — the old
 *  harnesses cast `() => {}` to a setter type, which meant a signature change
 *  landed as a silent lie rather than a type error. */
const inertMutate = (): DocResult => ({
  documents: [],
  versions: [],
  changed: false,
  rejected: [],
  documentId: null,
});

type Box = { docs: readonly ProjectDocument[]; versions: readonly DocVersion[] };

function boxMutator(box: Box) {
  return (m: DocMutation, source: DocVersionSource): DocResult => {
    const result = applyDocMutation({ documents: box.docs, versions: box.versions }, m, {
      now: NOW,
      source,
      mintDocId: () => mintId("document", box.docs),
      mintVersionId: () => mintId("documentVersion", box.versions),
    });
    box.docs = result.documents;
    box.versions = result.versions;
    return result;
  };
}

function renderPanel(initial: readonly ProjectDocument[] = []) {
  const box: Box = { docs: initial, versions: [] };
  const mutateDocuments = boxMutator(box);
  vi.mocked(downloadDocument).mockClear();
  const onResetSize = vi.fn();
  const utils = render(
    <ConfirmProvider lang="en-US">
      <DocumentsPanel
        lang="en-US"
        documents={initial}
        mutateDocuments={mutateDocuments}
        documentVersions={[]}
        ws={emptyWorkspace()}
        onResetSize={onResetSize}
      />
    </ConfirmProvider>,
  );
  return { box, mutateDocuments, onResetSize, ...utils };
}

/** ★★★ THE OTHER HARNESS, AND IT IS THE REAL `WorkspaceProvider` ON PURPOSE.
 *  `renderPanel` deliberately does not re-render, so the DOM never shows the
 *  row a create/duplicate just added — every assertion about the RENDERED set
 *  of accessible names needs real state behind the entry point.
 *
 *  But the bigger reason is fidelity. What this task moved into the pane is the
 *  claim "a user mutation records a version", and the code that makes that true
 *  lives in workspace-context: it composes `documents` and `documentVersions`
 *  from two refs it advances itself. A harness that re-implemented that would
 *  be a SECOND implementation of the thing under test — it could stay green
 *  while production silently dropped every version. So these cases mount the
 *  provider and read `documentVersions` back out of it, rendered as a list. */
function VersionTrail() {
  const { documentVersions } = useWorkspace();
  return (
    <ul data-testid="version-trail">
      {documentVersions.map((v) => (
        <li key={v.id}>{`${v.op}|${v.documentId}|${v.title}|${v.source}`}</li>
      ))}
    </ul>
  );
}

/** Seeds `documents` through the plain setter, NOT through `mutateDocuments` —
 *  seeding must not itself write versions, or every trail assertion below would
 *  start from a polluted baseline. */
function Seed({ documents }: { documents: readonly ProjectDocument[] }) {
  const { setDocuments } = useWorkspace();
  useEffect(() => {
    if (documents.length) setDocuments(documents);
  }, [documents, setDocuments]);
  return null;
}

function LivePanel({ initial }: { initial: readonly ProjectDocument[] }) {
  // ★ `documentVersions` comes from the PROVIDER here, not a fixture — the
  // history modal is fed by it, so a static `[]` would make every live history
  // assertion below vacuous while production worked. This is the whole reason
  // the panel takes it as a prop rather than reading `ws.documentVersions`:
  // `ws` is a static `emptyWorkspace()` in this harness.
  const { documents, mutateDocuments, documentVersions } = useWorkspace();
  return (
    <>
      <Seed documents={initial} />
      <DocumentsPanel
        lang="en-US"
        documents={documents}
        mutateDocuments={mutateDocuments}
        documentVersions={documentVersions}
        ws={emptyWorkspace()}
        onResetSize={() => {}}
      />
      <VersionTrail />
    </>
  );
}

function providers({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <ConfirmProvider lang="en-US">{children}</ConfirmProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

function renderLive(initial: readonly ProjectDocument[] = []) {
  vi.mocked(downloadDocument).mockClear();
  return render(<LivePanel initial={initial} />, { wrapper: providers });
}

/** The live version trail, as `op|documentId|title|source` strings. */
function versionTrail(): string[] {
  return within(screen.getByTestId("version-trail"))
    .queryAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

/** Row-title buttons currently rendered, in DOM order — the pane's documents as
 *  a user can actually see them. */
function renderedTitles(): string[] {
  return buttonNames().filter((n) => n.startsWith("Rename – ")).map((n) => n.slice("Rename – ".length));
}

/** Every button name currently rendered, asserted to be collision-free. */
function expectNoDuplicateButtonNames() {
  const names = buttonNames();
  expect(new Set(names).size).toBe(names.length);
}

describe("documents-panel pure helpers", () => {
  // ★ The four mutation transforms that used to live here — appendDocument,
  // duplicateDocument, renameDocument, removeDocument — are GONE, along with
  // the identity/no-op cases that pinned them. Do NOT reintroduce them: the
  // pane mutates through `mutateDocuments` now, and `document-mutations.test.ts`
  // owns those rules (including "a no-op returns the caller's OWN reference").
  // What is left here is naming and ordering, which are this file's own.

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
    // ★★★ THE STALE-PROP GUARD, and it MOVED when the pane stopped owning a
    // setter. It used to pin `setDocuments(prev => …)` against
    // `setDocuments([...documents, x])`. There is no updater here any more, so
    // what it pins now is that the pane hands `mutateDocuments` an INTENT and
    // lets it compute — never a list, an id or a next-state it derived from its
    // own `documents` prop, which `renderPanel` deliberately keeps one mutation
    // behind. A pane that minted the id itself ends at ONE distinct id.
    // ★ The same-tick correctness of the entry point itself is workspace-
    // context's (its refs advance synchronously); pinned there, not here.
    const { box } = renderPanel([]);
    const create = screen.getByRole("button", { name: "New document" });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(box.docs).toHaveLength(2);
    expect(new Set(box.docs.map((d) => d.id)).size).toBe(2);
  });

  it("keeps both TITLES distinct when two creates land in one tick", () => {
    // ★★★ THE HALF THE ID ASSERTION ABOVE CANNOT SEE, and the one this task
    // nearly broke. `uniqueDocumentTitle` used to run INSIDE the append
    // transform, which a functional setter handed React's latest queued state;
    // it runs at the CALL SITE now, and the only list a call site has is the
    // `documents` prop — one mutation behind, exactly as `renderPanel` models
    // it. Both creates would then uniquify against the empty pre-mutation list
    // and mint "Untitled document" TWICE: five pairs of identical per-row
    // control names, the WCAG 2.4.6 failure the minting exists to remove.
    // `freshDocuments()` is what closes it. Mutation-proved: point either call
    // site back at `documents` and this goes red while every other case here
    // stays green.
    const { box } = renderPanel([]);
    const create = screen.getByRole("button", { name: "New document" });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(box.docs.map((d) => d.title)).toEqual(["Untitled document", "Untitled document 2"]);
  });

  it("cannot mint a title the ENGINE's set already holds, whatever the prop says", () => {
    // ★★★ THIS CASE CHANGED MEANING, and the change is the whole point of
    // moving uniqueness into `document-mutations.ts`. It used to pin that
    // `freshDocuments()` prefers the PROP once the prop has moved on, and it
    // asserted the bare base as the answer.
    //
    // ★★★ THAT ASSERTION IS NOW WRONG, and the engine is right. The pane can
    // only ever see its `documents` prop; the engine uniquifies against the
    // state it actually holds, which here still contains "Untitled document"
    // from the first create. So the bare base WOULD have collided, and the
    // suffix is the correct answer — the engine resolved a collision the pane
    // could not see.
    //
    // ★★ CONSEQUENCE WORTH KNOWING: with the engine authoritative, the pane's
    // `freshRef` no longer changes any outcome — `mutateDocuments` reads
    // workspace-context's refs, which are advanced synchronously and are
    // therefore strictly fresher than anything a render body can compute. The
    // pane's own uniquification is now belt-and-braces, kept only because
    // documents-panel.tsx belongs to another slice. It is harmless because the
    // engine's pass is idempotent (pinned in document-mutations.test.ts).
    const { box, mutateDocuments, rerender } = renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    expect(box.docs.map((d) => d.title)).toEqual(["Untitled document"]);
    rerender(
      <ConfirmProvider lang="en-US">
        <DocumentsPanel
          lang="en-US"
          documents={[doc(9, "Something else")]}
          mutateDocuments={mutateDocuments}
          documentVersions={[]}
          ws={emptyWorkspace()}
          onResetSize={() => {}}
        />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    expect(box.docs.at(-1)!.title).toBe("Untitled document 2");
    // ★ And the property that actually matters, asserted directly rather than
    // inferred from one title: every rendered row name stays distinct.
    expect(new Set(box.docs.map((d) => d.title)).size).toBe(box.docs.length);
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
    renderLive([doc(1, "Steering update"), doc(2, "Beta")]);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate – Steering update" }));
    expect(screen.getByRole("button", { name: "Duplicate – Steering update (copy)" })).toBeInTheDocument();
    expectNoDuplicateButtonNames();
  });

  it("keeps every control name unique after duplicating the SAME row twice", () => {
    // ★ The second click's base ("… (copy)") is itself taken by then, so a
    // minter that only appended a fixed suffix collides on the second copy —
    // the exact "the collision merely moves" failure.
    renderLive([doc(1, "Steering update")]);
    const dup = () => screen.getByRole("button", { name: "Duplicate – Steering update" });
    fireEvent.click(dup());
    fireEvent.click(dup());
    expect(screen.getByRole("button", { name: "Duplicate – Steering update (copy) 2" })).toBeInTheDocument();
    expectNoDuplicateButtonNames();
  });

  it("keeps every control name unique after two CREATES", () => {
    // Same defect on the other call site: every new document was titled with
    // the same string, so two clicks collided.
    renderLive([]);
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
    renderLive([]);
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
          mutateDocuments={inertMutate}
          documentVersions={[]}
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
          mutateDocuments={inertMutate}
          documentVersions={[]}
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

// ★★★ THE POINT OF THE WHOLE TASK. Before this, the pane wrote `documents`
// with a setter of its own: a user rename recorded no history at all while an
// AI rename — going through `mutateDocuments` — recorded one. "Every mutation
// snapshots its before-image" cannot be half-true, because that snapshot is the
// only history the AI writes have (they bypass the undo stack entirely).
//
// ★★ These assert the RESULTING `documentVersions`, read back out of the real
// provider, not that `mutateDocuments` was called. A spy proves the wiring
// exists; it cannot prove the wiring works, and in the previous slice a
// flagship guard passed against a deliberately broken implementation.
describe("DocumentsPanel — every user mutation records a version", () => {
  function create() {
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
  }

  it("records NO version for a create — a create replaces nothing", () => {
    // ★ The control, and the reason the counts below are meaningful. Without
    // it, an implementation that snapshotted on EVERY mutation would satisfy
    // all three cases below while filling the trail with entries that restore
    // to an empty document. Paired with a positive observable so the empty
    // trail cannot be the empty trail of a pane that never rendered.
    renderLive([]);
    create();
    expect(renderedTitles()).toEqual(["Untitled document"]);
    expect(versionTrail()).toEqual([]);
  });

  it("records exactly ONE version for a rename, holding the PRE-rename title", () => {
    // ★★★ THE HEADLINE CASE. A version is a BEFORE-image: restoring it must
    // undo the rename, so it has to carry the title the rename REPLACED. An
    // implementation that snapshotted the post-rename state would produce a
    // version that restores to itself — a history entry that does nothing,
    // which reads as working right up until someone uses it.
    renderLive([]);
    create();
    fireEvent.click(screen.getByRole("button", { name: "Rename – Untitled document" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Steering deck" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    expect(renderedTitles()).toEqual(["Steering deck"]);
    // ★ The whole trail, EXACTLY — so "one version" and "the right version" are
    // one assertion. The id is deterministic (`__resetMintStateForTests` runs in
    // `beforeEach`), which is the same convention the id cases above use.
    expect(versionTrail()).toEqual(["rename|1|Untitled document|user"]);
  });

  it("records the pane's mutations as `user`, never `ai`", () => {
    // ★ The source is what separates a user's own edit from an AI write in the
    // version history UI, and it is a literal the pane passes — nothing else in
    // the suite would notice it flipping. Asserted on the same live trail, so a
    // wrong literal cannot hide behind a stubbed argument.
    renderLive([]);
    create();
    fireEvent.click(screen.getByRole("button", { name: "Rename – Untitled document" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(versionTrail().map((e) => e.split("|")[3])).toEqual(["user"]);
  });

  it("records a tombstone version for a delete rather than losing the document", async () => {
    // ★★ A delete is the one mutation whose before-image is the ONLY surviving
    // copy of the document — it is what the deleted-documents list and Restore
    // read. A pane that deleted without it destroys the document irrecoverably,
    // and the pane would look identical either way.
    renderLive([]);
    create();
    fireEvent.click(screen.getByRole("button", { name: "Delete – Untitled document" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(renderedTitles()).toEqual([]));
    expect(versionTrail()).toEqual(["delete|1|Untitled document|user"]);
  });

  it("does NOT record a version when the delete confirm is cancelled", async () => {
    // ★ The other half: a pane that mutated BEFORE awaiting the confirm would
    // satisfy the tombstone case above. The surviving row is the positive
    // observable that keeps the empty-trail assertion from being vacuous.
    renderLive([]);
    create();
    fireEvent.click(screen.getByRole("button", { name: "Delete – Untitled document" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(renderedTitles()).toEqual(["Untitled document"]);
    expect(versionTrail()).toEqual([]);
  });

  it("duplicating corrupts neither slice", () => {
    // Both documents survive under distinct titles, and exactly one version is
    // written, holding the SOURCE's title.
    // ★★ `2` is the COPY's id — the source minted 1. That is the half the
    // rendered rows cannot show: a version filed under the SOURCE would read
    // `duplicate|1|…`, which makes an untouched document look edited and leaves
    // the copy with no history at all. The rule itself is
    // document-mutations.ts's, but the trail exposes it here for free, so
    // asserting the whole string costs nothing and catches a real regression.
    renderLive([]);
    create();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate – Untitled document" }));

    expect(renderedTitles()).toEqual(["Untitled document", "Untitled document (copy)"]);
    expectNoDuplicateButtonNames();
    expect(versionTrail()).toEqual(["duplicate|2|Untitled document|user"]);
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
          mutateDocuments={() => {
            throw new Error("mutateDocuments must never be called in a read-only pane");
          }}
          documentVersions={[
            {
              id: 1,
              documentId: 99,
              title: "Gone",
              blocks: [],
              savedAt: "2026-08-05T10:00:00.000Z",
              source: "user",
              op: "delete",
            },
          ]}
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

  it("cannot mutate: clicking a disabled control reaches no mutation", () => {
    // `mutateDocuments` THROWS if called, so this fails loudly rather than
    // silently if
    // a control is ever left live. A real `disabled` attribute is what makes
    // this hold — an `aria-disabled` lookalike still fires onClick.
    renderReadOnly();
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete – Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename – Alpha" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // ★★ The popout guard, same split as the history modal: READING the deleted
  // list is safe, restoring is not. Driven through the read-only harness,
  // whose version fixture is a tombstone (a documentId absent from the live
  // documents) precisely so there is a row here to disable.
  it("disables Restore in a read-only popout while still listing the tombstone", async () => {
    const user = userEvent.setup();
    renderReadOnly();
    await user.click(screen.getByRole("button", { name: /Deleted documents/ }));

    const restore = screen.getByRole("button", { name: /^Restore –/ });
    expect(restore).toBeInTheDocument(); // still readable
    expect(restore).toBeDisabled();
    // A real `disabled` attribute, not an `aria-disabled` lookalike — the
    // lookalike still fires onClick, and this pane's mutateDocuments THROWS in
    // read-only, so a live button would surface as a crash.
    await user.click(restore);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// ★★★ THE DELETED-DOCUMENTS SURFACE. These drive the REAL provider
// (`renderLive`) rather than the props harness, because the list is derived
// from `documentVersions` and the derivation is the thing under test — a
// fixture-fed version array would be a second implementation of it.
describe("DocumentsPanel — deleted documents", () => {
  /** Create a document, then delete it, leaving exactly one tombstone. */
  async function seedOneDeleted(title = "Doomed") {
    renderLive([{ ...doc(1, title) }]);
    fireEvent.click(await screen.findByRole("button", { name: `Delete – ${title}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: `Delete – ${title}` })).toBeNull());
  }

  it("hides the section until the toggle is on, then lists the tombstone", async () => {
    const user = userEvent.setup();
    await seedOneDeleted();

    // ★ A POSITIVE observable that the toggle is what reveals it: the section
    // is absent first, so this cannot pass against a list that never renders.
    expect(screen.queryByRole("button", { name: /^Restore –/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Deleted documents/ }));

    const restores = screen.getAllByRole("button", { name: /^Restore –/ });
    expect(restores).toHaveLength(1);
    expect(restores[0].getAttribute("aria-label")).toContain("Doomed");
  });

  it("counts the tombstones on the toggle itself", async () => {
    await seedOneDeleted();
    expect(screen.getByRole("button", { name: /Deleted documents/ }).textContent).toContain("(1)");
  });

  // ★★★ MUTATION-PROVED. Row-unique names, with the trap from T20 closed: with
  // every aria-label null, `getAllByRole(…, {name: /Restore/})` finds NOTHING
  // and a Set-size assertion reduces to `0 === 0`. So this asserts the COUNT
  // first, then non-emptiness, then uniqueness, then that each name carries
  // its own version id — which is the only field unique by construction, since
  // nothing uniquifies titles outside this pane's create/duplicate handlers.
  it("gives every Restore button a row-unique accessible name", async () => {
    const user = userEvent.setup();
    renderLive([doc(1, "Same title"), doc(2, "Same title")]);
    for (const id of [1, 2]) {
      fireEvent.click(screen.getAllByRole("button", { name: "Delete – Same title" })[0]);
      fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
      await waitFor(() =>
        expect(screen.queryAllByRole("button", { name: "Delete – Same title" })).toHaveLength(2 - id),
      );
    }

    await user.click(screen.getByRole("button", { name: /Deleted documents/ }));
    const buttons = screen.getAllByRole("button", { name: /^Restore –/ });
    expect(buttons).toHaveLength(2);

    const names = buttons.map((b) => b.getAttribute("aria-label"));
    expect(names.every((n) => typeof n === "string" && n.trim().length > 0)).toBe(true);
    expect(new Set(names).size).toBe(2);
    // Both rows share a TITLE, so only the id can separate them — a
    // title-only label would collide here and pass the Set check nowhere else.
    expect(names.every((n) => /#\d+$/.test(n ?? ""))).toBe(true);
  });

  it("restores the document and drops it from the deleted list", async () => {
    const user = userEvent.setup();
    await seedOneDeleted();
    await user.click(screen.getByRole("button", { name: /Deleted documents/ }));
    await user.click(screen.getByRole("button", { name: /^Restore –/ }));

    // Back among the live documents (under a NEW id — ids are never reused)…
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete – Doomed" })).toBeInTheDocument());
    // …and gone from the deleted list, because the restore wrote a marker that
    // closes the tombstone. Without it the row would persist and every click
    // would mint another copy.
    expect(screen.queryByRole("button", { name: /^Restore –/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Deleted documents/ }).textContent).toContain("(0)");
  });

  // ★★★ MUTATION-PROVED, and the most important case here: at MAX_DOCUMENTS
  // every restore is refused, and a Restore button that silently does nothing
  // is the worst outcome available. `mutateDocuments` returns `rejected`
  // synchronously, so the only way to get this wrong is to discard it.
  it("renders the reason when a restore is refused", async () => {
    const user = userEvent.setup();
    // A workspace already AT the cap, plus one tombstone to restore into it.
    const full = Array.from({ length: MAX_DOCUMENTS }, (_, i) => doc(i + 2, `Doc ${i + 2}`));
    renderLive([doc(1, "Doomed"), ...full]);
    fireEvent.click(await screen.findByRole("button", { name: "Delete – Doomed" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete – Doomed" })).toBeNull());

    await user.click(screen.getByRole("button", { name: /Deleted documents/ }));
    const restore = screen.getByRole("button", { name: /^Restore –/ });
    await user.click(restore);

    // The refusal is ANNOUNCED, not merely drawn.
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/document limit reached/i);
    // And the row is still there, because nothing was restored — so this is
    // not passing against a surface that silently succeeded.
    expect(screen.getByRole("button", { name: /^Restore –/ })).toBeInTheDocument();
  });

});
