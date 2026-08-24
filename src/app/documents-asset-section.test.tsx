import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { hashBytes } from "./document-asset-upload";
import { DocumentsAssetSection, type DocumentAssetPaneProps } from "./documents-asset-section";
import { FiltersProvider } from "./filters-context";
import { t } from "./i18n";
import type { ProjectDocument } from "./document-model";
import type { DocumentAsset } from "./document-asset";
import type { BlockStructuralOps } from "./use-document-editor";
import type { TursoConfig } from "./turso-config";
import type { DocResult } from "./document-mutations";

vi.mock("./document-assets-store", () => ({
  saveAssetData: vi.fn(), deleteAssetData: vi.fn(), loadAssetDataIds: vi.fn(),
}));
import { saveAssetData, deleteAssetData, loadAssetDataIds } from "./document-assets-store";

const TURSO_CONFIG: TursoConfig = { httpUrl: "https://db.turso.io", authToken: "t" };

function doc(id: number, blocks: ProjectDocument["blocks"] = []): ProjectDocument {
  return { id, title: `Doc ${id}`, blocks, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

function okResult(documents: readonly ProjectDocument[]): DocResult {
  return { changed: true, documents, versions: [], rejected: [], documentId: documents[0]?.id ?? null, minted: null };
}

function fakeStructural(): BlockStructuralOps {
  return {
    insert: vi.fn(() => okResult([])),
    remove: vi.fn(() => okResult([])),
    move: vi.fn(() => okResult([])),
  } as unknown as BlockStructuralOps;
}

function fakeAsset(id: string, name = "chart.png", hash = id): DocumentAsset {
  return { id, name, mime: "image/png", size: 10, hash, createdAt: "2026-01-01T00:00:00.000Z" };
}

// A 24-byte PNG header, small enough that `processUpload` never downscales and
// so never reaches the (canvas-backed, jsdom-hostile) encoder. `width` varies
// the BYTES, which is what varies the hash the dedup compares.
function pngBytes(width = 4): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, 3);
  return b;
}

function pngFile(name = "paste.png", width = 4): File {
  return new File([pngBytes(width).buffer as ArrayBuffer], name, { type: "image/png" });
}

/** ★ The exact row-label shape belongs to `asset-library.tsx` — it qualifies
 *  each per-row control with the asset id so N rows cannot share one accessible
 *  name. Matched by PREFIX here so a change to that qualifier cannot break this
 *  file over a naming detail it does not own. */
