// src/app/doc-render-pptx.test.ts
//
// The renderer's job is to produce a package PowerPoint will OPEN and slide
// parts that say what the blocks said. So these tests unzip the real package
// and assert on real part XML — never on "the blob is non-empty", which passes
// for a package PowerPoint refuses outright.
//
// ★ The highest-value assertions here are the escaping ones. A single raw "<"
// from user text makes a slide part malformed, and PowerPoint then rejects the
// whole file rather than degrading. Those tests parse the XML and compare
// textContent, so they fail on both malformed output AND on double-escaping —
// a `toContain("&amp;")` assertion would happily pass double-escaped text.

import { describe, it, expect } from "vitest";
import { renderDocumentPptx, segmentIntoSlides } from "./doc-render-pptx";
import { readZipEntries } from "./unzip";
import { decodeUtf8 } from "./office-xml";
import {
  COLOR_DARK_BLUE,
  COLOR_GREEN,
  COLOR_LIGHT_GREY,
  COLOR_MEDIUM_GREY,
  COLOR_PINK,
  COLOR_TEXT,
  COLOR_WHITE,
  PPTX_MAX_ROWS_PER_SECTION,
} from "./export-ooxml-shared";
import type { DocBlock, ProjectDocument } from "./document-model";
import type { Workspace } from "./workspace";

const ws = { tasks: [], raid: [] } as unknown as Workspace;

const doc = (blocks: DocBlock[], title = "Deck"): ProjectDocument => ({
  id: 1,
  title,
  blocks,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
});

/** Unzip into `path → decoded text`. ★ readZipEntries returns a
 *  Map<string, Uint8Array>, NOT an array of {path,data} — a `.map((e) => e.path)`
 *  over the result is a TypeError, not a path list. */
async function parts(d: ProjectDocument, w: Workspace = ws): Promise<Map<string, string>> {
  const blob = renderDocumentPptx(d, w, "en-US");
  const entries = await readZipEntries(await blob.arrayBuffer());
  const out = new Map<string, string>();
  for (const [path, data] of entries) out.set(path, decodeUtf8(data));
  return out;
}

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

/** Slide part XML in slide order (slide1, slide2, … — NOT Map insertion order). */
async function slides(d: ProjectDocument, w: Workspace = ws): Promise<string[]> {
  const all = await parts(d, w);
  return [...all.entries()]
    .filter(([p]) => SLIDE_RE.test(p))
    .sort((a, b) => Number(SLIDE_RE.exec(a[0])![1]) - Number(SLIDE_RE.exec(b[0])![1]))
    .map(([, xml]) => xml);
}

/** Parse as XML and fail loudly if malformed. jsdom reports a bad parse as a
 *  <parsererror> element rather than throwing. */
function parseXml(xml: string): Document {
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  const err = parsed.getElementsByTagName("parsererror")[0];
  if (err) throw new Error(`malformed XML: ${err.textContent ?? ""}`);
  return parsed;
}

/** Every <a:t> in document order — what a viewer actually reads. */
function textNodes(xml: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagName("a:t")).map((n) => n.textContent ?? "");
}

/** Text of every CONTENT slide (i.e. excluding the leading title slide). */
async function bodyText(d: ProjectDocument, w: Workspace = ws): Promise<string[]> {
  return (await slides(d, w)).slice(1).flatMap(textNodes);
}

// ---------------------------------------------------------------------------
// segmentIntoSlides — the rule most likely to regress
// ---------------------------------------------------------------------------

