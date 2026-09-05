import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { DocumentsPanel, sortDocuments, uniqueDocumentTitle } from "./documents-panel";
import { MAX_DOCUMENTS, MAX_TITLE_CHARS } from "./document-model";
import { FOCUS_RING } from "./interaction-styles";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider } from "./confirm-dialog";
import { ToastProvider } from "./toast-context";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { t } from "./i18n";
import type { ProjectDocument } from "./document-model";
import type { DocRefKind } from "./document-ref";
import { applyDocMutation, type DocMutation, type DocResult } from "./document-mutations";
import type { DocVersion, DocVersionSource } from "./document-versions";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { emptyWorkspace } from "./workspace";
import { buttonNames } from "../test/toolbar-order";
import { downloadDocument } from "./document-download";
import { loadAssetData } from "./document-assets-store";
import type { DocumentAssetPaneProps } from "./documents-asset-section";
import type { TursoConfig } from "./turso-config";
import { __resetMintStateForTests, mintId } from "./id-mint-session";
import { flashOutlineClass } from "./use-deeplink-row-flash";
import { expectRowUniqueNames } from "../test/row-unique-names";

/** The heading editor's accessible names, 0-based block index in, en-dash
 *  qualified name out. Spelled once so a convention change is one edit. */
const headingTextName = (index: number) =>
  `${t("en-US", "documentsHeadingText")} – ${t("en-US", "documentsBlockN", String(index + 1))}`;

// The real one opens tabs and triggers blob downloads — neither works in jsdom,
// and the module has its own suite. Here we only pin that the panel calls it
// with the right document and format.
// ★★ `downloadDocument` ONLY. `reportDownloadFailure` is left REAL — it is the
// disclosure under test, and a `vi.fn()` for it would reduce the assertion to
// "we called the thing we mocked", which passes with the toast key, the
// diagnostic code and `reportSilentFailure` itself all wrong. Keeping it real
// lets the spy below see the actual translated string a user would read.
//
// ★ `async () => {}` rather than `vi.fn()`: the handler now chains `.catch` on
// the returned promise, and a mock returning `undefined` would throw a
// TypeError at the call site — which reads as a broken panel, not a broken mock.
vi.mock("./document-download", async (orig) => ({
  ...(await orig<typeof import("./document-download")>()),
  downloadDocument: vi.fn(async () => {}),
}));

// ★★ EVERY export is mocked, not just the one under test: the asset section
// this pane mounts calls `loadAssetDataIds` from an effect and the CRUD writers
// from its handlers, so a partial factory would leave those `undefined` and the
// render would throw for a reason unrelated to anything asserted here.
//
// ★★ `loadAssetData` RESOLVES A VALUE rather than no-opping. The loader
// assertion below AWAITS it, and a `vi.fn()` returning `undefined` would make
// that await throw inside the test rather than at the assertion — a mock that
// no-ops the method under test hides its own mutant.
vi.mock("./document-assets-store", () => ({
  loadAssetData: vi.fn(async () => "QUJD"),
  loadAssetDataIds: vi.fn(async () => []),
  saveAssetData: vi.fn(async () => {}),
  deleteAssetData: vi.fn(async () => {}),
  deleteAllAssetDataForProject: vi.fn(async () => {}),
}));

// ★★ REQUIRED, not hygiene: the panel now PERSISTS the chosen format to
// localStorage, so without this the format test leaks "pptx" into every later
// test that asserts the docx default — and `test:shuffle` reorders tests WITHIN
// a file, so the failure would be intermittent and seed-dependent rather than
// reproducible.
/** ★★ The pane now reads BOTH ambient contexts — `useToastContext` for the
 *  restore toast and `useWorkspaceTab` for the deep-link signal — and the
 *  latter THROWS outside its provider, so every harness below has to supply
 *  them. One host component rather than nine copies, and it carries the toast
 *  spy so any case can assert on it (or on its silence) without extra wiring. */
const showToastSpy = vi.fn();
const showToastActionSpy = vi.fn();

function PanelHost({ children }: { children: ReactNode }) {
  return (
    <WorkspaceTabProvider>
      <ToastProvider value={{ showToast: showToastSpy, showToastAction: showToastActionSpy }}>
        <ConfirmProvider lang="en-US">{children}</ConfirmProvider>
      </ToastProvider>
    </WorkspaceTabProvider>
  );
}

/** Fires `requestOpen(view, id)` — the exact primitive the chat transcript's
 *  document card calls — from INSIDE the provider, so the pane consumes a real
 *  signal rather than a hand-built prop. */
function DeepLinkTrigger({ view, id }: { view: "documents" | "raid"; id: number }) {
  const { requestOpen } = useWorkspaceTab();
  return (
    <button type="button" onClick={() => requestOpen(view, id)}>
      deep-link
    </button>
  );
}

// ★★ FILE-LEVEL, not scoped to the deep-link blocks, and that is deliberate.
// jsdom has no layout engine and does not define `scrollIntoView` at all — so
// `vi.spyOn` cannot wrap it and, left alone, the deep-link flash hook's rAF
// callback throws a TypeError on the row it just found. That throw happens
// INSIDE a requestAnimationFrame, i.e. outside the assertion path: it does not
// redden the case, it surfaces as an unhandled error that can exit the run
// non-zero with every test reported passing. Any case in this file that fires a
// deep link reaches it, so the stub belongs here rather than beside one block.
// Restored to the original (undefined) after each so it never leaks out.
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  window.localStorage.clear();
  __resetMintStateForTests();
  showToastSpy.mockClear();
  showToastActionSpy.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
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
  minted: null,
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