function findInsertRowButton(name: string): Promise<HTMLElement> {
  const prefix = `${t("en-US", "insert")} – ${name}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return screen.findByRole("button", { name: new RegExp(`^${prefix}`) });
}

/** The zone that owns paste + drop, located STRUCTURALLY.
 *
 *  ★★★ DELIBERATELY NOT `getByRole("group", { name: … })`. Its role and its
 *  aria-label are both things the a11y tests below exist to pin, and a helper
 *  that FINDS the element by them makes every paste/drop test die at the
 *  LOOKUP the moment either is mutated. That still prints RED, so it reads as
 *  a successful mutation proof while proving nothing about the assertion — the
 *  test would have "died" just as loudly for a harmless relabel. Locate by a
 *  handle no test mutates; assert on the attributes separately. */
function pasteZone(): HTMLElement {
  const zone = document.querySelector("[data-asset-drop-zone]");
  if (!zone) throw new Error("paste/drop zone not rendered");
  return zone as HTMLElement;
}

/** RTL has no `paste` helper that carries files, so the `clipboardData` shape
 *  React reads is supplied directly. Only `files` is consumed. */
async function pasteFiles(files: readonly File[]) {
  await act(async () => {
    fireEvent.paste(pasteZone(), { clipboardData: { files, items: [], types: ["Files"] } });
    await Promise.resolve();
  });
  // Two microtask drains: `upload` awaits arrayBuffer → processUpload → digest
  // before it commits, and the insert waits on all of those.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function dropFiles(files: readonly File[]) {
  await act(async () => {
    fireEvent.drop(pasteZone(), { dataTransfer: { files, items: [], types: ["Files"] } });
    await Promise.resolve();
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** The html `structural.insert` was handed, parsed. ★★ Asserting on the raw
 *  string would pass for an escaped-looking substring that the browser still
 *  parses as markup — the DOM is the only thing that answers "did this create
 *  an element". */
function insertedDom(structural: BlockStructuralOps, call = 0): HTMLElement {
  const [, block] = vi.mocked(structural.insert).mock.calls[call];
  const host = document.createElement("div");
  host.innerHTML = (block as { html: string }).html;
  return host;
}

/** Owns the `assets`/`setAssets` half of the bag with a plain `useState` —
 *  the same shape `workspace-panels.tsx` gets for free from `useWorkspace()`
 *  in production. No `WorkspaceProvider` needed here any more: the section
 *  reads asset state from PROPS, never `useWorkspace()` (see
 *  documents-asset-section.tsx's `DocumentAssetPaneProps` docstring — it must
 *  stay prop-driven so documents-panel.tsx's provider-less tests keep
 *  working). */
function Harness({
  tursoConfig = TURSO_CONFIG,
  projectId = "p1",
  isReadOnly,
  seedAssets = [],
  documents,
  structural,
  selected,
}: {
  tursoConfig?: TursoConfig | null;
  projectId?: string;
  isReadOnly?: boolean;
  seedAssets?: readonly DocumentAsset[];
  documents: readonly ProjectDocument[];
  structural: BlockStructuralOps;
  selected: ProjectDocument | null;
}) {
  const [assets, setAssets] = useState<readonly DocumentAsset[] | undefined>(seedAssets);
  const assetPane: DocumentAssetPaneProps = { tursoConfig, projectId, assets, setAssets };
  return (
    <DocumentsAssetSection
      lang="en-US"
      assetPane={assetPane}
      documents={documents}
      structural={structural}
      selected={selected}
      isReadOnly={isReadOnly}
    />
  );
}

function renderSection(
  props: {
    tursoConfig?: TursoConfig | null;
    projectId?: string;
    isReadOnly?: boolean;
    documents?: readonly ProjectDocument[];
    structural?: BlockStructuralOps;
    selected?: ProjectDocument | null;
  } = {},
  seedAssets: readonly DocumentAsset[] = [],
) {
  const structural = props.structural ?? fakeStructural();
  const selected = "selected" in props ? props.selected! : doc(1);
  const documents = props.documents ?? [selected];
  const result = render(
    <FiltersProvider>
      <Harness
        tursoConfig={props.tursoConfig}
        projectId={props.projectId}
        isReadOnly={props.isReadOnly}
        seedAssets={seedAssets}
        documents={documents}
        structural={structural}
        selected={selected}
      />
    </FiltersProvider>,
  );
  return { structural, ...result };
}

beforeEach(() => {
  vi.mocked(saveAssetData).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteAssetData).mockReset().mockResolvedValue(undefined);
  vi.mocked(loadAssetDataIds).mockReset().mockResolvedValue([]);
});

describe("documents asset library gating", () => {
  it("enables the library when a usable Turso config exists", async () => {
    renderSection({ tursoConfig: TURSO_CONFIG });
    expect(await screen.findByRole("button", { name: t("en-US", "upload") })).toBeEnabled();
    expect(screen.queryByText(t("en-US", "assetLibraryTursoOnly"))).not.toBeInTheDocument();
  });

  it("disables the library when the kind is turso but the config is unset", () => {
    // The config resolver already returns null when a Turso storage kind is
    // set but url/token are missing/quarantined — that resolved-to-null value
    // is exactly what this component receives.
    renderSection({ tursoConfig: null });
    expect(screen.getByText(t("en-US", "assetLibraryTursoOnly"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("en-US", "upload") })).not.toBeInTheDocument();
  });

  // ★★ A FILE BACKEND IS THE SAME CASE AND CANNOT BE TESTED SEPARATELY HERE.
  // A separate "disables the library on a file backend" test used to sit at
  // this spot with a byte-identical arrange (`renderSection({ tursoConfig:
  // null })`) and a strict SUBSET of the assertions above, so it could not
  // fail unless its neighbour failed first. This component only ever receives
  // an ALREADY-RESOLVED config, so at this boundary "file backend" and "turso
  // kind, config unset" are the same input and no fixture can tell them apart
  // — the distinction lives in the resolver, not here. Do not re-add it.

  // ★★ The read-only popout is NOT a storage problem, and saying it is sends
  // the reader off to check Turso settings that are already correct.
  // ★★ `toHaveTextContent` against the CONTAINER, not `getByText`/`queryByText`.
  //    `getBy*` throws on a miss (a lookup error, which proves nothing about
  //    WHICH message was chosen) and `queryBy*` hands `toBeInTheDocument` a
  //    null, which fails as a matcher ARGUMENT error for the same reason. Only
  //    this shape fails with an assertion naming the expected text.
  it("explains a read-only popout as read-only, not as a missing Turso project", () => {
    const { container } = renderSection({ tursoConfig: TURSO_CONFIG, isReadOnly: true });
    expect(container).toHaveTextContent(t("en-US", "assetLibraryReadOnly"));
    expect(container).not.toHaveTextContent(t("en-US", "assetLibraryTursoOnly"));
  });

  it("still blames the missing project when BOTH reasons apply", () => {
    const { container } = renderSection({ tursoConfig: null, isReadOnly: true });
    expect(container).toHaveTextContent(t("en-US", "assetLibraryTursoOnly"));
    expect(container).not.toHaveTextContent(t("en-US", "assetLibraryReadOnly"));
  });
});

describe("documents asset insertion", () => {
  it("inserts a NEW sanitized paragraph block via structural.insert (picker path)", async () => {
    const user = userEvent.setup();
    const d = doc(1, [{ type: "heading", level: 1, text: "Intro" }]);
    const { structural } = renderSection({ selected: d, documents: [d] }, [fakeAsset("a1", "chart.png")]);

    await user.click(await screen.findByRole("button", { name: t("en-US", "assetLibraryInsert") }));
    await user.click(await findInsertRowButton("chart.png"));

    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(1));
    const [at, block] = vi.mocked(structural.insert).mock.calls[0];
    expect(at).toBe(1); // appended after the document's one existing block
    expect(block).toEqual({ type: "paragraph", html: '<img data-asset-id="a1" alt="chart.png">' });
  });

  it("sanitizes an asset name that looks like markup before storing it", async () => {
    const user = userEvent.setup();
    const d = doc(1, []);
    const evilName = "<script>alert(1)</script>";
    const { structural } = renderSection(
      { selected: d, documents: [d] },
      [fakeAsset("a1", evilName)],
    );
    await user.click(await screen.findByRole("button", { name: t("en-US", "assetLibraryInsert") }));
    await user.click(await findInsertRowButton(evilName));
    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(1));
    const [, block] = vi.mocked(structural.insert).mock.calls[0];
    const html = (block as { html: string }).html;
    expect(html).not.toContain("<script>");
  });

  // ★★★ THE SANITIZER DOES NOT SAVE YOU HERE, which is the whole point. `<a>`
  // is allow-listed and an `https:` href passes the URI regexp, so an asset
  // name that BREAKS OUT of the alt attribute yields a well-formed, sanitizer-
  // approved anchor with attacker-chosen text — persisted into `block.html` and
  // carried into the standalone-HTML/DOCX/PPTX exports. An asset name is
  // `file.name` verbatim, free text via rename, and arbitrary in an imported
  // workspace, so all three are reachable without any privileged access.
  it("cannot be made to emit a link by an asset name that breaks out of the alt attribute", async () => {
    const user = userEvent.setup();
    const d = doc(1, []);
    const evilName =
      'x"><a href="https://evil.test/verify">Click to verify your account</a><img alt="';
    const { structural } = renderSection({ selected: d, documents: [d] }, [fakeAsset("a1", evilName)]);

    await user.click(await screen.findByRole("button", { name: t("en-US", "assetLibraryInsert") }));
    await user.click(await findInsertRowButton(evilName));
    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(1));

    const host = insertedDom(structural);
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.querySelectorAll("img")).toHaveLength(1);
    // The name survives INTACT as text — escaping is not truncation.
    expect(host.querySelector("img")!.getAttribute("alt")).toBe(evilName);
    expect(host.querySelector("img")!.getAttribute("data-asset-id")).toBe("a1");
  });

  it("keeps a plain double quote in the name instead of truncating the alt at it", async () => {
    const user = userEvent.setup();
    const d = doc(1, []);
    const quoted = 'q3 "final" chart.png';
    const { structural } = renderSection({ selected: d, documents: [d] }, [fakeAsset("a1", quoted)]);

    await user.click(await screen.findByRole("button", { name: t("en-US", "assetLibraryInsert") }));
    await user.click(await findInsertRowButton(quoted));
    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(1));

    expect(insertedDom(structural).querySelector("img")!.getAttribute("alt")).toBe(quoted);
  });

  it("refuses to insert past the 20-image-per-document cap, without calling structural.insert", async () => {
    const user = userEvent.setup();
    const html = Array.from({ length: 20 }, (_, i) => `<img data-asset-id="a${i}">`).join("");
    const d = doc(1, [{ type: "paragraph", html }]);
    const { structural } = renderSection({ selected: d, documents: [d] }, [fakeAsset("a20", "extra.png")]);

    await user.click(await screen.findByRole("button", { name: t("en-US", "assetLibraryInsert") }));
    await user.click(await findInsertRowButton("extra.png"));

    expect(await screen.findByText(t("en-US", "assetLibraryMaxPerDocument", "20"))).toBeInTheDocument();
    expect(structural.insert).not.toHaveBeenCalled();
  });

  it("does NOT refuse re-inserting an id already present in the document, even at the cap", async () => {
    const user = userEvent.setup();
    const html = Array.from({ length: 20 }, (_, i) => `<img data-asset-id="a${i}">`).join("");
    const d = doc(1, [{ type: "paragraph", html }]);
    const { structural } = renderSection({ selected: d, documents: [d] }, [fakeAsset("a0", "already-here.png")]);

    await user.click(await screen.findByRole("button", { name: t("en-US", "assetLibraryInsert") }));
    await user.click(await findInsertRowButton("already-here.png"));

    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(1));
  });
});

