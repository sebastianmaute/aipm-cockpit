import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
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
    // ★★ `loadAssetDataIds` must report a1's BYTES, or the diff effect marks the
    //    seeded row DANGLING and the upload becomes a §212 repair — which writes
    //    bytes and fails the assertion below. Measured, not reasoned: with the
    //    default `[]` this test passed only because the effect's async
    //    continuation had not landed by the time `upload` read the set; two
    //    flushed microtasks before the upload turned it red.
    vi.mocked(loadAssetDataIds).mockResolvedValue(["a1"]);
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

// ★★★ §212 — A DANGLING ROW MUST BE REPAIRABLE BY RE-UPLOADING THE SAME IMAGE.
// The two halves of this already existed and passed independently: a dangling
// case and a dedup case. Nothing ever uploaded the same file TWICE, which is
// the only shape that reaches the defect — `findDuplicate` matches on hash
// alone, so the failed row swallowed its own retry and the recovery path three
// comments in the hook described did not exist.
describe("useDocumentAssets — dangling retry (§212)", () => {
  it("re-writes the bytes over the SAME id when a dangling row is re-uploaded", async () => {
    vi.mocked(saveAssetData).mockRejectedValueOnce(new Error("network"));

    const { result } = renderHook(() => useAssetsHost([]));
    let first: DocumentAsset | null = null;
    await act(async () => { first = await result.current.upload(pngFile("chart.png")); });

    await waitFor(() => expect(result.current.danglingIds.has(first!.id)).toBe(true));
    expect(saveAssetData).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("storageWrite");

    let second: DocumentAsset | null = null;
    await act(async () => { second = await result.current.upload(pngFile("chart.png")); });

    // The retry writes the bytes AGAIN, under the id that is already placed in
    // whatever documents reference it — a fresh id would repair the library
    // and orphan every `<img data-asset-id>`.
    expect(saveAssetData).toHaveBeenCalledTimes(2);
    expect(saveAssetData).toHaveBeenLastCalledWith(
      config, expect.objectContaining({ id: first!.id, projectId: "p1" }),
    );
    expect(result.current.assets).toHaveLength(1);
    expect(result.current.assets[0]!.id).toBe(first!.id);
    expect(second!.id).toBe(first!.id);
    expect(result.current.error).toBeNull();

    // ★★★ `loadAssetDataIds` deliberately still returns [] here. The effect
    //     that builds `danglingIds` is keyed on `assets`, and a successful
    //     repair writes NO metadata — so it never runs again, and nothing but
    //     an explicit clear in the success path can take this id back out.
    //     Re-mocking the store would let a re-diff pass this for the hook.
    await waitFor(() => expect(result.current.danglingIds.has(first!.id)).toBe(false));

    // ...and the row is a healthy duplicate again, so a THIRD upload of the
    // same image short-circuits. A second observable for the same clear.
    await act(async () => { await result.current.upload(pngFile("chart.png")); });
    expect(saveAssetData).toHaveBeenCalledTimes(2);
  });

  it("still short-circuits a HEALTHY duplicate without touching the byte store", async () => {
    // ★ Without this, a "fix" that simply deletes the dedup branch — writing
    //   the bytes of every re-uploaded image over the existing row — passes
    //   the test above.
    vi.mocked(loadAssetDataIds).mockResolvedValue(["a1"]);
    const existing: DocumentAsset[] = [
      { id: "a1", name: "x.png", mime: "image/png", size: 24, hash: await knownHash(), createdAt: "" },
    ];
    const { result } = renderHook(() => useAssetsHost(existing));
    await waitFor(() => expect(loadAssetDataIds).toHaveBeenCalled());

    let returned: DocumentAsset | null = null;
    await act(async () => { returned = await result.current.upload(pngFile()); });

    expect(saveAssetData).not.toHaveBeenCalled();
    expect(result.current.assets).toHaveLength(1);
    expect(returned!.id).toBe("a1");
  });

  it("leaves the row dangling and reports the error when the retry fails too", async () => {
    vi.mocked(saveAssetData).mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useAssetsHost([]));
    let first: DocumentAsset | null = null;
    await act(async () => { first = await result.current.upload(pngFile("chart.png")); });
    await waitFor(() => expect(result.current.danglingIds.has(first!.id)).toBe(true));

    await act(async () => { await result.current.upload(pngFile("chart.png")); });

    expect(saveAssetData).toHaveBeenCalledTimes(2);
    expect(result.current.assets).toHaveLength(1);
    expect(result.current.error).toBe("storageWrite");
    expect(result.current.danglingIds.has(first!.id)).toBe(true);
  });

  it("marks the row busy for the retry write, exactly as for a first write", async () => {
    vi.mocked(saveAssetData).mockRejectedValueOnce(new Error("network"));

    const { result } = renderHook(() => useAssetsHost([]));
    let first: DocumentAsset | null = null;
    await act(async () => { first = await result.current.upload(pngFile("chart.png")); });
    await waitFor(() => expect(result.current.danglingIds.has(first!.id)).toBe(true));
    expect(result.current.busyId).toBeNull();

    // ★ A gate, not a resolved promise: `busyId` is set and cleared around the
    //   byte write with no render in between, so the only way to observe it is
    //   to hold the write open.
    let release!: () => void;
    vi.mocked(saveAssetData).mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );

    let pending!: Promise<DocumentAsset | null>;
    act(() => { pending = result.current.upload(pngFile("chart.png")); });
    await waitFor(() => expect(saveAssetData).toHaveBeenCalledTimes(2));

    expect(result.current.busyId).toBe(first!.id);
    await act(async () => { release(); await pending; });
    expect(result.current.busyId).toBeNull();
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

// ★★★ THE TWO WRITE-PATH GUARDS INSIDE `commitDangling`, WHICH A COLD REVIEW
// FOUND BOTH SURVIVING 20/20 MUTANTS. Neither is visible through the §212
// tests above: those assert WHAT the set contains, and both of these guards
// are about what happens when the set does NOT change and about WHEN the
// change becomes readable. Each test below is the minimal input that can tell
// the guarded code from the unguarded code.
describe("useDocumentAssets — commitDangling's two guards", () => {
  /** Counts how often a consumer effect keyed on `danglingIds` re-runs.
   *  `seen` is created ONCE per test and passed in, never minted inside the
   *  render callback — a fresh identity each render would re-run the effect
   *  every render and measure nothing. */
  function useDanglingWatchHost(seen: () => void) {
    // ★★ `config: null` ON PURPOSE. The diff effect is the OTHER writer of
    //    `danglingIds`, and it is armed by the metadata commit — i.e. BEFORE
    //    the byte write whose success path this test is about — so leaving it
    //    live makes the count race `saveAssetData`. The hook's own
    //    `if (!config) return` short-circuits it, leaving `commitDangling` as
    //    the only writer and the count deterministic.
    const [assets, setAssets] = useState<readonly DocumentAsset[] | undefined>([]);
    const api = useDocumentAssets({
      config: null as never, assets: assets ?? [], setAssets, projectId: "p1",
    });
    const { danglingIds } = api;
    useEffect(() => { seen(); }, [danglingIds, seen]);
    return api;
  }

  it("does not disturb consumers when the clear has nothing to remove", async () => {
    // MUTANT D: delete `if (!prev.has(asset.id)) return prev;` and this reads 2.
    // A first-time upload's success path ALWAYS runs the clear, and its id was
    // never dangling — so without the bail-out every upload in the app hands
    // every `danglingIds` consumer a fresh, content-identical Set.
    const seen = vi.fn();
    const { result } = renderHook(() => useDanglingWatchHost(seen));
    expect(seen).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.upload(pngFile("fresh.png")); });

    expect(saveAssetData).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("lets a repair's clear be seen by a SECOND upload in the same tick", async () => {
    // MUTANT E: delete `danglingRef.current = fn(danglingRef.current);` from
    // `commitDangling` — the entire reason that function exists rather than a
    // bare `setDanglingIds` — and this reads 3.
    //
    // ★★★ THE THIRD UPLOAD MUST SHARE THE REPAIR'S `act()`. The §212 block's
    // own third upload sits in its own `act()`, which flushes the state update
    // and lets the `danglingIds` -> `danglingRef` sync EFFECT refill the mirror
    // — so the mirror write-through is never the thing under test there and
    // the mutant walks. Inside one `act()` the effect has not run, so the
    // mirror is the ONLY record that the row went healthy. This is the
    // production fan-out shape the file header names: N uploads out of ONE
    // render, all sharing one closure.
    vi.mocked(saveAssetData).mockRejectedValueOnce(new Error("network"));

    const { result } = renderHook(() => useAssetsHost([]));
    let first: DocumentAsset | null = null;
    await act(async () => { first = await result.current.upload(pngFile("chart.png")); });
    await waitFor(() => expect(result.current.danglingIds.has(first!.id)).toBe(true));
    expect(saveAssetData).toHaveBeenCalledTimes(1);

    const { upload } = result.current;
    await act(async () => {
      await upload(pngFile("chart.png"));   // the repair: writes bytes, clears the mirror
      await upload(pngFile("chart.png"));   // must read the CLEARED mirror and short-circuit
    });

    // 1 failed write + 1 repair. A third call means the second upload still
    // saw a dangling row and re-wrote bytes that were already there.
    expect(saveAssetData).toHaveBeenCalledTimes(2);
    expect(result.current.assets).toHaveLength(1);
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

  // ★★ `documentAssets` counts toward `workspaceRecordCount`, so a burst of
  // removes inside ONE save-debounce window reads as a Layer-B mass deletion
  // and the save is REFUSED unless the one-shot bypass was armed.
  // ★★★ THAT WINDOW IS 500ms, NOT A SECOND. This comment used to say an
  // "ordinary click-per-second burst coalesces — this is not a 500ms-reflex
  // edge case", and `SAVE_DEBOUNCE_MS` (debounced-save.ts) refutes it: the
  // debounce is TRAILING at 500ms, so a click at t=0 has already fired its save
  // when a click at t=1000 arrives. Changes must be closer together than 500ms
  // to coalesce. The arming is still justified — the AI `delete_document` route
  // lands several mutations in ONE TICK, which always coalesces.
  it("arms allowDestructiveSave exactly once per remove", () => {
    const allowDestructiveSave = vi.fn();
    const assets: DocumentAsset[] = [
      { id: "a1", name: "x.png", mime: "image/png", size: 1, hash: "h1", createdAt: "" },
    ];
    const setAssets = vi.fn();
    const { result } = renderHook(() =>
      useDocumentAssets({ config, assets, setAssets, projectId: "p1", allowDestructiveSave }));
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    act(() => { result.current.remove("a1"); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  // ★★★ THE REF INDIRECTION IS THE POINT OF THIS ONE. The producer
  // (`use-storage-backend.ts`) re-creates its `allowDestructiveSave` arrow
  // every render, so it is NOT in `remove`'s dep list — `remove` reads a mirror
  // synced by an effect instead. A missing sync effect keeps this hook arming
  // the callback captured at MOUNT, which for a long-lived pane is a stale
  // closure over a torn-down storage hook.
  // ★★ WHAT ACTUALLY KILLS THAT MUTANT is `useRef(allowDestructiveSave)`, which
  // binds its INITIAL argument on the first render and ignores every later one.
  // Delete the sync effect and `.current` is pinned to `first` for the life of
  // the hook, so `expect(first).not.toHaveBeenCalled()` fails — regardless of
  // how often `remove` is re-minted.
  // ★★★ AN EARLIER REVISION OF THIS COMMENT CLAIMED THE OPPOSITE, and it is the
  // "comment asserting a guarantee the code does not provide" class: it said
  // `setAssets` is hoisted stable "precisely so `remove` does NOT re-mint here:
  // with an inline `vi.fn()` a fresh `commitAssets` would re-mint `remove` each
  // render and the test would pass with the sync effect deleted." MEASURED both
  // ways, not reasoned — sync effect deleted, once with the hoisted `setAssets`
  // and once with an inline `vi.fn()` in the render callback: the test is RED in
  // BOTH, for the `useRef` reason above. The test is sound; that justification
  // was not, and a false one reads as coverage and stops the next audit.
  // ★ So the hoisted `setAssets` is hygiene here, not the killer. Keep it — a
  // re-minting dep is noise in a test about a stale closure — but do not cite it
  // as what makes this mutant die.
  it("reads the LIVE bypass, not the one captured when `remove` was minted", () => {
    const first = vi.fn();
    const second = vi.fn();
    const assets: DocumentAsset[] = [
      { id: "a1", name: "x.png", mime: "image/png", size: 1, hash: "h1", createdAt: "" },
    ];
    const setAssets = vi.fn();
    const { result, rerender } = renderHook(
      ({ cb }: { cb: () => void }) =>
        useDocumentAssets({ config, assets, setAssets, projectId: "p1", allowDestructiveSave: cb }),
      { initialProps: { cb: first } },
    );
    rerender({ cb: second });
    act(() => { result.current.remove("a1"); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
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
