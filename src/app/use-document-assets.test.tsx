import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useDocumentAssets, encodeViaCanvas } from "./use-document-assets";
import { hashBytes } from "./document-asset-upload";
import type { DocumentAsset } from "./document-asset";

vi.mock("./document-assets-store", () => ({
  saveAssetData: vi.fn(), deleteAssetData: vi.fn(), loadAssetDataIds: vi.fn(),
}));
import { saveAssetData, deleteAssetData, loadAssetDataIds } from "./document-assets-store";

const config = { httpUrl: "https://db.turso.io", authToken: "t" } as never;

// A 24-byte PNG header — the same shape document-asset-upload.test.ts uses.
// At 4x3 pixels it never triggers a downscale (target size == source size,
// see targetSize's `Math.min(..., 1)` clamp), so `processUpload` never calls
// the injected canvas encoder and the "stored" bytes are exactly these bytes
// — which is what makes the hash in `knownHash()` predictable without a real
// canvas.
//
// ★ `width` is a parameter so two fixtures can differ in their BYTES, and
// therefore in their hash: `hash` is what the dedup compares, so two files
// that differ only in NAME are the same image as far as this hook is
// concerned. Every width used here stays far below the downscale threshold.
function pngBytes(width = 4): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, 3);
  return b;
}

function pngFile(name = "chart.png", width = 4): File {
  // ★ `BlobPart` wants an `ArrayBufferView<ArrayBuffer>`; the DOM lib types
  // `Uint8Array` as generic over `ArrayBufferLike` (which also admits
  // `SharedArrayBuffer`), so a bare `Uint8Array` fails tsc here even though
  // `pngBytes()` always allocates a real, non-shared `ArrayBuffer`.
  return new File([pngBytes(width).buffer as ArrayBuffer], name, { type: "image/png" });
}

async function knownHash(width = 4): Promise<string> {
  return hashBytes(pngBytes(width));
}

/** ★★★ A REAL `useState` HOST, NOT A `vi.fn()`.
 *
 *  The whole of the concurrency defect this file pins lives in the DIFFERENCE
 *  between `setAssets(array)` and `setAssets(updater)`. A `vi.fn()` records
 *  whichever one it was handed and applies NEITHER, so the two are
 *  indistinguishable through it — which is exactly why the pre-existing suite
 *  stayed green while three concurrent uploads dropped two metadata rows.
 *  Everything asserting on the resulting LIST must go through this host. The
 *  three `vi.fn()` uses left below assert call ORDER or call COUNT, which is
 *  all a spy can honestly witness. */
function useAssetsHost(seed: readonly DocumentAsset[] = [], cfg: unknown = config) {
  const [assets, setAssets] = useState<readonly DocumentAsset[] | undefined>(seed);
  const api = useDocumentAssets({
    config: cfg as never, assets: assets ?? [], setAssets, projectId: "p1",
  });
  return { ...api, assets: assets ?? [] };
}

beforeEach(() => {
  vi.mocked(saveAssetData).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteAssetData).mockReset().mockResolvedValue(undefined);
  vi.mocked(loadAssetDataIds).mockReset().mockResolvedValue([]);
});

