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
import { buildDocxPackage, buildDocxTable, docxContentWidth } from "./ooxml-docx-primitives";
import { buildDocx } from "./export-docx";
import type { ExportSection } from "./export-sections";
import { readZipEntries } from "./unzip";
import { decodeUtf8 } from "./office-xml";

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
    // ★★ The DEFAULT is the contract, not a preference: the workspace exporter
    // calls buildDocxPackage with two arguments, and its output is pinned by
    // export-ooxml.test.ts. Widening the page here re-orients every export.
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
