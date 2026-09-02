// src/app/document-preview.test.tsx
//
// The preview had no test file of its own — it was covered only incidentally by
// documents-panel.test.tsx's region/heading assertions, which say nothing about
// how often it renders. A memo is exactly the kind of thing that regresses
// silently: inline the call again and every assertion in that file still passes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentPreview } from "./document-preview";
import type { ProjectDocument } from "./document-model";
import type { DocumentAsset } from "./document-asset";
import { emptyWorkspace } from "./workspace";
import { renderDocumentHtml } from "./doc-render-html";
import { hashBytes } from "./document-asset-upload";
import { useDocumentAssets } from "./use-document-assets";
import { expectRowUniqueNames } from "../test/row-unique-names";

vi.mock("./document-assets-store", () => ({
  loadAssetData: vi.fn(), saveAssetData: vi.fn(), deleteAssetData: vi.fn(), loadAssetDataIds: vi.fn(),
}));
import { loadAssetData, saveAssetData, loadAssetDataIds } from "./document-assets-store";

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

// ★★★ THE OUTCOME §212 ADVERTISED AND DID NOT DELIVER. The commit message, the
// CHANGELOG entry and the hook's own header all said a repaired asset makes an
// image ALREADY PLACED in a document start rendering. It did not: the effect
// that resolves `<img data-asset-id>` to a blob URL is keyed on `html` and
// `documentAssets`, and a repair writes NO metadata — so nothing re-ran, and
// the placed image kept the missing marker while the library row beside it (the
// SAME pane) went healthy.
//
// ★★ THIS COMPOSES THE HOOK AND THE PREVIEW ON PURPOSE. Either half passes
// alone: the hook's own suite proves the second `saveAssetData` call, and this
// file's other tests prove the preview resolves what it is given. The defect
// lives in the SEAM, which is the one place neither of them looks.
describe("DocumentPreview + useDocumentAssets — a repair reaches a placed image", () => {
  const TURSO = { httpUrl: "https://db.turso.io", authToken: "t" } as never;

  // 4x3 px of PNG header. Below the downscale target, so `processUpload` stores
  // the source bytes untouched and the re-upload's hash is bit-identical to the
  // seeded row's by construction — which is what makes it a §212 repair rather
  // than a new asset.
  const PNG = new Uint8Array(24);
  PNG.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(PNG.buffer).setUint32(16, 4);
  new DataView(PNG.buffer).setUint32(20, 3);

  function Harness({ seed }: { seed: readonly DocumentAsset[] }) {
    const [assets, setAssets] = useState<readonly DocumentAsset[] | undefined>(seed);
    const api = useDocumentAssets({ config: TURSO, assets: assets ?? [], setAssets, projectId: "p1" });
    return (
      <>
        {/* ★ A button, not a ref assigned during render: a render-body write is
            the react-hooks purity rule this repo lints as fatal, and clicking is
            also how the real asset library reaches `upload`. */}
        <button onClick={() => { void api.upload(new File([PNG.buffer as ArrayBuffer], "chart.png", { type: "image/png" })); }}>
          re-upload
        </button>
        <span data-testid="dangling">{api.danglingIds.has("a1") ? "dangling" : "healthy"}</span>
        <DocumentPreview
          lang="en-US" doc={{ id: 1, title: "Steering update", blocks: [], createdAt: NOW, updatedAt: NOW }}
          ws={{ ...emptyWorkspace(), documentAssets: assets }} tursoConfig={TURSO} projectId="p1"
        />
      </>
    );
  }

  beforeEach(() => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:repaired"), revokeObjectURL: vi.fn() });
    vi.mocked(renderDocumentHtml).mockReturnValue('<p><img data-asset-id="a1" alt="chart"></p>');
    vi.mocked(loadAssetDataIds).mockReset().mockResolvedValue([]);
    vi.mocked(saveAssetData).mockReset().mockResolvedValue(undefined);
    vi.mocked(loadAssetData).mockReset().mockResolvedValue(null);
  });

  // ★ Restores the file-wide default rather than relying on describe ORDER —
  // `npm run test:shuffle` (a blocking gate) shuffles tests WITHIN a file.
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(renderDocumentHtml).mockReturnValue("<p>body</p>");
  });

  it("re-resolves the placed image once the dangling row's bytes are repaired", async () => {
    const seed: DocumentAsset[] = [{
      id: "a1", name: "chart.png", mime: "image/png", size: PNG.length,
      hash: await hashBytes(PNG), createdAt: NOW,
    }];
    render(<Harness seed={seed} />);

    // The starting state the user actually sees: library row dangling, and the
    // image already placed in the document rendered as a broken-asset marker.
    await waitFor(() => expect(screen.getByTestId("dangling")).toHaveTextContent("dangling"));
    const img = document.querySelector("img[data-asset-id='a1']")!;
    await waitFor(() => expect(img.getAttribute("data-asset-missing")).toBe("true"));
    expect(img.hasAttribute("src")).toBe(false);

    // The repair: the byte write now succeeds, so the bytes are readable too.
    vi.mocked(loadAssetData).mockResolvedValue("QUJD");
    await userEvent.click(screen.getByRole("button", { name: "re-upload" }));

    await waitFor(() => expect(saveAssetData).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("dangling")).toHaveTextContent("healthy"));

    // ★★★ THE ASSERTION THE ADVERTISED FLOW NEEDS. No metadata was written, so
    // `documentAssets` still holds the SAME array and `html` is unchanged —
    // nothing but the repair signal can have re-run the resolve effect.
    await waitFor(() => expect(img.getAttribute("src")).toBe("blob:repaired"));
    expect(img.hasAttribute("data-asset-missing")).toBe(false);
  });

  // ★★★ THE ROOT CAUSE UNDER §212's SYMPTOM, AND IT IS NOT ABOUT REPAIRS AT
  // ALL. React 19 diffs host props by identity, `dangerouslySetInnerHTML`
  // included, so an inline `{{ __html: html }}` made React re-assign
  // `innerHTML` on EVERY re-render — discarding every `src` the effect had
  // written, while the effect's own deps were unchanged and so never re-ran.
  // A rename keystroke or any parent render blanked every image in the pane
  // permanently. Mutation surface: inline the object again and this goes red.
  it("keeps a resolved image across an unrelated re-render", async () => {
    vi.mocked(loadAssetData).mockResolvedValue("QUJD");
    const d: ProjectDocument = { id: 1, title: "Steering update", blocks: [], createdAt: NOW, updatedAt: NOW };
    const { rerender } = render(
      <DocumentPreview lang="en-US" doc={d} ws={emptyWorkspace()} tursoConfig={TURSO} projectId="p1" />,
    );
    const img = document.querySelector("img[data-asset-id='a1']")!;
    await waitFor(() => expect(img.getAttribute("src")).toBe("blob:repaired"));

    // A FRESH `ws` object with identical content: the memo recomputes and the
    // HTML string is byte-identical, so nothing about the document changed and
    // the effect correctly does not re-run. The DOM must survive that.
    rerender(<DocumentPreview lang="en-US" doc={d} ws={emptyWorkspace()} tursoConfig={TURSO} projectId="p1" />);

    expect(document.querySelector("img[data-asset-id='a1']")).toBe(img);
    expect(img.getAttribute("src")).toBe("blob:repaired");
  });

  // ★★★ FILE MODE AND SAFE MODE ARE NOT THE MISSING CASE. `tursoConfig` null
  // means asset storage is OFF; `loadAssetData(null, …)` throws
  // `StorageNotReadyError` at once and `attachAssetImages` swallows it per id,
  // so every image here used to be stamped `data-asset-missing` — the dashed
  // red frame telling the reader their picture is gone. The history modal
  // carries the identical bail; these two must not drift.
  // ★★ `loadAssetData` is MOCKED and resolves happily, so the marker is NOT
  // what discriminates here — the mock cannot produce the real throw. The
  // load-bearing assertion is that the loader is never REACHED.
  it("does not reach the byte store when asset storage is off", async () => {
    vi.mocked(loadAssetData).mockResolvedValue("QUJD");
    const d: ProjectDocument = { id: 1, title: "Steering update", blocks: [], createdAt: NOW, updatedAt: NOW };
    render(<DocumentPreview lang="en-US" doc={d} ws={emptyWorkspace()} tursoConfig={null} projectId="p1" />);

    const img = document.querySelector("img[data-asset-id='a1']")!;
    await waitFor(() => expect(img).toBeTruthy());
    expect(loadAssetData).not.toHaveBeenCalled();
    expect(img.hasAttribute("data-asset-missing")).toBe(false);
    expect(img.hasAttribute("src")).toBe(false);
  });
});