describe("useDocumentAssets — write order", () => {
  // ★★★ METADATA FIRST, THEN BYTES. This is the ONE test that pins the decision
  //     that removes the whole orphan class. Inverting it means a failed upload
  //     leaves an invisible byte row nobody references, and a reclaim action
  //     would have to be built.
  it("commits the metadata row BEFORE writing the bytes", async () => {
    const order: string[] = [];
    const setAssets = vi.fn(() => { order.push("metadata"); });
    vi.mocked(saveAssetData).mockImplementation(async () => { order.push("bytes"); });

    const { result } = renderHook(() => useDocumentAssets({ config, assets: [], setAssets, projectId: "p1" }));
    await act(async () => { await result.current.upload(pngFile()); });

    expect(order).toEqual(["metadata", "bytes"]);
  });

  it("leaves the metadata row in place when the byte write fails", async () => {
    vi.mocked(saveAssetData).mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useAssetsHost([]));
    await act(async () => { await result.current.upload(pngFile()); });

    // The row survives — that IS the dangling case, and it is visible and
    // repairable by re-uploading over the same id.
    expect(result.current.assets).toHaveLength(1);
    expect(result.current.error).not.toBeNull();
  });

  it("still resolves to the asset when the byte write failed, so the insert is not silently dropped", async () => {
    vi.mocked(saveAssetData).mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useAssetsHost([]));
    let returned: DocumentAsset | null = null;
    await act(async () => { returned = await result.current.upload(pngFile("dangling.png")); });

    expect(returned).not.toBeNull();
    expect(returned!.name).toBe("dangling.png");
  });

  it("reuses an existing asset instead of storing a duplicate", async () => {
    const existing: DocumentAsset[] = [
      { id: "a1", name: "x.png", mime: "image/png", size: 3, hash: await knownHash(), createdAt: "" },
    ];
    const { result } = renderHook(() => useAssetsHost(existing));
    let returned: DocumentAsset | null = null;
    await act(async () => { returned = await result.current.upload(pngFile()); });

    expect(saveAssetData).not.toHaveBeenCalled();
    expect(result.current.assets).toHaveLength(1);
    // ★ The RETURNED row is what the paste/drop path inserts. Returning the
    //   existing asset is what makes "paste a screenshot already in the
    //   library" insert it instead of doing nothing.
    expect(returned!.id).toBe("a1");
  });

  it("rejects a disallowed format without touching either store", async () => {
    const setAssets = vi.fn();
    const { result } = renderHook(() => useDocumentAssets({ config, assets: [], setAssets, projectId: "p1" }));
    let returned: DocumentAsset | null = { id: "sentinel" } as DocumentAsset;
    await act(async () => {
      returned = await result.current.upload(new File(["x"], "a.gif", { type: "image/gif" }));
    });

    expect(setAssets).not.toHaveBeenCalled();
    expect(saveAssetData).not.toHaveBeenCalled();
    expect(result.current.error).toBe("format");
    // ★ null, not undefined — the caller branches on it to decide whether to
    //   insert anything at all.
    expect(returned).toBeNull();
  });

  it("reports which assets are dangling by diffing metadata against byte ids", async () => {
    vi.mocked(loadAssetDataIds).mockResolvedValue(["a1"]);
    const assets: DocumentAsset[] = [
      { id: "a1", name: "x", mime: "image/png", size: 1, hash: "h1", createdAt: "" },
      { id: "a2", name: "y", mime: "image/png", size: 1, hash: "h2", createdAt: "" },
    ];
    const { result } = renderHook(() => useDocumentAssets({ config, assets, setAssets: vi.fn(), projectId: "p1" }));
    await waitFor(() => expect(result.current.danglingIds.has("a2")).toBe(true));
    expect(result.current.danglingIds.has("a1")).toBe(false);
  });

  it("does not diff against the byte store when Turso is not configured", async () => {
    const assets: DocumentAsset[] = [
      { id: "a1", name: "x", mime: "image/png", size: 1, hash: "h1", createdAt: "" },
    ];
    renderHook(() => useDocumentAssets({ config: null, assets, setAssets: vi.fn(), projectId: "p1" }));
    await Promise.resolve();
    expect(loadAssetDataIds).not.toHaveBeenCalled();
  });
});

// ★★★ THE "N SAVES IN ONE TICK" LANDMINE (AGENTS.md, per-entity CRUD hooks).
// All three production fan-out sites — asset-library.tsx's drop handler and
// documents-asset-section.tsx's paste + drop — call `upload` N times out of ONE
// render, so all N share a single closure. These tests are the only thing that
// can see the difference, and they only can because the host above applies the
// writes for real.
describe("useDocumentAssets — concurrent uploads compose", () => {
  it("keeps EVERY metadata row when several distinct files upload in one tick", async () => {
    const { result } = renderHook(() => useAssetsHost([]));
    const { upload } = result.current;

    await act(async () => {
      await Promise.all([
        upload(pngFile("a.png", 4)),
        upload(pngFile("b.png", 5)),
        upload(pngFile("c.png", 6)),
      ]);
    });

    // ★ Sorted, so the assertion pins SURVIVAL rather than completion order —
    //   the bug drops rows, it does not reorder them.
    expect([...result.current.assets].map((a) => a.name).sort()).toEqual(["a.png", "b.png", "c.png"]);
    // Every surviving row's bytes were written too — a dropped row here is
    // precisely the orphan-byte state the metadata-first ordering prevents.
    expect(saveAssetData).toHaveBeenCalledTimes(3);
  });

  it("mints ONE row when the same image is uploaded twice in one tick", async () => {
    const { result } = renderHook(() => useAssetsHost([]));
    const { upload } = result.current;

    let both: (DocumentAsset | null)[] = [];
    await act(async () => {
      both = await Promise.all([upload(pngFile("same.png")), upload(pngFile("same-copy.png"))]);
    });

    // The second read must see the FIRST upload's committed row — a stale
    // closure here mints a second id for one image and writes its bytes twice.
    expect(result.current.assets).toHaveLength(1);
    expect(both[0]!.id).toBe(both[1]!.id);
    expect(saveAssetData).toHaveBeenCalledTimes(1);
  });

  it("does not lose a concurrently uploaded row to a rename landing in the same tick", async () => {
    const seeded: DocumentAsset[] = [
      { id: "seed", name: "old.png", mime: "image/png", size: 1, hash: "h-seed", createdAt: "" },
    ];
    const { result } = renderHook(() => useAssetsHost(seeded));
    const { upload, rename } = result.current;

    await act(async () => {
      const p = upload(pngFile("new.png"));
      rename("seed", "renamed.png");
      await p;
    });

    const byId = Object.fromEntries(result.current.assets.map((a) => [a.id, a.name]));
    expect(byId["seed"]).toBe("renamed.png");
    expect(Object.values(byId)).toContain("new.png");
  });
});

