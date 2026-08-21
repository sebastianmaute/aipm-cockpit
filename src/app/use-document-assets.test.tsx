import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDocumentAssets } from "./use-document-assets";
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
function pngBytes(): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(b.buffer).setUint32(16, 4);
  new DataView(b.buffer).setUint32(20, 3);
  return b;
}

function pngFile(name = "chart.png"): File {
  // ★ `BlobPart` wants an `ArrayBufferView<ArrayBuffer>`; the DOM lib types
  // `Uint8Array` as generic over `ArrayBufferLike` (which also admits
  // `SharedArrayBuffer`), so a bare `Uint8Array` fails tsc here even though
  // `pngBytes()` always allocates a real, non-shared `ArrayBuffer`.
  return new File([pngBytes().buffer as ArrayBuffer], name, { type: "image/png" });
}

async function knownHash(): Promise<string> {
  return hashBytes(pngBytes());
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
    const setAssets = vi.fn();
    vi.mocked(saveAssetData).mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useDocumentAssets({ config, assets: [], setAssets, projectId: "p1" }));
    await act(async () => { await result.current.upload(pngFile()); });

    // The row survives — that IS the dangling case, and it is visible and
    // repairable by re-uploading over the same id.
    expect(setAssets).toHaveBeenCalledTimes(1);
    expect(result.current.error).not.toBeNull();
  });

  it("reuses an existing asset instead of storing a duplicate", async () => {
    const setAssets = vi.fn();
    const existing: DocumentAsset[] = [
      { id: "a1", name: "x.png", mime: "image/png", size: 3, hash: await knownHash(), createdAt: "" },
    ];
    const { result } = renderHook(() => useDocumentAssets({ config, assets: existing, setAssets, projectId: "p1" }));
    await act(async () => { await result.current.upload(pngFile()); });

    expect(saveAssetData).not.toHaveBeenCalled();
    expect(setAssets).not.toHaveBeenCalled();
    expect(result.current.lastId).toBe("a1");
  });

  it("rejects a disallowed format without touching either store", async () => {
    const setAssets = vi.fn();
    const { result } = renderHook(() => useDocumentAssets({ config, assets: [], setAssets, projectId: "p1" }));
    await act(async () => { await result.current.upload(new File(["x"], "a.gif", { type: "image/gif" })); });

    expect(setAssets).not.toHaveBeenCalled();
    expect(saveAssetData).not.toHaveBeenCalled();
    expect(result.current.error).toBe("format");
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

describe("useDocumentAssets — rename and remove", () => {
  it("renames the matching asset and leaves the rest untouched", () => {
    const setAssets = vi.fn();
    const assets: DocumentAsset[] = [
      { id: "a1", name: "old.png", mime: "image/png", size: 1, hash: "h1", createdAt: "" },
      { id: "a2", name: "keep.png", mime: "image/png", size: 1, hash: "h2", createdAt: "" },
    ];
    const { result } = renderHook(() => useDocumentAssets({ config, assets, setAssets, projectId: "p1" }));
    act(() => { result.current.rename("a1", "new.png"); });

    expect(setAssets).toHaveBeenCalledWith([
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
    const setAssets = vi.fn();
    const assets: DocumentAsset[] = [
      { id: "a1", name: "x.png", mime: "image/png", size: 1, hash: "h1", createdAt: "" },
    ];
    const { result } = renderHook(() => useDocumentAssets({ config, assets, setAssets, projectId: "p1" }));
    act(() => { result.current.remove("a1"); });

    expect(setAssets).toHaveBeenCalledWith([]);
    await waitFor(() => expect(deleteAssetData).toHaveBeenCalledWith(config, "a1", "p1"));
  });

  it("swallows a byte-delete failure — the metadata removal already committed", async () => {
    const setAssets = vi.fn();
    vi.mocked(deleteAssetData).mockRejectedValue(new Error("network"));
    const assets: DocumentAsset[] = [
      { id: "a1", name: "x.png", mime: "image/png", size: 1, hash: "h1", createdAt: "" },
    ];
    const { result } = renderHook(() => useDocumentAssets({ config, assets, setAssets, projectId: "p1" }));
    act(() => { result.current.remove("a1"); });

    await waitFor(() => expect(deleteAssetData).toHaveBeenCalled());
    // No throw, no error surfaced from this direction.
    expect(result.current.error).toBeNull();
  });
});
