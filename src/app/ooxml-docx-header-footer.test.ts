import { describe, expect, it } from "vitest";
import { buildDocxHeaderFooter, decodeLogoDataUrl } from "./ooxml-docx-header-footer";
import { buildDocxPackage, HEADER_REL_ID, FOOTER_REL_ID } from "./ooxml-docx-primitives";
import { buildDocx } from "./export-docx";
import { renderDocumentDocx } from "./doc-render-docx";
import { emptyWorkspace } from "./workspace";
import { unzipBytes, partText } from "../test/unzip-bytes";

// A 2×1 PNG: signature, IHDR (width 2, height 1), and enough of a body for the
// header reader. The bytes after IHDR are never decoded.
const PNG_2x1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00,
]);
const PNG_URL = `data:image/png;base64,${btoa(String.fromCharCode(...PNG_2x1))}`;
const SVG_URL = `data:image/svg+xml;base64,${btoa("<svg xmlns='http://www.w3.org/2000/svg'/>")}`;

const base = { projectName: "Harbour <Build> & Co", pageLabel: "Page {0} of {1}" };

describe("decodeLogoDataUrl (§512 b)", () => {
  it("decodes a PNG data URL and reads its size from the header", () => {
    const logo = decodeLogoDataUrl(PNG_URL);
    expect(logo?.extension).toBe("png");
    expect(logo?.size).toEqual({ width: 2, height: 1 });
    expect(Array.from(logo?.bytes ?? [])).toEqual(Array.from(PNG_2x1));
  });

  it("refuses what a Word drawing cannot take or size: SVG, a broken header, not a data URL", () => {
    expect(decodeLogoDataUrl(SVG_URL)).toBeNull();
    expect(decodeLogoDataUrl(`data:image/png;base64,${btoa("not a png")}`)).toBeNull();
    expect(decodeLogoDataUrl("https://example.com/logo.png")).toBeNull();
    expect(decodeLogoDataUrl("data:image/png;base64,%%%")).toBeNull();
  });
});

describe("buildDocxHeaderFooter (§512 b)", () => {
  it("puts the escaped project name in the header and Word's PAGE and NUMPAGES fields in the footer", () => {
    const hf = buildDocxHeaderFooter(base);
    expect(hf.headerXml).toContain("Harbour &lt;Build&gt; &amp; Co");
    expect(hf.footerXml).toContain('<w:fldSimple w:instr="PAGE">');
    expect(hf.footerXml).toContain('<w:fldSimple w:instr="NUMPAGES">');
    // The label's text runs sit around the two fields, in the label's order.
    const text = [...hf.footerXml.matchAll(/<w:t xml:space="preserve">([^<]*)<\/w:t>/g)].map((m) => m[1]);
    expect(text).toEqual(["Page ", "1", " of ", "1"]);
    expect(hf.logo).toBeUndefined();
    expect(hf.headerRelsXml).toBeUndefined();
  });

  it("follows the label's order, so a language may put the total first", () => {
    const hf = buildDocxHeaderFooter({ ...base, pageLabel: "{1} pages, this is {0}" });
    expect(hf.footerXml.indexOf("NUMPAGES")).toBeLessThan(hf.footerXml.indexOf('w:instr="PAGE"'));
  });

  it("embeds a usable logo as a drawing whose relationship lives in the header's own part", () => {
    const hf = buildDocxHeaderFooter({ ...base, logo: PNG_URL });
    expect(hf.logo?.path).toBe("word/media/brand-logo.png");
    expect(hf.headerXml).toContain('r:embed="rIdLogo"');
    expect(hf.headerRelsXml).toContain('Id="rIdLogo"');
    expect(hf.headerRelsXml).toContain('Target="media/brand-logo.png"');
    // Alt text is the project name, so the image is not unlabelled.
    expect(hf.headerXml).toContain('descr="Harbour &lt;Build&gt; &amp; Co"');
  });

  it("leaves the logo out, and keeps the name, when the logo cannot be embedded", () => {
    const hf = buildDocxHeaderFooter({ ...base, logo: SVG_URL });
    expect(hf.logo).toBeUndefined();
    expect(hf.headerXml).not.toContain("w:drawing");
    expect(hf.headerXml).toContain("Harbour");
  });

  it("uses relationship ids no media or link sink mints", () => {
    expect(HEADER_REL_ID).not.toMatch(/^rId\d+$/);
    expect(FOOTER_REL_ID).not.toMatch(/^rId\d+$/);
  });
});