// ★★★ THIS SURFACE WAS ZERO-COVERED, which is why three defects shipped in it
// at once. Nothing touched paste, drop, clipboardData, dataTransfer, or the
// arm-a-ref-and-react-to-`lastId` state machine that used to sit between the
// upload and the insert.
describe("documents asset paste and drop insertion", () => {
  it("inserts a pasted image once it has uploaded", async () => {
    const d = doc(1, []);
    const { structural } = renderSection({ selected: d, documents: [d] });

    await pasteFiles([pngFile("pasted.png")]);

    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(1));
    expect(insertedDom(structural).querySelector("img")!.getAttribute("alt")).toBe("pasted.png");
  });

  // ★★★ DEFECT 2a. The dedup branch used to `setLastId(duplicate.id)` with the
  // value it already held; React bails out of a re-render for an identical
  // value, so the effect that performed the insert never ran — and its own
  // `lastId === lastInsertedRef.current` clause would have refused anyway.
  // Real-world shape: paste a screenshot into doc A, then the same screenshot
  // into doc B, and nothing appears, with no error.
  it("inserts an image that is ALREADY in the library when it is pasted again", async () => {
    const d = doc(1, []);
    const stored = fakeAsset("a1", "already-stored.png", await hashBytes(pngBytes()));
    const { structural } = renderSection({ selected: d, documents: [d] }, [stored]);

    await pasteFiles([pngFile("pasted-again.png")]);

    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(1));
    // Deduped to the STORED row — the existing id, and the stored name.
    const img = insertedDom(structural).querySelector("img")!;
    expect(img.getAttribute("data-asset-id")).toBe("a1");
    expect(img.getAttribute("alt")).toBe("already-stored.png");
  });

  // ★★★ DEFECT 2c. One boolean ref cannot carry N files: three pasted images
  // armed the same flag three times and exactly one insert ever fired.
  it("inserts EVERY file of a multi-file paste, in the pasted order", async () => {
    const d = doc(1, []);
    const { structural } = renderSection({ selected: d, documents: [d] });

    await pasteFiles([pngFile("one.png", 4), pngFile("two.png", 5), pngFile("three.png", 6)]);

    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(3));
    const names = [0, 1, 2].map((i) => insertedDom(structural, i).querySelector("img")!.getAttribute("alt"));
    expect(names).toEqual(["one.png", "two.png", "three.png"]);
  });

  it("inserts every file of a multi-file DROP too", async () => {
    const d = doc(1, []);
    const { structural } = renderSection({ selected: d, documents: [d] });

    await dropFiles([pngFile("one.png", 4), pngFile("two.png", 5)]);

    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(2));
  });

  // ★★★ DEFECT 2b — THE MOST DAMAGING OF THE THREE, because it mutates a
  // document the user never asked to touch. The arm was set BEFORE the await;
  // every rejection path in `upload` returns without touching `lastId`, so the
  // arm was never cleared. The next ORDINARY Upload press — which arms nothing
  // and is not an insert gesture at all — then satisfied the effect and
  // appended that unrelated image to the open document.
  it("does not insert anything when a rejected paste is followed by an ordinary Upload", async () => {
    const user = userEvent.setup();
    const d = doc(1, []);
    const { structural, container } = renderSection({ selected: d, documents: [d] });

    // An allowed mime so the paste handler's own filter passes it through, but
    // an empty file, so `checkUploadCandidate` rejects it as `empty`.
    await pasteFiles([new File([], "broken.png", { type: "image/png" })]);
    expect(structural.insert).not.toHaveBeenCalled();
    expect(await screen.findByText(t("en-US", "assetUploadErrorEmpty"))).toBeInTheDocument();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, pngFile("library-only.png"));

    await waitFor(() => expect(screen.queryByText(t("en-US", "assetUploadErrorEmpty"))).not.toBeInTheDocument());
    // The Upload button adds to the LIBRARY. It is not an insert gesture, and
    // nothing armed earlier may make it one.
    expect(structural.insert).not.toHaveBeenCalled();
  });

  /** A file the intake filter must reject. Deliberately NOT a malformed image:
   *  the upload pipeline rejects a broken PNG on its own, so a bad-PNG fixture
   *  cannot tell a working filter from a deleted one. */
  const textFile = () => new File(["hello"], "notes.txt", { type: "text/plain" });

  const statusText = () =>
    Array.from(pasteZone().querySelectorAll('[role="status"]'))
      .map((r) => r.textContent ?? "").join(" ");

  /** Dispatches like `pasteFiles`/`dropFiles` but KEEPS the dispatch result,
   *  which is `false` exactly when a handler called `preventDefault`. */
  async function intake(kind: "paste" | "drop", files: readonly File[]): Promise<boolean> {
    let notCancelled = true;
    await act(async () => {
      notCancelled = kind === "paste"
        ? fireEvent.paste(pasteZone(), { clipboardData: { files, items: [], types: ["Files"] } })
        : fireEvent.drop(pasteZone(), { dataTransfer: { files, items: [], types: ["Files"] } });
      await Promise.resolve();
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return notCancelled;
  }

  // ★★★ BOTH INTAKE FILTERS WERE ENTIRELY UNOBSERVED. Measured, not assumed:
  // neutering `handlePaste`'s `.filter(...)` to `() => true` left all 29 tests
  // in this file GREEN. `structural.insert` alone cannot see it — the upload
  // pipeline rejects a text file too, so nothing is inserted either way. What
  // separates a working filter from a deleted one is that a filtered file never
  // reaches the pipeline AT ALL, so no format rejection is ever announced.
  //
  // ★★★ THE `preventDefault` ORDERING IS OPPOSITE IN THE TWO HANDLERS AND BOTH
  // ARE CORRECT, so it is pinned PER HANDLER and never shared. `handlePaste`
  // calls it AFTER the filter, so pasting ordinary TEXT falls through to the
  // default paste handler; `handleDrop` calls it BEFORE, so the browser never
  // navigates away to a dropped file even when nothing is accepted. Harmonising
  // them would break one or the other, and this pair is what says so.
  it("filters a pasted non-image out, leaving the default paste handler to run", async () => {
    const d = doc(1, []);
    const { structural } = renderSection({ selected: d, documents: [d] });
    await screen.findByRole("button", { name: t("en-US", "upload") });

    const notCancelled = await intake("paste", [textFile()]);

    expect(structural.insert).not.toHaveBeenCalled();
    expect(statusText()).not.toContain(t("en-US", "assetUploadErrorFormat"));
    expect(notCancelled).toBe(true);
  });

  it("filters a dropped non-image out, but still cancels the drop itself", async () => {
    const d = doc(1, []);
    const { structural } = renderSection({ selected: d, documents: [d] });
    await screen.findByRole("button", { name: t("en-US", "upload") });

    const notCancelled = await intake("drop", [textFile()]);

    expect(structural.insert).not.toHaveBeenCalled();
    expect(statusText()).not.toContain(t("en-US", "assetUploadErrorFormat"));
    expect(notCancelled).toBe(false);
  });

  // ★★★ THE POSITIVE ANCHOR FOR THE TWO NEGATIVE ASSERTIONS ABOVE. Both intake
  // tests kill their mutant partly (paste) or ENTIRELY (drop) via `statusText()`
  // NOT containing the format error — and a negative assertion is worth only
  // what its positive counterpart is worth. For drop it is the SOLE
  // discriminator: `notCancelled` is false either way there, because that
  // handler calls preventDefault BEFORE filtering. So without this test, a
  // change that stopped the status region rendering `assetUploadErrorFormat`
  // specifically would make the drop test vacuous with nothing going red.
  //
  // ★★ It has to arrive through the PICKER. Paste and drop filter the file out
  // by mime before `checkUploadCandidate` ever sees it — which is exactly what
  // the two tests above assert — so neither can reach the format rejection.
  // `applyAccept: false` is required because the input carries an `accept` list
  // and userEvent honours it by default, silently dropping the file and passing
  // this test for the wrong reason.
  it("announces a format rejection when a non-image arrives through the picker", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const d = doc(1, []);
    const { structural, container } = renderSection({ selected: d, documents: [d] });
    await screen.findByRole("button", { name: t("en-US", "upload") });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, textFile());

    expect(await screen.findByText(t("en-US", "assetUploadErrorFormat"))).toBeInTheDocument();
    expect(structural.insert).not.toHaveBeenCalled();
  });

  it("uploads a pasted image without inserting it when no document is selected", async () => {
    const { structural } = renderSection({ selected: null, documents: [] });
    await pasteFiles([pngFile("orphan.png")]);
    expect(structural.insert).not.toHaveBeenCalled();
  });
});

