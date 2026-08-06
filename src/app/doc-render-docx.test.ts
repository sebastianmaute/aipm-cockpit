// src/app/doc-render-docx.test.ts
//
// The renderer's job is to produce a package Word will OPEN and a document.xml
// that says what the blocks said. So these tests unzip the real package and
// assert on the real part XML — never on "the blob is non-empty".
//
// ★ The highest-value assertions here are the escaping ones. A single raw "<"
// from user text makes document.xml malformed, and Word then refuses the file
// outright rather than degrading. Those tests parse the XML and compare
// textContent, so they fail on both malformed output AND on double-escaping.

import { describe, it, expect } from "vitest";
import { renderDocumentDocx, DOC_STYLES } from "./doc-render-docx";
import { t } from "./i18n";
import { readZipEntries } from "./unzip";
import { decodeUtf8 } from "./office-xml";
import { COLOR_DARK_BLUE, COLOR_MEDIUM_GREY, COLOR_TEXT } from "./export-ooxml-shared";
import type { ProjectDocument, DocBlock } from "./document-model";
import type { Workspace } from "./workspace";

const ws = { tasks: [], raid: [] } as unknown as Workspace;

const doc = (blocks: DocBlock[], title = "Report"): ProjectDocument => ({
  id: 1,
  title,
  blocks,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
});

/** Unzip the package into `path → decoded text`. readZipEntries returns a
 *  Map<string, Uint8Array>, not an array of {path,data}. */
async function parts(d: ProjectDocument, w: Workspace = ws): Promise<Map<string, string>> {
  const blob = renderDocumentDocx(d, w, "en-US");
  const entries = await readZipEntries(await blob.arrayBuffer());
  const out = new Map<string, string>();
  for (const [path, data] of entries) out.set(path, decodeUtf8(data));
  return out;
}

async function part(d: ProjectDocument, path: string, w: Workspace = ws): Promise<string> {
  const found = (await parts(d, w)).get(path);
  if (found === undefined) throw new Error(`${path} missing from package`);
  return found;
}

const documentXml = (d: ProjectDocument, w: Workspace = ws) =>
  part(d, "word/document.xml", w);

/** Parse as XML and fail loudly if the document is not well-formed. jsdom
 *  reports a malformed parse as a <parsererror> element rather than throwing. */
function parseXml(xml: string): Document {
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  const err = parsed.getElementsByTagName("parsererror")[0];
  if (err) throw new Error(`malformed XML: ${err.textContent ?? ""}`);
  return parsed;
}

/** Every <w:t> in document order, which is what a reader actually sees. */
function textNodes(xml: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagName("w:t")).map(
    (n) => n.textContent ?? "",
  );
}

describe("renderDocumentDocx — package integrity", () => {
  it("writes every part Word requires to open the file", async () => {
    const paths = [...(await parts(doc([]))).keys()];
    // A docx missing any of these will not open at all; document.xml alone is
    // not a package.
    expect(paths).toContain("[Content_Types].xml");
    expect(paths).toContain("_rels/.rels");
    expect(paths).toContain("word/_rels/document.xml.rels");
    expect(paths).toContain("word/document.xml");
    expect(paths).toContain("word/styles.xml");
  });

  it("emits well-formed XML for every block type at once", async () => {
    const xml = await documentXml(
      doc([
        { type: "heading", level: 1, text: "H" },
        { type: "paragraph", html: "<p>p</p>" },
        { type: "bullets", items: ["a"] },
        { type: "bullets", ordered: true, items: ["b"] },
        { type: "table", caption: "Cap", columns: ["C"], rows: [["v"]] },
        { type: "pageBreak" },
      ]),
    );
    expect(() => parseXml(xml)).not.toThrow();
    expect(parseXml(xml).documentElement.tagName).toBe("w:document");
  });

  it("parseXml actually detects malformed XML", () => {
    // CONTROL: without this, every well-formedness assertion above could be
    // passing because the checker never fails.
    expect(() => parseXml("<w:p><w:t>unclosed</w:p>")).toThrow(/malformed XML/);
  });
});