// ★★★ THE SECOND ENTRY POINT INTO THE LIGHTBOX, AND WHY IT CANNOT BE A REACT
// `onClick`. The preview body is ONE `dangerouslySetInnerHTML` string, so the
// `<img data-asset-id>` nodes inside it are not React elements — there is
// nothing to hand a handler or a `tabIndex` to. Activation is DELEGATED from
// the container element, and the interactive attributes are stamped in the
// same imperative register `attachAssetImages` already writes `src` in.
//
// ★★ THE LIST THE LIGHTBOX WALKS IS THE CONTAINER'S IMAGES IN DOM ORDER — the
// document's visual order. A global asset ordering would make "next" jump to a
// picture that is not on the page the user clicked from.
describe("DocumentPreview — opening the lightbox from an inserted image", () => {
  // `as never` matches the sibling describe above: the component only forwards
  // this to the (mocked) byte store, so no real shape is needed. `typeof TURSO`
  // is therefore `never`, which is why the config parameter below reads oddly —
  // it accepts TURSO and `null` and nothing else.
  const TURSO = { httpUrl: "https://db.turso.io", authToken: "t" } as never;

  const asset = (id: string, name: string): DocumentAsset => ({
    id, name, mime: "image/png", size: 24, hash: `h-${id}`, createdAt: NOW,
  });

  const D: ProjectDocument = {
    id: 1, title: "Steering update", blocks: [], createdAt: NOW, updatedAt: NOW,
  };

  function renderPreview(assets: readonly DocumentAsset[], config: typeof TURSO | null = TURSO) {
    return render(
      <DocumentPreview
        lang="en-US" doc={D} ws={{ ...emptyWorkspace(), documentAssets: assets }}
        tursoConfig={config} projectId="p1"
      />,
    );
  }

  beforeEach(() => {
    vi.mocked(renderDocumentHtml).mockReturnValue(
      '<p><img data-asset-id="a1" alt="chart"><img data-asset-id="a2" alt="table"></p>',
    );
    // ★ Null bytes on every path, deliberately: the lightbox then reports
    // "unavailable" and NOTHING mints an object URL, so these tests need no
    // `URL` stubbing to assert WHICH image the lightbox opened on.
    vi.mocked(loadAssetData).mockReset().mockResolvedValue(null);
  });

  // Restores the file-wide default rather than relying on describe ORDER —
  // `npm run test:shuffle` is a blocking gate and shuffles within a file.
  afterEach(() => { vi.mocked(renderDocumentHtml).mockReturnValue("<p>body</p>"); });

  it("opens the lightbox on the image the user clicked", async () => {
    renderPreview([asset("a1", "chart.png"), asset("a2", "table.png")]);

    await userEvent.click(screen.getByRole("button", { name: "Preview image – table.png" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Preview – table.png" })).toBeInTheDocument();
    expect(within(dialog).getByText("2 of 2")).toBeInTheDocument();
  });

  it("steps through the images in the document's own visual order", async () => {
    // ★ The control that makes the previous test mean something: opening on the
    // FIRST image and stepping forward has to land on the image that follows it
    // IN THE DOCUMENT, which is what pins the list to the container's DOM order
    // rather than to `ws.documentAssets` (seeded here in the opposite order).
    renderPreview([asset("a2", "table.png"), asset("a1", "chart.png")]);

    await userEvent.click(screen.getByRole("button", { name: "Preview image – chart.png" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("1 of 2")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Next image" }));
    expect(within(dialog).getByRole("heading", { name: "Preview – table.png" })).toBeInTheDocument();
  });

  it("reaches an inserted image with Tab and opens it with Enter", async () => {
    // ★★★ `userEvent.tab()`, NEVER `.focus()`. `.focus()` succeeds on any
    // element a script points it at and so proves nothing about whether a
    // keyboard user can REACH the image; only a real Tab walk does. The
    // scrollable region (tabIndex={0}) is the first stop, the images follow.
    renderPreview([asset("a1", "chart.png"), asset("a2", "table.png")]);

    await userEvent.tab();
    expect(screen.getByRole("region", { name: "Steering update" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Preview image – chart.png" })).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    expect(within(await screen.findByRole("dialog")).getByText("1 of 2")).toBeInTheDocument();
  });

  it("opens an inserted image with Space too", async () => {
    // A `role="button"` announces itself as operable by BOTH keys; wiring only
    // Enter leaves a control that lies about what it accepts.
    renderPreview([asset("a1", "chart.png"), asset("a2", "table.png")]);

    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Preview image – table.png" })).toHaveFocus();

    await userEvent.keyboard(" ");
    expect(within(await screen.findByRole("dialog")).getByText("2 of 2")).toBeInTheDocument();
  });

  it("keeps two images of the SAME asset name distinct", () => {
    // ★★★ THE ONLY DETECTOR THAT CAN EXIST. axe carries no rule flagging two
    // controls that share an accessible name, in any view at any seed size, so
    // a green a11y gate says nothing here. Two images naming one asset is not
    // exotic — inserting the same picture twice reaches it immediately.
    renderPreview([asset("a1", "chart.png"), asset("a2", "chart.png")]);

    // Whole-document scope: the lightbox is closed (Modal renders null), so the
    // only controls on the page are the two images. `minControls` at exactly 2
    // is the measured value — a floor of 0 would let a broken query pass.
    expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true });
  });

  it("names the SAME asset inserted twice distinctly as well", () => {
    // ★★★ THE SINGLE-MEMBER TOKEN-MAP TRAP. `buildRowTokens` keys its output by
    // the row id, so keying on the ASSET id would collapse both occurrences of
    // one asset into a single map entry and emit a BARE token for both — a
    // collision no `documentAssets` fixture can produce. The tokens are keyed
    // by POSITION for exactly this case.
    vi.mocked(renderDocumentHtml).mockReturnValue(
      '<p><img data-asset-id="a1" alt="chart"><img data-asset-id="a1" alt="chart"></p>',
    );
    renderPreview([asset("a1", "chart.png")]);

    expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true });
  });

  it("falls back to the image's alt text when the asset has no metadata row", async () => {
    // A byte row can outlive its metadata (an import that dropped the slice).
    // The label still has to say WHICH picture, so it falls through to the alt
    // the insert path wrote — never to a bare uuid.
    renderPreview([]);

    await userEvent.click(screen.getByRole("button", { name: "Preview image – table" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("makes no image interactive when asset storage is off", () => {
    // ★★ The same bail the resolve effect carries: a null config means asset
    // storage is OFF, so no byte can ever load and an affordance promising a
    // lightbox would be a lie. Mirrors "does not reach the byte store" above.
    renderPreview([asset("a1", "chart.png")], null);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const img = document.querySelector("img[data-asset-id='a1']")!;
    expect(img.hasAttribute("tabindex")).toBe(false);
  });
});