function renderPanel(
  initial: readonly ProjectDocument[] = [],
  opts: { allowDestructiveSave?: () => void; isReadOnly?: boolean } = {},
) {
  const box: Box = { docs: initial, versions: [] };
  const mutateDocuments = boxMutator(box);
  vi.mocked(downloadDocument).mockClear();
  const onResetSize = vi.fn();
  const utils = render(
    <PanelHost>
      <DocumentsPanel
        lang="en-US"
        documents={initial}
        mutateDocuments={mutateDocuments}
        documentVersions={[]}
        ws={emptyWorkspace()}
        onResetSize={onResetSize}
        allowDestructiveSave={opts.allowDestructiveSave}
        isReadOnly={opts.isReadOnly}
      />
    </PanelHost>,
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
        <PanelHost>{children}</PanelHost>
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
      <PanelHost>
        <DocumentsPanel
          lang="en-US"
          documents={[doc(9, "Something else")]}
          mutateDocuments={mutateDocuments}
          documentVersions={[]}
          ws={emptyWorkspace()}
          onResetSize={() => {}}
        />
      </PanelHost>,
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

  it("arms the destructive-save bypass when a document is deleted", async () => {
    const allowDestructiveSave = vi.fn();
    const { box } = renderPanel([doc(1, "Alpha"), doc(2, "Beta")], { allowDestructiveSave });
    fireEvent.click(screen.getByRole("button", { name: "Delete – Alpha" }));
    const confirmBtn = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(box.docs.map((d) => d.id)).toEqual([2]));
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  // ★★★ ARMING BEFORE THE MUTATION LEAKED THE ONE-SHOT INDEFINITELY.
  // `mutateDocuments` (`workspace-context.tsx`) returns early on
  // `!result.changed` — no `setDocuments`, so no state change, so the save
  // effect never runs and never CONSUMES the bypass. A concurrent writer (the
  // AI `delete_document` tool, or another tab via broadcast sync) removing the
  // same document while the confirm was open was enough to trigger it, and the
  // bypass then waved a LATER accidental mass deletion through L3 and Layer B.
  it("does NOT arm when the delete turns out to be a no-op", async () => {
    const allowDestructiveSave = vi.fn();
    const { box } = renderPanel([doc(1, "Alpha"), doc(2, "Beta")], { allowDestructiveSave });
    fireEvent.click(screen.getByRole("button", { name: "Delete – Alpha" }));
    const confirmBtn = await screen.findByRole("button", { name: "Delete" });
    // THE CONCURRENT WRITER, landing between the confirm opening and the click.
    // `boxMutator` reads `box.docs` at call time, so the mutation the confirm
    // triggers now finds nothing to remove and reports `changed:false`.
    box.docs = box.docs.filter((d) => d.id !== 1);
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    // Control: the mutation really did run and really did change nothing — so
    // the assertion above is about the `changed` gate, not about a click that
    // never reached the handler.
    expect(box.docs.map((d) => d.id)).toEqual([2]);
  });

  it("does NOT arm the destructive-save bypass when the confirm is cancelled", async () => {
    const allowDestructiveSave = vi.fn();
    renderPanel([doc(1, "Alpha"), doc(2, "Beta")], { allowDestructiveSave });
    fireEvent.click(screen.getByRole("button", { name: "Delete – Alpha" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(allowDestructiveSave).not.toHaveBeenCalled();
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
    expectRowUniqueNames({ minControls: 8 });
  });

  it("keeps every per-row control distinct when two documents share a title", () => {
    // ★★ TWO documents, SAME title. A one-row fixture, or two rows with distinct
    // titles, passes against the unfixed code - which is how this shipped.
    renderLive([doc(1, "Q3 report"), doc(2, "Q3 report")]);
    expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true });
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
      <PanelHost>
        <DocumentsPanel
          lang="en-US"
          documents={[doc(1, "Alpha")]}
          mutateDocuments={inertMutate}
          documentVersions={[]}
          ws={emptyWorkspace()}
          onResetSize={() => {}}
        />
      </PanelHost>,
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
      // ★ The FIFTH argument is the asset byte loader, and `undefined` is the
      // real value here: this pane was rendered with no `assetPane`, so the
      // feature is off and every image discloses itself as missing. Spelling it
      // out rather than trimming the assertion is what keeps the arity pinned —
      // `toHaveBeenCalledWith` matches arity exactly, so a four-argument
      // expectation would go RED the moment the loader is wired, and a reader
      // would "fix" it by deleting the very argument this slice adds.
      undefined,
    );
  });

  // ★★★ BOTH CALL SITES, NOT ONE. The toolbar button and the row button are
  //  two separate expressions that each had to gain a `.catch`, so a single
  //  test would leave the other silent — which is exactly the shape that let
  //  this card's asset LOADER diverge from the pane's once already.
  it.each([
    ["the toolbar button", "Download"],
    ["a row control", "Download – Alpha"],
  ])("tells the user when the export rejects, from %s", async (_label, buttonName) => {
    // The byte store is a NETWORK call, so a rejection here is ordinary
    // operation, not just a malformed row.
    vi.mocked(downloadDocument).mockRejectedValueOnce(new Error("byte store down"));
    renderPanel([doc(1, "Alpha")]);
    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    // ★★ THE ASSERTION IS THE STRING A USER WOULD READ, not that some spy was
    //  called. `reportDownloadFailure` is deliberately unmocked, so this pins
    //  the whole chain — catch → reportSilentFailure → the EN copy that already
    //  says "nothing was downloaded", which is precisely what happened.
    await waitFor(() => {
      expect(showToastSpy).toHaveBeenCalledWith("error", t("en-US", "guardExportFailed"));
    });
  });

  it("shows NO toast when the export resolves", async () => {
    // ★★ ANTI-VACUITY. Without this, a panel that toasted on EVERY download
    //  would pass the pair above — and a spurious "export failed" on a
    //  successful export is its own defect.
    renderPanel([doc(1, "Alpha")]);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(downloadDocument).toHaveBeenCalledTimes(1));
    expect(showToastSpy).not.toHaveBeenCalled();
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
      // ★ The FIFTH argument is the asset byte loader, and `undefined` is the
      // real value here: this pane was rendered with no `assetPane`, so the
      // feature is off and every image discloses itself as missing. Spelling it
      // out rather than trimming the assertion is what keeps the arity pinned —
      // `toHaveBeenCalledWith` matches arity exactly, so a four-argument
      // expectation would go RED the moment the loader is wired, and a reader
      // would "fix" it by deleting the very argument this slice adds.
      undefined,
    );
  });

  it("honours an explicit initialFormat", () => {
    render(
      <PanelHost>
        <DocumentsPanel
          lang="en-US"
          documents={[doc(1, "Alpha")]}
          mutateDocuments={inertMutate}
          documentVersions={[]}
          ws={emptyWorkspace()}
          initialFormat="pdf"
          onResetSize={() => {}}
        />
      </PanelHost>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(downloadDocument).toHaveBeenCalledWith(expect.anything(), "pdf", expect.anything(), "en-US", undefined);
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
        undefined,
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
    expect(downloadDocument).toHaveBeenCalledWith(expect.anything(), "pptx", expect.anything(), "en-US", undefined);
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
    expect(downloadDocument).toHaveBeenCalledWith(expect.anything(), "docx", expect.anything(), "en-US", undefined);
  });

  it("passes the picked format to a ROW download too", () => {
    // The row controls share the toolbar's format; without this a picker that
    // only reached the toolbar path would look correct.
    renderPanel([doc(1, "Alpha")]);
    fireEvent.change(screen.getByRole("combobox", { name: "Download format" }), {
      target: { value: "html" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Download – Alpha" }));
    expect(downloadDocument).toHaveBeenCalledWith(expect.anything(), "html", expect.anything(), "en-US", undefined);
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
      <PanelHost>
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
      </PanelHost>,
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
    // ★ §111 disambiguates the row Delete controls too now, so the two seeded
    // rows are "Delete – Same title (1)"/"(2)", not a colliding pair — deleting
    // the first leaves a lone survivor whose token reverts to the bare title
    // (nothing left to collide with). These two explicit deletions still
    // exercise the same two-deletes-in-a-row path the Restore assertion below
    // depends on.
    fireEvent.click(screen.getByRole("button", { name: "Delete – Same title (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Delete – Same title (1)" })).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete – Same title" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Delete – Same title" })).toBeNull(),
    );

    await user.click(screen.getByRole("button", { name: /Deleted documents/ }));
    const buttons = screen.getAllByRole("button", { name: /^Restore –/ });
    expect(buttons).toHaveLength(2);

    const names = buttons.map((b) => b.getAttribute("aria-label"));
    expect(names.every((n) => typeof n === "string" && n.trim().length > 0)).toBe(true);
    expect(new Set(names).size).toBe(2);
    // Both rows share a TITLE, so only the id can separate them — a
    // title-only label would collide here and pass the Set check nowhere else.
    expect(names.every((n) => /#\d+$/.test(n ?? ""))).toBe(true);
    // ★ NO `requireCollisionSeed` here even though two docs DO share a title:
    // the deleted list disambiguates with ` · #id` (`documents-deleted-section.tsx`),
    // not with buildRowTokens' `(N)` occurrence suffix, so the guard's strip-and-pair
    // test cannot see the seed. The `/#\d+$/` assertion above is what covers it.
    expectRowUniqueNames({ minControls: 2 });
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
  // ★★★ THE ENGINE IS AT THE CAP; THE PANE IS NOT ASKED TO DRAW IT.
  // This case needs `documents.length >= MAX_DOCUMENTS` in the ENGINE, because
  // that is what makes the restore's recreate path refuse. It does not need the
  // pane to RENDER 200 rows — no assertion here depends on them, and the pane's
  // job under test is only "render what `mutateDocuments` refused".
  //
  // ★★★ THAT DISTINCTION IS WHY THIS TEST EXISTS IN THIS SHAPE. Seeded through
  // `renderLive` the two are the same array, so the fixture cost 200 rows × 5
  // controls of jsdom render plus an accessible-name scan over ~1000 buttons per
  // query: MEASURED at 9150ms in isolation against 90–323ms for every other test
  // in this file, and it timed out at 20s inside the full suite. Through the box
  // harness the engine state and the rendered prop are separate, and the same
  // assertions run in a fraction of the time.
  // ★★ The engine, the cap, the reason string and the pane's rendering are all
  // still REAL — `boxMutator` drives `applyDocMutation` itself. The only thing
  // dropped is an incidental 200-row render.
  // ★ The pane is given ONE live document on purpose: with zero, `deleted (1) >
  // documents (0)` fires the implausibility caution, which is ALSO a
  // `role="status"` region, and `findByRole("status")` would then be ambiguous
  // rather than wrong — a much harder failure to read.
  it("renders the reason when a restore is refused", async () => {
    const atCap = Array.from({ length: MAX_DOCUMENTS }, (_, i) => doc(i + 10, `Doc ${i + 10}`));
    const tomb: DocVersion = {
      // ★★★ DERIVED FROM THE CAP, NEVER A LITERAL. `atCap` generates ids
      // 10..MAX_DOCUMENTS+9. A hardcoded 999 sat OUTSIDE that range while the
      // cap was 200 and INSIDE it once the cap became 1000 — so the restore
      // resolved against a document the engine already held instead of
      // recreating one, the cap never refused, and both refusal tests failed
      // with a bare "Unable to find role=status". The tombstone must point at
      // a document the engine does NOT hold, whatever the cap happens to be.
      id: 500,
      documentId: MAX_DOCUMENTS + 999,
      title: "Doomed",
      blocks: [],
      savedAt: "2026-08-05T10:00:00.000Z",
      source: "user",
      op: "delete",
    };
    const box: Box = { docs: atCap, versions: [tomb] };

    render(
      <PanelHost>
        <DocumentsPanel
          lang="en-US"
          documents={[doc(1, "Alpha")]}
          mutateDocuments={boxMutator(box)}
          documentVersions={[tomb]}
          ws={emptyWorkspace()}
          onResetSize={() => {}}
        />
      </PanelHost>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Deleted documents/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Restore –/ }));

    // The refusal is ANNOUNCED, not merely drawn.
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/document limit reached/i);
    // The engine really did refuse — nothing was added past the cap. Without
    // this the test could pass against a pane that rendered a reason for a
    // write that actually succeeded.
    expect(box.docs).toHaveLength(MAX_DOCUMENTS);
    // And the row is still offered, because nothing was restored.
    expect(screen.getByRole("button", { name: /^Restore –/ })).toBeInTheDocument();
  });

});

