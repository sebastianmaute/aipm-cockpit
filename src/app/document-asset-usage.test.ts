import { describe, it, expect } from "vitest";
import { assetIdsInDocument, assetRefsInDocument, countAssetUsage } from "./document-asset-usage";
import type { ProjectDocument } from "./document-model";

function doc(id: number, blocks: ProjectDocument["blocks"]): ProjectDocument {
  return { id, title: `Doc ${id}`, blocks, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

describe("assetIdsInDocument", () => {
  it("returns an empty set for a document with no image paragraphs", () => {
    expect(assetIdsInDocument(doc(1, [{ type: "heading", level: 1, text: "Hi" }])).size).toBe(0);
  });

  it("finds an asset id in a paragraph", () => {
    const d = doc(1, [{ type: "paragraph", html: '<img data-asset-id="a1" alt="x">' }]);
    expect(assetIdsInDocument(d)).toEqual(new Set(["a1"]));
  });

  it("dedupes the SAME id referenced twice in one document", () => {
    const d = doc(1, [
      { type: "paragraph", html: '<img data-asset-id="a1" alt="x">' },
      { type: "paragraph", html: '<p>text</p><img data-asset-id="a1" alt="y">' },
    ]);
    expect(assetIdsInDocument(d)).toEqual(new Set(["a1"]));
  });

  it("collects distinct ids across multiple blocks", () => {
    const d = doc(1, [
      { type: "paragraph", html: '<img data-asset-id="a1" alt="x">' },
      { type: "paragraph", html: '<img data-asset-id="a2" alt="y">' },
    ]);
    expect(assetIdsInDocument(d)).toEqual(new Set(["a1", "a2"]));
  });

  it("ignores non-paragraph blocks even if their text happens to contain the marker", () => {
    const d = doc(1, [{ type: "heading", level: 1, text: 'data-asset-id="a1"' }]);
    expect(assetIdsInDocument(d).size).toBe(0);
  });

  it("ignores an empty id attribute", () => {
    const d = doc(1, [{ type: "paragraph", html: '<img data-asset-id="" alt="x">' }]);
    expect(assetIdsInDocument(d).size).toBe(0);
  });
});

describe("countAssetUsage", () => {
  it("returns an empty record for no documents", () => {
    expect(countAssetUsage([])).toEqual({});
  });

  it("counts one document per id, not one per reference", () => {
    const docs = [
      doc(1, [{ type: "paragraph", html: '<img data-asset-id="a1"><img data-asset-id="a1">' }]),
    ];
    expect(countAssetUsage(docs)).toEqual({ a1: 1 });
  });

  it("counts across multiple documents", () => {
    const docs = [
      doc(1, [{ type: "paragraph", html: '<img data-asset-id="a1">' }]),
      doc(2, [{ type: "paragraph", html: '<img data-asset-id="a1">' }]),
      doc(3, [{ type: "paragraph", html: '<img data-asset-id="a2">' }]),
    ];
    expect(countAssetUsage(docs)).toEqual({ a1: 2, a2: 1 });
  });
});

describe("assetRefsInDocument", () => {
  const htmlDoc = (html: string[]): ProjectDocument =>
    doc(
      9,
      html.map((h) => ({ type: "paragraph" as const, html: h })),
    );

  it("counts an <img> reference in all THREE sets appropriately", () => {
    const refs = assetRefsInDocument(htmlDoc([`<img data-asset-id="a" alt="x">`]));
    expect([...refs.all]).toEqual(["a"]);
    expect([...refs.drawable]).toEqual(["a"]);
    expect([...refs.undrawable]).toEqual([]);
  });

  it("counts a <span> reference against the cap but NOT as drawable", () => {
    const refs = assetRefsInDocument(htmlDoc([`<span data-asset-id="b">label</span>`]));
    expect([...refs.all]).toEqual(["b"]);
    expect([...refs.drawable]).toEqual([]);
    expect([...refs.undrawable]).toEqual(["b"]);
  });

  it("separates the two when a document holds both", () => {
    const refs = assetRefsInDocument(
      htmlDoc([`<img data-asset-id="a">`, `<span data-asset-id="b">x</span>`]),
    );
    expect([...refs.all].sort()).toEqual(["a", "b"]);
    expect([...refs.drawable]).toEqual(["a"]);
    expect([...refs.undrawable]).toEqual(["b"]);
  });

  it("deduplicates a repeated id — the cap counts IMAGES, not references", () => {
    const refs = assetRefsInDocument(
      htmlDoc([`<img data-asset-id="a">`, `<img data-asset-id="a">`]),
    );
    expect([...refs.all]).toEqual(["a"]);
    expect([...refs.drawable]).toEqual(["a"]);
  });

  it("does not treat an id as undrawable merely because ANOTHER block draws it", () => {
    // The same id on a span AND an img: it IS drawable, so it must not appear
    // in `undrawable` and inflate the count the cap message reports.
    const refs = assetRefsInDocument(
      htmlDoc([`<span data-asset-id="a">x</span>`, `<img data-asset-id="a">`]),
    );
    expect([...refs.undrawable]).toEqual([]);
  });

  it("ignores non-paragraph blocks, matching both underlying scanners", () => {
    const d = doc(10, [{ type: "heading", level: 1, text: `<img data-asset-id="a">` }]);
    expect([...assetRefsInDocument(d).all]).toEqual([]);
  });

  it("keeps assetIdsInDocument returning exactly the `all` set", () => {
    const d = htmlDoc([`<img data-asset-id="a">`, `<span data-asset-id="b">x</span>`]);
    expect([...assetIdsInDocument(d)].sort()).toEqual([...assetRefsInDocument(d).all].sort());
  });
});