describe("renderDocumentDocx — page orientation", () => {
  // ★★ A project document is PROSE. doc-render-html.ts deliberately overrides
  // @page to A4 portrait for these documents; the .docx path inherited the
  // workspace exporter's landscape sectPr, so the SAME document was portrait as
  // a PDF and landscape as a .docx. The primitive's own default stays landscape
  // — ooxml-docx-primitives.test.ts pins that side.
  const pgSz = async (d: ProjectDocument): Promise<Element> => {
    const parsed = parseXml(await documentXml(d));
    const el = parsed.getElementsByTagName("w:pgSz")[0];
    if (!el) throw new Error("<w:pgSz> missing from document.xml");
    return el;
  };

  it("puts prose on A4 portrait, not the exporter's landscape", async () => {
    const el = await pgSz(doc([{ type: "paragraph", html: "<p>prose</p>" }]));
    expect(el.getAttribute("w:w")).toBe("11906");
    expect(el.getAttribute("w:h")).toBe("16838");
    expect(el.getAttribute("w:orient")).toBe("portrait");
  });

  it("measures its tables against the portrait text column, not the landscape one", async () => {
    // A table sized for the landscape text column overflows the narrower
    // portrait page — orientation and column widths are ONE decision. Compared
    // against the page LESS ITS OWN MARGINS, read from the same document, so
    // the assertion cannot drift from whatever geometry is emitted.
    const d = doc([{ type: "table", columns: ["A", "B"], rows: [["1", "2"]] }]);
    const xml = await documentXml(d);
    const widths = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(0);
    const total = widths.reduce((a, b) => a + b, 0);

    const parsed = parseXml(xml);
    const pgMar = parsed.getElementsByTagName("w:pgMar")[0];
    if (!pgMar) throw new Error("<w:pgMar> missing from document.xml");
    const usable =
      Number((await pgSz(d)).getAttribute("w:w")) -
      Number(pgMar.getAttribute("w:left")) -
      Number(pgMar.getAttribute("w:right"));
    expect(usable).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(usable);
  });
});

describe("renderDocumentDocx — declared styles", () => {
  it("puts DOC_STYLES inside <w:styles>, not after it", async () => {
    const styles = await part(doc([]), "word/styles.xml");
    const parsed = parseXml(styles);
    expect(parsed.documentElement.tagName).toBe("w:styles");
    // Every declared style must be a CHILD of <w:styles>. Appending after the
    // closing tag would still "contain" the ids while being malformed.
    const ids = Array.from(parsed.documentElement.children).map((el) =>
      el.getAttribute("w:styleId"),
    );
    expect(ids).toEqual(
      expect.arrayContaining([
        "Title",
        "TableHeader",
        "Heading1",
        "Heading2",
        "Heading3",
        "ListParagraph",
        "Caption",
      ]),
    );
  });

  it("styles every pStyle the renderer can emit", async () => {
    const styles = await part(
      doc([
        { type: "heading", level: 1, text: "a" },
        { type: "heading", level: 2, text: "b" },
        { type: "heading", level: 3, text: "c" },
        { type: "bullets", items: ["d"] },
        { type: "table", caption: "e", columns: ["C"], rows: [] },
      ]),
      "word/styles.xml",
    );
    const declared = new Set(
      Array.from(parseXml(styles).documentElement.children).map((el) =>
        el.getAttribute("w:styleId"),
      ),
    );
    const xml = await documentXml(
      doc([
        { type: "heading", level: 1, text: "a" },
        { type: "heading", level: 2, text: "b" },
        { type: "heading", level: 3, text: "c" },
        { type: "bullets", items: ["d"] },
        { type: "table", caption: "e", columns: ["C"], rows: [] },
      ]),
    );
    const used = Array.from(parseXml(xml).getElementsByTagName("w:pStyle")).map((n) =>
      n.getAttribute("w:val"),
    );
    expect(used.length).toBeGreaterThan(0);
    // The whole point of DOC_STYLES: no pStyle may fall through to a Word
    // latent built-in, which would render in Word's palette, not Acme's.
    for (const id of used) expect(declared).toContain(id);
  });

  it("colours the declared styles from the sanctioned palette only", () => {
    const hexes = [...DOC_STYLES.matchAll(/w:color w:val="([0-9A-F]{6})"/g)].map((m) => m[1]);
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) {
      expect([COLOR_DARK_BLUE, COLOR_TEXT, COLOR_MEDIUM_GREY]).toContain(hex);
    }
  });
});

