// src/app/ooxml-docx-primitives.test.ts
//
// Page geometry for the shared .docx package builder, and the COUPLING between
// that geometry and the width tables are laid out to.
//
// ★★ WHY THIS FILE EXISTS: `buildDocxPackage` hardcoded a landscape <w:sectPr>
// inherited from the workspace exporter, where landscape is right for wide task
// tables. `renderDocumentDocx` reused it, so the SAME project document was
// portrait as HTML/PDF and landscape as .docx. Nothing asserted the orientation
// on either path, which meant ANY value passed.
//
// ★★ ORIENTATION ALONE IS NOT ENOUGH. `buildDocxTable` sizes columns to a page
// width, so re-orienting a document without re-measuring its tables lays them
// out wider than the page they now sit on. That defect is INVISIBLE to a test
// that only reads `w:orient`, and invisible in jsdom generally — the table
// still renders, just off the printable area. So the load-bearing assertions
// here are the fits-its-own-page ones, driven off geometry read back out of the
// emitted XML rather than restated as a literal.
//
// ★ Assertions read parsed <w:pgSz>/<w:pgMar> ATTRIBUTES, never a substring of
// the blob: a string match on "portrait" would also be satisfied by the word
// appearing in a style name or in a user's prose.

import { describe, it, expect } from "vitest";
import {
  buildDocxPackage,
  buildDocxTable,
  docxContentWidth,
  docxInlineDrawing,
  docxRichParagraphs,
} from "./ooxml-docx-primitives";
import { createLinkSink } from "./ooxml-links";
import { buildDocx } from "./export-docx";
import type { ExportSection } from "./export-sections";
import { readZipEntries } from "./unzip";
import { decodeUtf8 } from "./office-xml";
import { unzipBytes, partText } from "../test/unzip-bytes";
import type { MediaPart } from "./ooxml-media";

/** A4 in twips (1/1440 inch). Portrait is the landscape pair transposed. */
const A4_LONG = "16838";
const A4_SHORT = "11906";

const LAYOUTS = ["landscape", "portrait"] as const;

async function documentXml(blob: Blob): Promise<string> {
  const entries = await readZipEntries(await blob.arrayBuffer());
  const found = entries.get("word/document.xml");
  if (!found) throw new Error("word/document.xml missing from package");
  return decodeUtf8(found);
}

function parseXml(xml: string): Document {
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  const err = parsed.getElementsByTagName("parsererror")[0];
  if (err) throw new Error(`malformed XML: ${err.textContent ?? ""}`);
  return parsed;
}

interface PageGeometry {
  width: string | null;
  height: string | null;
  orient: string | null;
  top: string | null;
  right: string | null;
  bottom: string | null;
  left: string | null;
  /** Page width less its OWN declared left+right margins. */
  usableWidth: number;
}

/** Read the ONE section's page geometry out of a real package. Throws rather
 *  than returning nulls when the elements are missing, so a test cannot pass by
 *  comparing `undefined` to `undefined`. */
async function geometry(blob: Blob): Promise<PageGeometry> {
  const parsed = parseXml(await documentXml(blob));
  const sectPr = parsed.getElementsByTagName("w:sectPr");
  // Several <w:sectPr> would mean several sections with independent
  // orientations — never intended here, and it would make "the" page geometry
  // ambiguous.
  expect(sectPr).toHaveLength(1);
  const pgSz = sectPr[0].getElementsByTagName("w:pgSz")[0];
  const pgMar = sectPr[0].getElementsByTagName("w:pgMar")[0];
  if (!pgSz) throw new Error("<w:pgSz> missing from <w:sectPr>");
  if (!pgMar) throw new Error("<w:pgMar> missing from <w:sectPr>");
  const width = pgSz.getAttribute("w:w");
  const left = pgMar.getAttribute("w:left");
  const right = pgMar.getAttribute("w:right");
  return {
    width,
    height: pgSz.getAttribute("w:h"),
    orient: pgSz.getAttribute("w:orient"),
    top: pgMar.getAttribute("w:top"),
    right,
    bottom: pgMar.getAttribute("w:bottom"),
    left,
    usableWidth: Number(width) - Number(left) - Number(right),
  };
}

