import { describe, it, expect } from "vitest";
import { assetIdsInDocument, assetRefsInDocument, countAssetUsage } from "./document-asset-usage";
import { sanitizeProjectDocuments } from "./document-model";
import { sanitizeDocumentRichFields } from "./document-rich-fields";
import { jsonToWorkspace } from "./workspace";
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
    // in `undrawable` and inflate the reclaimable room the cap message reports.
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

describe("the three asset-id patterns and what each deliberately does not see", () => {
  // ★★★ These three patterns are all correct and all different. This test is
  // the only place that states the differences together; without it, each is
  // documented only in its own file's docstring and a reader fixing one has no
  // way to see the other two. open-followups §218.
  //
  //   ASSET_ID_RE   (document-asset-usage.ts)   attribute on ANY element, double-quote only
  //   IMG_TAG_RE    (document-export-assets.ts) <img> tag, quote-aware, double-quote value
  //   ASSET_IMG_RE  (document-model.ts)         <img>, case-INSENSITIVE, ALL quoting styles
  //
  // ASSET_IMG_RE is not exported and yields no ids, so it is probed through
  // sanitizeProjectDocuments: a paragraph with no visible text survives load
  // only when that pattern matches.
  const oneParagraph = (html: string): ProjectDocument =>
    doc(11, [{ type: "paragraph", html }]);
  const survivesLoad = (html: string): boolean => {
    const [loaded] = sanitizeProjectDocuments([oneParagraph(html)]);
    return (loaded?.blocks ?? []).some((b) => b.type === "paragraph");
  };
  const counted = (html: string): boolean =>
    assetRefsInDocument(oneParagraph(html)).all.size > 0;
  const drawable = (html: string): boolean =>
    assetRefsInDocument(oneParagraph(html)).drawable.size > 0;

  it("a double-quoted <img> is seen by all three", () => {
    const html = `<img data-asset-id="a">`;
    expect({ survivesLoad: survivesLoad(html), counted: counted(html), drawable: drawable(html) })
      .toEqual({ survivesLoad: true, counted: true, drawable: true });
  });

  it("a <span> is counted but never drawable", () => {
    const html = `<span data-asset-id="b">x</span>`;
    expect({ counted: counted(html), drawable: drawable(html) })
      .toEqual({ counted: true, drawable: false });
  });

  it("a SINGLE-quoted <img> survives load but is invisible to the other two", () => {
    // ★★ This is the divergence that matters, and it is harmless ONLY because
    // of an ordering: DOMPurify normalises quoting before the counting and
    // export patterns ever run. The next describe block pins that ordering.
    const html = `<img data-asset-id='c'>`;
    expect({ survivesLoad: survivesLoad(html), counted: counted(html), drawable: drawable(html) })
      .toEqual({ survivesLoad: true, counted: false, drawable: false });
  });

  it("an UPPERCASE <IMG> survives load but is invisible to the other two", () => {
    const html = `<IMG DATA-ASSET-ID="d">`;
    expect({ survivesLoad: survivesLoad(html), counted: counted(html), drawable: drawable(html) })
      .toEqual({ survivesLoad: true, counted: false, drawable: false });
  });

  it("an EMPTY id is seen by none of them — including the load predicate", () => {
    // ★ The survivesLoad row here is what proves the other three rows are not
    // vacuous: the helper CAN return false, so a `true` above is a measurement.
    const html = `<img data-asset-id="">`;
    expect({ survivesLoad: survivesLoad(html), counted: counted(html), drawable: drawable(html) })
      .toEqual({ survivesLoad: false, counted: false, drawable: false });
  });
});