// ★★★ THE SECOND RESTORE SURFACE. The history modal's Restore threw its
// `DocResult` away and closed, so a refusal read as a successful dismissal:
// the modal vanished, nothing changed, and nothing said so — the exact "a
// Restore button that silently does nothing" outcome the pane's own comment
// calls the worst available.
//
// ★★★ AND THE HALF THAT WOULD HAVE LEFT THE FIX INERT: the refusal region used
// to render only inside the `showDeleted` block. That toggle is OFF by default
// and is completely independent of this modal, so surfacing the reason without
// hoisting the region would have set state that nothing drew. Every case here
// therefore NEVER touches the show-deleted toggle, and asserts that it is off.
describe("DocumentsPanel — the history modal's Restore", () => {
  /** A before-image for the LIVE document #1, so the modal's own
   *  `documentId === historyFor` filter lists it and its Restore takes the
   *  restore-IN-PLACE branch (the modal only ever opens for a live document). */
  const stale: DocVersion = {
    id: 500,
    documentId: 1,
    title: "Older title",
    blocks: [],
    savedAt: "2026-08-05T10:00:00.000Z",
    source: "user",
    op: "rename",
  };

  /** ★ The engine's version list is passed SEPARATELY from the panel's
   *  `documentVersions` prop, which is what lets the two disagree — and that
   *  disagreement IS the bug's first trigger: a concurrent AI write trims the
   *  version away between the render that drew the button and the click. Pass
   *  `[]` for the engine to model the trim, `[stale]` for the success control. */
  function renderModalHarness(engineVersions: readonly DocVersion[]) {
    const box: Box = { docs: [doc(1, "Alpha")], versions: engineVersions };
    render(
      <PanelHost>
        <DocumentsPanel
          lang="en-US"
          documents={[doc(1, "Alpha")]}
          mutateDocuments={boxMutator(box)}
          documentVersions={[stale]}
          ws={emptyWorkspace()}
          onResetSize={() => {}}
        />
      </PanelHost>,
    );
    fireEvent.click(screen.getByRole("button", { name: "History – Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: /^Restore –/ }));
    return box;
  }

  it("renders the refusal when the MODAL's Restore is refused, with showDeleted OFF", async () => {
    const box = renderModalHarness([]);

    // ★ The show-deleted section was never opened, so the region the reason
    // used to live inside is not in the DOM at all. Asserted directly: this is
    // the half a fix that only stopped discarding the result would fail.
    expect(screen.queryByRole("region", { name: "Deleted documents" })).toBeNull();
    // The modal closed on the click, exactly as before — which is why a
    // swallowed refusal looked like a successful dismissal.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const status = screen.getByRole("status");
    // The SPECIFIC reason, not merely that some status node exists.
    expect(status.textContent).toMatch(/not found/i);
    expect(status.textContent).toContain("#500");
    // ★ And the engine really did refuse. Without this the case could pass
    // against a pane that announced a refusal for a write that succeeded.
    expect(box.docs).toHaveLength(1);
    expect(box.docs[0].title).toBe("Alpha");
    // ★ A refusal already has a `role="status"` reason; a toast on the same
    // event would announce it a second time. Paired with the success case in
    // this same describe, which fires on this very code path (named rather than
    // placed — `test:shuffle` reorders cases within a file).
    expect(showToastSpy).not.toHaveBeenCalled();
  });

  it("announces the restore made from the MODAL, naming the restored title", () => {
    // ★★ The second restore surface has to reach the toast too — both go
    // through `handleRestore` for exactly this reason. This is the restore-IN-
    // PLACE branch, so the row goes back to the version's title and the toast
    // must name what the row now holds.
    const box = renderModalHarness([stale]);
    expect(box.docs[0].title).toBe("Older title");
    expect(showToastSpy).toHaveBeenCalledTimes(1);
    expect(showToastSpy).toHaveBeenCalledWith("success", t("en-US", "documentsRestored", "Older title"));
  });

  it("announces nothing when the MODAL's Restore SUCCEEDS", async () => {
    // ★ The control. Without it, a pane that rendered the reason region
    // unconditionally — or a handler that ignored `result.changed` — would
    // satisfy the case above while crying refusal on every restore.
    const box = renderModalHarness([stale]);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("status")).toBeNull();
    // The positive observable: the restore really landed, so the empty status
    // is the empty status of a SUCCESS, not of a click that did nothing.
    expect(box.docs[0].title).toBe("Older title");
  });
});

// ★★★ THE REFUSAL IS A STATEMENT ABOUT ONE CLICK. Hoisting the region OUT of
// the `showDeleted` block (so a refusal raised in the history modal could draw
// at all) removed the accidental clear that closing the section used to give it,
// and nothing replaced it — the reason then sat above the preview through every
// later action until the next restore overwrote it.
//
// ★★★ EVERY CASE HERE ASSERTS AN ABSENCE, which is exactly what a pane that
// never rendered the message would also produce. `renderWithRefusal` therefore
// asserts the message IS there before handing back, and each case adds a second
// positive observable for the action itself (the selection moved, the modal
// opened, the engine really mutated, the section really closed) so "the message
// went away" is distinguishable from "the click did nothing".
describe("DocumentsPanel — a refusal does not outlive the click that raised it", () => {
  /** A before-image for the LIVE document #1 that the ENGINE does not hold, so
   *  the modal's Restore is refused with `version #500 not found`. That is the
   *  cheapest reliable refusal available — the other one, the document cap,
   *  needs a MAX_DOCUMENTS engine fixture. Its `documentId` is a live document,
   *  so it never reaches the deleted list and the pane holds exactly ONE
   *  `role="status"` node: an ambiguous query here would be far harder to read
   *  than a wrong one. */
  const stale: DocVersion = {
    id: 500,
    documentId: 1,
    title: "Older title",
    blocks: [],
    savedAt: "2026-08-05T10:00:00.000Z",
    source: "user",
    op: "rename",
  };

  /** TWO documents, so a case can move the selection to a row that is not the
   *  read-time fallback. */
  const rows = [doc(1, "Alpha"), doc(2, "Beta")];

  function renderPane(documentVersions: readonly DocVersion[]) {
    const box: Box = { docs: rows, versions: [] };
    render(
      <PanelHost>
        <DocumentsPanel
          lang="en-US"
          documents={rows}
          mutateDocuments={boxMutator(box)}
          documentVersions={documentVersions}
          ws={emptyWorkspace()}
          onResetSize={() => {}}
        />
      </PanelHost>,
    );
    return box;
  }

  /** Raises the refusal through the history modal and PROVES it rendered. */
  function renderWithRefusal() {
    const box = renderPane([stale]);
    fireEvent.click(screen.getByRole("button", { name: "History – Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: /^Restore –/ }));
    // The positive control every case below rests on. The SPECIFIC reason, not
    // merely that some status node exists — an unqualified match would also be
    // satisfied by the implausible-deleted-list caution.
    expect(screen.getByRole("status").textContent).toMatch(/#500/);
    // …and the engine really refused, so the message is not being rendered over
    // a write that actually landed.
    expect(box.docs).toHaveLength(2);
    expect(box.docs[0].title).toBe("Alpha");
    return box;
  }

  it("clears it when the user selects a different document", () => {
    renderWithRefusal();

    fireEvent.click(screen.getByRole("button", { name: "Beta" }));

    // The selection really moved: the message renders directly above the
    // preview, so a reason left standing here reads as being about Beta.
    expect(screen.getByRole("heading", { name: "Beta" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clears it when the history modal is opened again", () => {
    renderWithRefusal();

    fireEvent.click(screen.getByRole("button", { name: "History – Alpha" }));

    // The modal really opened — a new restore session, which the previous
    // session's reason would otherwise still be sitting under when it closes.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // ★★ Any mutation, pinned through the cheapest one-click path. The clear
  // lives in `mutate`, not in the four handlers, so this case covers create /
  // duplicate / rename / delete at once — and reddens if a future call site
  // bypasses that funnel.
  it("clears it when a mutation lands", () => {
    const box = renderWithRefusal();

    fireEvent.click(screen.getByRole("button", { name: "Duplicate – Alpha" }));

    // The mutation really landed. (The rendered prop is static in this harness,
    // so the engine box — not the DOM — is where a create is observable.)
    expect(box.docs).toHaveLength(3);
    expect(screen.queryByRole("status")).toBeNull();
  });

  // ★ The other restore surface, and the only case whose refusal is raised from
  // the deleted list rather than the modal — so it needs its own tombstone.
  it("clears it when the deleted-documents section is closed", () => {
    const tomb: DocVersion = {
      id: 501,
      documentId: 999,
      title: "Doomed",
      blocks: [],
      savedAt: "2026-08-05T10:00:00.000Z",
      source: "user",
      op: "delete",
    };
    const box = renderPane([tomb]);

    fireEvent.click(screen.getByRole("button", { name: /Deleted documents/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Restore –/ }));
    // Positive control: the reason is up, and the engine (which holds no
    // version) really refused rather than restoring anything.
    expect(screen.getByRole("status").textContent).toMatch(/#501/);
    expect(box.docs).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /Deleted documents/ }));

    // The section really closed, taking the Restore buttons that produced the
    // reason with it.
    expect(screen.queryByRole("region", { name: "Deleted documents" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("DocumentsPanel — the implausible-deleted-list guard", () => {
  function tombstone(id: number, documentId: number, title: string): DocVersion {
    return {
      id,
      documentId,
      title,
      blocks: [],
      savedAt: "2026-08-05T10:00:00.000Z",
      source: "user",
      op: "delete",
    };
  }

  /** Renders with an explicit version list, so the derivation can be handed the
   *  shapes a corrupted load produces without having to corrupt a load. */
  function renderWith(documents: readonly ProjectDocument[], versions: readonly DocVersion[]) {
    return render(
      <PanelHost>
        <DocumentsPanel
          lang="en-US"
          documents={documents}
          mutateDocuments={inertMutate}
          documentVersions={versions}
          ws={emptyWorkspace()}
          onResetSize={() => {}}
        />
      </PanelHost>,
    );
  }

  // ★★★ RE-POINTED. This used to assert a CAUTION here (the old
  // `deleted.length > documentCount` heuristic: 2 > 0) — the exact
  // false-positive shape the user reported, just generalised past N=1.
  // Deleting documents, however many, is an ordinary workflow and must stay
  // quiet; only an ORPHAN (a version whose newest op is neither "delete" nor
  // "restored", for a document absent from `documents`) is evidence of a
  // failed load now.
  it("stays quiet no matter how many documents were genuinely deleted", async () => {
    const user = userEvent.setup();
    renderWith([], [tombstone(1, 10, "Gone A"), tombstone(2, 11, "Gone B")]);
    await user.click(screen.getByRole("button", { name: /Deleted documents/ }));

    expect(screen.queryByRole("status")).toBeNull();
    // Positive observable: the section really rendered both tombstones, so
    // "no caution" is not "nothing rendered".
    expect(screen.getAllByRole("button", { name: /^Restore –/ })).toHaveLength(2);
  });

  // ★★★ THE USER'S EXACT REPORT: one document, ever created, now deleted.
  // Under the old `deleted.length > documentCount` heuristic this was 1 > 0 —
  // a caution on the single most ordinary shape a delete can take.
  it("does not caution over the user's exact bug case: deleting your only document", async () => {
    const user = userEvent.setup();
    renderWith([], [tombstone(1, 10, "Gone")]);
    await user.click(screen.getByRole("button", { name: /Deleted documents/ }));

    expect(screen.queryByRole("status")).toBeNull();
    // Positive observable: the tombstone's Restore row really rendered, so a
    // caution that never fires under any condition cannot pass this test.
    expect(screen.getByRole("button", { name: /^Restore –/ })).toBeInTheDocument();
  });

  it("stays quiet when the deleted list is a plausible size", async () => {
    const user = userEvent.setup();
    // ★ A POSITIVE observable in the same test, so this cannot pass against a
    // caution that never renders under any conditions: the section IS shown and
    // its row IS there, only the caution is absent.
    renderWith([doc(1, "Alpha"), doc(2, "Beta")], [tombstone(1, 99, "Gone")]);
    await user.click(screen.getByRole("button", { name: /Deleted documents/ }));

    expect(screen.getByRole("button", { name: /^Restore –/ })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // ★★★ A GENUINE ORPHAN — the signature the guard is now aimed at. A document
  // id absent from `documents` whose newest version is an ORDINARY edit
  // (never a delete) is exactly what a truncation artifact, a `documents`
  // blob that failed to parse beside a valid versions blob, or a partial
  // import leaves behind.
  it("cautions over a genuine orphan: a document missing from `documents` whose newest version was an ordinary edit", async () => {
    const user = userEvent.setup();
    const orphan: DocVersion = {
      id: 2,
      documentId: 77,
      title: "Vanished",
      blocks: [],
      savedAt: "2026-08-05T10:00:00.000Z",
      source: "user",
      op: "update",
    };
    renderWith([doc(1, "Alpha")], [orphan]);
    await user.click(screen.getByRole("button", { name: /Deleted documents/ }));

    expect(screen.getByRole("status").textContent).toMatch(/may not have loaded correctly/i);
  });

  // ★★★ THE TRAP. Restoring a deleted document mints a NEW id and leaves a
  // `"restored"` marker version on the OLD one (RESTORED_MARKER_OP,
  // document-versions.ts) — that old id is permanently absent from
  // `documents` and is NOT a tombstone. Without excluding it, every ordinary
  // restore would caution as if the load had failed.
  it("does not caution over a restored-marker id", async () => {
    const user = userEvent.setup();
    const restoredMarker: DocVersion = {
      id: 3,
      documentId: 55,
      title: "Restored Elsewhere",
      blocks: [],
      savedAt: "2026-08-05T10:00:00.000Z",
      source: "user",
      op: "restored",
    };
    renderWith([doc(1, "Alpha")], [restoredMarker]);
    await user.click(screen.getByRole("button", { name: /Deleted documents/ }));

    expect(screen.queryByRole("status")).toBeNull();
    // Positive observable: the section really rendered (empty — a marker is
    // not a tombstone either, so the deleted list itself is empty too), so
    // "no caution" is not "nothing rendered".
    expect(screen.getByText(t("en-US", "documentsNoVersions"))).toBeInTheDocument();
  });
});

// ★★★ THE RESTORE TOAST. `documentsRestored` shipped in both dictionaries with
// ZERO consumers, so a restore changed the list and said nothing. These drive
// the REAL provider, because the title the toast must name is the one the
// ENGINE produced — a fixture-fed title would be a second implementation of the
// rule under test (see the uniquify case).
describe("DocumentsPanel — the restore toast", () => {
  /** Delete the row titled `title` through the confirm dialog, leaving one
   *  tombstone behind. */
  async function deleteRow(title: string) {
    fireEvent.click(await screen.findByRole("button", { name: `Delete – ${title}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: `Delete – ${title}` })).toBeNull());
  }

  it("announces a successful restore, naming the document", async () => {
    const user = userEvent.setup();
    renderLive([doc(1, "Doomed")]);
    await deleteRow("Doomed");
    await user.click(screen.getByRole("button", { name: /Deleted documents/ }));
    await user.click(screen.getByRole("button", { name: /^Restore –/ }));

    // The positive observable: the document really is back in the list, so the
    // toast is the toast of a real restore.
    await waitFor(() => expect(renderedTitles()).toEqual(["Doomed"]));
    expect(showToastSpy).toHaveBeenCalledTimes(1);
    expect(showToastSpy).toHaveBeenCalledWith("success", t("en-US", "documentsRestored", "Doomed"));
    // ★ …and the key really INTERPOLATES. Comparing only against `t(…)` with
    // the same arguments would pass with `{0}` left unreplaced on both sides.
    expect(showToastSpy.mock.calls[0][1]).toContain("Doomed");
  });

  // ★★★ THE CASE THAT DECIDES WHICH TITLE IS ANNOUNCED, and the only one that
  // can tell the two candidates apart. `applyDocMutation` uniquifies on BOTH
  // restore branches, so a tombstone stored as "Doomed" comes back as
  // "Doomed 2" once something else has taken that title. A toast built from the
  // VERSION's stored title names a document that does not exist; every other
  // case here passes either way, because the two titles are equal there.
  it("announces the title the LIST will show, not the version's stored title", async () => {
    const user = userEvent.setup();
    // ★ id 50, NOT 1, and that is load-bearing. `Seed` writes through
    // `setDocuments`, which does not raise the session mint's high-water mark —
    // so with id 1 the create below mints 1 AGAIN, the tombstone's documentId
    // reads as live, `deletedDocumentVersions` drops it and there is no Restore
    // button to click at all. Measured: the query failed on an empty list.
    renderLive([doc(50, "Doomed")]);
    await deleteRow("Doomed");

    // Re-take the title with a NEW document, so the recreate has to suffix.
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename – Untitled document" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Doomed" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(renderedTitles()).toEqual(["Doomed"]));

    showToastSpy.mockClear();
    await user.click(screen.getByRole("button", { name: /Deleted documents/ }));
    await user.click(screen.getByRole("button", { name: /^Restore –/ }));

    // The engine really did suffix it — this is the row the user can see, and
    // asserting it here is what stops the toast assertion below from merely
    // agreeing with a stale expectation.
    await waitFor(() => expect(renderedTitles()).toEqual(["Doomed", "Doomed 2"]));
    expect(showToastSpy).toHaveBeenCalledTimes(1);
    expect(showToastSpy).toHaveBeenCalledWith("success", t("en-US", "documentsRestored", "Doomed 2"));
  });

  it("does NOT announce a REFUSED restore", async () => {
    // ★★ Same engine-at-the-cap shape as the refusal case above, and for the
    // same reason: the pane is given one live document while the ENGINE holds
    // MAX_DOCUMENTS, so the cap really refuses without rendering that many rows.
    const atCap = Array.from({ length: MAX_DOCUMENTS }, (_, i) => doc(i + 10, `Doc ${i + 10}`));
    const tomb: DocVersion = {
      // ★★★ DERIVED FROM THE CAP, NEVER A LITERAL. `atCap` generates ids
      // 10..MAX_DOCUMENTS+9. A hardcoded 999 sat OUTSIDE that range while the
      // cap was 200 and INSIDE it once the cap became 1000 — so the restore
      // resolved against a document the engine already held instead of
      // recreating one, the cap never refused, and both refusal tests failed
      // with a bare "Unable to find role=status". The tombstone must point at
      // a document the engine does NOT hold, whatever the cap happens to be.
      id: 500,
      documentId: MAX_DOCUMENTS + 999,
      title: "Doomed",
      blocks: [],
      savedAt: "2026-08-05T10:00:00.000Z",
      source: "user",
      op: "delete",
    };
    const box: Box = { docs: atCap, versions: [tomb] };

    render(
      <PanelHost>
        <DocumentsPanel
          lang="en-US"
          documents={[doc(1, "Alpha")]}
          mutateDocuments={boxMutator(box)}
          documentVersions={[tomb]}
          ws={emptyWorkspace()}
          onResetSize={() => {}}
        />
      </PanelHost>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Deleted documents/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Restore –/ }));

    // ★ The click really landed and really was refused — without this the
    // "no toast" assertion is satisfied by a button that did nothing at all.
    expect((await screen.findByRole("status")).textContent).toMatch(/document limit reached/i);
    expect(box.docs).toHaveLength(MAX_DOCUMENTS);
    expect(showToastSpy).not.toHaveBeenCalled();
  });
});

// ★★★ THE HISTORY MODAL'S PREVIEW NEEDS THE LIVE WORKSPACE. Each history row
// renders its version's blocks through `renderDocumentHtml`, which resolves a
// `dataSection` block against a `Workspace`. The modal's `ws` is OPTIONAL and
// falls back to `emptyWorkspace()`, and that fallback fails SILENTLY: an empty
// register makes `resolveDataSection` return null, so the section renders as
// NOTHING rather than as broken markup. Every test that merely opens the modal
// — all of them, before this one — passes with the prop dropped.
describe("DocumentsPanel — the history modal's Preview", () => {
  /** One milestone, because `dataSection` is the ONLY block type that reads
   *  the workspace at all, and `buildExportSections` returns null for a
   *  register with zero rows. */
  const wsWithData = {
    ...emptyWorkspace(),
    milestones: [{ id: 7, name: "Phase gate 1", date: "2026-09-01", linkedTaskIds: [] }],
  };

  const dataVersion: DocVersion = {
    id: 500,
    documentId: 1,
    title: "Older title",
    blocks: [{ type: "dataSection", key: "milestones" }],
    savedAt: "2026-08-05T10:00:00.000Z",
    source: "user",
    op: "update",
  };

  // ★★★ MUTATION-PROVED: dropping `ws={ws}` from the `<DocumentsHistoryModal>`
  // mount reddens this case and nothing else in the file.
  it("renders a version's dataSection against the LIVE workspace, not an empty one", () => {
    const { container } = render(
      <PanelHost>
        <DocumentsPanel
          lang="en-US"
          documents={[doc(1, "Alpha")]}
          mutateDocuments={inertMutate}
          documentVersions={[dataVersion]}
          ws={wsWithData}
          onResetSize={() => {}}
        />
      </PanelHost>,
    );
    fireEvent.click(screen.getByRole("button", { name: "History – Alpha" }));

    // ★ The panel is ALWAYS mounted and `hidden`-toggled, and its CONTENT is
    // computed only while open — so an empty panel here is the positive
    // control: the text asserted below cannot have been there all along.
    const panel = () => container.querySelector("[data-documents-history-preview]");
    expect(panel()).not.toBeNull();
    expect(panel()!.textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /^Preview –/ }));

    // ★★ The milestone name can ONLY have come from the workspace this pane
    // threaded through. `emptyWorkspace()` holds no milestones, so the
    // fallback resolves this very block to null and renders nothing — which is
    // why asserting the SECTION'S CONTENT, and not merely that the panel has
    // some text, is what gives this teeth.
    expect(panel()!.textContent).toContain("Phase gate 1");
  });
});

// ★★★ DEEP-LINK SELECTION. The chat transcript's document card calls
// `requestOpen("documents", id)`; with no consumer here that landed on the
// Documents view with nothing selected — half a feature that looks whole.
describe("DocumentsPanel — deep-link selection (pendingOpen)", () => {
  /** Renders the live signal, so a case can prove the trigger FIRED and say
   *  whether this pane consumed it or left it for another view's consumer.
   *  Without it "the selection did not move" is indistinguishable from "the
   *  click did nothing", which is the vacuity trap on every negative case
   *  below. */
  function PendingProbe() {
    const { pendingOpen } = useWorkspaceTab();
    return (
      <p data-testid="pending">{pendingOpen ? `${pendingOpen.view}:${pendingOpen.id}` : "none"}</p>
    );
  }

  const rows = [doc(1, "Alpha"), doc(2, "Beta")];

  function panel() {
    return (
      <DocumentsPanel
        lang="en-US"
        documents={rows}
        mutateDocuments={inertMutate}
        documentVersions={[]}
        ws={emptyWorkspace()}
        onResetSize={() => {}}
      />
    );
  }

  /** The pane stays mounted throughout — for a signal arriving at a pane the
   *  user is already looking at. */
  function renderMounted(view: "documents" | "raid", id: number) {
    return render(
      <PanelHost>
        <DeepLinkTrigger view={view} id={id} />
        <PendingProbe />
        {panel()}
      </PanelHost>,
    );
  }

  /** ★★★ THE ARRIVAL CASE, modelled the way the shell really behaves.
   *  `requestOpen` sets `activeTab` AND arms `pendingOpen` in one batch, and
   *  the shell renders only the ACTIVE view — so the pane MOUNTS FRESH with the
   *  request already pending. That is the remount-swallow scenario, and it is
   *  the ordinary path for this feature, not an edge case. */
  function ShellHost() {
    const { activeTab } = useWorkspaceTab();
    return (
      <>
        <DeepLinkTrigger view="documents" id={2} />
        <PendingProbe />
        {activeTab === "documents" ? panel() : <p>another view</p>}
      </>
    );
  }

  // ★★★ MUTATION-PROVED and the most important case in this block: seeding a
  // "last seen" ref from the LIVE signal (`useRef(pendingOpen)`) makes the
  // first run see prop === seed and swallow the request — which is exactly this
  // arrival — and reddens this case alone.
  it("selects the deep-linked row when the pane MOUNTS with the request pending", () => {
    render(
      <PanelHost>
        <ShellHost />
      </PanelHost>,
    );
    // ★ Positive controls: the pane is not mounted yet, so this cannot pass
    // against a selection that happened to be Beta already.
    expect(screen.getByText("another view")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Beta" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "deep-link" }));

    // Mounted AND pointed at the requested row — not at the first-row fallback.
    expect(screen.getByRole("heading", { name: "Beta" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Alpha" })).toBeNull();
    expect(screen.getByTestId("pending").textContent).toBe("none");
  });

  it("selects the deep-linked row on a pane that is already open", () => {
    renderMounted("documents", 2);
    // The read-time fallback puts the selection on the first row to begin with.
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "deep-link" }));

    expect(screen.getByRole("heading", { name: "Beta" })).toBeInTheDocument();
    // ★ CONSUMED. An uncleared signal re-fires on every later render, and would
    // drag the selection back each time the user picked another row.
    expect(screen.getByTestId("pending").textContent).toBe("none");
  });

  // ★★★ MUTATION-PROVED. The id is a REAL document id, so a consumer that
  // ignored the `view` would select Beta here — that is what gives this teeth.
  it("leaves a pendingOpen for ANOTHER view alone", () => {
    renderMounted("raid", 2);
    fireEvent.click(screen.getByRole("button", { name: "deep-link" }));

    // ★ The trigger really fired, and the signal is STILL armed — clearing
    // another view's request here would steal it from raid-panel's consumer.
    // This is the positive observable that makes the two assertions below
    // something other than "the click did nothing".
    expect(screen.getByTestId("pending").textContent).toBe("raid:2");
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Beta" })).toBeNull();
  });

  it("ignores a deep link to an id no live document holds", () => {
    renderMounted("documents", 999);
    // Move the selection off the fallback FIRST: without this, "the selection
    // is still Alpha" is also what a handler that blanked it would produce,
    // since a blank selection falls back to the first row.
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(screen.getByRole("heading", { name: "Beta" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "deep-link" }));

    // Not blanked, not reset to the first row, and no crash.
    expect(screen.getByRole("heading", { name: "Beta" })).toBeInTheDocument();
    // It IS this pane's request, so it is consumed rather than left to rot.
    expect(screen.getByTestId("pending").textContent).toBe("none");
  });
});

// ★★★ THE ARRIVAL AFFORDANCE — the OTHER half of the deep link, and the half
// that was missing when the selection consumer above shipped. `documents-list`
// is its own `overflow-auto` box holding up to MAX_DOCUMENTS rows, so moving
// the selection to a row below the fold changes nothing the user can see there.
//
// ★★ THE TWO HALVES ONLY MEET THROUGH THE DOM. `useDeepLinkRowFlash` scrolls by
// running `containerRef.current.querySelector('[data-deeplink-row="<id>"]')`, so
// there are THREE independent wirings and any one of them missing is a SILENT
// no-op — the hook still returns, the pane still renders, nothing throws:
//   (a) the ref reaching the list's scroll box,
//   (b) the row carrying `data-deeplink-row`,
//   (c) that attribute carrying the RIGHT id.
// The scroll case below reddens on all three, because it records the ELEMENT
// `scrollIntoView` was called ON rather than merely that it was called.
//
// ★★★ WHAT THESE CANNOT COVER: that the row actually MOVES INTO VIEW. jsdom has
// no layout — no scroll offsets, no viewport, no `scrollIntoView`
// implementation at all (it is stubbed above). These pin the WIRING that makes
// the browser's scroll possible and nothing about the scroll itself; the
// scrolling behaviour is unverified by this suite and is not verifiable in
// jsdom. Do not read a green run here as "the deep link scrolls".
describe("DocumentsPanel — deep-link arrival affordance (scroll + flash)", () => {
  // ids well clear of 1: `Seed`-written documents do not raise
  // `id-mint-session`'s high-water mark, and 50/51 are also two-digit so an
  // exact `toBe("50")` cannot be satisfied by a substring of a neighbour.
  const rows = [doc(50, "Alpha"), doc(51, "Beta")];

  /** Records the ELEMENT each scroll landed on, by its deep-link id. The
   *  fallback string is not decoration: with `data-deeplink-row` removed from
   *  the row the hook would still find nothing (so nothing scrolls), but if a
   *  future change makes the querySelector match some OTHER element this
   *  reports which, instead of failing as an opaque length mismatch. */
  let scrolledOnto: string[] = [];

  beforeEach(() => {
    scrolledOnto = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolledOnto.push(this.getAttribute("data-deeplink-row") ?? "(no data-deeplink-row)");
    };
    // Synchronous, deterministic rAF — the same technique
    // `use-deeplink-row-flash.test.tsx` uses, so the scroll has happened by the
    // time the click returns.
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function panel() {
    return (
      <DocumentsPanel
        lang="en-US"
        documents={rows}
        mutateDocuments={inertMutate}
        documentVersions={[]}
        ws={emptyWorkspace()}
        onResetSize={() => {}}
      />
    );
  }

  function PendingProbe() {
    const { pendingOpen } = useWorkspaceTab();
    return <p data-testid="pending">{pendingOpen ? `${pendingOpen.view}:${pendingOpen.id}` : "none"}</p>;
  }

  function renderMounted(view: "documents" | "raid", id: number) {
    return render(
      <PanelHost>
        <DeepLinkTrigger view={view} id={id} />
        <PendingProbe />
        {panel()}
      </PanelHost>,
    );
  }

  it("tags every document row with its own id via data-deeplink-row", () => {
    const { container } = renderMounted("documents", 50);
    const tagged = container.querySelectorAll("[data-deeplink-row]");

    // ★ NON-ZERO FIRST. Every assertion below is over a collection, and each of
    // them is trivially true of an EMPTY one — a query that found nothing would
    // otherwise report the attribute as correctly applied to all zero rows.
    expect(tagged).toHaveLength(2);
    // Exact strings, not `toContain`/substring: "5" is a substring of "50" and
    // "51", so a loose check cannot tell a right id from a truncated one.
    const ids = Array.from(tagged).map((r) => r.getAttribute("data-deeplink-row"));
    expect(ids).toEqual(["50", "51"]);
  });

  it("scrolls the deep-linked row into view and flashes THAT row", () => {
    const { container } = renderMounted("documents", 51);
    // ★ Positive control: nothing has scrolled yet, so the assertion after the
    // click is about this click and not about a scroll from mount.
    expect(scrolledOnto).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "deep-link" }));

    // The scroll landed on the REQUESTED row — this is what proves the ref, the
    // attribute and the id all line up. A missing ref gives `[]`; a missing
    // attribute gives `[]`; a wrong id gives `[]` or another row's id.
    expect(scrolledOnto).toEqual(["51"]);

    // …and that row, not its neighbour, carries the flash outline.
    const beta = container.querySelector('[data-deeplink-row="51"]');
    const alpha = container.querySelector('[data-deeplink-row="50"]');
    expect(beta?.getAttribute("class")).toContain(flashOutlineClass(true));
    expect(alpha?.getAttribute("class")).not.toContain(flashOutlineClass(true));
  });

  it("neither scrolls nor flashes for a deep link aimed at ANOTHER view", () => {
    // ★ The id is a REAL document id, so a hook wired to the wrong view — or a
    // row that flashed on any pending signal — would scroll here. That is what
    // gives this teeth rather than being "the click did nothing".
    const { container } = renderMounted("raid", 51);

    fireEvent.click(screen.getByRole("button", { name: "deep-link" }));

    // The positive observable: the trigger really fired and the signal is still
    // armed for raid's own consumer.
    expect(screen.getByTestId("pending").textContent).toBe("raid:51");
    expect(scrolledOnto).toEqual([]);
    expect(container.querySelector('[data-deeplink-row="51"]')?.getAttribute("class")).not.toContain(
      flashOutlineClass(true),
    );
  });
});

// ═══ entity filter (Documents S4) ═══════════════════════════════════════════
//
// The Documents pane is the CONSUMER of `requestDocumentsForEntity`; a
// DocumentBadge on a task/RAID/change/milestone row is the producer. Both cases
// below drive the REAL provider primitive rather than a hand-built prop, so a
// signal that never reaches the pane fails here rather than passing.

/** Fires `requestDocumentsForEntity(kind, id)` from INSIDE the provider. */
function EntityFilterTrigger({ kind, id }: { kind: DocRefKind; id: number }) {
  const { requestDocumentsForEntity } = useWorkspaceTab();
  return (
    <button type="button" onClick={() => requestDocumentsForEntity(kind, id)}>
      arm-filter
    </button>
  );
}

/** ★★★ THE FRESH-MOUNT HARNESS. Arming and the panel's FIRST mount land in ONE
 *  commit, which is the production shape: `requestDocumentsForEntity` switches
 *  the active view, and the shell renders only the active view — so the pane
 *  mounts with the signal ALREADY present. Rendering the panel first and arming
 *  afterwards (what `EntityFilterTrigger` alone does) exercises the UPDATE path
 *  instead and cannot see the remount-swallow bug at all. */
function ArmThenMount({ children }: { children: ReactNode }) {
  const { requestDocumentsForEntity } = useWorkspaceTab();
  const [mounted, setMounted] = useState(false);
  if (mounted) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={() => {
        requestDocumentsForEntity("raid", 3);
        setMounted(true);
      }}
    >
      arm-then-mount
    </button>
  );
}

const CLEAR_FILTER = t("en-US", "documentsFilterClear");

function linkedDoc(): ProjectDocument {
  return { ...doc(10, "Charter"), linkedEntities: [{ kind: "raid", id: 3 }] };
}

function panelWith(documents: readonly ProjectDocument[]) {
  return (
    <DocumentsPanel
      lang="en-US"
      documents={documents}
      mutateDocuments={inertMutate}
      documentVersions={[]}
      ws={emptyWorkspace()}
      onResetSize={() => {}}
    />
  );
}

describe("DocumentsPanel — entity filter", () => {
  it("filters the list to the armed entity, and dismissing brings the rest back", () => {
    const documents = [linkedDoc(), doc(11, "Minutes")];
    render(
      <PanelHost>
        <EntityFilterTrigger kind="raid" id={3} />
        {panelWith(documents)}
      </PanelHost>,
    );

    // Positive control: unfiltered, BOTH rows are listed. Without this the
    // filtered assertion below could pass against a pane that renders nothing.
    expect(screen.getByRole("button", { name: "Charter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Minutes" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "arm-filter" }));

    expect(screen.getByRole("button", { name: "Charter" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Minutes" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: CLEAR_FILTER }));

    expect(screen.getByRole("button", { name: "Minutes" })).toBeTruthy();
    // The banner goes with it — it is the only visible statement that the list
    // is a subset, so leaving it up would be worse than never showing it.
    expect(screen.queryByRole("button", { name: CLEAR_FILTER })).toBeNull();
  });

  // ★★★ THE REMOUNT-SWALLOW GUARD, and it is the case that matters. Seeding the
  // pane's `handledFilter` from the LIVE prop instead of the `undefined`
  // sentinel makes this red; nothing else in the file can see that difference.
  it("HONORS a filter armed before this pane first mounted", () => {
    const documents = [linkedDoc(), doc(11, "Minutes")];
    render(
      <PanelHost>
        <ArmThenMount>{panelWith(documents)}</ArmThenMount>
      </PanelHost>,
    );

    // The pane does not exist yet — proof the mount below really is its first.
    expect(screen.queryByRole("button", { name: "Charter" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "arm-then-mount" }));

    expect(screen.getByRole("button", { name: "Charter" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Minutes" })).toBeNull();
    // …and it says so, rather than silently looking like a one-document project.
    expect(screen.getByRole("button", { name: CLEAR_FILTER })).toBeTruthy();
  });

  // ★★★ SELECTION MUST FALL BACK WITHIN THE VISIBLE ROWS. The link field is
  // bound to `selected`, so a fallback to `documents[0]` would let an attach
  // made from a filtered view land on a document the list is not showing —
  // silently, and document writes have no undo.
  //
  // ★★ THE ORDER OF THIS FIXTURE IS THE WHOLE TEST: the UNLINKED document is
  // first, so `documents[0]` is the wrong answer. The two tests above put the
  // linked one first, which makes `documents[0]` accidentally correct — they
  // cannot see this defect at all.
  it("selects a VISIBLE document when the filter hides the first one", () => {
    const documents = [doc(11, "Minutes"), linkedDoc()];
    render(
      <PanelHost>
        <EntityFilterTrigger kind="raid" id={3} />
        {panelWith(documents)}
      </PanelHost>,
    );

    fireEvent.click(screen.getByRole("button", { name: "arm-filter" }));

    // The one visible row is the linked one…
    expect(screen.getByRole("button", { name: "Charter" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Minutes" })).toBeNull();
    // …and the pane's link surface is bound to THAT document, not to the hidden
    // "Minutes". Its chips resolve against the armed entity's own reference.
    expect(screen.getByText(t("en-US", "documentsLinkedEntities"))).toBeTruthy();
    // Exact, not a regex: with `onOpen` wired the chip renders TWO buttons
    // matching /R#3/ (the chip body and its remove control), so a loose matcher
    // throws "found multiple elements" rather than asserting anything.
    expect(screen.getByRole("button", { name: `${t("en-US", "documentsLinkedRemove")} R#3` })).toBeTruthy();
  });
});

describe("DocumentsPanel — edit mode toggle", () => {
  // ★ The toggle's accessible name is PINNED to "Edit blocks" in both states
  // (see documents-toolbar.tsx) — it does NOT flip to "Preview" — so this
  // asserts on `aria-pressed` plus the block editor's own textbox, not on a
  // second button name. The fixture carries its own heading block: the shared
  // `doc()` builder only mints `pageBreak` blocks. The row-selection button
  // shares its accessible name with the preview's own `<h2>` title, so the
  // selection click is scoped to `{ name: ..., }` on a BUTTON role, not
  // `getByText`, which would match both.
  it("toggles between preview and the block editor", async () => {
    const headingDoc: ProjectDocument = {
      id: 9,
      title: "Charter",
      blocks: [{ type: "heading", level: 2, text: "Scope" }],
      createdAt: NOW,
      updatedAt: NOW,
    };
    renderPanel([headingDoc]);
    // ★ No opening click: `selected` falls back to selectionPool[0], so the sole
    // document is ALREADY open. Clicking its name was a no-op before the collapse
    // landed and is now the collapse gesture itself — it would hide the very body
    // this test then looks for.

    // Preview is the default — no block editor textbox mounted yet.
    expect(screen.queryByRole("textbox", { name: /Heading text/ })).toBeNull();

    const toggle = screen.getByRole("button", { name: t("en-US", "documentsEditBlocks") });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);

    expect(await screen.findByRole("textbox", { name: /Heading text/ })).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(toggle);
    expect(screen.queryByRole("textbox", { name: /Heading text/ })).toBeNull();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });
});

// ★★★ Pins the FULL fix — the doc-id-keyed rows in document-editor.tsx AND
// the currentDocIdRef guard in use-document-editor.ts — through the REAL
// panel wiring (`useDocumentEditMode` → `useDocumentEditor` → `commitBlock`),
// not just `DocumentEditor` in isolation. `document-editor.test.tsx` already
// pins that a switch remounts and shows the right content; these two pin
// that a commit reaching this far EITHER never fires on a switch, OR — if
// it does — can never land against the newly-selected document's id.
describe("DocumentsPanel — document-switch commit guard", () => {
  const docA: ProjectDocument = {
    id: 301,
    title: "Doc A",
    blocks: [{ type: "heading", level: 1, text: "Alpha" }],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const docB: ProjectDocument = {
    id: 302,
    title: "Doc B",
    blocks: [{ type: "heading", level: 1, text: "Beta" }],
    createdAt: NOW,
    updatedAt: NOW,
  };

  /** A spied `mutateDocuments` backed by the REAL `applyDocMutation` (via
   *  `boxMutator`), so a call that DOES land still behaves like production —
   *  the point is to observe WHICH id it lands against, not to fake the
   *  write. */
  function renderWithSpy() {
    const box: Box = { docs: [docA, docB], versions: [] };
    const realMutate = boxMutator(box);
    const mutateDocuments = vi.fn(
      (m: DocMutation, source: DocVersionSource): DocResult => realMutate(m, source),
    );
    render(
      <PanelHost>
        <DocumentsPanel
          lang="en-US"
          documents={box.docs}
          mutateDocuments={mutateDocuments}
          documentVersions={[]}
          ws={emptyWorkspace()}
          onResetSize={() => {}}
        />
      </PanelHost>,
    );
    return { mutateDocuments };
  }

  it("shows the new document and commits nothing when switching without editing", async () => {
    const { mutateDocuments } = renderWithSpy();
    // ★ docA is ALREADY open (the selectionPool[0] fallback), so no opening
    // click — that click is now the collapse gesture and would hide the editor.
    // The docB click below is a real SWITCH and still expands, which is the
    // behaviour this test cares about.
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "documentsEditBlocks") }));
    expect(
      await screen.findByRole("textbox", { name: headingTextName(0) }),
    ).toHaveValue("Alpha");

    await userEvent.click(screen.getByRole("button", { name: docB.title }));
    const textAfterSwitch = await screen.findByRole("textbox", {
      name: headingTextName(0),
    });
    expect(textAfterSwitch).toHaveValue("Beta");

    textAfterSwitch.focus();
    textAfterSwitch.blur();
    expect(mutateDocuments).not.toHaveBeenCalled();
  });

  // ★★★ ASSERT THE POSITIVE. `.not.toContain` passes on an EMPTY array, so the
  //  first cut of this test stayed green with the unmount flush deleted, with
  //  `key={index}` restored, AND with use-document-editor's document-switch
  //  guard deleted. The flush MUST happen, and it must land on doc A.
  //  ★★ `fireEvent.click`, never `userEvent.click`: userEvent moves focus, so
  //   it blurs the input BEFORE the switch and commits through the ordinary
  //   blur path — the "pending unblurred edit" this test is named for never
  //   exists. fireEvent dispatches the click alone and leaves focus put.
  it("flushes a pending unblurred edit to the OLD document on a switch, never the new one", async () => {
    const { mutateDocuments } = renderWithSpy();
    // ★ docA is ALREADY open (the selectionPool[0] fallback) — see the sibling
    // test: an opening click is now the collapse gesture, not a no-op.
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "documentsEditBlocks") }));
    const text = await screen.findByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "!"); // dirty, unblurred — and still focused

    fireEvent.click(screen.getByRole("button", { name: docB.title }));

    const committed = mutateDocuments.mock.calls.map(([m]) => m as { id?: number; ops?: unknown[] });
    const ids = committed.map((m) => m.id);
    expect(ids).toContain(docA.id);
    expect(ids).not.toContain(docB.id);
    // ...and it carried the EDITED text, not docA's stored text — otherwise a
    // flush that wrote the wrong content would still satisfy the id assertions.
    const op = committed.find((m) => m.id === docA.id)?.ops?.[0] as
      | { block?: { text?: string } }
      | undefined;
    expect(op?.block?.text).toBe("Alpha!");
  });

  // ★★★ A REFUSAL MUST REACH THE USER. The panel funnel (`mutate`) is the ONE
  //  place that renders one — its own comment says so — and the block editor
  //  was wired straight past it to `mutateDocuments`. A concurrent delete then
  //  refused the commit with "document #N not found" and the user's typing
  //  vanished in silence.
  it("shows the refusal when a block commit is rejected", async () => {
    const box: Box = { docs: [docA], versions: [] };
    const realMutate = boxMutator(box);
    const mutateDocuments = vi.fn((m: DocMutation, source: DocVersionSource): DocResult => {
      // The document is deleted out from under the open editor, exactly as a
      // second tab or an AI delete would do it.
      if (m.kind === "ops") box.docs = [];
      return realMutate(m, source);
    });
    render(
      <PanelHost>
        <DocumentsPanel
          lang="en-US"
          documents={[docA]}
          mutateDocuments={mutateDocuments}
          documentVersions={[]}
          ws={emptyWorkspace()}
          onResetSize={() => {}}
        />
      </PanelHost>,
    );
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "documentsEditBlocks") }));
    const text = await screen.findByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "!");
    text.blur();

    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The asset byte loader — the export's fifth argument.
//
// ★★★ WHY THIS NEEDS ITS OWN TESTS AT ALL. `downloadDocument`'s loader
// parameter is OPTIONAL, and this repo configures no `no-floating-promises`
// rule, so a call site that never passes it compiles, typechecks, lints and
// runs. The only visible symptom is an exported file whose images are dashed
// "missing asset" boxes — which is exactly what the pane did before this slice,
// so nothing looks broken. Nothing but a test can catch a regression here.
describe("DocumentsPanel — asset loader", () => {
  const TURSO_CONFIG: TursoConfig = { httpUrl: "https://db.turso.io", authToken: "tok" };

  function assetPaneProps(tursoConfig: TursoConfig | null, projectId: string): DocumentAssetPaneProps {
    return { tursoConfig, projectId, assets: [], setAssets: () => {} };
  }

  function renderWithAssets(
    assetPane: DocumentAssetPaneProps | undefined,
    documents: readonly ProjectDocument[] = [doc(1, "Alpha"), doc(2, "Beta")],
  ) {
    vi.mocked(downloadDocument).mockClear();
    vi.mocked(loadAssetData).mockClear();
    return render(
      <PanelHost>
        <DocumentsPanel
          lang="en-US"
          documents={documents}
          mutateDocuments={inertMutate}
          documentVersions={[]}
          ws={emptyWorkspace()}
          assetPane={assetPane}
          onResetSize={() => {}}
        />
      </PanelHost>,
    );
  }

  /** The loader as the pane actually handed it over, so every assertion below
   *  runs against the real closure rather than a re-built stand-in. */
  function capturedLoader() {
    expect(downloadDocument).toHaveBeenCalledTimes(1);
    return vi.mocked(downloadDocument).mock.calls[0][4];
  }

  // ★★★ BOTH SITES, SEPARATELY. The toolbar button and the per-row button are
  // two independent call sites in this file, and covering only one leaves the
  // other free to drop the argument with the suite green — measured by dropping
  // it at one site at a time, each of which reddens exactly one of these two.
  it.each([
    ["the toolbar download", "Download"],
    ["a row download", "Download – Alpha"],
  ])("passes a loader scoped to THIS project from %s", async (_label, buttonName) => {
    renderWithAssets(assetPaneProps(TURSO_CONFIG, "proj-42"));
    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    const loader = capturedLoader();
    expect(loader).toBeTypeOf("function");
    // ★★★ INVOKING IT IS THE POINT. `toBeTypeOf("function")` alone passes for a
    // loader closing over the WRONG config or the WRONG project id — and the
    // project id is the asset store's partition key, so a wrong one reads
    // another project's images into this project's export. The only way to see
    // that is to run the closure and look at what it asks the store for.
    await expect(loader!("asset-9")).resolves.toBe("QUJD");
    expect(loadAssetData).toHaveBeenCalledWith(TURSO_CONFIG, "asset-9", "proj-42");
  });

  // ★ THE NEGATIVE BRANCH OF THE SAME useMemo. Without this the guard is
  // unpinned and a loader could be built unconditionally — one that would call
  // `loadAssetData` with a null config on every image of every export in file
  // mode. `undefined` is the documented "no assets available" signal.
  it.each([
    ["no asset pane at all", undefined],
    ["an asset pane with no Turso config", "null-config"],
  ])("passes NO loader when there is %s", (_label, kind) => {
    renderWithAssets(kind === undefined ? undefined : assetPaneProps(null, "proj-42"));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(capturedLoader()).toBeUndefined();
    expect(loadAssetData).not.toHaveBeenCalled();
  });

  // ★★★ WHY THIS TEST EXISTS — it is the only possible detector. On an empty
  // Turso project BOTH the documents empty-state box and the asset-library
  // empty-state box render at once, in one pane. Two buttons sharing an
  // accessible name is a WCAG 2.4.6 failure, and axe cannot see it: of
  // axe-core 4.12.1's 105 rules, 69 carry one of the four tags
  // `e2e/a11y.spec.ts` requests, and not one of them flags two controls
  // sharing an accessible name (measured elsewhere in this repo — see
  // AGENTS.md's a11y hard-constraint bullet). Documents IS an axe-scanned
  // view, so a fully green axe run says nothing here, at every seed size,
  // forever. This unit test is the entire coverage for this property.
  it("gives the two empty-state boxes distinct accessible names", () => {
    // Both sections empty, assets ENABLED — the only state in which both
    // boxes are on screen at once, which is an empty Turso project.
    renderWithAssets(assetPaneProps(TURSO_CONFIG, "proj-42"), []);

    // Both boxes must actually be on screen, or the uniqueness claim below
    // is vacuous.
    expect(
      screen.getByRole("button", { name: t("en-US", "documentsCreateFirst") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("en-US", "assetLibraryUploadFirst") }),
    ).toBeInTheDocument();

    // ★★ The shared helper (`src/test/row-unique-names.ts`), never a
    // hand-rolled enumeration: `minControls` throws if the scope rendered
    // fewer controls than measured, so a query typo or a silently narrowed
    // scope cannot read as a pass.
    // ★ `requireCollisionSeed` stays OFF: this is a distinct-name
    // regression pin, not a test certifying a collision fixture. Turning it
    // on would make the assertion throw against correct code.
    expectRowUniqueNames({ minControls: 11 });
  });
});

describe("DocumentsPanel — the documents empty-state box", () => {
  it("offers the create box when the register is truly empty", () => {
    renderPanel([]);
    expect(
      screen.getByRole("button", { name: t("en-US", "documentsCreateFirst") }),
    ).toBeInTheDocument();
  });

  // ★★ Asserts the SUBSTRATE, not a mock's arguments: `boxMutator` is real, so
  // a working create actually grows `box.docs`. Asserting on the arguments
  // handed to a mock would prove spelling, not behaviour.
  it("creates a document when the box is clicked", async () => {
    const user = userEvent.setup();
    const { box } = renderPanel([]);
    expect(box.docs).toHaveLength(0);
    await user.click(
      screen.getByRole("button", { name: t("en-US", "documentsCreateFirst") }),
    );
    expect(box.docs).toHaveLength(1);
  });

  // ★★★ A popout is a read-only mirror whose create affordance is inert by
  // design.
  // ★★ READ THE SECOND ASSERTION FOR WHAT IT IS. `documentsNoneYet` is the
  // passive EmptyState's title AND the box's own `text` line, so it renders in
  // BOTH branches and CANNOT discriminate between them — it proves only that
  // the pane rendered something rather than throwing. The `queryByRole` half is
  // the whole load-bearing assertion.
  it("shows the passive message instead of the box when read-only", () => {
    renderPanel([], { isReadOnly: true });
    expect(
      screen.queryByRole("button", { name: t("en-US", "documentsCreateFirst") }),
    ).toBeNull();
    expect(screen.getByText(t("en-US", "documentsNoneYet"))).toBeInTheDocument();
  });

  // ★ The mirror of the asset side's own populated-register test. Paired with a
  // positive observable so it cannot pass against a pane that rendered nothing.
  it("does not offer the create box once the register has a document", () => {
    renderPanel([doc(1, "Alpha")]);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("en-US", "documentsCreateFirst") }),
    ).toBeNull();
  });

  // ★★★ The one case where the gate's two candidate readings DISAGREE.
  // `documents` (the register) is non-empty; `visibleRows` (filtered) is empty.
  // Reading the filtered array here would offer "Create your first document" to
  // someone who has documents and a filter applied. The passive message is the
  // positive observable, so this cannot pass against a pane that rendered nothing.
  it("shows the passive message, not the create box, when an armed filter matches none of the documents", () => {
    const documents = [linkedDoc(), doc(11, "Minutes")];
    render(
      <PanelHost>
        <EntityFilterTrigger kind="raid" id={999} />
        {panelWith(documents)}
      </PanelHost>,
    );

    fireEvent.click(screen.getByRole("button", { name: "arm-filter" }));

    expect(
      screen.queryByRole("button", { name: t("en-US", "documentsCreateFirst") }),
    ).toBeNull();
    expect(screen.getByText(t("en-US", "documentsNoneYet"))).toBeInTheDocument();
  });
});

describe("DocumentsPanel — the list is sized by its rows, not crushed by the preview", () => {
  // ★★★ THE DEFECT THIS PINS. The list box and the preview box are BOTH
  // `overflow-auto` children of the pane's fixed-height flex column, and
  // `overflow` other than `visible` makes `min-height: auto` resolve to 0 — so
  // both are crushable all the way down, and flex distributes the shrink in
  // PROPORTION to content height. Both therefore keep the same FRACTION of
  // themselves. That is fine for a 2000px preview (20% is still ~390px) and
  // useless for a one-row list (20% is ~14px: the header and a scrollbar, no
  // row). It got WORSE the fewer documents there were, which is the opposite
  // of what a reader expects and is why it read as "the section collapsed".
  //
  // ★★ jsdom HAS NO LAYOUT ENGINE, so nothing here can measure a height — this
  // pins the CLASS PLUMBING only, exactly as `budget-panel-totals.tsx`'s
  // geometry is pinned. `shrink-0` is what makes the box uncrushable; the
  // `max-h-*` ceiling is what stops a large register pushing the preview off
  // screen; `overflow-auto` is what makes the box scroll internally past that
  // ceiling. Remove any ONE of the three and the behaviour is wrong in a
  // different direction, so all three are asserted.
  function listBox(): HTMLElement {
    // The documents table is the only table on this surface when no assetPane
    // is supplied, so its nearest div ancestor is the list's own scroll box.
    const box = screen.getByRole("table").closest("div");
    if (!box) throw new Error("no scroll box around the documents table");
    return box;
  }

  // ★★ These read `className` and nothing else — jsdom has no layout engine.
  // The geometry itself is pinned by `e2e/documents-list-geometry.spec.ts`.
  it("carries shrink-0 on the list scroll box", () => {
    renderPanel([doc(1, "Alpha")]);
    expect(listBox()).toHaveClass("shrink-0");
  });

  it("carries max-h-80 and overflow-auto on the list scroll box", () => {
    renderPanel([doc(1, "Alpha")]);
    expect(listBox()).toHaveClass("max-h-80");
    expect(listBox()).toHaveClass("overflow-auto");
  });
});

describe("documents pane — collapsing the open document's body", () => {
  // ★★★ THE `aria-expanded` HALF ALONE IS VACUOUS. Both it and the guard around
  // the body are threaded from the SAME `bodyCollapsed` state, so reverting
  // `{!bodyCollapsed && (<DocumentEditModeBody …/>)}` to the unconditional
  // element deletes the entire user-visible feature — the body never collapses,
  // only the announcement flips — and every ARIA-only assertion in this describe
  // stays green. Assert the RENDERED BODY too, and take the observable from
  // INSIDE `DocumentEditModeBody`: the `<h2>` `DocumentPreview` renders for
  // `doc.title` (`document-preview.tsx`), which is the same locator the rest of
  // this file already uses for "the pane is showing this document".
  // ★★ NOT `DocumentLinksSection` / `DocumentsAssetSection` — both sit OUTSIDE
  // the guard by design and stay mounted while collapsed, so an assertion on
  // either passes under that revert and reproduces the very gap this closes.
  it("collapses the body when the open document's name is clicked again", async () => {
    const user = userEvent.setup();
    renderLive([doc(1, "Alpha")]);
    // `selected` falls back to selectionPool[0], so the body is rendered before
    // the first click — without this the absence below could pass vacuously.
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Alpha" }));
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "Alpha" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Alpha" }));
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
  });

  // ★★★ THE REGRESSION THIS DESIGN EXISTS TO PREVENT. `selected` falls back to
  // selectionPool[0], so the FIRST document renders as open while `selectedId` is
  // still null. A toggle comparing the clicked id against `selectedId` therefore
  // does nothing here — and a fixture that clicks only AFTER an explicit
  // selection passes either way, which is why this case is separate.
  it("collapses the FIRST document even though selectedId is still null", async () => {
    const user = userEvent.setup();
    renderLive([doc(1, "Alpha")]);
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Alpha" }));
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-expanded", "false");
  });

  it("selecting a different document expands it rather than inheriting the collapse", async () => {
    const user = userEvent.setup();
    renderLive([doc(1, "Alpha"), doc(2, "Beta")]);
    await user.click(screen.getByRole("button", { name: "Alpha" })); // collapse Alpha
    await user.click(screen.getByRole("button", { name: "Beta" })); // switch
    expect(screen.getByRole("button", { name: "Beta" })).toHaveAttribute("aria-expanded", "true");
  });
});
