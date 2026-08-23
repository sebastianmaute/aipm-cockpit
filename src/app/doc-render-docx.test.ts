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
import { renderDocumentDocx } from "./doc-render-docx";
import { buildDocx } from "./export-docx";
import { DOC_STYLES, buildDocxTable } from "./ooxml-docx-primitives";
import { TASK_MARK_CHECKED } from "./rich-text-plain";
import { t } from "./i18n";
import { readZipEntries } from "./unzip";
import { unzipBytes, partText } from "../test/unzip-bytes";
import { decodeUtf8 } from "./office-xml";
import { COLOR_DARK_BLUE, COLOR_MEDIUM_GREY, COLOR_TEXT } from "./export-ooxml-shared";
import type { ExportSection } from "./export-sections";
import type { ProjectDocument, DocBlock } from "./document-model";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { DocumentAsset } from "./document-asset";
import { NO_EXPORT_ASSETS, type ExportAssets } from "./document-export-assets";
import { base64ToBytes } from "./document-asset-upload";

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

/** Each <w:p> as its own concatenated visible text, in document order.
 *
 *  ★ This is what `textNodes` cannot see: whether two pieces of text landed in
 *  ONE paragraph or two. A rich paragraph block now emits one <w:p> per line,
 *  so the block boundary is a real paragraph rather than a <w:br/>, and only a
 *  per-paragraph view can tell those apart. A rule (<hr>) carries no runs at
 *  all, so it shows up here as an empty string — which is exactly the entry a
 *  renderer that drops rules would be missing. */
function paraTexts(xml: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagName("w:p")).map((p) =>
    Array.from(p.getElementsByTagName("w:t"))
      .map((n) => n.textContent ?? "")
      .join(""),
  );
}

/** Every <w:pStyle w:val>, in document order. */
function pStyles(xml: string): (string | null)[] {
  return Array.from(parseXml(xml).getElementsByTagName("w:pStyle")).map((n) =>
    n.getAttribute("w:val"),
  );
}

/** `buildDocxTable` returns a bare `<w:tbl>` FRAGMENT, whose `w:` prefix is
 *  unbound — `parseXml` reports that as a parse error rather than parsing it.
 *  Wrapping it in a namespace-declaring root is what lets every helper above
 *  be reused against a table built in isolation. */