describe("documents asset section accessibility", () => {
  // ★★★ A live region inserted into the DOM in the same commit as its text is
  // not reliably announced — assistive tech has to already be observing it.
  // Conditionally mounted, none of the seven upload-error strings nor the cap
  // message ever reached a screen reader.
  // ★ `querySelectorAll`, not `getAllByRole` — a missing region must surface as
  //   a length assertion, not as a TestingLibrary lookup throw. A proof that
  //   dies at the lookup never reaches the claim it is supposed to be about.
  function statusRegions(): HTMLElement[] {
    return Array.from(pasteZone().querySelectorAll('[role="status"]'));
  }

  it("mounts both status regions before there is anything to announce", async () => {
    renderSection();
    await screen.findByRole("button", { name: t("en-US", "upload") });
    expect(statusRegions()).toHaveLength(2);
  });

  it("announces an upload error through an already-mounted region", async () => {
    renderSection();
    const before = statusRegions();
    expect(before).toHaveLength(2);

    await pasteFiles([new File([], "broken.png", { type: "image/png" })]);

    const after = statusRegions();
    // SAME element, new text — that is what makes it an announcement rather
    // than an insertion.
    expect(after[0]).toBe(before[0]);
    expect(after[0]).toHaveTextContent(t("en-US", "assetUploadErrorEmpty"));
  });

  // ★★ ARIA prohibits naming the implicit `generic` role, so the aria-label on
  // a role-less focusable div may simply not be exposed — leaving a tab stop
  // that announces nothing.
  it("gives the paste/drop zone a real role so its label can be exposed", async () => {
    renderSection();
    await screen.findByRole("button", { name: t("en-US", "upload") });
    const zone = pasteZone();
    expect(zone).toHaveAttribute("role", "group");
    expect(zone).toHaveAttribute("tabIndex", "0");
    // ★ The point is not that SOME group exists — it is that the accessible
    //   name resolves to THIS element. `queryByRole` returns null rather than
    //   throwing, so a missing role fails as an assertion naming the element.
    expect(screen.queryByRole("group", { name: t("en-US", "assetLibraryPasteDropZone") })).toBe(zone);
  });
});