/** Every <w:gridCol> width, in document order. */
function gridWidths(xml: string): number[] {
  return [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
}

function tableWidth(xml: string): number {
  const widths = gridWidths(xml);
  expect(widths.length).toBeGreaterThan(0);
  return widths.reduce((a, b) => a + b, 0);
}

describe("buildDocxPackage — page geometry", () => {
  it("defaults to A4 landscape with the exporter's 720-twip margins", async () => {
    // ★★★ THE REASONING HERE WAS FALSIFIED BY THE LINKS BRANCH AND THE
    // CONCLUSION WITH IT. It read: "the workspace exporter calls
    // buildDocxPackage with two arguments … widening the page here re-orients
    // every export." Both halves are now untrue. `export-docx.ts` passes five
    // arguments with "landscape" spelled out (it has link relationships to
    // hand over) and `doc-render-docx.ts` passes its own `PAGE = "portrait"`,
    // so NO production caller reads this default and widening it re-orients
    // NOTHING that ships. Reproduce before trusting this either:
    //   grep -rn "buildDocxPackage(" src/app --include=*.ts | grep -v test
    // ★★ So this stays an ARGUMENT-DEFAULT test, not an export-behaviour one.
    // It is worth keeping in that narrower form precisely BECAUSE no caller
    // covers the default any more — every site that still reads it is a TEST.
    // Enumerate them; do not trust a count here:
    //   grep -rn 'buildDocxPackage("<w:p/>")\|buildDocxPackage("<w:p/>", "")' src --include=*.ts
    const g = await geometry(buildDocxPackage("<w:p/>"));
    expect(g.width).toBe(A4_LONG);
    expect(g.height).toBe(A4_SHORT);
    expect(g.orient).toBe("landscape");
    expect([g.top, g.right, g.bottom, g.left]).toEqual(["720", "720", "720", "720"]);
  });

  it("emits the landscape pair transposed when asked for portrait", async () => {
    const g = await geometry(buildDocxPackage("<w:p/>", "", "portrait"));
    expect(g.width).toBe(A4_SHORT);
    expect(g.height).toBe(A4_LONG);
    // Written explicitly even though portrait is the ST_PageOrientation
    // default: an absence assertion would also pass if <w:pgSz> vanished.
    expect(g.orient).toBe("portrait");
  });

  it("widens the portrait margins for prose instead of reusing the export's", async () => {
    // Mirrors doc-render-html.ts, which widens to 18mm/16mm for the same
    // documents because prose at the export's tight measure reads badly.
    // 18mm ≈ 1020 twips, 16mm ≈ 907.
    const g = await geometry(buildDocxPackage("<w:p/>", "", "portrait"));
    expect([g.top, g.bottom]).toEqual(["1020", "1020"]);
    expect([g.left, g.right]).toEqual(["907", "907"]);
  });

  it("declares an orientation that agrees with its own dimensions", async () => {
    // A landscape page is WIDER than tall and a portrait one taller than wide.
    // Transposing one pair without the other produces a file Word opens and
    // lays out wrongly — nothing else here would catch that.
    for (const layout of LAYOUTS) {
      const g = await geometry(buildDocxPackage("<w:p/>", "", layout));
      expect(g.orient).toBe(layout);
      const isWide = Number(g.width) > Number(g.height);
      expect(isWide).toBe(layout === "landscape");
    }
  });

  it("keeps the caller's body and extra styles regardless of layout", async () => {
    // CONTROL: proves the layout argument only reaches the sectPr. Without it,
    // a portrait branch that dropped the body would still pass every geometry
    // assertion above.
    const blob = buildDocxPackage("<w:p><w:r><w:t>marker</w:t></w:r></w:p>", "", "portrait");
    expect(await documentXml(blob)).toContain("marker");
  });
});

describe("docxContentWidth — derived from the emitted page", () => {
  it("gives every layout a width its own page can hold", async () => {
    // ★★ THE COUPLING INVARIANT, and the only one that generalises: whatever
    // geometry a layout emits, the width its tables are measured to must fit
    // between that page's own margins. Read back out of the real XML, so it
    // cannot drift from a restated literal.
    for (const layout of LAYOUTS) {
      const g = await geometry(buildDocxPackage("<w:p/>", "", layout));
      expect(g.usableWidth).toBeGreaterThan(0);
      expect(docxContentWidth(layout)).toBeLessThanOrEqual(g.usableWidth);
    }
  });

  it("derives the portrait width exactly — page less its own margins", async () => {
    const g = await geometry(buildDocxPackage("<w:p/>", "", "portrait"));
    expect(docxContentWidth("portrait")).toBe(g.usableWidth);
    expect(docxContentWidth("portrait")).toBe(10092); // 11906 − 907 − 907
  });

  it("pins the landscape override, and that it is NARROWER than derived", async () => {
    // ★★★ THE EXPORTER DOES NOT DERIVE, AND CANNOT BE MADE TO. Its tables have
    // always been laid out to 14520 while its page leaves 15398 — 878 twips
    // (≈15.5mm) of unused measure. The original comment calling 14520 "the
    // usable width at 0.5-inch margins on A4 landscape" was wrong arithmetic.
    // Deriving it would change every column width in every workspace export
    // (n=3: 4840 → 5132), and that output is contractually byte-stable.
    // Asserting BOTH numbers is what stops the discrepancy being quietly
    // "tidied up" in either direction by someone who spots one of them.
    const g = await geometry(buildDocxPackage("<w:p/>"));
    expect(docxContentWidth("landscape")).toBe(14520);
    expect(g.usableWidth).toBe(15398);
    expect(docxContentWidth("landscape")).toBeLessThan(g.usableWidth);
  });
});

describe("buildDocxTable — width follows the page", () => {
  it("shares the landscape content width by default", () => {
    const widths = gridWidths(buildDocxTable(["A", "B", "C"], [["1", "2", "3"]]));
    expect(widths).toHaveLength(3);
    expect(widths).toEqual([4840, 4840, 4840]); // floor(14520 / 3)
  });

  it("narrows every column when handed the portrait content width", () => {
    // The defect this guards is silent: a table keeps rendering, just wider
    // than the page it sits on.
    const widths = gridWidths(
      buildDocxTable(["A", "B", "C"], [["1", "2", "3"]], docxContentWidth("portrait")),
    );
    expect(widths).toEqual([3364, 3364, 3364]); // floor(10092 / 3)
  });

  it("fits its layout's page for any column count, on both layouts", () => {
    // Column widths are floored, so the total lands at or just under the
    // content width — never over it, at any count.
    for (const layout of LAYOUTS) {
      const content = docxContentWidth(layout);
      for (const count of [1, 2, 3, 5, 7, 11]) {
        const columns = Array.from({ length: count }, (_, i) => `C${i}`);
        const total = tableWidth(buildDocxTable(columns, [], content));
        expect(total).toBeLessThanOrEqual(content);
        expect(content - total).toBeLessThan(count); // floor loss only
      }
    }
  });

  it("declares the same total on <w:tblW> as the columns add up to", () => {
    const xml = buildDocxTable(["A", "B"], [], docxContentWidth("portrait"));
    expect(xml).toContain(`<w:tblW w:w="${tableWidth(xml)}" w:type="dxa"/>`);
  });
});

describe("the workspace exporter's page is untouched", () => {
  const section = (): ExportSection => ({
    key: "tasks",
    title: "Tasks",
    columns: ["A", "B", "C"],
    rows: [["1", "2", "3"]],
  });

  it("still renders A4 landscape", async () => {
    // ★ End-to-end guard on the OTHER side of the shared primitive: making the
    // document renderer portrait must not re-orient the workspace export. This
    // asserts through buildDocx, so a default flipped anywhere between here and
    // the sectPr is caught.
    const g = await geometry(buildDocx([]));
    expect(g.width).toBe(A4_LONG);
    expect(g.height).toBe(A4_SHORT);
    expect(g.orient).toBe("landscape");
    expect([g.top, g.right, g.bottom, g.left]).toEqual(["720", "720", "720", "720"]);
  });

  it("emits its <w:sectPr> byte-for-byte as it always has", async () => {
    // ★★★ THE BYTE CONTRACT, stated as bytes. Every other assertion in this
    // file reads PARSED attributes, which is right for meaning but blind to
    // serialization: attribute order, indentation and whitespace could all
    // change while every parsed test stayed green. The sectPr is now
    // GENERATED from PAGE_GEOMETRY rather than written out as a literal, and
    // this is what proves the generator reproduces the original literal
    // exactly. Both source files are LF-only (verified), so "\n" is the real
    // separator — on a CRLF checkout this would need "\r\n".
    const expected =
      `    <w:sectPr>\n` +
      `      <w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>\n` +
      `      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/>\n` +
      `    </w:sectPr>`;
    expect(await documentXml(buildDocx([]))).toContain(expected);
  });

  it("still lays its tables out to 14520, inside its own page", async () => {
    // The exporter's OWN coupling: its tables must keep the widths they have
    // always had AND must sit inside the page it declares. The first assertion
    // is the byte-stability contract; the second is the property that actually
    // matters to a reader opening the file.
    const blob = buildDocx([section()]);
    const xml = await documentXml(blob);
    expect(gridWidths(xml)).toEqual([4840, 4840, 4840]);
    expect(tableWidth(xml)).toBeLessThanOrEqual((await geometry(blob)).usableWidth);
  });
});

// ★★★ THE ADDITIVE-BY-CONTRACT SUITE. `buildDocxPackage` is SHARED with the
// workspace exporter, so an empty `media` array must add no `Default` entry, no
// part and no relationship.
//
// ★★ THE BYTE-IDENTITY TEST BELOW IS NO LONGER THE ONLY THING ENFORCING IT —
// two earlier revisions of this comment said it was, the first of them also
// sending a reader to the `export-ooxml` golden suite, which cannot see this
// contract at all. `ooxml-package-manifest.test.ts` closed the gap: it digests
// every part of the media-free package IN ZIP ORDER against
// `docs/baselines/ooxml-parts.json`, and that one DOES fail on a change nobody
// thought to assert. Measured while closing open-followups §216 — the mutant
// that opened the entry (a `<Default Extension="png" ContentType="image/png"/>`
// forced into the empty-media case) reddens it with "the CONTENT of 1 part(s)
// changed: [Content_Types].xml", and a pure REORDER of two adjacent zip entries
// (same part set, same digests, unchanged byte count) reddens it too, naming
// the order. The reorder is the evidence for ordered over sorted: a sorted
// manifest is green there by construction.
//
// ★★ THE TEST BELOW IS STILL WEAKER THAN ITS NAME — read it as what it is. It
// compares `buildDocxPackage(body, "", "portrait")` against
// `buildDocxPackage(body, "", "portrait", [])`, the builder against ITSELF, so
// it proves the `media` parameter is ADDITIVE and nothing about what the
// package contains. What caught the original mutant here was the trailing
// `not.toContain("image/")` assertion, never the byte loop above it.
//
// ★ `export-ooxml.test.ts` asserts part PRESENCE and document.xml SUBSTRINGS,
// never package bytes, and there is no `.docx` byte fixture in the repo
// (`src/app/__fixtures__/` holds only golden-workspace.csv and .md). The
// manifest replaced the fixture idea on purpose — diffable, and movable only
// by `npm run ooxml:manifest`, never by a `vitest -u`.
//
// ★ Bytes are read back with `../test/unzip-bytes`, not this file's own
// `readZipEntries`: that one decodes every part as UTF-8, which turns invalid
// UTF-8 into U+FFFD and so cannot byte-compare an image.
describe("buildDocxPackage media parts", () => {
  const png: MediaPart = {
    path: "word/media/image1.png",
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    extension: "png",
    relId: "rId2",
  };

  it("is byte-identical to the no-argument call when media is empty", async () => {
    const a = await unzipBytes(buildDocxPackage("<w:p/>", "", "portrait"));
    const b = await unzipBytes(buildDocxPackage("<w:p/>", "", "portrait", []));
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [path, bytes] of a) {
      expect(Array.from(b.get(path)!)).toEqual(Array.from(bytes));
    }
    // And the empty case adds NO image machinery at all.
    expect(partText(a, "[Content_Types].xml")).not.toContain("image/");
    expect(partText(a, "word/_rels/document.xml.rels")).not.toContain("/image");
  });

  it("writes the part bytes verbatim", async () => {
    const parts = await unzipBytes(buildDocxPackage("<w:p/>", "", "portrait", [png]));
    expect(Array.from(parts.get("word/media/image1.png")!)).toEqual(Array.from(png.data));
  });

  it("declares the extension and relates the id to the part", async () => {
    const parts = await unzipBytes(buildDocxPackage("<w:p/>", "", "portrait", [png]));
    expect(partText(parts, "[Content_Types].xml")).toContain(
      `<Default Extension="png" ContentType="image/png"/>`,
    );
    const rels = partText(parts, "word/_rels/document.xml.rels");
    expect(rels).toContain(`Id="rId2"`);
    expect(rels).toContain(`Target="media/image1.png"`);
    // The styles relationship must survive unshifted.
    expect(rels).toContain(`Id="rId1"`);
    expect(rels).toContain(`Target="styles.xml"`);
  });

  it("declares each extension ONCE even with several images of that type", async () => {
    const second: MediaPart = { ...png, path: "word/media/image2.png", relId: "rId3" };
    const parts = await unzipBytes(buildDocxPackage("<w:p/>", "", "portrait", [png, second]));
    const types = partText(parts, "[Content_Types].xml");
    expect(types.match(/<Default Extension="png"/g)).toHaveLength(1);
  });

  it("refuses rId1, which would silently detach the styles part", () => {
    expect(() =>
      buildDocxPackage("<w:p/>", "", "portrait", [{ ...png, relId: "rId1" }]),
    ).toThrow(/rId1/);
  });
});