function wrapWordXml(fragment: string): string {
  return `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${fragment}</w:document>`;
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
    // Bounded on BOTH sides. `<=` alone passes for a table sized to any
    // narrower page too, so it would not notice the width being pinned to some
    // other constant; column widths are floored, so the only legitimate
    // shortfall is under one twip per column.
    expect(total).toBeLessThanOrEqual(usable);
    expect(usable - total).toBeLessThan(widths.length);
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

  it("keeps the paragraph boundary instead of fusing the lines", async () => {
    // ★★ The PROPERTY is unchanged — three paragraphs must not arrive as one
    // run-on line — but the MECHANISM changed deliberately in the mark-aware
    // slice: a block boundary is now a real <w:p> per line, where it used to be
    // a <w:br/> inside a single paragraph. So the old `toContain("<w:br/>")`
    // assertion was retired, not weakened; `paraTexts` pins the stronger
    // property (each line is its own paragraph), which the <w:br/> form would
    // fail. `<w:br/>` itself is still emitted for table cells that hold a
    // newline (ooxml-docx-primitives.test.ts owns that) and for pageBreak.
    const xml = await documentXml(doc([{ type: "paragraph", html: "<p>one</p><p>two</p>" }]));
    expect(paraTexts(xml)).toEqual(["Report", "one", "two"]);
    expect(textNodes(xml)).not.toContain("onetwo");
  });

  it("upgrades a legacy plain-text paragraph instead of fusing its lines", async () => {
    // Reachable by import only: the AI write boundary upgrades before storing,
    // but hand-edited or externally-produced workspace JSON reaches the renderer
    // raw. Measured through the composed load pipeline, {"type":"paragraph",
    // "html":"a\nb"} survives byte-for-byte — neither sanitizeProjectDocuments
    // nor sanitizeDocumentRichFields upgrades it (open-followups §118).
    //
    // ★★ Asserting the OUTPUT, not the mechanism: plainToHtml turns the newline
    // into "<br>", and htmlToRichLines ENDS a line at a <br> rather than
    // emitting a marker — so the upgrade yields TWO <w:p>, not one paragraph
    // holding a <w:br/>. A `toContain("<w:br/>")` assertion would be red here
    // for the right reason and green for a table cell's newline elsewhere.
    const xml = await documentXml(doc([{ type: "paragraph", html: "a\nb" }]));
    expect(paraTexts(xml)).toEqual(["Report", "a", "b"]);
  });

  it("keeps a paragraph opening with an unlisted tag as TEXT, not escaped markup", async () => {
    // ★★★ The other side of the upgrade above, and the reason its classifier is
    // the "render" sink rather than an allow-list-derived one. htmlToRichLines
    // keeps the text of EVERY tag, so a classifier narrower than that escapes a
    // value the parser would have read: under "document", "<h3>Sub</h3>" came
    // out as the literal characters "<h3>Sub</h3>" in one run instead of "Sub".
    // Asserting the LINE TEXT is what separates the two — a toContain("Sub")
    // holds for the escaped form too.
    for (const [html, text] of [
      ["<h3>Sub</h3>", "Sub"],
      ["<div>Status</div>", "Status"],
      ["<table><tr><td>cell</td></tr></table>", "cell"],
    ]) {
      const xml = await documentXml(doc([{ type: "paragraph", html }]));
      expect(paraTexts(xml)).toEqual(["Report", text]);
    }
  });

  it("keeps markup that does not OPEN with a tag as markup", async () => {
    // ★★★ The render classifier asks "does this CONTAIN a tag at all?", not
    // "does it START with one". While it was anchored at the start, a value
    // whose markup begins mid-sentence was classified plain text and escaped
    // WHOLE, so Word showed the literal characters "<strong>bold</strong>"
    // instead of a bold run. Same input, same three renderers, one classifier.
    const xml = await documentXml(
      doc([{ type: "paragraph", html: "Intro <strong>bold</strong> tail" }]),
    );
    // POSITIVE form: the markup reached the parser and became a real run
    // property. A `not.toContain("&lt;strong")` alone is satisfied by an empty
    // document too.
    expect(xml).toContain(`<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">bold</w:t></w:r>`);
    expect(paraTexts(xml)).toEqual(["Report", "Intro bold tail"]);
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

describe("renderDocumentDocx — rich paragraph marks", () => {
  // ★★ Assertions here pin the WHOLE RUN, never a bare tag. `toContain("<w:b/>")`
  // alone is satisfied by buildDocxTable's header run and by DOC_STYLES, so it
  // would pass with the paragraph path still flattening to plain text — the
  // exact vacuity this slice has already produced three times elsewhere.

  it("emits Word run properties for each mark in a paragraph", async () => {
    const xml = await documentXml(
      doc([{ type: "paragraph", html: "<p><strong>b</strong><em>i</em><u>u</u><s>s</s></p>" }]),
    );
    expect(xml).toContain(`<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">b</w:t></w:r>`);
    expect(xml).toContain(`<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">i</w:t></w:r>`);
    expect(xml).toContain(
      `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">u</w:t></w:r>`,
    );
    expect(xml).toContain(
      `<w:r><w:rPr><w:strike/></w:rPr><w:t xml:space="preserve">s</w:t></w:r>`,
    );
    // All four marks are siblings in ONE line, so they must be four runs in one
    // paragraph — not four paragraphs, and not one fused run.
    expect(paraTexts(xml)).toEqual(["Report", "bius"]);
  });

  it("emits a subscript run property", async () => {
    const xml = await documentXml(doc([{ type: "paragraph", html: "<p><sub>x</sub></p>" }]));
    expect(xml).toContain(
      `<w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t xml:space="preserve">x</w:t></w:r>`,
    );
  });

  it("orders w:rPr children by the WordprocessingML schema, not by arrival", async () => {
    // ★★★ CT_RPr is a SEQUENCE: rFonts · b · i · strike · highlight · u ·
    // vertAlign. Word may reject or silently ignore a run whose properties are
    // out of sequence. The nesting below hands the parser the marks in almost
    // the reverse of that order, so an implementation that emits them in
    // arrival order fails here — on all seven marks at once, which is what
    // makes this the test that says WHAT the order is.
    // ★ It is no longer the ONLY test that fails on it. Invariant 4 ("orders
    // every <w:rPr>'s children by the EG_RPrBase sequence") also goes red now
    // that `EVERY_SHAPE_HTML` carries an out-of-rank-order two-mark run; it
    // sweeps every part for the PROPERTY without naming the sequence, so the
    // two are complements rather than duplicates.
    const xml = await documentXml(
      doc([
        {
          type: "paragraph",
          html: "<p><sup><code><s><mark><u><em><strong>x</strong></em></u></mark></s></code></sup></p>",
        },
      ]),
    );
    const rPrs = parseXml(xml).getElementsByTagName("w:rPr");
    expect(rPrs).toHaveLength(1);
    expect(Array.from(rPrs[0].children).map((el) => el.tagName)).toEqual([
      "w:rFonts",
      "w:b",
      "w:i",
      "w:strike",
      "w:highlight",
      "w:u",
      "w:vertAlign",
    ]);
    expect(rPrs[0].getElementsByTagName("w:vertAlign")[0].getAttribute("w:val")).toBe(
      "superscript",
    );
  });

  it("emits no run properties at all for unmarked text", async () => {
    // Byte-stability for the overwhelmingly common case: plain prose must not
    // grow an empty <w:rPr>.
    const xml = await documentXml(doc([{ type: "paragraph", html: "<p>plain</p>" }]));
    expect(xml).toContain(`<w:p><w:r><w:t xml:space="preserve">plain</w:t></w:r></w:p>`);
    expect(xml).not.toContain("<w:rPr>");
  });

  it("renders a horizontal rule as a bordered paragraph", async () => {
    // ★★ An <hr> line carries ZERO runs, so a renderer that maps line.runs
    // blindly emits an empty paragraph and the rule vanishes. The exact
    // paraTexts array below is what catches that: the "" entry must be there
    // AND must be the paragraph carrying the border.
    const xml = await documentXml(
      doc([{ type: "paragraph", html: "<p>a</p><hr><p>b</p>" }]),
    );
    expect(paraTexts(xml)).toEqual(["Report", "a", "", "b"]);
    const bordered = Array.from(parseXml(xml).getElementsByTagName("w:p")).filter(
      (p) => p.getElementsByTagName("w:pBdr").length > 0,
    );
    expect(bordered).toHaveLength(1);
    const bottom = bordered[0].getElementsByTagName("w:bottom")[0];
    expect(bottom.getAttribute("w:val")).toBe("single");
    expect(bottom.getAttribute("w:color")).toBe(COLOR_MEDIUM_GREY);
  });

  it("gives blockquote and preformatted lines their own paragraph styles", async () => {
    const xml = await documentXml(
      doc([{ type: "paragraph", html: "<blockquote><p>q</p></blockquote><pre>c1\nc2</pre>" }]),
    );
    // A <pre> splits on its newlines, so two code lines are two paragraphs —
    // both styled, neither folded into the quote's style.
    expect(pStyles(xml)).toEqual(["Title", "Quote", "CodeBlock", "CodeBlock"]);
    expect(paraTexts(xml)).toEqual(["Report", "q", "c1", "c2"]);
  });

  it("declares every style a rich paragraph can emit", async () => {
    // Same contract as the block-level test above: a w:pStyle naming a style
    // that styles.xml does not declare is SILENTLY IGNORED by Word, so the
    // blockquote would render as body text while every assertion still passed.
    //
    // ★★ THE h4 AND THE <li> ARE LOAD-BEARING, not padding. §141(b) taught the
    // rich paragraph path to emit `Heading1`-`Heading4` and `ListParagraph`,
    // and `Heading4` had to be DECLARED for the first time. Every other
    // assertion in this file about h4 passes on the emitted `w:pStyle` string
    // alone, so THIS is the only test that goes red if the declaration is
    // dropped — the pStyle is still emitted, it just resolves to nothing.
    const blocks: DocBlock[] = [
      {
        type: "paragraph",
        html: "<blockquote>q</blockquote><pre>c</pre><p>p</p><h4>h</h4><ul><li><p>i</p></li></ul>",
      },
    ];
    const declared = new Set(
      Array.from(
        parseXml(await part(doc(blocks), "word/styles.xml")).documentElement.children,
      ).map((el) => el.getAttribute("w:styleId")),
    );
    const used = pStyles(await documentXml(doc(blocks)));
    expect(used).toContain("Quote");
    expect(used).toContain("CodeBlock");
    expect(used).toContain("Heading4");
    expect(used).toContain("ListParagraph");
    for (const id of used) expect(declared).toContain(id);
  });

  it("sets a monospace font on the preformatted style and on inline code", async () => {
    // A code block routed through a style that does not change the font exports
    // in the body face, which is the whole point of marking it up as code.
    expect(DOC_STYLES).toContain(`<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>`);
    const xml = await documentXml(doc([{ type: "paragraph", html: "<p><code>x()</code></p>" }]));
    expect(xml).toContain(
      `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t xml:space="preserve">x()</w:t></w:r>`,
    );
  });

  it("escapes marked text just as it escapes plain text", async () => {
    const xml = await documentXml(
      doc([{ type: "paragraph", html: "<p><strong>A &amp; B &lt; C</strong></p>" }]),
    );
    expect(() => parseXml(xml)).not.toThrow();
    expect(textNodes(xml)).toContain("A & B < C");
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

// Rich entity cells in a table — open-followups §141(b). The seven rich entity
// fields (Task.description, RAID description+mitigation, Change description+
// impactDescription+resolutionNotes, Milestone description) reach a .docx as
// TABLE CELLS, where there is no block model to carry heading level, list
// numbering or alignment. These tests drive `buildDocxTable` directly, because
// that is the boundary both the workspace exporter and a document's own
// `table`/`dataSection` blocks go through.
describe("rich entity cells in a DOCX table (§141(b))", () => {
  const cellXml = (html: string): string =>
    wrapWordXml(buildDocxTable(["description"], [[{ html, text: "ignored" }]]));

  /** The BODY cell's paragraphs. The single header column contributes exactly
   *  one paragraph, so dropping the first entry leaves the cell's own.
   *
   *  ★★ PARAGRAPH-SCOPED, and that is not a stylistic choice. The list marker
   *  is its OWN `<w:r>` — it has to be, because it carries no marks while the
   *  text after it may carry several — so the emitted XML reads
   *  `…<w:t>1. </w:t></w:r><w:r><w:t>first</w:t>…` and a `toContain("1. first")`
   *  over the raw string can NEVER pass. Concatenating the `<w:t>`s within one
   *  `<w:p>` is what asserts the reader actually sees "1. first" on one line. */
  const cellParas = (html: string): string[] => paraTexts(cellXml(html)).slice(1);

  /** Every `<w:ind w:left>` in the fragment, in document order. */
  const indents = (html: string): (string | null)[] =>
    Array.from(parseXml(cellXml(html)).getElementsByTagName("w:ind")).map((n) =>
      n.getAttribute("w:left"),
    );

  it("renders a heading with its level's style", () => {
    expect(pStyles(cellXml("<h2>Plan</h2>"))).toContain("Heading2");
    expect(cellParas("<h2>Plan</h2>")).toEqual(["Plan"]);
  });

  it("renders h4, whose style this slice had to declare", () => {
    expect(pStyles(cellXml("<h4>Deep</h4>"))).toContain("Heading4");
    expect(cellParas("<h4>Deep</h4>")).toEqual(["Deep"]);
  });

  it("numbers an ordered list as literal marker text", () => {
    // ★★ THE EDITOR'S REAL SHAPE. Tiptap stores `<li><p>text</p></li>`; a
    // fixture using a bare `<li>` cannot see a defect in the transparency arm,
    // which is how a CRITICAL already hid in this slice.
    expect(cellParas("<ol><li><p>first</p></li><li><p>second</p></li></ol>")).toEqual([
      "1. first",
      "2. second",
    ]);
  });

  it("numbers a bare <li> the same way the editor's nested <p> is numbered", () => {
    // The golden fixtures and legacy stored values carry this flatter form, so
    // both shapes must reach the same bytes.
    expect(cellParas("<ol><li>first</li><li>second</li></ol>")).toEqual([
      "1. first",
      "2. second",
    ]);
  });

  it("bullets an unordered list instead of numbering it", () => {
    expect(cellParas("<ul><li><p>one</p></li></ul>")).toEqual(["• one"]);
  });

  it("indents a nested list item one further step", () => {
    const nested = "<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>";
    expect(cellParas(nested)).toEqual(["• a", "• b"]);
    expect(indents(nested)).toEqual(["720", "1440"]);
  });

  it("indents a wrapped item's continuation without repeating the marker", () => {
    // ★★ Shift+Enter inside a bullet. The continuation keeps the item's indent
    // — `<w:ind>` derives from `line.depth`, which it copies — and gets NO
    // second "1."/"•", because a list item has one marker however many lines it
    // wraps to. Before this it restarted as a bare `p`, so a client-facing DOCX
    // showed an unmarked, unindented orphan BETWEEN two numbered items.
    const wrapped = "<ol><li><p>a<br>b</p></li><li><p>c</p></li></ol>";
    expect(cellParas(wrapped)).toEqual(["1. a", "b", "2. c"]);
    expect(indents(wrapped)).toEqual(["720", "720", "720"]);
  });

  it("still numbers an item whose own line was dropped before any text arrived", () => {
    // ★★★ Shift+Enter as the FIRST keystroke in a bullet. The item's own `li`
    // line starts empty, the `<br>` closes it, `flush` drops it for holding no
    // text, and the text re-opened as a CONTINUATION — which this renderer
    // correctly leaves unmarked. The ordinal was spent regardless, so the
    // exported list's first visible number was "2." with an unmarked line above
    // it and no "1." anywhere. `promoteItemHead` makes the first line the item
    // DID emit its head.
    expect(cellParas("<ol><li><p><br>x</p></li><li><p>y</p></li></ol>")).toEqual([
      "1. x",
      "2. y",
    ]);
  });

  it("centres BOTH halves of a bullet split by a <br>", () => {
    // ★★ A `<br>` breaks the LINE, not the paragraph, so both halves belong to
    // the same `<p data-align="center">`. The continuation was built with its
    // align hardcoded `undefined`, so para 2 carried no `<w:jc>` and Word
    // rendered one bullet half centred, half left.
    const xml = cellXml('<ul><li><p data-align="center">a<br>b</p></li></ul>');
    expect(xml.match(/<w:jc w:val="center"\/>/g)).toHaveLength(2);
  });

  it("indents a second paragraph in the same item at the item's depth", () => {
    const twoParas = "<ul><li><p>a</p><p>b</p></li></ul>";
    expect(cellParas(twoParas)).toEqual(["• a", "b"]);
    expect(indents(twoParas)).toEqual(["720", "720"]);
  });

  it("marks a task item with the flat projection's own constant", () => {
    const xml = '<ul data-type="taskList"><li data-checked="true"><p>done</p></li></ul>';
    expect(cellParas(xml)).toEqual([`${TASK_MARK_CHECKED.trim()} done`]);
  });

  it("maps justify to OOXML's `both`", () => {
    // ST_Jc spells justified as "both". Passing "justify" through is a value
    // Word does not recognise and silently drops.
    expect(cellXml('<p data-align="justify">x</p>')).toContain(`<w:jc w:val="both"/>`);
    expect(cellXml('<p data-align="center">x</p>')).toContain(`<w:jc w:val="center"/>`);
  });

  it("orders <w:pPr>'s children by the schema, not by the order they are added", () => {
    // ★★★ CT_PPr's children are an xsd:sequence, exactly like the `<w:rPr>`
    // ordering `DOCX_MARK_RPR`'s `rank` exists for: pStyle -> ind -> jc. Every
    // string assertion in this describe passes whatever the order, so this is
    // the only thing pinning it.
    const li = '<ol><li><p data-align="center">x</p></li></ol>';
    const pPr = Array.from(parseXml(cellXml(li)).getElementsByTagName("w:pPr")).find(
      (n) => n.getElementsByTagName("w:jc").length > 0,
    );
    expect(pPr).toBeDefined();
    expect(Array.from(pPr!.children).map((el) => el.tagName)).toEqual([
      "w:pStyle",
      "w:ind",
      "w:jc",
    ]);
  });

  it("emits several paragraphs in ONE table cell", () => {
    const parsed = parseXml(cellXml("<p>one</p><p>two</p>"));
    const cells = Array.from(parsed.getElementsByTagName("w:tc"));
    expect(cells).toHaveLength(2); // header cell + body cell
    expect(cells[1].getElementsByTagName("w:p")).toHaveLength(2);
    expect(cellParas("<p>one</p><p>two</p>")).toEqual(["one", "two"]);
  });

  it("keeps an empty rich cell structurally valid", () => {
    // A `<w:tc>` with no block-level child is INVALID and Word refuses the
    // file. An empty rich value must still emit one paragraph.
    const cells = Array.from(parseXml(cellXml("")).getElementsByTagName("w:tc"));
    expect(cells[1].getElementsByTagName("w:p")).toHaveLength(1);
    // ★ And it must be EMPTY. Without this the test passes on the pre-§141(b)
    // code, which stringified the RichCell object into the cell as
    // "[object Object]" — one paragraph, entirely wrong content.
    expect(cellParas("")).toEqual([""]);
  });

  it("leaves a plain string cell byte-identical to what it always emitted", () => {
    // The rich branch must not disturb the path every non-rich column takes —
    // the workspace exporter's bytes ride on it.
    expect(buildDocxTable(["a"], [["x"]])).toContain(
      `<w:p>\n              <w:r><w:t xml:space="preserve">x</w:t></w:r>\n            </w:p>`,
    );
  });

  it("carries marks through a rich cell", () => {
    expect(cellXml("<p><strong>b</strong></p>")).toContain(
      `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">b</w:t></w:r>`,
    );
  });

  it("escapes rich cell text", () => {
    const xml = cellXml("<p>A &amp; B &lt; C</p>");
    expect(() => parseXml(xml)).not.toThrow();
    expect(cellParas("<p>A &amp; B &lt; C</p>")).toEqual(["A & B < C"]);
  });
});

// The MIRROR of the describe above, one level up. A `paragraph` DocBlock and a
// rich table cell go through the SAME line builder now; before §141(b) the
// block path had no `heading`/`li` style at all, so a list item inside a
// document paragraph rendered with NO MARKER while the same document's .pptx
// showed one.
describe("renderDocumentDocx — headings and lists inside a paragraph block", () => {
  it("marks and indents a list item in a document paragraph block", async () => {
    const xml = await documentXml(
      doc([{ type: "paragraph", html: "<ol><li><p>first</p></li><li><p>second</p></li></ol>" }]),
    );
    expect(paraTexts(xml)).toEqual(["Report", "1. first", "2. second"]);
    expect(pStyles(xml)).toEqual(["Title", "ListParagraph", "ListParagraph"]);
  });

  it("styles a heading inside a document paragraph block", async () => {
    const xml = await documentXml(
      doc([{ type: "paragraph", html: "<h2>Plan</h2><p>body</p>" }]),
    );
    expect(pStyles(xml)).toEqual(["Title", "Heading2"]);
    expect(paraTexts(xml)).toEqual(["Report", "Plan", "body"]);
  });

  it("aligns a paragraph inside a document paragraph block", async () => {
    const xml = await documentXml(
      doc([{ type: "paragraph", html: '<p data-align="right">r</p>' }]),
    );
    expect(xml).toContain(`<w:jc w:val="right"/>`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The three ways this renderer can be wrong that WORD NEVER TELLS ANYONE ABOUT.
//
// ★★★ NOTHING IN THIS REPO CAN PROVE WORD OPENS THE FILE, so these stand in for
// it. Each failure mode below produces a document that opens, renders, and is
// simply WRONG — and every string-comparison assertion elsewhere in this file
// stays green through all three:
//   1. A `w:pStyle` naming a style styles.xml does not declare is SILENTLY
//      IGNORED; the line renders as body text in Word's palette, not AIPM's.
//   2. `<w:pPr>`'s children are an `xsd:sequence` (CT_PPr). Out of sequence the
//      part is schema-INVALID — rejected by strict validators, and the
//      properties dropped by less forgiving consumers than Word.
//   3. ST_Jc's vocabulary is `left | center | right | both`. "justify" is not a
//      member; Word drops an unrecognised value and renders left-aligned.
//
// ★★ EVERY test here iterates over matches, and a loop over ZERO matches passes
// vacuously — which would report coverage that does not exist, the one outcome
// worse than having no test. So each asserts it found something FIRST, and two
// of them pin the exact SET they expect so a shape silently dropped from the
// fixture goes red rather than quietly narrowing the sweep.
describe("DOCX invariants Word fails silently on", () => {
  /** ONE fixture, every shape `htmlToRichLines` can produce: all four heading
   *  levels, plain/blockquote/pre/hr, both list orderings, a nested list, both
   *  task states, all four alignments, and marks.
   *
   *  ★★ Lists use the EDITOR'S REAL SHAPE (`<li><p>…</p></li>`) — Tiptap's
   *  listItem spec is `paragraph block*`, and a fixture using a bare `<li>`
   *  cannot see a defect in the transparency arm, which is how a CRITICAL
   *  already hid in this slice. The bare form is here TOO, because the golden
   *  fixtures and legacy stored values carry it. */
  const EVERY_SHAPE_HTML = [
    "<h1>H1</h1>",
    '<h2 data-align="center">H2 centred</h2>',
    "<h3>H3</h3>",
    "<h4>H4</h4>",
    "<p>plain</p>",
    '<p data-align="left">left</p>',
    '<p data-align="right">right</p>',
    '<p data-align="justify">justified</p>',
    '<blockquote data-align="right"><p>quoted</p></blockquote>',
    "<pre>code1\ncode2</pre>",
    "<hr>",
    "<ul><li><p>bullet</p></li></ul>",
    "<ol><li><p>first</p></li><li><p>second</p></li></ol>",
    "<ul><li>bare</li></ul>",
    "<ul><li><p>outer</p><ul><li><p>nested</p></li></ul></li></ul>",
    '<ul data-type="taskList"><li data-checked="true"><p>done</p></li>' +
      '<li data-checked="false"><p>todo</p></li></ul>',
    '<ol><li><p data-align="center">centred item</p></li></ol>',
    "<p><strong>b</strong><em>i</em><code>c</code></p>",
    // ★★ A run carrying SEVERAL marks, and it is load-bearing for invariant 4.
    // Every other marked shape here is a sequence of SINGLE-mark runs, and a
    // one-child `<w:rPr>` is in sequence order whatever the builder does — so
    // `DOCX_MARK_RPR`'s `rank` table, the only thing that orders mark elements
    // against each other, was never exercised there. Measured, not assumed:
    // dropping the `<em>` here turns invariant 4 red on `widestMarkRun`.
    //
    // ★★★ THE NESTING ORDER IS THE WHOLE POINT — `<em>` OUTSIDE, `<strong>`
    // INSIDE. Marks arrive in NESTING order, so this run reaches `markedRun` as
    // [italic, bold] = ranks [2, 1], which the sort has to REORDER. Written the
    // other way round (`<strong><em>`) it arrives [bold, italic] = [1, 2],
    // already sorted — `widestMarkRun` still reaches 2 and invariant 4 stays
    // GREEN with `markedRun`'s `.sort(...)` deleted, i.e. the anti-vacuity guard
    // is satisfied by a run that cannot fail the check it guards. Measured in
    // both directions.
    "<p><em><strong>bi</strong></em></p>",
  ].join("");

  /** `buildDocx`'s own `word/document.xml` — the WORKSPACE exporter's package.
   *
   *  ★★★ IT SHARES `buildDocxTable` WITH THE DOCUMENT RENDERER BUT NOT ITS BODY.
   *  `buildDocxSection` hand-writes the title and row-count paragraphs, and
   *  those runs are unreachable from `renderDocumentDocx` at any input — so a
   *  sweep built only from `renderDocumentDocx` + `buildDocxTable` cannot see
   *  them. Two out-of-sequence `<w:rPr>`s lived there behind exactly that gap. */
  async function exporterDocumentXml(): Promise<string> {
    const section: ExportSection = {
      key: "tasks",
      title: "Tasks",
      // A rich cell, so the exporter's package carries the rich paragraph
      // shapes too and not merely its own two hand-written runs.
      columns: ["description"],
      rows: [[{ html: EVERY_SHAPE_HTML, text: "ignored" }]],
    };
    const entries = await readZipEntries(await buildDocx([section]).arrayBuffer());
    const data = entries.get("word/document.xml");
    if (data === undefined) throw new Error("word/document.xml missing from export package");
    return decodeUtf8(data);
  }

  /** The same fixture through BOTH emission paths and the workspace exporter,
   *  plus the styles part the first invariant is measured against.
   *
   *  ★★ ONE fixture, THREE emitting paths. A `paragraph` DocBlock and a rich
   *  table cell go through the same `docxRichParagraph` builder — but that is a
   *  fact to PIN, not to assume, and the two reached it by different routes
   *  (§141(b)). The document also carries the block-level shapes only
   *  `renderBlock` emits, so `Caption` and `TableHeader` are in the sweep too.
   *  The third is the workspace exporter, whose body paragraphs no other path
   *  reaches — see `exporterDocumentXml` above for why that gap mattered.
   *
   *  ★ It asserts its own output rather than trusting it: a helper that silently
   *  returned "" would make all four invariants below vacuous at once. */
  async function renderEverySupportedShape(): Promise<{
    block: string;
    cell: string;
    styles: string;
    exported: string;
  }> {
    const blocks: DocBlock[] = [
      { type: "paragraph", html: EVERY_SHAPE_HTML },
      { type: "heading", level: 1, text: "block heading" },
      { type: "bullets", items: ["unordered"] },
      { type: "bullets", ordered: true, items: ["ordered"] },
      { type: "table", caption: "Cap", columns: ["C"], rows: [["v"]] },
      { type: "pageBreak" },
    ];
    const rendered = await parts(doc(blocks));
    const block = rendered.get("word/document.xml");
    const styles = rendered.get("word/styles.xml");
    if (block === undefined || styles === undefined) throw new Error("package incomplete");
    const cell = wrapWordXml(
      buildDocxTable(["description"], [[{ html: EVERY_SHAPE_HTML, text: "ignored" }]]),
    );
    const exported = await exporterDocumentXml();
    for (const xml of [block, cell, styles, exported]) {
      expect(xml.length).toBeGreaterThan(0);
      expect(() => parseXml(xml)).not.toThrow();
    }
    // All three emitting paths must really have LAID OUT the fixture — one
    // paragraph would mean it was flattened, and every sweep below would then
    // be near-empty.
    expect(parseXml(block).getElementsByTagName("w:p").length).toBeGreaterThan(15);
    expect(parseXml(cell).getElementsByTagName("w:p").length).toBeGreaterThan(15);
    expect(parseXml(exported).getElementsByTagName("w:p").length).toBeGreaterThan(15);
    return { block, cell, styles, exported };
  }

  it("declares every paragraph style any emission path can name", async () => {
    // ★★★ INVARIANT 1. `docxStyleFor` names Heading1-Heading4, ListParagraph,
    // Quote and CodeBlock; `renderBlock` adds Title and Caption; buildDocxTable
    // adds TableHeader; the workspace exporter re-uses Title. An undeclared one
    // is IGNORED by Word — the pStyle is still emitted, so every other
    // assertion in this file about it passes.
    const { block, cell, styles, exported } = await renderEverySupportedShape();
    const declared = new Set(
      Array.from(parseXml(styles).documentElement.children).map((el) =>
        el.getAttribute("w:styleId"),
      ),
    );
    const used = [...pStyles(block), ...pStyles(cell), ...pStyles(exported)];
    expect(used.length).toBeGreaterThan(0);
    // ★ The exact DOMAIN, not just "some styles". Without this a shape dropped
    // from the fixture would narrow the sweep silently, and the loop below
    // would go on passing over whatever was left.
    expect(new Set(used)).toEqual(
      new Set([
        "Title",
        "Heading1",
        "Heading2",
        "Heading3",
        "Heading4",
        "ListParagraph",
        "Quote",
        "CodeBlock",
        "Caption",
        "TableHeader",
      ]),
    );
    for (const id of used) expect(declared).toContain(id);
  });

  it("orders every <w:pPr>'s children by the CT_PPr sequence", async () => {
    // ★★★ INVARIANT 2. CT_PPrBase is an xsd:sequence, so the RANK of each child
    // is fixed by the schema and not by the order a builder happens to push
    // them: pStyle · pBdr · spacing · ind · jc · outlineLvl. This sweeps EVERY
    // <w:pPr> in both emission paths AND in styles.xml — the style declarations
    // drifted out of sequence independently of the emitters once already,
    // because nothing was looking at them.
    const ORDER = ["w:pStyle", "w:pBdr", "w:spacing", "w:ind", "w:jc", "w:outlineLvl"];
    const { block, cell, styles, exported } = await renderEverySupportedShape();
    let seen = 0;
    let widest = 0;
    for (const xml of [block, cell, styles, exported]) {
      for (const pPr of Array.from(parseXml(xml).getElementsByTagName("w:pPr"))) {
        const tags = Array.from(pPr.children).map((el) => el.tagName);
        // An element this list does not rank cannot be checked at all, so an
        // unknown one is a failure rather than a silent skip.
        for (const tag of tags) expect(ORDER).toContain(tag);
        const ranks = tags.map((tag) => ORDER.indexOf(tag));
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
        seen += 1;
        widest = Math.max(widest, tags.length);
      }
    }
    expect(seen).toBeGreaterThan(0);
    // ★ A one-child <w:pPr> is sorted whatever the builder does, so the sweep
    // above is only meaningful if something in it carries several children —
    // the list item that is styled, indented AND aligned is the widest the rich
    // path can emit, and it is what mutating the push order shows up in.
    expect(widest).toBeGreaterThanOrEqual(3);
  });

  it("orders every <w:rPr>'s children by the EG_RPrBase sequence", async () => {
    // ★★★ INVARIANT 4, and the RUN-level twin of invariant 2. CT_RPr is an
    // xsd:sequence exactly as CT_PPrBase is, which is the whole reason
    // `DOCX_MARK_RPR` carries a `rank` — but that table governs the RICH path
    // only. Every HAND-WRITTEN <w:rPr> (the style declarations, the table
    // header run, and the exporter's title + row-count runs) was outside any
    // sweep, and two of the exporter's carried <w:color/> before <w:i/>.
    // Word opens such a file happily; the Open XML SDK and validators built on
    // it reject it, so the cost is invalidity with nothing visible to notice.
    //
    // ★★ THE POSITIONS ARE EG_RPrBase's, NOT the rank table's 0..6. w:color
    // (19) and w:sz (24) fall BETWEEN w:strike (9) and w:highlight (26), and no
    // RunMark maps to either — so the rank table never ordered them against the
    // marks, and copying its 0..6 here would rank two of the elements that
    // actually appear in the wrong place.
    const ORDER = [
      "w:rFonts",
      "w:b",
      "w:i",
      "w:strike",
      "w:color",
      "w:sz",
      "w:highlight",
      "w:u",
      "w:vertAlign",
    ];
    // Exactly `DOCX_MARK_RPR`'s elements — the ones a RUN's marks produce, as
    // opposed to the `w:color`/`w:sz` that only a hand-written declaration
    // carries.
    // ★ It is a FILTER, not a provenance proof: an `<w:rPr>` whose children are
    // all mark elements is one NO hand-written declaration in this fixture
    // emits (every one of them carries `w:color` or `w:sz`), which is what makes
    // it separate `markedRun`'s output from theirs TODAY. A hand-written run
    // built solely from mark elements would satisfy it too; none exists, and if
    // one is added this filter stops distinguishing the two and the guard below
    // has to be narrowed some other way.
    const MARK_TAGS = ["w:rFonts", "w:b", "w:i", "w:strike", "w:highlight", "w:u", "w:vertAlign"];
    const { block, cell, styles, exported } = await renderEverySupportedShape();
    let seen = 0;
    let widest = 0;
    let widestMarkRun = 0;
    for (const xml of [block, cell, styles, exported]) {
      for (const rPr of Array.from(parseXml(xml).getElementsByTagName("w:rPr"))) {
        const tags = Array.from(rPr.children).map((el) => el.tagName);
        // An element this list does not rank cannot be checked at all, so an
        // unknown one is a failure rather than a silent skip.
        for (const tag of tags) expect(ORDER).toContain(tag);
        const ranks = tags.map((tag) => ORDER.indexOf(tag));
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
        seen += 1;
        widest = Math.max(widest, tags.length);
        if (tags.every((tag) => MARK_TAGS.includes(tag))) {
          widestMarkRun = Math.max(widestMarkRun, tags.length);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
    // ★ A one-child <w:rPr> is sorted whatever the builder does, so the sweep
    // only bites where several properties meet — Heading4 (b · i · color · sz)
    // is the widest, and the exporter's italic-grey runs are the pair that was
    // wrong.
    expect(widest).toBeGreaterThanOrEqual(4);
    // ★★★ AND `widest` ALONE IS MET BY THE WRONG THING — it is `Heading4` in
    // styles.xml, a HAND-WRITTEN declaration. Measured on the fixture: every
    // multi-child `<w:rPr>` in the sweep came from a hand-written run (the
    // table header's `w:b+w:color`, the exporter's `w:i+w:color`, the styles),
    // and every run `markedRun` built carried exactly ONE mark — the case the
    // sequence check above cannot fail on. So `DOCX_MARK_RPR`'s `rank` table,
    // which is the only thing ordering the mark elements against each other,
    // was never exercised by this invariant at all. This guard admits only an
    // `<w:rPr>` whose children are ALL mark elements (see `MARK_TAGS`), so
    // nothing but a real multi-mark run can satisfy it.
    //
    // ★★★ AND A MULTI-MARK RUN IS STILL NOT ENOUGH ON ITS OWN — the marks have
    // to arrive OUT of rank order. `EVERY_SHAPE_HTML`'s multi-mark fixture was
    // `<strong><em>` (arrival [bold, italic] = ranks [1, 2], already sorted)
    // and this guard passed while `markedRun`'s `.sort(...)` was DELETED: two
    // marks were present, and `[...ranks].sort()` had nothing to reorder. It is
    // `<em><strong>` now (arrival [italic, bold] = [2, 1]). Measured in both
    // directions: with the sort deleted this invariant is GREEN on the old
    // nesting and RED on the new one.
    expect(widestMarkRun).toBeGreaterThanOrEqual(2);
  });

  it("emits only legal ST_Jc values", async () => {
    // ★★★ INVARIANT 3, and the NEGATIVE, exhaustive form of "maps justify to
    // OOXML's `both`" above. Three of the four alignments spell the same in
    // both vocabularies, which is exactly why passing the CSS name through
    // looks correct; Word silently drops the one that does not and renders the
    // paragraph left-aligned.
    const LEGAL = ["left", "center", "right", "both"];
    const { block, cell, exported } = await renderEverySupportedShape();
    const used: string[] = [];
    for (const xml of [block, cell, exported]) {
      for (const [, value] of xml.matchAll(/<w:jc w:val="([^"]*)"\/>/g)) used.push(value);
    }
    expect(used.length).toBeGreaterThan(0);
    for (const value of used) expect(LEGAL).toContain(value);
    // ★ And all four are REACHED. Without this the sweep passes on a fixture
    // that never drives `justify` — i.e. exactly the input the mapping exists
    // for would go untested while the test claimed to sweep the domain.
    expect(new Set(used)).toEqual(new Set(LEGAL));
  });
});

// S3c-1: DOCX has no media parts yet (a later slice, S3c-2) — an
// `<img data-asset-id>` must DISCLOSE as a translated placeholder run naming
// the asset rather than vanish through `htmlToRichLines`, which has no `<img>`
// handling at all.
describe("renderDocumentDocx — S3c-1 image placeholders", () => {
  function assetMeta(id: string, name: string): DocumentAsset {
    return { id, name, mime: "image/png", size: 3, hash: "h", createdAt: "2026-08-06T00:00:00.000Z" };
  }

  const docWithImage = (html: string, w: Workspace = ws): [ProjectDocument, Workspace] => [
    doc([{ type: "paragraph", html }]),
    w,
  ];

  /** Every visible word in the document, one string. */
  const textOf = async (d: ProjectDocument, w: Workspace = ws): Promise<string> =>
    textNodes(await documentXml(d, w)).join("");

  it("replaces an <img data-asset-id> with a translated placeholder naming the asset", async () => {
    const wsWithAsset = { ...ws, documentAssets: [assetMeta("a1", "sunset.png")] } as Workspace;
    const [d, w] = docWithImage('<p><img data-asset-id="a1" alt="Sunset"></p>', wsWithAsset);
    const text = await textOf(d, w);
    expect(text).toContain(t("en-US", "assetExportPlaceholder", "sunset.png"));
  });

  it("does not drop the paragraph the image sat in — surrounding text survives in the SAME paragraph", async () => {
    const wsWithAsset = { ...ws, documentAssets: [assetMeta("a1", "sunset.png")] } as Workspace;
    const [d, w] = docWithImage('<p>Before <img data-asset-id="a1"> After</p>', wsWithAsset);
    const xml = await documentXml(d, w);
    const texts = paraTexts(xml);
    // paraTexts[0] is always the title paragraph ("Report").
    expect(texts[1]).toBe(`Before ${t("en-US", "assetExportPlaceholder", "sunset.png")} After`);
  });

  it("falls back to the asset id when the asset is dangling (no metadata for it)", async () => {
    const [d, w] = docWithImage('<p><img data-asset-id="a1"></p>');
    const text = await textOf(d, w);
    expect(text).toContain(t("en-US", "assetExportPlaceholder", "a1"));
  });

  it("emits well-formed XML and the literal name when the asset name carries XML-special characters", async () => {
    const wsWithAsset = { ...ws, documentAssets: [assetMeta("a1", `Q3 & "roadmap" <final>`)] } as Workspace;
    const [d, w] = docWithImage('<p><img data-asset-id="a1"></p>', wsWithAsset);
    const xml = await documentXml(d, w);
    expect(() => parseXml(xml)).not.toThrow();
    const text = await textOf(d, w);
    expect(text).toContain(t("en-US", "assetExportPlaceholder", `Q3 & "roadmap" <final>`));
  });

  it("never emits a raw <img> tag into document.xml", async () => {
    const wsWithAsset = { ...ws, documentAssets: [assetMeta("a1", "sunset.png")] } as Workspace;
    const [d, w] = docWithImage('<p><img data-asset-id="a1" alt="Sunset"></p>', wsWithAsset);
    const xml = await documentXml(d, w);
    expect(xml).not.toContain("<img");
    expect(xml).not.toContain("data-asset-id");
  });
});

// S3c-2: media parts. The renderer now embeds real image bytes for every asset
// the caller INLINED, and falls back to the S3c-1 placeholder for every other
// reason (omitted by the budget, no byte row, no metadata, a mime outside the
// allow-list, no stored dimensions to build an extent from).
describe("renderDocumentDocx — S3c-2 embedded images", () => {
  /** An 8-byte PNG header — short enough to byte-compare in an assertion. */
  const PNG_B64 = "iVBORw0KGgo=";

  const imageDoc = (html: string): ProjectDocument =>
    doc([{ type: "paragraph", html }], "T");

  /** ★ `hash` is REQUIRED on `DocumentAsset`; a fixture omitting it does not
   *  compile. `width`/`height` are the optional pair the extent needs. */
  const asset = (over: Partial<DocumentAsset> = {}): DocumentAsset => ({
    id: "a1",
    name: "chart.png",
    mime: "image/png",
    size: 8,
    width: 480,
    height: 240,
    hash: "h",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  const wsWith = (...list: DocumentAsset[]): Workspace => ({
    ...emptyWorkspace(),
    documentAssets: list.length > 0 ? list : [asset()],
  });

  const inlinedAssets = (map: Record<string, string>): ExportAssets => ({
    inlined: map,
    omitted: new Set(),
    missing: new Set(),
  });

  const mediaPaths = (zip: Map<string, Uint8Array>): string[] =>
    [...zip.keys()].filter((p) => p.startsWith("word/media/"));

  it("embeds an inlined image as a media part whose bytes match", async () => {
    const zip = await unzipBytes(renderDocumentDocx(
      imageDoc(`<p><img data-asset-id="a1" alt="chart"></p>`),
      wsWith(), "en-US", inlinedAssets({ a1: PNG_B64 }),
    ));
    const media = mediaPaths(zip);
    expect(media).toHaveLength(1);
    expect(Array.from(zip.get(media[0])!)).toEqual(Array.from(base64ToBytes(PNG_B64)));

    const xml = partText(zip, "word/document.xml");
    const relId = xml.match(/r:embed="(rId\d+)"/)?.[1];
    expect(relId).toBeTruthy();
    const rels = partText(zip, "word/_rels/document.xml.rels");
    expect(rels).toContain(`Id="${relId}"`);
    expect(rels).toContain(`Target="media/${media[0].slice("word/media/".length)}"`);
  });

  it("does not bracket an image-only paragraph with blank paragraphs", async () => {
    // ★★★ THE SHAPE THE BLOCK EDITOR ACTUALLY INSERTS. Splitting `<p><img></p>`
    // around the tag leaves the fragments `<p>` and `</p>`: non-blank as
    // STRINGS, empty as PROSE. A renderer that emits a segment whenever
    // `fragment.trim()` is truthy therefore wraps EVERY image in two blank
    // paragraphs — well-formed, green against every other assertion here, and
    // two spurious blank lines per image in Word.
    const zip = await unzipBytes(renderDocumentDocx(
      imageDoc(`<p><img data-asset-id="a1"></p>`),
      wsWith(), "en-US", inlinedAssets({ a1: PNG_B64 }),
    ));
    // The title paragraph, then the drawing's own paragraph — which carries no
    // <w:t> at all, hence the empty string. Nothing either side of it.
    expect(paraTexts(partText(zip, "word/document.xml"))).toEqual(["T", ""]);
  });

  it("keeps the placeholder when the asset was OMITTED by the budget", async () => {
    const zip = await unzipBytes(renderDocumentDocx(
      imageDoc(`<p><img data-asset-id="a1"></p>`), wsWith(), "en-US",
      { inlined: {}, omitted: new Set(["a1"]), missing: new Set() },
    ));
    expect(mediaPaths(zip)).toHaveLength(0);
    expect(partText(zip, "word/document.xml")).toContain("chart.png");
  });

  it("keeps the placeholder when the asset has NO stored dimensions", async () => {
    // OOXML needs a concrete extent; guessing one would stretch the image.
    const zip = await unzipBytes(renderDocumentDocx(
      imageDoc(`<p><img data-asset-id="a1"></p>`),
      wsWith(asset({ width: undefined, height: undefined })),
      "en-US", inlinedAssets({ a1: PNG_B64 }),
    ));
    expect(mediaPaths(zip)).toHaveLength(0);
    expect(partText(zip, "word/document.xml")).toContain("chart.png");
  });

  // ★★★ EACH CASE IS A DIFFERENT atob FAILURE MODE, and one of them alone is
  //  not enough. "a!b" is a CHARSET fault ("Invalid character"); "abcde" is a
  //  LENGTH fault ("not correctly encoded") whose every character IS in the
  //  base64 alphabet. A guard written as an alphabet regex — the shape
  //  `doc-render-html.ts` correctly uses for its non-decoding sink — passes the
  //  second one straight into the decode, so a suite testing only "a!b" would
  //  report this closed while the export still dies on a length fault.
  //
  //  ★★★ AND THE ASSERTION IS THAT A PACKAGE COMES BACK, NOT THAT NOTHING
  //  THROWS. `expect(...).not.toThrow()` would pass against a renderer that
  //  swallowed the row and emitted a corrupt zip. The user's whole document is
  //  what was at stake here: the render is synchronous inside an un-awaited
  //  `downloadDocument`, so before this guard a single bad byte row cost them
  //  the file AND the message. Assert the surviving prose and the placeholder.
  it.each([
    ["a charset fault", "a!b"],
    ["a length fault whose characters are all in the alphabet", "abcde"],
  ])("declines an image whose stored base64 has %s, and still emits the document", async (_label, bad) => {
    const zip = await unzipBytes(renderDocumentDocx(
      imageDoc(`<p>before<img data-asset-id="a1">after</p>`),
      wsWith(), "en-US", inlinedAssets({ a1: bad }),
    ));
    // No media part was minted — the row never reached the zip.
    expect(mediaPaths(zip)).toHaveLength(0);
    const xml = partText(zip, "word/document.xml");
    // The SAME placeholder an undrawable asset already gets...
    expect(xml).toContain(t("en-US", "assetExportPlaceholder", "chart.png"));
    // ...and the prose either side of it survived, which is the whole point:
    // the user got their document, minus one image they could not have had.
    expect(paraTexts(xml).join("|")).toContain("before");
    expect(paraTexts(xml).join("|")).toContain("after");
  });

  it("still embeds a GOOD image when a sibling row's base64 is malformed", async () => {
    // ★★ Anti-vacuity for the pair above: without this, a renderer that dropped
    //  EVERY image would pass both of them. One bad row must cost exactly one
    //  image, never the other.
    const zip = await unzipBytes(renderDocumentDocx(
      imageDoc(`<p><img data-asset-id="a1"><img data-asset-id="a2"></p>`),
      { ...emptyWorkspace(), documentAssets: [asset(), asset({ id: "a2", name: "good.png" })] } as Workspace,
      "en-US", inlinedAssets({ a1: "a!b", a2: PNG_B64 }),
    ));
    const media = mediaPaths(zip);
    expect(media).toHaveLength(1);
    expect(Array.from(zip.get(media[0])!)).toEqual(Array.from(base64ToBytes(PNG_B64)));
    // ★ The surviving part is image1, not image2 — declining happens BEFORE the
    //  index is claimed, so the numbering has no gap for Word to trip over.
    expect(media[0]).toBe("word/media/image1.png");
    expect(partText(zip, "word/document.xml")).toContain(t("en-US", "assetExportPlaceholder", "chart.png"));
  });

  it("keeps the text either side of an inlined image, in order", async () => {
    const zip = await unzipBytes(renderDocumentDocx(
      imageDoc(`<p>before<img data-asset-id="a1">after</p>`),
      wsWith(), "en-US", inlinedAssets({ a1: PNG_B64 }),
    ));
    const xml = partText(zip, "word/document.xml");
    // ★★★ THE PARAGRAPH LIST, NOT A PAIR OF indexOf COMPARISONS. `indexOf`
    // returns -1 for a string that is NOT THERE, and -1 is less than every real
    // index — so the ordering form is VACUOUS in the exact direction that
    // matters: a renderer which DROPS the text before an image satisfies
    // "before comes first". Measured, not reasoned: deleting the before-segment
    // emission from `paragraphBlock` left the ordering version of this test
    // GREEN. This form pins presence, order AND the split in one assertion —
    // the empty entry is the drawing's own paragraph, which carries no <w:t>.
    expect(paraTexts(xml)).toEqual(["T", "before", "", "after"]);
  });

  // ★★★ A RULE IS CONTENT THAT CARRIES NO TEXT, which is the one shape where
  // "does this fragment have visible text?" and "does this fragment emit
  // anything?" give different answers — and the emptiness gate in
  // `paragraphBlock` is asked about a fragment that a split has already stripped
  // of its own tags. `DocBlock` has no rule member (document-model.ts), so an
  // <hr> can ONLY reach a renderer inside a paragraph's html: exactly the string
  // this split cuts up. `hr` is in RICH_ALLOWED_TAGS and therefore in
  // DOCUMENT_ALLOWED_TAGS, so `sanitizeDocumentHtml` preserves one — no toolbar
  // control emits it, but AI-authored and pasted html both can, and
  // "renders a horizontal rule as a bordered paragraph" above already pins the
  // no-image shape of the very same fixture.
  it("keeps a horizontal rule that FOLLOWS an inlined image", async () => {
    const zip = await unzipBytes(renderDocumentDocx(
      imageDoc(`<p><img data-asset-id="a1"></p><hr>`),
      wsWith(), "en-US", inlinedAssets({ a1: PNG_B64 }),
    ));
    const xml = partText(zip, "word/document.xml");
    expect(xml).toContain("<w:drawing>");
    // The rule renders as a paragraph wearing a bottom border (HR_PARAGRAPH,
    // ooxml-docx-primitives.ts) — it has no run, so no text assertion can see it.
    expect(xml).toContain("<w:pBdr>");
  });

  it("keeps a horizontal rule that PRECEDES an inlined image", async () => {
    // The mirror arm: the leading segment, not the trailing one.
    const zip = await unzipBytes(renderDocumentDocx(
      imageDoc(`<hr><p><img data-asset-id="a1"></p>`),
      wsWith(), "en-US", inlinedAssets({ a1: PNG_B64 }),
    ));
    const xml = partText(zip, "word/document.xml");
    expect(xml).toContain("<w:drawing>");
    expect(xml).toContain("<w:pBdr>");
  });

  it("renders unchanged when no assets are passed at all", async () => {
    const a = await unzipBytes(renderDocumentDocx(imageDoc(`<p>x</p>`), emptyWorkspace(), "en-US"));
    const b = await unzipBytes(
      renderDocumentDocx(imageDoc(`<p>x</p>`), emptyWorkspace(), "en-US", NO_EXPORT_ASSETS),
    );
    expect(partText(a, "word/document.xml")).toBe(partText(b, "word/document.xml"));
  });

  it("sizes the image against the page width in EMU, not twips", async () => {
    // ★★★ 10092 TWIPS of content width is 6_408_420 EMU. If the twips figure is
    // passed straight through as a bound, a 480px image clamps to ~10092 EMU —
    // about a hundredth of an inch. Valid XML, green everything, invisible in
    // Word. This assertion is the only thing in the repo that can see it.
    const zip = await unzipBytes(renderDocumentDocx(
      imageDoc(`<p><img data-asset-id="a1"></p>`),
      wsWith(), "en-US", inlinedAssets({ a1: PNG_B64 }),
    ));
    const cx = Number(partText(zip, "word/document.xml").match(/<wp:extent cx="(\d+)"/)?.[1]);
    // 480px at 96dpi is 5in = 4_572_000 EMU, which fits inside 6_408_420 and is
    // therefore emitted at natural size.
    expect(cx).toBe(4_572_000);
  });

  it("numbers several images so each drawing resolves to its own part", async () => {
    const zip = await unzipBytes(renderDocumentDocx(
      imageDoc(`<p><img data-asset-id="a1"><img data-asset-id="a2"></p>`),
      wsWith(
        asset({ id: "a1", name: "one.png" }),
        asset({ id: "a2", name: "two.png" }),
      ),
      "en-US", inlinedAssets({ a1: PNG_B64, a2: PNG_B64 }),
    ));
    const xml = partText(zip, "word/document.xml");
    const rels = [...xml.matchAll(/r:embed="(rId\d+)"/g)].map((m) => m[1]);
    expect(new Set(rels).size).toBe(2);           // distinct relationship ids
    expect(rels).not.toContain("rId1");           // rId1 is the styles part
    expect(mediaPaths(zip)).toHaveLength(2);
  });
});