// ★★★ THE CAP IS A BATCH PROPERTY, AND IT ONLY BECAME ONE WHEN MULTI-FILE
// PASTE STARTED INSERTING EVERY FILE. Before that fix a paste inserted exactly
// one image, so N per-file checks against one frozen `selected` closure could
// not disagree with each other. Afterwards they all evaluated the SAME
// pre-batch id set: at 19 stored images a 5-file paste passed the cap five
// times over and the document ended with 24.
describe("documents asset per-document cap across a batch", () => {
  /** A document whose single paragraph already references `count` asset ids. */
  function docHolding(count: number): ProjectDocument {
    const html = Array.from({ length: count }, (_, i) => `<img data-asset-id="a${i}">`).join("");
    return doc(1, [{ type: "paragraph", html }]);
  }

  /** The `alt` of every image handed to `structural.insert`, call order. ★ Read
   *  through the parsed DOM (`insertedDom`) for the same reason the other tests
   *  do — a raw-string match would pass for something the browser still parses
   *  as markup. */
  function insertedAlts(structural: BlockStructuralOps): (string | null)[] {
    return vi.mocked(structural.insert).mock.calls.map(
      (_, i) => insertedDom(structural, i).querySelector("img")!.getAttribute("alt"),
    );
  }

  function insertedIndices(structural: BlockStructuralOps): number[] {
    return vi.mocked(structural.insert).mock.calls.map(([at]) => at);
  }

  // The LOWER boundary: a batch that lands exactly ON the cap must go in whole,
  // and must NOT announce a cap it did not hit.
  it("inserts a whole batch that exactly fills the 20-image cap", async () => {
    const d = docHolding(18);
    const { structural, container } = renderSection({ selected: d, documents: [d] });

    await pasteFiles([pngFile("nineteen.png", 4), pngFile("twenty.png", 5)]);

    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(2));
    expect(insertedAlts(structural)).toEqual(["nineteen.png", "twenty.png"]);
    expect(container).not.toHaveTextContent(t("en-US", "assetLibraryMaxPerDocument", "20"));
  });

  // The UPPER boundary, and the regression itself: one file too many. The two
  // that fit must still land — a batch is not rejected because its last member
  // would overshoot.
  it("inserts only what fits when a batch exceeds the cap by one, and says so", async () => {
    const d = docHolding(18);
    const { structural } = renderSection({ selected: d, documents: [d] });

    await pasteFiles([pngFile("nineteen.png", 4), pngFile("twenty.png", 5), pngFile("overshoot.png", 6)]);

    // ★★ THE VALUE ASSERTION COMES FIRST, DELIBERATELY. Leading with the cap
    //    message would make a reverted cap fail at `findByText` — "Unable to
    //    find an element", a LOOKUP failure that reads as a successful mutation
    //    proof while saying nothing about how many images went in. This shape
    //    fails as an AssertionError printing the real overshoot.
    // ★ SPECIFIC VALUES, not a count and not a uniqueness check: the two that
    //   fit, in pasted order, and the third one absent. A `toHaveLength(2)`
    //   alone would stay green if the cap kept the WRONG two.
    await waitFor(() => expect(structural.insert).toHaveBeenCalled());
    expect(insertedAlts(structural)).toEqual(["nineteen.png", "twenty.png"]);
    expect(structural.insert).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(t("en-US", "assetLibraryMaxPerDocument", "20"))).toBeInTheDocument();
  });

  // Across batches, not only within one: the second paste re-reads a document
  // that the first one filled.
  it("still refuses a later batch once an earlier one filled the cap", async () => {
    const d = docHolding(20);
    const { structural } = renderSection({ selected: d, documents: [d] });

    await pasteFiles([pngFile("late.png", 7)]);

    expect(await screen.findByText(t("en-US", "assetLibraryMaxPerDocument", "20"))).toBeInTheDocument();
    expect(structural.insert).not.toHaveBeenCalled();
  });

  // ★★★ THE SECOND HALF OF THE SAME FROZEN-CLOSURE DEFECT. `structural.insert`
  // splices at the index it is given, against LIVE state, while
  // `selected.blocks.length` is frozen for the whole loop — so N inserts at one
  // index stack each new block BEFORE the previous one. The pre-existing
  // "in the pasted order" test compares the order of the CALLS, which was
  // always right; nothing looked at the index they carried.
  it("advances the insert index so a multi-file paste appends in pasted order", async () => {
    const d = doc(1, []);
    const { structural } = renderSection({ selected: d, documents: [d] });

    await pasteFiles([pngFile("one.png", 4), pngFile("two.png", 5), pngFile("three.png", 6)]);

    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(3));
    expect(insertedIndices(structural)).toEqual([0, 1, 2]);
  });

  it("advances from the END of an existing document, not from zero", async () => {
    const d = doc(1, [
      { type: "heading", level: 1, text: "Intro" },
      { type: "paragraph", html: "<p>body</p>" },
    ]);
    const { structural } = renderSection({ selected: d, documents: [d] });

    await pasteFiles([pngFile("one.png", 4), pngFile("two.png", 5)]);

    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(2));
    expect(insertedIndices(structural)).toEqual([2, 3]);
  });

  // A dedup hit resolves to a row the document ALREADY holds, so it takes no
  // slot — and the running set must not count it as one either.
  it("does not spend a cap slot on a re-insert of an id the document already holds", async () => {
    const html = Array.from({ length: 20 }, (_, i) => `<img data-asset-id="a${i}">`).join("");
    const d = doc(1, [{ type: "paragraph", html }]);
    const stored = fakeAsset("a0", "already-here.png", await hashBytes(pngBytes()));
    const { structural, container } = renderSection({ selected: d, documents: [d] }, [stored]);

    await pasteFiles([pngFile("same-bytes.png", 4)]);

    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(1));
    expect(insertedAlts(structural)).toEqual(["already-here.png"]);
    expect(container).not.toHaveTextContent(t("en-US", "assetLibraryMaxPerDocument", "20"));
  });
});

