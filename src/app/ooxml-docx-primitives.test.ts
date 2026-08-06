// src/app/ooxml-docx-primitives.test.ts
//
// Page geometry for the shared .docx package builder.
//
// ★★ WHY THIS FILE EXISTS: `buildDocxPackage` hardcoded a landscape <w:sectPr>
// inherited from the workspace exporter, where landscape is right for wide task
// tables. `renderDocumentDocx` reused it, so the SAME project document was
// portrait as HTML/PDF and landscape as .docx. Nothing asserted the orientation
// on either path, which meant ANY value passed — so these tests pin BOTH
// directions, not just the one that changed.
//
// ★ Assertions read the parsed <w:pgSz>/<w:pgMar> attributes, never a substring
// of the blob: a string match on "portrait" would also be satisfied by the word
// appearing in a style name or a user's prose.

import { describe, it, expect } from "vitest";
import {
  DOCX_CONTENT_WIDTH_TWIPS,
  buildDocxPackage,
  buildDocxTable,
} from "./ooxml-docx-primitives";
import { buildDocx } from "./export-docx";
import { readZipEntries } from "./unzip";
import { decodeUtf8 } from "./office-xml";

/** A4 in twips (1/1440 inch). Portrait is the landscape pair transposed. */
const A4_LONG = "16838";
const A4_SHORT = "11906";

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
}

/** Read the ONE section's page geometry out of a real package. Throws rather
 *  than returning nulls when the elements are missing, so a test cannot pass
 *  by comparing `undefined` to `undefined`. */
async function geometry(blob: Blob): Promise<PageGeometry> {
  const parsed = parseXml(await documentXml(blob));
  const sectPr = parsed.getElementsByTagName("w:sectPr");
  // Several <w:sectPr> would mean several sections with independent
  // orientations — never intended here, and it would make "the" page
  // geometry ambiguous.
  expect(sectPr).toHaveLength(1);
  const pgSz = sectPr[0].getElementsByTagName("w:pgSz")[0];
  const pgMar = sectPr[0].getElementsByTagName("w:pgMar")[0];
  if (!pgSz) throw new Error("<w:pgSz> missing from <w:sectPr>");
  if (!pgMar) throw new Error("<w:pgMar> missing from <w:sectPr>");
  return {
    width: pgSz.getAttribute("w:w"),
    height: pgSz.getAttribute("w:h"),
    orient: pgSz.getAttribute("w:orient"),
    top: pgMar.getAttribute("w:top"),
    right: pgMar.getAttribute("w:right"),
    bottom: pgMar.getAttribute("w:bottom"),
    left: pgMar.getAttribute("w:left"),
  };
}

describe("buildDocxPackage — page geometry", () => {
  it("defaults to A4 landscape with the exporter's 720-twip margins", async () => {
    // ★★ The DEFAULT is the contract, not a preference: the workspace exporter
    // calls buildDocxPackage with two arguments, and its bytes are pinned by
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

  it("keeps the caller's body and extra styles regardless of layout", async () => {
    // CONTROL: proves the layout argument only reaches the sectPr. Without it,
    // a portrait branch that dropped the body would still pass every geometry
    // assertion above.
    const blob = buildDocxPackage("<w:p><w:r><w:t>marker</w:t></w:r></w:p>", "", "portrait");
    expect(await documentXml(blob)).toContain("marker");
  });

  it("declares a portrait page that its own margins fit inside", async () => {
    const g = await geometry(buildDocxPackage("<w:p/>", "", "portrait"));
    const usable = Number(g.width) - Number(g.left) - Number(g.right);
    // The content width the tables are measured against must BE that number —
    // a table sized for a wider page silently runs off the sheet.
    expect(DOCX_CONTENT_WIDTH_TWIPS.portrait).toBe(usable);
  });
});

describe("buildDocxTable — width follows the page", () => {
  const gridWidths = (xml: string): number[] =>
    [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));

  it("shares the landscape content width by default", () => {
    const widths = gridWidths(buildDocxTable(["A", "B", "C"], [["1", "2", "3"]]));
    expect(widths).toHaveLength(3);
    expect(widths).toEqual([4840, 4840, 4840]); // floor(14520 / 3)
  });

  it("narrows every column when handed the portrait content width", () => {
    // The defect this guards is silent: a table keeps rendering, just wider
    // than the page it sits on.
    const widths = gridWidths(
      buildDocxTable(["A", "B", "C"], [["1", "2", "3"]], DOCX_CONTENT_WIDTH_TWIPS.portrait),
    );
    expect(widths).toEqual([3364, 3364, 3364]); // floor(10092 / 3)
    const total = widths.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(DOCX_CONTENT_WIDTH_TWIPS.portrait);
  });

  it("declares the same total on <w:tblW> as the columns add up to", () => {
    const xml = buildDocxTable(["A", "B"], [], DOCX_CONTENT_WIDTH_TWIPS.portrait);
    const total = gridWidths(xml).reduce((a, b) => a + b, 0);
    expect(xml).toContain(`<w:tblW w:w="${total}" w:type="dxa"/>`);
  });
});

describe("the workspace exporter's page is untouched", () => {
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
});