describe("segmentIntoSlides", () => {
  it("starts a new slide at a level-1 heading and uses it as the title", () => {
    const blocks: DocBlock[] = [
      { type: "heading", level: 1, text: "One" },
      { type: "bullets", items: ["a"] },
      { type: "heading", level: 1, text: "Two" },
    ];
    const result = segmentIntoSlides(blocks);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("One");
    expect(result[0].body).toHaveLength(1);
    expect(result[1].title).toBe("Two");
    expect(result[1].body).toEqual([]);
  });

  it("starts a new slide at a pageBreak without consuming a title", () => {
    const result = segmentIntoSlides([
      { type: "bullets", items: ["a"] },
      { type: "pageBreak" },
      { type: "bullets", items: ["b"] },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("");
    expect(result[1].title).toBe("");
    expect(result[1].body).toEqual([{ type: "bullets", items: ["b"] }]);
  });

  it("does NOT split on a level-2 or level-3 heading", () => {
    // ★ CONTROL: without this, a renderer that splits on EVERY heading passes
    // the level-1 test above for entirely the wrong reason.
    const result = segmentIntoSlides([
      { type: "heading", level: 1, text: "One" },
      { type: "heading", level: 2, text: "Sub" },
      { type: "heading", level: 3, text: "SubSub" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("One");
    expect(result[0].body).toHaveLength(2);
  });

  it("opens an untitled slide for blocks that precede any level-1 heading", () => {
    const result = segmentIntoSlides([
      { type: "bullets", items: ["a"] },
      { type: "heading", level: 1, text: "Later" },
    ]);
    expect(result.map((s) => s.title)).toEqual(["", "Later"]);
    expect(result[0].body).toHaveLength(1);
  });

  it("returns no slides for an empty block list", () => {
    expect(segmentIntoSlides([])).toEqual([]);
  });

  it("drops a segment left with neither a title nor any body", () => {
    // ★ DELIBERATE DEVIATION from the plan's snippet, which emits a slide per
    // break unconditionally: a pageBreak immediately followed by a level-1
    // heading produced a wholly BLANK slide in the middle of the deck. A blank
    // slide is a visible defect in the delivered artifact, and nothing else in
    // the pipeline removes it.
    const result = segmentIntoSlides([
      { type: "bullets", items: ["a"] },
      { type: "pageBreak" },
      { type: "heading", level: 1, text: "Two" },
      { type: "bullets", items: ["b"] },
    ]);
    expect(result.map((s) => s.title)).toEqual(["", "Two"]);
  });

  it("returns no slides for breaks alone", () => {
    expect(segmentIntoSlides([{ type: "pageBreak" }, { type: "pageBreak" }])).toEqual([]);
  });

  it("keeps a titled slide that has no body", () => {
    // The converse of the rule above — a section divider is legitimate output.
    const result = segmentIntoSlides([{ type: "heading", level: 1, text: "Divider" }]);
    expect(result).toHaveLength(1);
    expect(result[0].body).toEqual([]);
  });

  it("does not mutate the caller's block list", () => {
    const blocks: DocBlock[] = [{ type: "heading", level: 1, text: "One" }];
    const before = JSON.parse(JSON.stringify(blocks));
    segmentIntoSlides(blocks);
    expect(blocks).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Package integrity
// ---------------------------------------------------------------------------

describe("renderDocumentPptx — package integrity", () => {
  it("writes every part PowerPoint requires to open the file", async () => {
    const paths = [...(await parts(doc([]))).keys()];
    // A pptx missing any of these does not open at all; a slide part alone is
    // not a package.
    expect(paths).toContain("[Content_Types].xml");
    expect(paths).toContain("_rels/.rels");
    expect(paths).toContain("ppt/presentation.xml");
    expect(paths).toContain("ppt/_rels/presentation.xml.rels");
    expect(paths).toContain("ppt/slideMasters/slideMaster1.xml");
    expect(paths).toContain("ppt/slideLayouts/slideLayout1.xml");
    expect(paths).toContain("ppt/theme/theme1.xml");
    expect(paths).toContain("ppt/slides/slide1.xml");
    expect(paths).toContain("ppt/slides/_rels/slide1.xml.rels");
  });

  it("emits one slide part per segment PLUS the leading title slide", async () => {
    const paths = [
      ...(
        await parts(
          doc([
            { type: "heading", level: 1, text: "One" },
            { type: "heading", level: 1, text: "Two" },
          ]),
        )
      ).keys(),
    ];
    // Exact count, never toBeGreaterThan: 2 segments + 1 title slide.
    expect(paths.filter((p) => SLIDE_RE.test(p))).toHaveLength(3);
  });

  it("still emits the title slide for a document with no blocks", async () => {
    // An empty deck must remain a VALID package, not a zero-slide one.
    const paths = [...(await parts(doc([]))).keys()];
    expect(paths.filter((p) => SLIDE_RE.test(p))).toHaveLength(1);
  });

  it("declares one content-type Override and one relationship per slide", async () => {
    // The package is only coherent if these three counts agree; a mismatch
    // opens as a repair prompt.
    const all = await parts(doc([{ type: "heading", level: 1, text: "One" }]));
    const slideCount = [...all.keys()].filter((p) => SLIDE_RE.test(p)).length;
    expect(slideCount).toBe(2);
    const types = all.get("[Content_Types].xml")!;
    const rels = all.get("ppt/_rels/presentation.xml.rels")!;
    const presentation = all.get("ppt/presentation.xml")!;
    expect([...types.matchAll(/PartName="\/ppt\/slides\/slide\d+\.xml"/g)]).toHaveLength(2);
    expect([...rels.matchAll(/Target="slides\/slide\d+\.xml"/g)]).toHaveLength(2);
    expect([...presentation.matchAll(/<p:sldId /g)]).toHaveLength(2);
  });

  it("emits well-formed XML for every block type at once", async () => {
    const all = await slides(
      doc([
        { type: "heading", level: 1, text: "H1" },
        { type: "heading", level: 2, text: "H2" },
        { type: "paragraph", html: "<p>p</p>" },
        { type: "bullets", items: ["a"] },
        { type: "bullets", ordered: true, items: ["b"] },
        { type: "table", caption: "Cap", columns: ["C"], rows: [["v"]] },
        { type: "dataSection", key: "raid" },
        { type: "pageBreak" },
      ]),
    );
    expect(all.length).toBeGreaterThan(0);
    for (const xml of all) {
      expect(() => parseXml(xml)).not.toThrow();
      expect(parseXml(xml).documentElement.tagName).toBe("p:sld");
    }
  });

  it("parseXml actually detects malformed XML", () => {
    // CONTROL: without this, every well-formedness assertion above could be
    // passing because the checker itself never fails.
    expect(() => parseXml("<p:sld><a:t>unclosed</p:sld>")).toThrow(/malformed XML/);
  });
});

// ---------------------------------------------------------------------------
// The title slide
// ---------------------------------------------------------------------------

describe("renderDocumentPptx — title slide", () => {
  it("puts the document title on the FIRST slide", async () => {
    const all = await slides(doc([{ type: "heading", level: 1, text: "Body slide" }], "Quarterly review"));
    expect(textNodes(all[0])).toContain("Quarterly review");
    // …and not on the content slide that follows it.
    expect(textNodes(all[1])).not.toContain("Quarterly review");
  });
});

// ---------------------------------------------------------------------------
// Block rendering — one assertion set per DocBlock variant
// ---------------------------------------------------------------------------

describe("renderDocumentPptx — blocks", () => {
  it("renders a level-1 heading as the slide title, not as body text", async () => {
    const all = await slides(doc([{ type: "heading", level: 1, text: "Scope" }]));
    const shapeNames = Array.from(parseXml(all[1]).getElementsByTagName("p:cNvPr")).map((n) =>
      n.getAttribute("name"),
    );
    expect(shapeNames).toContain("Title");
    expect(textNodes(all[1])).toContain("Scope");
  });

  it("keeps level-2 and level-3 headings in the body", async () => {
    const text = await bodyText(
      doc([
        { type: "heading", level: 1, text: "Top" },
        { type: "heading", level: 2, text: "Middle" },
        { type: "heading", level: 3, text: "Low" },
      ]),
    );
    expect(text).toContain("Middle");
    expect(text).toContain("Low");
  });

  it("omits the title shape entirely on an untitled slide", async () => {
    const all = await slides(doc([{ type: "bullets", items: ["a"] }]));
    const shapeNames = Array.from(parseXml(all[1]).getElementsByTagName("p:cNvPr")).map((n) =>
      n.getAttribute("name"),
    );
    expect(shapeNames).not.toContain("Title");
    expect(shapeNames).toContain("Body");
  });

  it("keeps a paragraph's block boundary as separate lines instead of fusing them", async () => {
    // ★ Recorded S1 limitation: bold/italic are lost. What must NOT be lost is
    // the block boundary — three paragraphs must not arrive as one run-on line.
    const text = await bodyText(doc([{ type: "paragraph", html: "<p>one</p><p>two</p>" }]));
    expect(text).toContain("one");
    expect(text).toContain("two");
    expect(text).not.toContain("onetwo");
  });

  it("keeps a literal '<' from prose as text, not markup", async () => {
    // The projection treats "<" not followed by a letter as literal text; if
    // that regressed, this is where the package stops opening.
    const all = await slides(doc([{ type: "paragraph", html: "<p>cost < 5k</p>" }]));
    expect(() => parseXml(all[1])).not.toThrow();
    expect(textNodes(all[1]).join(" ")).toContain("< 5k");
  });

  it("renders unordered bullets with a bullet marker", async () => {
    const text = await bodyText(doc([{ type: "bullets", items: ["alpha", "beta"] }]));
    expect(text).toContain("• alpha");
    expect(text).toContain("• beta");
  });

  it("numbers ordered bullets instead of repeating a dot", async () => {
    // ★ DELIBERATE DEVIATION from the plan's snippet, which hardcoded "• " for
    // both. `ordered` is part of the model and the DOCX renderer honours it;
    // dropping it here silently discards what the author chose.
    const text = await bodyText(doc([{ type: "bullets", ordered: true, items: ["first", "second"] }]));
    expect(text).toContain("1. first");
    expect(text).toContain("2. second");
    expect(text.join(" ")).not.toContain("•");
  });

  it("renders a table's columns and rows", async () => {
    const text = await bodyText(
      doc([{ type: "table", columns: ["Risk", "Owner"], rows: [["Vendor", "Ana"]] }]),
    );
    expect(text.join("\n")).toContain("Risk");
    expect(text.join("\n")).toContain("Vendor");
    expect(text.join("\n")).toContain("Ana");
  });

  it("renders a table's caption", async () => {
    // ★ DELIBERATE DEVIATION: the plan's snippet dropped `caption` silently.
    const text = await bodyText(
      doc([{ type: "table", caption: "Top risks", columns: ["Risk"], rows: [["Vendor"]] }]),
    );
    expect(text.join("\n")).toContain("Top risks");
  });

  it("renders a table with no rows without emitting a stray blank line", async () => {
    const text = await bodyText(doc([{ type: "table", columns: ["Risk"], rows: [] }]));
    expect(text.join("\n")).toContain("Risk");
    expect(text.every((t) => t.trim() !== "")).toBe(true);
  });

  it("emits no blank line for a body that renders to nothing", async () => {
    // pageBreak is consumed by segmentation; if one ever reaches slideLines it
    // must render as nothing rather than as a blank line. The positive half —
    // that the surrounding content IS present — is what stops this passing on
    // an empty text list.
    const text = await bodyText(doc([{ type: "bullets", items: ["a"] }]));
    expect(text).toContain("• a");
    expect(text.every((t) => t.trim() !== "")).toBe(true);
  });

  it("keeps body blocks in author order", async () => {
    const text = await bodyText(
      doc([
        { type: "heading", level: 2, text: "AAA" },
        { type: "heading", level: 2, text: "BBB" },
      ]),
    );
    expect(text.indexOf("AAA")).toBeLessThan(text.indexOf("BBB"));
  });
});

// ---------------------------------------------------------------------------
// XML escaping — the assertions that decide whether the file opens at all
// ---------------------------------------------------------------------------

describe("renderDocumentPptx — XML escaping", () => {
  const HOSTILE = `A & B < C > D " E ' F`;

  it("escapes the document title on the title slide", async () => {
    const all = await slides(doc([], HOSTILE));
    expect(() => parseXml(all[0])).not.toThrow();
    expect(textNodes(all[0])).toContain(HOSTILE);
  });

  it("escapes a slide title", async () => {
    const all = await slides(doc([{ type: "heading", level: 1, text: HOSTILE }]));
    expect(() => parseXml(all[1])).not.toThrow();
    expect(textNodes(all[1])).toContain(HOSTILE);
  });

  it("escapes body heading text", async () => {
    const text = await bodyText(doc([{ type: "heading", level: 2, text: HOSTILE }]));
    expect(text).toContain(HOSTILE);
  });

  it("escapes bullet items", async () => {
    const text = await bodyText(doc([{ type: "bullets", items: [HOSTILE] }]));
    expect(text).toContain(`• ${HOSTILE}`);
  });

  it("escapes table headers and cells", async () => {
    const all = await slides(doc([{ type: "table", columns: [HOSTILE], rows: [[HOSTILE]] }]));
    expect(() => parseXml(all[1])).not.toThrow();
    const joined = textNodes(all[1]).join("\n");
    expect(joined).toContain(HOSTILE);
    // Double-escaping would render the entity itself as visible text.
    expect(joined).not.toContain("&amp;");
  });

  it("escapes text projected out of paragraph html", async () => {
    const text = await bodyText(doc([{ type: "paragraph", html: "<p>Tom &amp; Jerry</p>" }]));
    expect(text).toContain("Tom & Jerry");
    expect(text.join(" ")).not.toContain("&amp;");
  });

  it("does not let script-shaped text become markup", async () => {
    const nasty = `<script>alert(1)</script>`;
    const all = await slides(doc([{ type: "heading", level: 1, text: nasty }]));
    expect(() => parseXml(all[1])).not.toThrow();
    expect(parseXml(all[1]).getElementsByTagName("script")).toHaveLength(0);
    expect(textNodes(all[1])).toContain(nasty);
  });
});

// ---------------------------------------------------------------------------
// dataSection — routed through the real export-sections registry
// ---------------------------------------------------------------------------

describe("renderDocumentPptx — dataSection", () => {
  const wsWithRaid = {
    tasks: [],
    raid: [
      { id: 1, title: "Vendor delay", category: "Risk", status: "Open" },
      { id: 2, title: "Budget & scope <risk>", category: "Risk", status: "Open" },
    ],
  } as unknown as Workspace;

  it("routes a dataSection key through the real registry", async () => {
    const text = await bodyText(doc([{ type: "dataSection", key: "raid" }]), wsWithRaid);
    expect(text.join("\n")).toContain("Vendor delay");
  });

  it("escapes data pulled from the workspace", async () => {
    const all = await slides(doc([{ type: "dataSection", key: "raid" }]), wsWithRaid);
    expect(() => parseXml(all[1])).not.toThrow();
    expect(textNodes(all[1]).join("\n")).toContain("Budget & scope <risk>");
  });

  it("renders nothing when the section has no data, dropping the slide entirely", async () => {
    // Empty registers are the common case in a fresh project; a stray heading
    // would otherwise appear on every generated deck.
    // ★ The POSITIVE observable is the slide COUNT. Asserting only that the
    // text lacks "RAID" is vacuous — it passes just as well if the renderer
    // produced no text at all for an unrelated reason, which is precisely the
    // failure this test would then hide.
    const all = await slides(doc([{ type: "dataSection", key: "raid" }]), ws);
    expect(all).toHaveLength(1); // the title slide, and nothing else
    // CONTROL: the same block against a POPULATED workspace does yield a slide,
    // so the count above reflects emptiness and not a broken fixture.
    expect(await slides(doc([{ type: "dataSection", key: "raid" }]), wsWithRaid)).toHaveLength(2);
  });

  it("selects only the requested section", async () => {
    const both = {
      tasks: [{ id: 9, title: "A task", status: "To Do" }],
      raid: [{ id: 1, title: "Vendor delay", category: "Risk", status: "Open" }],
    } as unknown as Workspace;
    const text = await bodyText(doc([{ type: "dataSection", key: "raid" }]), both);
    expect(text.join("\n")).toContain("Vendor delay");
    expect(text.join("\n")).not.toContain("A task");
  });

  it("caps a long section at PPTX_MAX_ROWS_PER_SECTION and says it truncated", async () => {
    // ★ Reuses the exporter's own constant rather than inventing a cap. An
    // uncapped 500-row register produces one unreadable text box per slide.
    const many = {
      tasks: [],
      raid: Array.from({ length: PPTX_MAX_ROWS_PER_SECTION + 25 }, (_, i) => ({
        id: i + 1,
        title: `Risk ${i + 1}`,
        category: "Risk",
        status: "Open",
      })),
    } as unknown as Workspace;
    const text = await bodyText(doc([{ type: "dataSection", key: "raid" }]), many);
    const joined = text.join("\n");
    expect(joined).toContain("Risk 1");
    expect(joined).toContain(`Risk ${PPTX_MAX_ROWS_PER_SECTION}`);
    expect(joined).not.toContain(`Risk ${PPTX_MAX_ROWS_PER_SECTION + 1}`);
    expect(joined).toContain(String(PPTX_MAX_ROWS_PER_SECTION + 25));
  });
});

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

describe("renderDocumentPptx — palette", () => {
  it("uses only sanctioned Acme colours in the slide parts", async () => {
    const sanctioned = [
      COLOR_DARK_BLUE,
      COLOR_GREEN,
      COLOR_LIGHT_GREY,
      COLOR_MEDIUM_GREY,
      COLOR_PINK,
      COLOR_TEXT,
      COLOR_WHITE,
    ];
    const all = await slides(
      doc([
        { type: "heading", level: 1, text: "One" },
        { type: "bullets", items: ["a"] },
      ]),
    );
    const hexes = all.flatMap((xml) =>
      [...xml.matchAll(/<a:srgbClr val="([0-9A-Fa-f]{6})"\/>/g)].map((m) => m[1]),
    );
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) expect(sanctioned).toContain(hex);
  });
});
