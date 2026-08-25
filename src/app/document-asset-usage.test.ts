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
  // ★★★ These three patterns are all correct and all different. All three now
  // live in document-asset-patterns.ts and its test asserts them against each
  // other DIRECTLY, as a table. open-followups §218/§209.
  //
  //   ANY_TAG_ASSET_ID_RE  attribute on ANY element, double-quote only
  //   IMG_TAG_ASSET_ID_RE           <img> tag, quote-aware, double-quote value
  //   ASSET_IMG_TEST_RE    <img>, case-INSENSITIVE, ALL quoting styles
  //
  // ★ This describe stays, and is NOT a duplicate of that table. It pins two
  // things the pattern-level table cannot reach, and BOTH are consequences
  // rather than pattern behaviour:
  //   - `survivesLoad` runs the third pattern through sanitizeProjectDocuments,
  //     so it pins what a LOAD does, not what the regex matches;
  //   - `counted`/`drawable` run through `assetRefsInDocument`, NOT the raw
  //     regexes, so they pin the CALLER's `.filter((id) => id.length > 0)`.
  // ★★ That second one is why `<img data-asset-id="">` asserts `counted: false`
  // here while the new table asserts the same input CAPTURES `[""]`. Both are
  // right and neither implies the other — delete this block and the empty-id
  // filter has no cover anywhere.
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
  // ★★★ THIS PINS A CAUSE, NOT A CONSEQUENCE. ASSET_IMG_TEST_RE accepts
  // data-asset-id='x' and a bare unquoted value; ANY_TAG_ASSET_ID_RE and IMG_TAG_ASSET_ID_RE
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
  // quote in text survives every pass untouched — that half is unchanged by
  // §231, which removed this module's DEPENDENCE on it rather than the fact.
  // The cases below exist so the header's claim cannot rot back into the old
  // one, in either direction.
  const loadFully = (html: string): ProjectDocument =>
    sanitizeProjectDocuments([doc(21, [{ type: "paragraph", html }])]).map(
      sanitizeDocumentRichFields,
    )[0];

  it("does NOT escape a data-asset-id a user merely TYPED as prose, and no longer counts it", () => {
    // A user documenting this very app, or pasting HTML to talk about it.
    const loaded = loadFully(`<p>data-asset-id="hero"</p>`);
    const [block] = loaded.blocks;

    // ★ The positive observable, and it is the half that did NOT change: HTML
    //   text-node serialisation escapes `&`, `<` and `>` and NEVER `"`, so the
    //   string survives a full load verbatim. Without this assertion the empty
    //   id sets below could pass because the block had been dropped.
    expect(block.type === "paragraph" && block.html).toContain(`data-asset-id="hero"`);

    // ★★ What CHANGED (open-followups §231): the scanner now requires a start
    //    tag, so prose spends no slot of the 20-image cap and contributes
    //    nothing to the reclaimable-room figure the cap message renders.
    const refs = assetRefsInDocument(loaded);
    expect([...refs.all]).toEqual([]);
    expect([...refs.drawable]).toEqual([]);
    expect([...refs.undrawable]).toEqual([]);
  });

  it("no longer lets a crafted alt hide the real id from `all`", () => {
    // ★★ `htmlEscape` escapes `& < > "` but NOT `=`, and an asset NAME is free
    //    text (rename), so `alt` can end in `data-asset-id=`. The OLD scanner
    //    paired that trailing `=` with the REAL attribute's opening quote and
    //    produced a phantom id while the real one went missing — an id that
    //    spends no cap slot and can be re-inserted, defeating dedup.
    //    open-followups §231, half two.
    const loaded = loadFully(`<img alt="data-asset-id=" data-asset-id="real">`);
    const [block] = loaded.blocks;
    expect(block.type === "paragraph" && block.html).toContain(`data-asset-id="real"`);

    const refs = assetRefsInDocument(loaded);
    expect([...refs.all]).toEqual(["real"]);
    expect([...refs.drawable]).toEqual(["real"]);
    expect([...refs.undrawable]).toEqual([]);
  });

  it("computes `undrawable` as `all` minus `drawable`, even when `drawable` holds an id `all` does not", () => {
    // ★★★ BOTH HALVES OF THE FIXTURE ARE LOAD-BEARING. This test asserted
    //     nothing for two INDEPENDENT reasons; restoring either makes it
    //     vacuous again while it goes on passing.
    //
    // ★★ ONE, the load path. Through `loadFully` the `<span>` is unwrapped and
    //    its attribute goes with it (measured: the stored html is
    //    `x<img data-asset-id="i">`), leaving `undrawable` EMPTY.
    //
    // ★★ TWO, the fixture. `undrawable` is BUILT by filtering `all`, so
    //    wherever `drawable ⊆ all` these expectations hold however the
    //    constructor is broken. The duplicate attribute is what makes
    //    `drawable` hold an id `all` does not — `all` = ["s","a"] against
    //    `drawable` = ["b"], the divergence the test below pins.
    //
    // ★★★ NAME THE MUTANT OR THE CLAIM CANNOT BE CHECKED. "Rebuilding
    //     `undrawable` from a second scan" has several readings and they do
    //     NOT behave alike, so this lists which ones this test answers for:
    //       · symmetric difference (`all\drawable` ∪ `drawable\all`) — the
    //         shape that drives the reclaimable-room arithmetic in
    //         documents-asset-section NEGATIVE. KILLED here; SURVIVES if the
    //         duplicate attribute is dropped. It is the reason for the fixture.
    //       · direction swap (`drawable\all`) — KILLED, with or without it.
    //       · whole-document re-scan, then subtract — EQUIVALENT BY
    //         CONSTRUCTION, not merely unkilled: it re-runs the same two
    //         scanners over the same blocks, so its output cannot differ for
    //         any input. Ran it: 29/29 green. Nothing to catch.
    //       · PER-BLOCK re-scan — a genuine regression this test does NOT
    //         catch, and deliberately: an id spanned in one block and drawn in
    //         another is only visible across blocks. Ran it: it reddens "does
    //         not treat an id as undrawable merely because ANOTHER block draws
    //         it" and nothing else, which is the test that owns that shape. Do
    //         not widen this fixture to chase it.
    const raw: ProjectDocument = doc(97, [
      {
        type: "paragraph",
        html: `<span data-asset-id="s">x</span><img data-asset-id="a" data-asset-id="b">`,
      },
    ]);
    const refs = assetRefsInDocument(raw);
    // ★★ ALL THREE SETS, and `all` is not decoration: a mutant narrowing `all`
    //    while building `undrawable` from its own scan yields all=[],
    //    drawable=["b"], undrawable=["s","a"] — the other two assertions PASS.
    //    The `AssetRefs` note tells callers the subset relationship follows
    //    from this test, and it only follows if `all` is pinned too.
    expect([...refs.all]).toEqual(["s", "a"]);
    expect([...refs.undrawable]).toEqual(["s", "a"]);
    expect([...refs.drawable]).toEqual(["b"]);
  });

  it("finds BOTH ids when one paragraph holds two images and the first has a crafted alt", () => {
    // ★★★ ORDER ALONE WAS NEVER THE PROTECTION. The old scanner crossed `<img>`
    //     boundaries WITHIN a block: it paired the first tag's alt with the
    //     SECOND tag's markup and yielded `["r1", "><img data-asset-id="]`, so
    //     the second real image was invisible to the cap entirely.
    //
    // ★ WHY `loadFully` HERE while its neighbours scan raw: measured, the
    //   loaded html is byte-identical to the input, so the load changes no
    //   observable — what it buys is proof the fixture is REACHABLE post-load,
    //   which the two raw-scanning tests below cannot claim of theirs.
    const loaded = loadFully(
      `<img data-asset-id="r1" alt="data-asset-id="><img data-asset-id="r2" alt="x">`,
    );
    const refs = assetRefsInDocument(loaded);
    expect([...refs.all].sort()).toEqual(["r1", "r2"]);
    expect([...refs.drawable].sort()).toEqual(["r1", "r2"]);
  });

  it("does not count the attribute spelled without a space after the tag name", () => {
    // ★ The THIRD behaviour change, beyond §231's two halves, pinned so it is
    //   not latent: `<imgdata-asset-id="x">` is malformed HTML (the tag name
    //   swallows the attribute) and used to count. It cannot survive the load
    //   path either, so this asserts the SCANNER directly rather than through
    //   loadFully — which is the only way to observe it.
    //
    // ★★ THE DISCRIMINATOR IS THE `\b`, NOT THE TAG NAME. The tag-name class
    //    happily eats `mgdata-asset-id=`; what rejects this is the word
    //    boundary before `data-asset-id`, with a word character on each side.
    //    Measured: remove the `\b` and leave the anchor intact, and this
    //    matches again. So this test guards the `\b`, and a reader "tidying"
    //    the anchor will not learn that from the assertion alone.
    const raw: ProjectDocument = doc(99, [
      { type: "paragraph", html: `<imgdata-asset-id="x">` },
    ]);
    expect([...assetRefsInDocument(raw).all]).toEqual([]);
  });

  it("characterizes the duplicate-attribute divergence — `all` takes the FIRST, `drawable` the LAST", () => {
    // ★★★ A CHARACTERIZATION OF A KNOWN DIVERGENCE, NOT A DESIRED PROPERTY.
    //     It records what the two patterns currently do so a change to either
    //     cannot widen the gap silently. §231 closed the crafted-`alt` half of
    //     the non-subset problem; THIS is the half that stayed open. If a
    //     change makes the two agree this SHOULD go red — delete it and the
    //     `AssetRefs` note citing it, never re-fit the expectations.
    //
    // ★★ THE CAUSE IS THE QUANTIFIER. Their ALTERNATIONS are byte-identical;
    //    the QUANTIFIER is not — `ANY_TAG_ASSET_ID_RE` is LAZY (`*?`) so it stops at
    //    the FIRST occurrence, `IMG_TAG_ASSET_ID_RE` is GREEDY (`*`) and backtracks to
    //    the LAST. It is NOT the only difference between them, though, and
    //    believing so leads to the inference `TAG-AGNOSTIC ON PURPOSE` exists
    //    to prevent: they also differ in the tag anchor (`<[a-zA-Z][^\s/>"']*`
    //    here vs `<img\b` there — the §218 design), and `IMG_TAG_ASSET_ID_RE` carries a
    //    trailing alternation plus `>` with no counterpart. Measured: making
    //    this one greedy does NOT turn it into `IMG_TAG_ASSET_ID_RE` — a `<span>` still
    //    counts here and is still invisible there.
    //
    // ★★ SCANNED UN-LOADED ON PURPOSE. A full load collapses the duplicate to
    //    `data-asset-id="a"` (measured through the real two-pass composition),
    //    after which both sets agree and this would assert NOTHING. Routing it
    //    through `loadFully` makes it vacuous, not stricter.
    const raw: ProjectDocument = doc(98, [
      { type: "paragraph", html: `<img data-asset-id="a" data-asset-id="b">` },
    ]);
    const refs = assetRefsInDocument(raw);
    expect([...refs.all]).toEqual(["a"]);
    expect([...refs.drawable]).toEqual(["b"]);
    expect([...refs.drawable].every((id) => refs.all.has(id))).toBe(false);
  });
});