describe("docxInlineDrawing", () => {
  it("embeds by relationship id and sizes in EMU", () => {
    const xml = docxInlineDrawing({
      relId: "rId2",
      id: 7,
      name: "image1.png",
      descr: "A chart",
      // ★ cx and cy are DELIBERATELY different, and both lines are asserted
      // separately: Word reads the size from BOTH <wp:extent> and <a:ext>, and
      // a disagreement between them is a real corruption. Equal values would
      // let either line be transposed with this test still green.
      extent: { cxEmu: 914400, cyEmu: 457200 },
    });
    expect(xml).toContain(`r:embed="rId2"`);
    expect(xml).toContain(`<wp:extent cx="914400" cy="457200"/>`);
    expect(xml).toContain(`<a:ext cx="914400" cy="457200"/>`);
  });

  it("escapes the description, which is user-supplied", () => {
    const xml = docxInlineDrawing({
      relId: "rId2",
      id: 7,
      name: "image1.png",
      descr: `a "&" <b>`,
      extent: { cxEmu: 1, cyEmu: 1 },
    });
    expect(xml).toContain("&amp;");
    expect(xml).not.toContain(`<b>`);
  });

  // ★★ `descr` lands inside an XML ATTRIBUTE, so a bare double quote closes it
  // early and corrupts the package — a failure the &amp;/<b> test above cannot
  // see, because neither character it checks is the one that breaks an
  // attribute. Assert on the attribute VALUE, not on the whole blob: the
  // document is full of legitimate quotes.
  it("escapes a double quote inside the descr attribute", () => {
    const xml = docxInlineDrawing({
      relId: "rId2",
      id: 7,
      name: "image1.png",
      descr: `say "hi"`,
      extent: { cxEmu: 1, cyEmu: 1 },
    });
    const values = [...xml.matchAll(/descr="([^"]*)"/g)].map((m) => m[1]);
    expect(values).toHaveLength(2);
    for (const value of values) {
      expect(value).toBe("say &quot;hi&quot;");
    }
  });
});