describe("renderDocumentDocx — blocks", () => {
  it("renders the document title with the Title style", async () => {
    const xml = await documentXml(doc([], "Quarterly review"));
    const first = parseXml(xml).getElementsByTagName("w:pStyle")[0];
    expect(first.getAttribute("w:val")).toBe("Title");
    expect(textNodes(xml)).toContain("Quarterly review");
  });

  it("maps each heading level to its own Heading style", async () => {
    for (const level of [1, 2, 3] as const) {
      const xml = await documentXml(doc([{ type: "heading", level, text: "Scope" }]));
      const used = Array.from(parseXml(xml).getElementsByTagName("w:pStyle")).map((n) =>
        n.getAttribute("w:val"),
      );
      expect(used).toContain(`Heading${level}`);
      expect(textNodes(xml)).toContain("Scope");
    }
  });

  it("keeps the paragraph boundary as a break instead of fusing the lines", async () => {
    // ★ Recorded S1 limitation: bold/italic are lost. What must NOT be lost is
    // the block boundary — three paragraphs must not arrive as one run-on line.
    const xml = await documentXml(doc([{ type: "paragraph", html: "<p>one</p><p>two</p>" }]));
    expect(textNodes(xml)).toContain("one");
    expect(textNodes(xml)).toContain("two");
    expect(xml).toContain("<w:br/>");
    expect(textNodes(xml)).not.toContain("onetwo");
  });

  it("keeps a literal '<' from prose as text, not markup", async () => {
    // The projection treats "<" not followed by a letter as literal text; if
    // that ever regressed, this is where the package stops opening.
    const xml = await documentXml(doc([{ type: "paragraph", html: "<p>cost < 5k</p>" }]));
    expect(() => parseXml(xml)).not.toThrow();
    expect(textNodes(xml).join(" ")).toContain("< 5k");
  });

  it("renders unordered bullets as indented list paragraphs with a marker", async () => {
    const xml = await documentXml(doc([{ type: "bullets", items: ["alpha", "beta"] }]));
    const used = Array.from(parseXml(xml).getElementsByTagName("w:pStyle")).map((n) =>
      n.getAttribute("w:val"),
    );
    expect(used.filter((s) => s === "ListParagraph")).toHaveLength(2);
    const text = textNodes(xml);
    expect(text).toContain("• alpha");
    expect(text).toContain("• beta");
  });

  it("numbers ordered bullets instead of repeating a dot", async () => {
    // block.ordered is part of the model; rendering it identically to an
    // unordered list silently discards what the author chose.
    const xml = await documentXml(
      doc([{ type: "bullets", ordered: true, items: ["first", "second"] }]),
    );
    const text = textNodes(xml);
    expect(text).toContain("1. first");
    expect(text).toContain("2. second");
    expect(text.join(" ")).not.toContain("•");
  });

  it("renders a table, including its caption", async () => {
    const xml = await documentXml(
      doc([{ type: "table", caption: "Top risks", columns: ["Risk"], rows: [["Vendor"]] }]),
    );
    expect(xml).toContain("<w:tbl>");
    const text = textNodes(xml);
    expect(text).toContain("Risk");
    expect(text).toContain("Vendor");
    expect(text).toContain("Top risks");
  });

  it("renders a table with no caption and no rows", async () => {
    const xml = await documentXml(doc([{ type: "table", columns: ["Risk"], rows: [] }]));
    expect(xml).toContain("<w:tbl>");
    expect(textNodes(xml)).toContain("Risk");
  });

  it("renders a pageBreak as a page-type break", async () => {
    const xml = await documentXml(doc([{ type: "pageBreak" }]));
    expect(xml).toContain('w:type="page"');
  });

  it("keeps blocks in author order", async () => {
    const xml = await documentXml(
      doc([
        { type: "heading", level: 1, text: "AAA" },
        { type: "heading", level: 2, text: "BBB" },
      ]),
    );
    const text = textNodes(xml);
    expect(text.indexOf("AAA")).toBeLessThan(text.indexOf("BBB"));
  });
});