// ★★★ THE BYTE PARTITION KEY, AND THE DECISION THAT IT IS A REAL KEY RATHER
// THAN A BROKEN STATE TO REFUSE. A Turso portfolio with nothing selected loads
// the SINGLE-TENANT backend (storage.ts `createBackend` falls back when
// `tursoProjectId` is null), so a real workspace with real documents is on
// screen; disabling images there would break a configuration that works. What
// the feature owes instead is that the key is DETERMINISTIC — the same state
// resolves to the same partition, and the read side and the write side resolve
// it identically. Contrast Safe Mode (workspace-panels.tsx), which IS refused,
// precisely because it MOVES the key under a workspace whose metadata stayed.
describe("documents asset byte partition", () => {
  it("keeps the library operating when the caller has no project id", async () => {
    const d = doc(1, []);
    const { container } = renderSection({ selected: d, documents: [d], projectId: "" });

    // ★★ The two refusal messages FIRST, as text assertions on the container.
    //    A `findByRole("button")` leading the test would fail at the LOOKUP if
    //    a refusal were ever added — which prints RED without naming what went
    //    wrong, and reads identically to any unrelated render break.
    expect(container).not.toHaveTextContent(t("en-US", "assetLibraryTursoOnly"));
    expect(container).not.toHaveTextContent(t("en-US", "assetLibraryReadOnly"));
    expect(await screen.findByRole("button", { name: t("en-US", "upload") })).toBeEnabled();
  });

  // ★★ ONE key, asserted as a LITERAL on both sides. Comparing the two calls to
  //    each other would stay green if both drifted together, and comparing
  //    either to the exported constant would stay green if the constant moved.
  it("writes bytes to and reads dangling ids from the same fallback partition", async () => {
    const d = doc(1, []);
    renderSection({ selected: d, documents: [d], projectId: "" });

    await pasteFiles([pngFile("no-project.png")]);

    await waitFor(() => expect(saveAssetData).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveAssetData).mock.calls[0][1].projectId).toBe("default");
    expect(vi.mocked(loadAssetDataIds).mock.calls.length).toBeGreaterThan(0);
    for (const [, key] of vi.mocked(loadAssetDataIds).mock.calls) expect(key).toBe("default");
  });

  it("passes a real project id straight through, without substituting the fallback", async () => {
    const d = doc(1, []);
    renderSection({ selected: d, documents: [d], projectId: "proj-7" });

    await pasteFiles([pngFile("scoped.png")]);

    await waitFor(() => expect(saveAssetData).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveAssetData).mock.calls[0][1].projectId).toBe("proj-7");
  });
});