describe("useDocumentAssets — rename and remove", () => {
  it("renames the matching asset and leaves the rest untouched", async () => {
    const assets: DocumentAsset[] = [
      { id: "a1", name: "old.png", mime: "image/png", size: 1, hash: "h1", createdAt: "" },
      { id: "a2", name: "keep.png", mime: "image/png", size: 1, hash: "h2", createdAt: "" },
    ];
    const { result } = renderHook(() => useAssetsHost(assets));
    act(() => { result.current.rename("a1", "new.png"); });

    expect(result.current.assets).toEqual([
      { id: "a1", name: "new.png", mime: "image/png", size: 1, hash: "h1", createdAt: "" },
      { id: "a2", name: "keep.png", mime: "image/png", size: 1, hash: "h2", createdAt: "" },
    ]);
  });

  it("is a no-op for an id that is not in the list", () => {
    const setAssets = vi.fn();
    const { result } = renderHook(() => useDocumentAssets({ config, assets: [], setAssets, projectId: "p1" }));
    act(() => { result.current.rename("missing", "new.png"); });
    expect(setAssets).not.toHaveBeenCalled();
  });

  it("removes the asset from metadata and best-effort deletes its bytes", async () => {
    const assets: DocumentAsset[] = [
      { id: "a1", name: "x.png", mime: "image/png", size: 1, hash: "h1", createdAt: "" },
    ];
    const { result } = renderHook(() => useAssetsHost(assets));
    act(() => { result.current.remove("a1"); });

    expect(result.current.assets).toEqual([]);
    await waitFor(() => expect(deleteAssetData).toHaveBeenCalledWith(config, "a1", "p1"));
  });

  it("swallows a byte-delete failure — the metadata removal already committed", async () => {
    vi.mocked(deleteAssetData).mockRejectedValue(new Error("network"));
    const assets: DocumentAsset[] = [
      { id: "a1", name: "x.png", mime: "image/png", size: 1, hash: "h1", createdAt: "" },
    ];
    const { result } = renderHook(() => useAssetsHost(assets));
    act(() => { result.current.remove("a1"); });

    await waitFor(() => expect(deleteAssetData).toHaveBeenCalled());
    // No throw, no error surfaced from this direction.
    expect(result.current.error).toBeNull();
  });
});

// ★★ jsdom has no canvas, so every piece of the browser step is stubbed. The
// point is narrow: which mime the returned EncodedImage carries.
describe("encodeViaCanvas", () => {
  function stubCanvas(producedType: string) {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 2, height: 2 })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback) => {
      cb(new Blob([new Uint8Array([1, 2, 3]).buffer as ArrayBuffer], { type: producedType }));
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ★★★ `canvas.toBlob` falls back to image/png SILENTLY for a type it cannot
  //     encode, and image/png is itself allow-listed downstream — so a row that
  //     records the REQUESTED mime passes every later check while describing
  //     bytes that are not what it says they are, and the export sink emits a
  //     `data:` URI with the wrong media type.
  it("records the mime the blob ACTUALLY is, not the one requested", async () => {
    stubCanvas("image/png");
    const out = await encodeViaCanvas(new Uint8Array([9]), "image/webp", { width: 2, height: 2 });
    expect(out.mime).toBe("image/png");
  });

  it("falls back to the requested mime when the blob reports no type at all", async () => {
    stubCanvas("");
    const out = await encodeViaCanvas(new Uint8Array([9]), "image/webp", { width: 2, height: 2 });
    expect(out.mime).toBe("image/webp");
  });
});