function wellFormed(xml: string): boolean {
  return new DOMParser().parseFromString(xml, "application/xml").getElementsByTagName("parsererror").length === 0;
}

describe("buildDocxPackage with a header and footer (§512 b)", () => {
  it("adds the two parts, their content types and relationships, and points the section at them", async () => {
    const parts = await unzipBytes(buildDocxPackage("<w:p/>", "", "portrait", [], [], undefined, buildDocxHeaderFooter({ ...base, logo: PNG_URL })));
    for (const path of ["word/header1.xml", "word/footer1.xml", "word/_rels/header1.xml.rels", "word/document.xml", "[Content_Types].xml"]) {
      expect(wellFormed(partText(parts, path)), path).toBe(true);
    }
    expect(Array.from(parts.get("word/media/brand-logo.png") ?? [])).toEqual(Array.from(PNG_2x1));
    const types = partText(parts, "[Content_Types].xml");
    expect(types).toContain('PartName="/word/header1.xml"');
    expect(types).toContain('PartName="/word/footer1.xml"');
    expect(types.match(/Default Extension="png"/g)).toHaveLength(1);
    const rels = partText(parts, "word/_rels/document.xml.rels");
    expect(rels).toContain('Id="' + HEADER_REL_ID + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"');
    expect(rels).toContain('Id="' + FOOTER_REL_ID + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"');
    const doc = partText(parts, "word/document.xml");
    expect(doc).toContain('<w:headerReference w:type="default" r:id="' + HEADER_REL_ID + '"/>');
    expect(doc).toContain('<w:footerReference w:type="default" r:id="' + FOOTER_REL_ID + '"/>');
    // The header and footer need a band to sit in.
    expect(doc).not.toContain('w:header="0"');
  });

  it("leaves a package built without one exactly as before", async () => {
    const a = await unzipBytes(buildDocxPackage("<w:p/>", "", "landscape"));
    const b = await unzipBytes(buildDocxPackage("<w:p/>", "", "landscape", [], [], undefined, undefined));
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [path, bytes] of a) expect(Array.from(b.get(path)!), path).toEqual(Array.from(bytes));
    expect([...a.keys()].some((p) => p.includes("header") || p.includes("footer"))).toBe(false);
    expect(partText(a, "word/document.xml")).toContain('w:header="0" w:footer="0"');
  });

  it("refuses a media part that claims the header or footer id", () => {
    const media = [{ path: "word/media/image1.png", data: PNG_2x1, extension: "png" as const, relId: HEADER_REL_ID }];
    expect(() => buildDocxPackage("<w:p/>", "", "portrait", media)).toThrow(/reserved for the header and footer/);
  });

  it("reaches the workspace export when branding is passed", async () => {
    const parts = await unzipBytes(buildDocx([], undefined, { ...base, logo: PNG_URL }));
    expect(partText(parts, "word/header1.xml")).toContain("Harbour");
    expect(parts.has("word/media/brand-logo.png")).toBe(true);
    const plain = await unzipBytes(buildDocx([]));
    expect(plain.has("word/header1.xml")).toBe(false);
  });

  it("reaches a rendered project document when branding is passed", async () => {
    const document = { id: 1, title: "Report", blocks: [], createdAt: "2026-10-06T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z" };
    const parts = await unzipBytes(renderDocumentDocx(document, emptyWorkspace(), "en-US", undefined, {}, base));
    expect(partText(parts, "word/footer1.xml")).toContain('w:instr="NUMPAGES"');
    const plain = await unzipBytes(renderDocumentDocx(document, emptyWorkspace(), "en-US"));
    expect(plain.has("word/footer1.xml")).toBe(false);
  });
});