describe("renderDocumentDocx — XML escaping", () => {
  // A raw "&" or "<" in any of these positions produces a package Word refuses
  // to open. Comparing textContent also catches DOUBLE-escaping, which a
  // `toContain("&amp;")` assertion would happily pass.
  const HOSTILE = `A & B < C > D " E ' F`;

  it("escapes the document title", async () => {
    const xml = await documentXml(doc([], HOSTILE));
    expect(textNodes(xml)).toContain(HOSTILE);
  });

  it("escapes heading text", async () => {
    const xml = await documentXml(doc([{ type: "heading", level: 1, text: HOSTILE }]));
    expect(textNodes(xml)).toContain(HOSTILE);
  });

  it("escapes bullet items", async () => {
    const xml = await documentXml(doc([{ type: "bullets", items: [HOSTILE] }]));
    expect(textNodes(xml)).toContain(`• ${HOSTILE}`);
  });

  it("escapes table headers and cells", async () => {
    const xml = await documentXml(
      doc([{ type: "table", columns: [HOSTILE], rows: [[HOSTILE]] }]),
    );
    const text = textNodes(xml);
    expect(text.filter((t) => t === HOSTILE).length).toBeGreaterThanOrEqual(2);
  });

  it("escapes text projected out of paragraph html", async () => {
    const xml = await documentXml(doc([{ type: "paragraph", html: "<p>Tom &amp; Jerry</p>" }]));
    expect(textNodes(xml)).toContain("Tom & Jerry");
    // The stored entity must not survive into the run as a literal.
    expect(textNodes(xml).join(" ")).not.toContain("&amp;");
  });

  it("does not let script-shaped text become markup", async () => {
    const nasty = `<script>alert(1)</script>`;
    const xml = await documentXml(doc([{ type: "heading", level: 1, text: nasty }]));
    expect(() => parseXml(xml)).not.toThrow();
    expect(parseXml(xml).getElementsByTagName("script")).toHaveLength(0);
    expect(textNodes(xml)).toContain(nasty);
  });
});

// The resolver's OWN contract (null for an empty register, key selection, lang
// threading) is unit-tested in doc-data-section.test.ts. What stays here is
// what only this renderer can be wrong about: that a resolved section reaches
// document.xml as a real table, escaped.
describe("renderDocumentDocx — dataSection blocks", () => {
  const wsWithRaid = {
    tasks: [],
    raid: [
      { id: 1, title: "Vendor delay", category: "Risk", status: "Open" },
      { id: 2, title: "Budget & scope <risk>", category: "Risk", status: "Open" },
    ],
  } as unknown as Workspace;

  it("routes a dataSection key through the real export-sections registry", async () => {
    const xml = await documentXml(doc([{ type: "dataSection", key: "raid" }]), wsWithRaid);
    const text = textNodes(xml);
    expect(text).toContain("Vendor delay");
    expect(xml).toContain("<w:tbl>");
  });

  it("escapes data pulled from the workspace", async () => {
    const xml = await documentXml(doc([{ type: "dataSection", key: "raid" }]), wsWithRaid);
    expect(() => parseXml(xml)).not.toThrow();
    expect(textNodes(xml)).toContain("Budget & scope <risk>");
  });

  it("heads the resolved section with its localized title", async () => {
    const xml = await documentXml(doc([{ type: "dataSection", key: "raid" }]), wsWithRaid);
    expect(textNodes(xml)).toContain(t("en-US", "tabRaid"));
  });

  it("renders nothing for an empty register", async () => {
    // Empty registers are the common case in a fresh project; a stray empty
    // table or heading would appear in every generated document.
    const xml = await documentXml(doc([{ type: "dataSection", key: "raid" }]), ws);
    expect(xml).not.toContain("<w:tbl>");
    expect(textNodes(xml)).not.toContain(t("en-US", "tabRaid"));
  });

  it("does not leak a section the block did not ask for", async () => {
    const both = {
      // ★ `taskName`, not `title` — see doc-data-section.test.ts. With `title`
      // this whole assertion passes vacuously.
      tasks: [{ id: 9, taskName: "A task", status: "To Do" }],
      raid: [{ id: 1, title: "Vendor delay", category: "Risk", status: "Open" }],
    } as unknown as Workspace;
    const xml = await documentXml(doc([{ type: "dataSection", key: "raid" }]), both);
    expect(textNodes(xml)).toContain("Vendor delay");
    expect(textNodes(xml).join(" ")).not.toContain("A task");
  });
});
