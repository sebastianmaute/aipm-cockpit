// src/app/document-preview.test.tsx
//
// The preview had no test file of its own — it was covered only incidentally by
// documents-panel.test.tsx's region/heading assertions, which say nothing about
// how often it renders. A memo is exactly the kind of thing that regresses
// silently: inline the call again and every assertion in that file still passes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentPreview } from "./document-preview";
import type { ProjectDocument } from "./document-model";
import type { DocumentAsset } from "./document-asset";
import { emptyWorkspace } from "./workspace";
import { renderDocumentHtml } from "./doc-render-html";
import { hashBytes } from "./document-asset-upload";
import { useDocumentAssets } from "./use-document-assets";

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