// ★★★ THE CAP MESSAGE MUST EXPLAIN A CAP THE USER CANNOT SEE. A
// `<span data-asset-id>` holds a cap slot, contributes to no export and lands
// in none of `inlined`/`omitted`/`missing` — so a document whose slots are
// held by them reads as full with nothing on screen to account for it.
// open-followups §218.
//
// ★★★ BOTH CASES ARE REQUIRED AND THE ALL-DRAWABLE ONE IS THE LOAD-BEARING
// HALF. A test that only asserts the new wording passes just as well with the
// condition INVERTED — at which point every user at a full document is told
// slots are held by undrawable references when none are. The second case is
// what makes the first one mean anything.
describe("documents asset cap message names undrawable references", () => {
  /** `count` drawable `<img>` references plus `undrawable` `<span>` ones, all
   *  distinct, in ONE paragraph — `assetRefsInDocument` scans paragraphs only. */
  function docHoldingMixed(count: number, undrawable: number): ProjectDocument {
    const html = [
      ...Array.from({ length: count }, (_, i) => `<img data-asset-id="a${i}">`),
      ...Array.from({ length: undrawable }, (_, i) => `<span data-asset-id="s${i}">x</span>`),
    ].join("");
    return doc(1, [{ type: "paragraph", html }]);
  }

  it("says how many slots are held by references no export can draw", async () => {
    const user = userEvent.setup();
    const d = docHoldingMixed(18, 2);
    const { structural } = renderSection({ selected: d, documents: [d] }, [fakeAsset("a20", "extra.png")]);

    await user.click(await screen.findByRole("button", { name: t("en-US", "assetLibraryInsert") }));
    await user.click(await findInsertRowButton("extra.png"));

    // ★★ THE CAP ASSERTION COMES FIRST, for the reason the batch tests give:
    //    leading with the wording would make a reverted cap fail at a TEXT
    //    LOOKUP, which prints red while saying nothing about the cap.
    expect(structural.insert).not.toHaveBeenCalled();
    // ★ The COUNT is asserted, not just the phrasing — the message exists to
    //   report a number, and a hardcoded one would satisfy a phrase match.
    expect(
      await screen.findByText(t("en-US", "assetLibraryMaxPerDocumentUndrawable", "20", "2")),
    ).toBeInTheDocument();
  });

  it("keeps the plain cap wording when every reference is drawable", async () => {
    const user = userEvent.setup();
    const d = docHoldingMixed(20, 0);
    const { structural } = renderSection({ selected: d, documents: [d] }, [fakeAsset("a20", "extra.png")]);

    await user.click(await screen.findByRole("button", { name: t("en-US", "assetLibraryInsert") }));
    await user.click(await findInsertRowButton("extra.png"));

    expect(structural.insert).not.toHaveBeenCalled();
    expect(await screen.findByText(t("en-US", "assetLibraryMaxPerDocument", "20"))).toBeInTheDocument();
    // ★★ THE NEGATIVE ASSERTION NAMES THE REAL STRING, not a phrase lifted out
    //    of it. `/no export can draw/i` matches nothing the moment the EN copy
    //    is reworded, so a rewording would turn the load-bearing half of this
    //    pair vacuously green while the inverted-condition bug it exists to
    //    catch shipped. Built from `t` with the count this fixture actually
    //    has (zero undrawable), it tracks the string it is denying.
    expect(
      screen.queryByText(t("en-US", "assetLibraryMaxPerDocumentUndrawable", "20", "0")),
    ).not.toBeInTheDocument();
  });
});