// ★★★ HYPERLINKS. A link is a relationship with NO part — that is the whole
// point of `TargetMode="External"`, and it is what makes this additive in a way
// the media path is not: no zip entry, no content-type Default.
//
// ★★ The namespace declaration is asserted ON THE ELEMENT deliberately.
// `w:document`'s root declares only `xmlns:w`; moving `xmlns:r` up there would
// change the bytes of EVERY package, including link-free ones, and move
// docs/baselines/ooxml-parts.json. The media path already solves the identical
// problem the identical way, on `a:blip`.
describe("docxRichParagraphs — hyperlinks", () => {
  it("wraps a linked run in w:hyperlink carrying the sink's rel id", () => {
    const sink = createLinkSink(2);
    const xml = docxRichParagraphs('<p><a href="https://intra/spec">the spec</a></p>', sink);
    // ★ Matched as a pattern rather than a literal prefix because `xmlns:r`
    // precedes `r:id` in the emitted element — see the test below, which pins
    // that order.
    expect(xml).toMatch(/<w:hyperlink [^>]*r:id="rId2">/);
    expect(sink.rels()).toEqual([{ relId: "rId2", target: "https://intra/spec" }]);
  });

  it("declares xmlns:r ON the hyperlink element, leaving w:document untouched", () => {
    const sink = createLinkSink(2);
    const xml = docxRichParagraphs('<p><a href="https://a">x</a></p>', sink);
    expect(xml).toContain(
      '<w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    );
  });

  it("emits no hyperlink and mints no rel for an unlinked paragraph", () => {
    const sink = createLinkSink(2);
    const xml = docxRichParagraphs("<p>plain</p>", sink);
    expect(xml).not.toContain("w:hyperlink");
    expect(sink.rels()).toEqual([]);
  });

  // ★★★ THE `Hyperlink` CHARACTER STYLE (§333). Before it, a link was
  // followable and drawn in ordinary body colour with no underline — it looked
  // exactly like the words around it, which is most of what §119 was filed to
  // deliver. `w:rStyle` is the FIRST child of `<w:rPr>` (CT_RPr is an
  // `xsd:sequence`, and rStyle leads EG_RPrBase), so these read the child ORDER
  // off the parsed tree rather than asserting mere presence: a presence-only
  // assertion passes at any order, and a run whose properties come out in
  // another order is schema-INVALID.
  //
  // ★★ THIS FILE CANNOT WITNESS THE FIX ON ITS OWN. A `w:rStyle` naming a style
  // the package does not DECLARE is silently ignored by Word, and
  // `docxRichParagraphs` emits no styles.xml. The declaration half, and the
  // derived membership check that ties the two together, live in
  // `doc-render-docx.test.ts` and `export-ooxml.test.ts` — one per consumer.
  describe("the Hyperlink character style", () => {
    /** The child tag names of the `<w:rPr>` inside the fragment's first
     *  `<w:r>`, in document order, or `[]` when that run carries none. */
    function runRPrChildren(fragment: string): string[] {
      const parsed = parseXml(
        `<w:root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
          `${fragment}</w:root>`,
      );
      const r = parsed.getElementsByTagName("w:r")[0];
      expect(r).toBeDefined();
      const rPr = Array.from(r.children).find((el) => el.tagName === "w:rPr");
      return rPr === undefined ? [] : Array.from(rPr.children).map((el) => el.tagName);
    }

    it("opens a linked run's w:rPr with the rStyle, and nothing else", () => {
      const sink = createLinkSink(2);
      const xml = docxRichParagraphs('<p><a href="https://intra/spec">the spec</a></p>', sink);
      expect(runRPrChildren(xml)).toEqual(["w:rStyle"]);
      expect(xml).toContain(`<w:rStyle w:val="Hyperlink"/>`);
    });

    it("keeps the rStyle ahead of a linked run's mark properties", () => {
      // ★ The marks the run also carries are what make the ORDER observable —
      //   the test above cannot tell first from only.
      const sink = createLinkSink(2);
      const xml = docxRichParagraphs('<p><a href="https://a"><b><i>x</i></b></a></p>', sink);
      expect(runRPrChildren(xml)).toEqual(["w:rStyle", "w:b", "w:i"]);
    });

    it("leaves an unlinked run's properties exactly as they were", () => {
      // The additive contract at the run level: a marked run keeps only its
      // marks, and an unmarked one still emits NO `<w:rPr>` at all — which the
      // empty array alone would not distinguish from an empty one.
      const sink = createLinkSink(2);
      const bold = docxRichParagraphs("<p><b>bold</b></p>", sink);
      expect(runRPrChildren(bold)).toEqual(["w:b"]);
      expect(bold).not.toContain("w:rStyle");
      const plain = docxRichParagraphs("<p>plain</p>", sink);
      expect(runRPrChildren(plain)).toEqual([]);
      expect(plain).not.toContain("<w:rPr>");
    });

    /** ★★★ THE SEPARATING INPUT FOR A MUTANT THAT OTHERWISE SURVIVES ALL
     *  THREE DOCX TEST FILES. Keying the rStyle off the parse-side `href`
     *  rather than the resolved `hyperlinkRelId` — one identifier — was green
     *  everywhere, measured, and the reason is that the two differ on only two
     *  inputs. An UNSAFE scheme is not one of them: `safeLinkTarget` drops it
     *  during the parse, so such a run reaches `markedRun` with no `href` at
     *  all and the "degrades an unsafe scheme" tests cannot tell the two
     *  spellings apart.
     *
     *  ★★ The other is THIS: a caller that passes NO SINK. `renderRun` then
     *  returns the run untouched, `href` intact and `hyperlinkRelId` never
     *  minted — which is the whole of the "the sink being OPTIONAL" contract
     *  that keeps every pre-existing caller byte-identical. Under the mutant
     *  such a run wears the `Hyperlink` style with NO `<w:hyperlink>` wrapper:
     *  text drawn as a link that cannot be followed, which is §333's defect
     *  inverted and worse. `buildDocxTable` is called without links today, so
     *  this is a live path, not a hypothetical one. */
    it("adds no character style to a link when the caller passes no sink", () => {
      const xml = docxRichParagraphs('<p><a href="https://intra/spec">the spec</a></p>');
      expect(xml).not.toContain("w:rStyle");
      expect(xml).not.toContain("w:hyperlink");
      // Positive observable — a render that dropped the run entirely would
      // satisfy both negatives while proving nothing.
      expect(xml).toContain("the spec");
    });
  });

  // ★★★ A TEST NAMED "gives a dataSection block the same link fidelity as the
  // register's own export" WAS DELETED FROM HERE, and the deletion is the point
  // worth recording. It imported no `doc-render-docx`, called no `renderBlock`,
  // `resolveDataSection` or `buildExportSections`, and built no `DocBlock` — it
  // was the first test in this describe with a different URL and a weaker pair
  // of assertions, under a name claiming a subject it could not reach. Its
  // comment argued the case ("shares these sinks by construction") instead of
  // asserting it, and a reader auditing dataSection link coverage would have
  // found the name, believed it, and stopped. A test with the right name and
  // no view of its subject is worse than no test at all.
  // ★ The claim is now covered where it can actually be observed: the
  // "hyperlinks" describe in `doc-render-docx.test.ts` drives a real
  // `{ type: "dataSection" }` block through `renderDocumentDocx` and resolves
  // the emitted `r:id` against the rels part.
});

describe("buildDocxPackage link relationships", () => {
  it("writes an external relationship with TargetMode and adds NO zip part", async () => {
    const parts = await unzipBytes(
      buildDocxPackage("<w:p/>", "", "landscape", [], [
        { relId: "rId2", target: "https://intra/spec?a=1&b=2" },
      ]),
    );
    const rels = partText(parts, "word/_rels/document.xml.rels");
    expect(rels).toContain(`Id="rId2"`);
    expect(rels).toContain(`TargetMode="External"`);
    expect(rels).toContain("relationships/hyperlink");
    expect(rels).toContain("https://intra/spec?a=1&amp;b=2");
    // The property that separates a link from a media part: no new zip entry.
    expect([...parts.keys()].filter((p) => p.startsWith("word/media/"))).toEqual([]);
    expect(partText(parts, "[Content_Types].xml")).not.toContain("hyperlink");
  });

  it("throws when a link id collides with a media id", () => {
    expect(() =>
      buildDocxPackage("<w:p/>", "", "landscape", [
        { path: "word/media/image1.png", data: new Uint8Array([1]), relId: "rId2", extension: "png" },
      ], [{ relId: "rId2", target: "https://a" }]),
    ).toThrow(/duplicate relationship id/i);
  });
});