describe("the load path normalises quoting BEFORE anything counts references", () => {
  // ★★★ THIS PINS A CAUSE, NOT A CONSEQUENCE. ASSET_IMG_RE accepts
  // data-asset-id='x' and a bare unquoted value; ASSET_ID_RE and IMG_TAG_RE
  // both require a double-quoted value. That divergence is harmless ONLY
  // because every load path runs
  //   sanitizeProjectDocuments(raw).map(sanitizeDocumentRichFields)
  // and the second pass is DOMPurify, which re-serialises every attribute with
  // double quotes. Recompose those two the other way round -- or persist the
  // output of the structural pass alone -- and a single-quoted reference
  // survives load while being invisible to the cap AND to every export, with
  // no error anywhere. open-followups §218.
  //
  // Verified 2026-08-24 at all five load paths -- workspace.ts (JSON),
  // browser-backend.ts (IndexedDB), csv-codecs-config.ts,
  // markdown-codecs-core.ts and turso-schema.ts -- each composed in that order,
  // for `documents` and again for `documentVersions`.
  it("turns a single-quoted reference into one the cap and the export both see", () => {
    const raw = [doc(12, [{ type: "paragraph", html: `<img data-asset-id='c' alt='x'>` }])];

    const structuralOnly = sanitizeProjectDocuments(raw);
    expect(assetRefsInDocument(structuralOnly[0]).all.size).toBe(0); // the hazard

    const loaded = structuralOnly.map(sanitizeDocumentRichFields);
    const refs = assetRefsInDocument(loaded[0]);
    expect([...refs.all]).toEqual(["c"]); // the guarantee the ordering buys
    expect([...refs.drawable]).toEqual(["c"]);
  });

  // ★★★ THE CASE ABOVE COMPOSES THE TWO PASSES BY HAND, so what it pins is the
  // CONSEQUENCE of that composition — never that any real load path uses it.
  // Reverse the order inside `turso-schema.ts` or `csv-codecs-config.ts` and it
  // stays green. This one drives ONE real load path end to end instead.
  // `jsonToWorkspace` is the cheapest of the five to reach — a string in, a
  // Workspace out, no backend — and its `documents` branch IS the composition
  // under test.
  //
  // ★★ MUTATION-PROVED 2026-08-24, not assumed: deleting
  // `.map(sanitizeDocumentRichFields)` from that branch in `workspace.ts`
  // reddens THIS case (`[]` where `["c"]` was expected) while the hand-composed
  // case above stays green — which is the whole difference between the two.
  //
  // ★ It pins ONE of the ten compositions. The other four documents-side load
  // paths and all five documentVersions-side ones are still verified by
  // inspection alone; open-followups §218 says so in the same terms.
  it("holds through a REAL load path — jsonToWorkspace, end to end", () => {
    const raw = JSON.stringify({
      tasks: [],
      raid: [],
      documents: [doc(13, [{ type: "paragraph", html: `<img data-asset-id='c' alt='x'>` }])],
    });

    const [loaded] = jsonToWorkspace(raw).documents ?? [];
    expect(loaded).toBeDefined();

    const refs = assetRefsInDocument(loaded!);
    expect([...refs.all]).toEqual(["c"]);
    expect([...refs.drawable]).toEqual(["c"]);
  });
});

describe("what being ALREADY-SANITIZED does and does not buy this module", () => {
  // ★★★ THE MODULE HEADER USED TO CLAIM SANITISING WAS A GUARD HERE, AND IT IS
  // NOT. It said a literal `data-asset-id="…"` in TEXT content "would already
  // have been escaped on the way in — this module does not need to guard
  // against that itself". Measured false 2026-08-24 and pinned below: HTML
  // text-node serialisation escapes `&`, `<` and `>` and NEVER `"`, so a double
  // quote in text survives every pass untouched. These two cases exist so the
  // replacement claim in that header cannot rot back into the old one.
  const loadFully = (html: string): ProjectDocument =>
    sanitizeProjectDocuments([doc(21, [{ type: "paragraph", html }])]).map(
      sanitizeDocumentRichFields,
    )[0];

  it("does NOT escape a data-asset-id a user merely TYPED as prose", () => {
    // A user documenting this very app, or pasting HTML to talk about it.
    const loaded = loadFully(`<p>data-asset-id="hero"</p>`);
    const [block] = loaded.blocks;

    // ★ The positive observable: the text is still there verbatim AFTER a full
    //   load. Without this the id-set assertions below could pass because the
    //   block was dropped and something else supplied the ids.
    expect(block.type === "paragraph" && block.html).toContain(`data-asset-id="hero"`);

    const refs = assetRefsInDocument(loaded);
    // Counted against the 20-image cap, and folded into the reclaimable room the
    // cap message offers — for a string that is prose, not a reference at all.
    expect([...refs.all]).toEqual(["hero"]);
    expect([...refs.drawable]).toEqual([]);
    expect([...refs.undrawable]).toEqual(["hero"]);
  });

  it("lets a crafted alt put an id in `drawable` that is NOT in `all`", () => {
    // ★★★ `drawable` IS NOT A SUBSET OF `all`, and only this case shows it.
    // `htmlEscape` escapes `& < > "` but NOT `=`, and an asset NAME is free
    // text (rename), so `alt` can end in `data-asset-id=`. The naive
    // `ASSET_ID_RE` then pairs that trailing `=` with the REAL attribute's
    // opening quote; the quote-aware `IMG_TAG_RE` steps over the alt and finds
    // the real id.
    // The undercount is PRE-EXISTING (`assetIdsInDocument` always had these
    // semantics) — recorded as open-followups §231, not fixed here.
    const loaded = loadFully(`<img alt="data-asset-id=" data-asset-id="real">`);
    const [block] = loaded.blocks;
    expect(block.type === "paragraph" && block.html).toContain(`data-asset-id="real"`);

    const refs = assetRefsInDocument(loaded);
    expect([...refs.drawable]).toEqual(["real"]);
    expect(refs.all.has("real")).toBe(false);

    // ★★ THIS ONE PINS THE CONSTRUCTOR, NOT THIS FIXTURE. `undrawable` is BUILT
    // by filtering `all`, so it is constant-true for every input. It is kept
    // because the cap message's reclaimable-room arithmetic in
    // documents-asset-section subtracts one size from the other and would go
    // NEGATIVE if a later fix rebuilt `undrawable` from a second scan.
    expect([...refs.undrawable].every((id) => refs.all.has(id))).toBe(true);
  });
});
