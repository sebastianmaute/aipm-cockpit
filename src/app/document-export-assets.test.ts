import { describe, it, expect, vi } from "vitest";
import {
  documentAssetIds, loadExportAssets, EXPORT_INLINE_BUDGET_BYTES,
} from "./document-export-assets";
import type { ProjectDocument } from "./document-model";

const doc = (html: string[]): ProjectDocument => ({
  id: 1,
  title: "d",
  blocks: html.map((h) => ({ type: "paragraph", html: h })),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

/** `n` KiB of bytes as base64 — length drives the budget arithmetic. */
const b64OfBytes = (n: number) => "A".repeat(Math.ceil((n * 4) / 3));

describe("documentAssetIds", () => {
  it("collects ids in document order, without duplicates", () => {
    const d = doc([
      `<p><img data-asset-id="b" alt=""><img data-asset-id="a" alt=""></p>`,
      `<p><img data-asset-id="b" alt=""></p>`,
    ]);
    expect(documentAssetIds(d)).toEqual(["b", "a"]);
  });

  it("ignores non-paragraph blocks", () => {
    const d: ProjectDocument = {
      ...doc([]),
      blocks: [{ type: "heading", level: 1, text: `<img data-asset-id="x">` }],
    };
    expect(documentAssetIds(d)).toEqual([]);
  });
});

describe("loadExportAssets", () => {
  it("does not touch the byte store for a document with no images", async () => {
    const load = vi.fn();
    const out = await loadExportAssets(doc([`<p>plain</p>`]), load);
    expect(load).not.toHaveBeenCalled();
    expect(out.inlined).toEqual({});
  });

  it("inlines what fits and classifies a null row as missing, not omitted", async () => {
    const load = vi.fn(async (id: string) => (id === "gone" ? null : b64OfBytes(10)));
    const out = await loadExportAssets(
      doc([`<p><img data-asset-id="ok"><img data-asset-id="gone"></p>`]),
      load,
    );
    expect(Object.keys(out.inlined)).toEqual(["ok"]);
    expect([...out.missing]).toEqual(["gone"]);
    expect([...out.omitted]).toEqual([]);
  });

  it("classifies a REJECTED load as missing rather than failing the export", async () => {
    const load = vi.fn(async () => { throw new Error("network"); });
    const out = await loadExportAssets(doc([`<p><img data-asset-id="x"></p>`]), load);
    expect([...out.missing]).toEqual(["x"]);
    expect(out.inlined).toEqual({});
  });

  it("omits past the budget, in document order, and keeps inlining nothing after", async () => {
    // Budget 100 bytes. Three 60-byte images: first fits, the rest do not.
    const load = vi.fn(async () => b64OfBytes(60));
    const out = await loadExportAssets(
      doc([`<p><img data-asset-id="a"><img data-asset-id="b"><img data-asset-id="c"></p>`]),
      load,
      100,
    );
    expect(Object.keys(out.inlined)).toEqual(["a"]);
    expect([...out.omitted].sort()).toEqual(["b", "c"]);
    expect([...out.missing]).toEqual([]);
  });

  it("has a budget expressed in bytes, not images", () => {
    expect(EXPORT_INLINE_BUDGET_BYTES).toBe(25 * 1024 * 1024);
  });
});
