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
import { renderDocumentPptx, segmentIntoSlides, paginateLines } from "./doc-render-pptx";
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
import type { RunMark } from "./rich-text-runs";

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

type RunInfo = {
  text: string;
  /** Every `<a:rPr>` ATTRIBUTE by name. DrawingML puts b/i/u/strike/baseline
   *  here, so this is where a mark shows up. */
  attrs: Record<string, string>;
  /** `<a:rPr>` CHILD tag names IN DOCUMENT ORDER. CT_TextCharacterProperties
   *  is an XML SEQUENCE, so the order is itself the assertion. */
  childTags: string[];
  typeface: string | null;
  highlight: string | null;
};

/**
 * Every `<a:r>` in a slide, each paired with ITS OWN properties.
 *
 * ★★ The point of pairing. A `toContain('b="1"')` over the whole part passes
 * on any slide that happens to contain a bold run ANYWHERE — including the
 * title shape, which is bold on every content slide — so it pins nothing about
 * which run carries which mark. Every assertion below looks a run up by its
 * text and reads that run's properties.
 */
function runInfos(xml: string): RunInfo[] {
  return Array.from(parseXml(xml).getElementsByTagName("a:r")).map((r) => {
    const rPr = r.getElementsByTagName("a:rPr")[0] ?? null;
    const attrs: Record<string, string> = {};
    for (const a of Array.from(rPr?.attributes ?? [])) attrs[a.name] = a.value;
    const highlight = rPr?.getElementsByTagName("a:highlight")[0] ?? null;
    return {
      text: r.getElementsByTagName("a:t")[0]?.textContent ?? "",
      attrs,
      childTags: Array.from(rPr?.children ?? []).map((c) => c.tagName),
      typeface: rPr?.getElementsByTagName("a:latin")[0]?.getAttribute("typeface") ?? null,
      highlight: highlight?.getElementsByTagName("a:srgbClr")[0]?.getAttribute("val") ?? null,
    };
  });
}

/** One slide's runs keyed by their text. ★ Throws on a duplicate key rather
 *  than silently keeping the last, which would make a lookup answer about a
 *  run the test did not mean. */
function runsByText(xml: string): Map<string, RunInfo> {
  const map = new Map<string, RunInfo>();
  for (const info of runInfos(xml)) {
    if (map.has(info.text)) throw new Error(`ambiguous run text: ${JSON.stringify(info.text)}`);
    map.set(info.text, info);
  }
  return map;
}

/** Every TEXT `<a:p>` as its OWN text plus its paragraph properties.
 *
 *  ★★ Assert on this, never on a flat `<a:t>` list: a flat list is identical
 *  whether two lines are separate paragraphs or fused into one, which is the
 *  regression this whole path exists to prevent.
 *  ★ The background rect and the accent bar each carry a placeholder
 *  `<a:p><a:endParaRPr/></a:p>`, so filtering on `<a:t>` PRESENCE (never on
 *  non-empty text — a body line CAN legitimately be blank, and is how the gap
 *  between two blocks is drawn) is what keeps two decorative shapes out of
 *  every paragraph assertion below.
 *  ★★ `indent` is captured alongside `marL`, not folded into it: a renderer
 *  that emits `marL` but drops `indent="0"` hangs the first line of an
 *  indented paragraph past the rest, since `indent` is a first-line DELTA and ANY
 *  non-zero value inherited from the layout would move line one alone (the primitive
 *  states it conditionally, and so does this: what PowerPoint actually defaults to was
 *  never measured, so the guard rests on the deletion test below, not on that) — and a
 *  `marL`-only
 *  assertion cannot see that regression at all (measured: deleting `indent="0"`
 *  from the primitive left the whole suite green before this field existed). */
function paraInfos(
  xml: string,
): Array<{ text: string; marL: string | null; indent: string | null }> {
  return Array.from(parseXml(xml).getElementsByTagName("a:p"))
    .filter((p) => p.getElementsByTagName("a:t").length > 0)
    .map((p) => ({
      text: Array.from(p.getElementsByTagName("a:t"))
        .map((t) => t.textContent ?? "")
        .join(""),
      marL: p.getElementsByTagName("a:pPr")[0]?.getAttribute("marL") ?? null,
      indent: p.getElementsByTagName("a:pPr")[0]?.getAttribute("indent") ?? null,
    }));
}

/** The single CONTENT slide of an untitled one-block document. Untitled means
 *  no Title shape, so every run and paragraph on it is body content. */
async function onlyContentSlide(html: string): Promise<string> {
  const all = await slides(doc([{ type: "paragraph", html }]));
  expect(all).toHaveLength(2);
  return all[1];
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
// paginateLines — the overflow rule
// ---------------------------------------------------------------------------

describe("paginateLines", () => {
  it("keeps content that fits on a single chunk", () => {
    expect(paginateLines(["a", "b"], 5)).toEqual([["a", "b"]]);
  });

  it("continues overflow onto further chunks instead of clipping it", () => {
    // ★ The whole point: nothing may be DROPPED. A renderer that truncated
    // would pass a "first chunk is right" assertion, so this checks the
    // round-trip of every line.
    const lines = ["1", "2", "3", "4", "5"];
    const chunks = paginateLines(lines, 2);
    expect(chunks).toEqual([["1", "2"], ["3", "4"], ["5"]]);
    expect(chunks.flat()).toEqual(lines);
  });

  it("returns one empty chunk for no lines, so a titled slide still renders", () => {
    expect(paginateLines([], 5)).toEqual([[]]);
  });

  it("drops a blank line left leading by a chunk boundary", () => {
    // A gap between blocks is typography mid-slide and dead space at the top
    // of a continuation slide.
    const chunks = paginateLines(["a", "b", "", "c"], 2);
    expect(chunks[1][0]).not.toBe("");
    expect(chunks.flat().filter((l) => l === "")).toEqual([]);
  });

  it("keeps a blank line that falls INSIDE a chunk", () => {
    // CONTROL for the test above — otherwise a renderer that stripped every
    // blank line would pass it, defeating the block-gap behaviour.
    expect(paginateLines(["a", "", "b"], 5)).toEqual([["a", "", "b"]]);
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

  it("continues an over-long slide onto further slides, losing no content", async () => {
    // ★★ 40 bullets against a 16-line budget. The failure this prevents is
    // INVISIBLE in the XML — bodyPr carries no autofit, so PowerPoint lets the
    // text run off the slide rather than shrinking it, and only opening the
    // deck would show it. Assert on what IS observable: the line count per
    // slide, and that every bullet survives somewhere.
    const items = Array.from({ length: 40 }, (_, i) => `item ${i + 1}`);
    const all = await slides(doc([{ type: "heading", level: 1, text: "Long" }, { type: "bullets", items }]));
    // 1 title slide + ceil(40 / 16) = 3 content slides.
    expect(all).toHaveLength(4);
    const perSlide = all.slice(1).map((xml) => textNodes(xml));
    for (const lines of perSlide) {
      // Each content slide holds its title plus at most the body budget.
      expect(lines.length).toBeLessThanOrEqual(16 + 1);
    }
    const joined = perSlide.flat();
    for (const item of items) expect(joined).toContain(`• ${item}`);
  });

  it("marks continuation slides numerically and titles the first one plainly", async () => {
    const items = Array.from({ length: 40 }, (_, i) => `item ${i + 1}`);
    const all = await slides(doc([{ type: "heading", level: 1, text: "Long" }, { type: "bullets", items }]));
    const titles = all.slice(1).map((xml) => textNodes(xml)[0]);
    expect(titles).toEqual(["Long (1/3)", "Long (2/3)", "Long (3/3)"]);
  });

  it("adds no marker when the content fits on one slide", async () => {
    // CONTROL: without this, a renderer that ALWAYS appended "(1/1)" would
    // pass the marker test above while disfiguring every ordinary slide.
    const all = await slides(doc([{ type: "heading", level: 1, text: "Short" }, { type: "bullets", items: ["a"] }]));
    expect(all).toHaveLength(2);
    expect(textNodes(all[1])[0]).toBe("Short");
  });

  it("keeps the three package counts in agreement WITH pagination in play", async () => {
    // ★ This trio is what catches a PowerPoint repair prompt, and pagination
    // makes it do more work: the slide count is no longer the segment count.
    const items = Array.from({ length: 40 }, (_, i) => `item ${i + 1}`);
    const all = await parts(doc([{ type: "heading", level: 1, text: "Long" }, { type: "bullets", items }]));
    const slideCount = [...all.keys()].filter((p) => SLIDE_RE.test(p)).length;
    expect(slideCount).toBe(4);
    expect([...all.get("[Content_Types].xml")!.matchAll(/PartName="\/ppt\/slides\/slide\d+\.xml"/g)])
      .toHaveLength(slideCount);
    expect([...all.get("ppt/_rels/presentation.xml.rels")!.matchAll(/Target="slides\/slide\d+\.xml"/g)])
      .toHaveLength(slideCount);
    expect([...all.get("ppt/presentation.xml")!.matchAll(/<p:sldId /g)]).toHaveLength(slideCount);
    // …and one _rels part per slide.
    expect([...all.keys()].filter((p) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(p)))
      .toHaveLength(slideCount);
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
    // ★ Marks used to be lost here (recorded S1 limitation) — they survive now,
    // see the "paragraph marks" suite. What must NOT be lost either way is the
    // block boundary: three paragraphs must not arrive as one run-on line.
    const text = await bodyText(doc([{ type: "paragraph", html: "<p>one</p><p>two</p>" }]));
    expect(text).toContain("one");
    expect(text).toContain("two");
    expect(text).not.toContain("onetwo");
  });

  it("upgrades a legacy plain-text paragraph instead of fusing its lines", async () => {
    // Sibling of the DOCX suite's test of the same name — the composition is at
    // THREE renderer call sites, so each needs its own pin or deleting one goes
    // unnoticed. A hand-edited or externally-produced workspace can store
    // {"type":"paragraph","html":"a\nb"}: neither load-path sanitizer upgrades
    // it, so the renderer is where the newline must become a line break
    // (open-followups §118). Asserting SEPARATE paragraphs, not "<a:br/>" —
    // htmlToRichLines ENDS a line at the <br> plainToHtml produces.
    const texts = paraInfos(await onlyContentSlide("a\nb")).map((p) => p.text);
    expect(texts).toEqual(["a", "b"]);
  });

  it("keeps a paragraph opening with an unlisted tag as TEXT, not escaped markup", async () => {
    // ★★★ Sibling of the DOCX test of the same name. The upgrade above must not
    // be bought by escaping real markup: htmlToRichLines keeps every tag's
    // text, so the classifier has to be the "render" sink. Under "document",
    // each of these came back as its own literal characters in one run.
    for (const [html, text] of [
      ["<h3>Sub</h3>", "Sub"],
      ["<div>Status</div>", "Status"],
      ["<table><tr><td>cell</td></tr></table>", "cell"],
    ]) {
      expect(paraInfos(await onlyContentSlide(html)).map((p) => p.text)).toEqual([text]);
    }
  });

  it("keeps markup that does not OPEN with a tag as markup", async () => {
    // ★★★ Sibling of the DOCX test of the same name. The render classifier asks
    // "does this CONTAIN a tag at all?", never "does it START with one" — while
    // it was anchored, "Intro <strong>bold</strong> tail" was escaped WHOLE and
    // PowerPoint showed the literal tag characters.
    const xml = await onlyContentSlide("Intro <strong>bold</strong> tail");
    // POSITIVE form: the mark reached the run that carries it. Asserting only
    // the absence of "&lt;strong" would be satisfied by an empty slide.
    expect(runsByText(xml).get("bold")!.attrs.b).toBe("1");
    expect(paraInfos(xml).map((p) => p.text)).toEqual(["Intro bold tail"]);
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

  it("keeps a row on ONE line when a cell contains a newline", async () => {
    // ★★ REACHABLE, not theoretical: export-sections routes every rich column
    // through descriptionTextWithBreaks (`richCell`), which emits "\n" at a
    // block boundary — so a two-paragraph RAID description arrives as a cell
    // with a newline in it. pptxTextBox splits its text on "\n" to make one
    // <a:p> per line, so an unhandled cell newline breaks the row in half and
    // the trailing columns start a new line with no headers above them. In a
    // table laid out as TEXT, that silently destroys column alignment.
    const text = await bodyText(
      doc([
        {
          type: "table",
          columns: ["Risk", "Owner"],
          rows: [["line one\nline two", "Ana"]],
        },
      ]),
    );
    const row = text.find((l) => l.includes("line one"));
    expect(row).toBeDefined();
    expect(row).toContain("line two");
    expect(row).toContain("Ana");
    // No fragment may be left stranded on its own line.
    expect(text).not.toContain("line two  |  Ana");
    expect(text.some((l) => l.trim() === "line two")).toBe(false);
  });

  it("keeps a dataSection row on one line when a rich cell spans blocks", async () => {
    const wsMultiline = {
      tasks: [],
      raid: [
        {
          id: 1,
          title: "Vendor delay",
          category: "Risk",
          status: "Open",
          description: "<p>first para</p><p>second para</p>",
        },
      ],
    } as unknown as Workspace;
    const text = await bodyText(doc([{ type: "dataSection", key: "raid" }]), wsMultiline);
    const row = text.find((l) => l.includes("first para"));
    expect(row).toBeDefined();
    expect(row).toContain("second para");
    expect(text.some((l) => l.trim() === "second para")).toBe(false);
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

  it("separates two blocks with exactly one blank line", async () => {
    // ★ A blanket `filter(l => l.trim() !== "")` used to strip every empty
    // line, so consecutive paragraphs abutted and read as one. The gap BETWEEN
    // blocks is typography; blanks INSIDE a block are artifacts and still go.
    const text = await bodyText(
      doc([
        { type: "paragraph", html: "<p>one</p>" },
        { type: "paragraph", html: "<p>two</p>" },
      ]),
    );
    expect(text).toEqual(["one", "", "two"]);
  });

  it("does not put a blank line before the first block or after the last", async () => {
    const text = await bodyText(doc([{ type: "paragraph", html: "<p>only</p>" }]));
    expect(text).toEqual(["only"]);
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
// Paragraph marks — the styled-run path
// ---------------------------------------------------------------------------

describe("renderDocumentPptx — paragraph marks", () => {
  it("gives each run the DrawingML property for its OWN mark", async () => {
    const xml = await onlyContentSlide(
      "<p><strong>bo</strong><em>it</em><u>un</u><s>st</s></p>",
    );
    const by = runsByText(xml);
    // Positive half: the mark reaches the run that carries it…
    expect(by.get("bo")!.attrs.b).toBe("1");
    expect(by.get("it")!.attrs.i).toBe("1");
    expect(by.get("un")!.attrs.u).toBe("sng");
    expect(by.get("st")!.attrs.strike).toBe("sngStrike");
    // …negative half: and reaches NO other run. Without this, a renderer that
    // stamped every property on every run passes the four assertions above.
    expect(by.get("bo")!.attrs.i).toBeUndefined();
    expect(by.get("it")!.attrs.b).toBeUndefined();
    expect(by.get("un")!.attrs.strike).toBeUndefined();
    expect(by.get("st")!.attrs.u).toBeUndefined();
  });

  it("leaves an unmarked run with no mark attributes and no rPr children", async () => {
    // CONTROL for the whole suite: plain prose must not acquire styling.
    const by = runsByText(await onlyContentSlide("<p>plain</p>"));
    const run = by.get("plain")!;
    expect(run.attrs.b).toBeUndefined();
    expect(run.attrs.i).toBeUndefined();
    expect(run.attrs.u).toBeUndefined();
    expect(run.attrs.strike).toBeUndefined();
    expect(run.attrs.baseline).toBeUndefined();
    expect(run.childTags).toEqual([]);
    // …but it IS still a real run with the body size, not an empty shell.
    expect(run.attrs.sz).toBe("1400");
  });

  it("distinguishes superscript from subscript by the SIGN of baseline", async () => {
    // ★ One `baseline` attribute carries both, so a renderer that mapped the
    // two marks to the same value would look correct in any test that only
    // asserted "a baseline is present".
    const by = runsByText(await onlyContentSlide("<p>H<sub>lo</sub>O<sup>hi</sup></p>"));
    expect(by.get("lo")!.attrs.baseline).toBe("-25000");
    expect(by.get("hi")!.attrs.baseline).toBe("30000");
    expect(by.get("H")!.attrs.baseline).toBeUndefined();
  });

  it("renders code as a monospace latin face, not unstyled", async () => {
    const by = runsByText(await onlyContentSlide("<p>say <code>npm run</code></p>"));
    expect(by.get("npm run")!.typeface).toBe("Consolas");
    expect(by.get("npm run")!.childTags).toEqual(["a:latin"]);
    // The surrounding prose keeps the theme face.
    expect(by.get("say ")!.typeface).toBeNull();
  });

  it("renders highlight as a real sanctioned colour, not unstyled", async () => {
    // ★ Unlike WordprocessingML's closed ST_HighlightColor enum, `a:highlight`
    // takes a colour — so the DOCX renderer's "yellow was forced on us"
    // argument does not transfer, and this pins the choice that replaced it.
    const by = runsByText(await onlyContentSlide("<p>see <mark>this bit</mark></p>"));
    expect(by.get("this bit")!.highlight).toBe(COLOR_GREEN);
    expect(by.get("this bit")!.childTags).toEqual(["a:highlight"]);
    expect(by.get("see ")!.highlight).toBeNull();
  });

  it("orders rPr children by the SCHEMA sequence, not by HTML nesting order", async () => {
    // ★★★ CT_TextCharacterProperties is a sequence: highlight precedes latin.
    // Marks arrive in HTML nesting order, which is unrelated — so BOTH
    // nestings must produce the same child order. A renderer emitting arrival
    // order passes on one of these two and fails on the other.
    const outer = runsByText(await onlyContentSlide("<p><mark><code>aa</code></mark></p>"));
    const inner = runsByText(await onlyContentSlide("<p><code><mark>bb</mark></code></p>"));
    expect(outer.get("aa")!.childTags).toEqual(["a:highlight", "a:latin"]);
    expect(inner.get("bb")!.childTags).toEqual(["a:highlight", "a:latin"]);
    // …and both really do carry both, so the order above is not vacuous.
    expect(inner.get("bb")!.typeface).toBe("Consolas");
    expect(inner.get("bb")!.highlight).toBe(COLOR_GREEN);
  });

  it("draws a horizontal rule that a runs-only mapping would have dropped", async () => {
    // ★★ An `hr` RichLine carries ZERO runs, so mapping `line.runs` blindly
    // emits an empty paragraph and the rule disappears — and any test that
    // only checked the surrounding text would still pass. The line COUNT and
    // the rule's own shape are what catch it.
    const text = await bodyText(doc([{ type: "paragraph", html: "<p>above</p><hr><p>below</p>" }]));
    expect(text).toHaveLength(3);
    expect(text[0]).toBe("above");
    expect(text[2]).toBe("below");
    expect(text[1]).toMatch(/^—+$/);
  });

  it("indents a blockquote and italicises it with DIRECT formatting", async () => {
    // ★ A slide package has no style part, so a `pStyle`-style name would
    // silently no-op — the indent has to be on the paragraph and the italic on
    // every run.
    const xml = await onlyContentSlide("<blockquote>quoted words</blockquote>");
    expect(paraInfos(xml)).toEqual([{ text: "quoted words", marL: "228600", indent: "0" }]);
    expect(runsByText(xml).get("quoted words")!.attrs.i).toBe("1");
  });

  it("renders a pre block monospace on EVERY run, and indents it", async () => {
    const xml = await onlyContentSlide("<pre>a <em>b</em></pre>");
    expect(paraInfos(xml)).toEqual([{ text: "a b", marL: "228600", indent: "0" }]);
    for (const run of runInfos(xml)) expect(run.typeface).toBe("Consolas");
  });

  it("leaves an ordinary paragraph un-indented", async () => {
    // CONTROL: without this, a renderer that indented everything passes both
    // tests above while shifting all body prose right.
    expect(paraInfos(await onlyContentSlide("<p>flush left</p>"))).toEqual([
      { text: "flush left", marL: null, indent: null },
    ]);
  });

  it("keeps each block boundary in its OWN <a:p> when runs are styled", async () => {
    // ★★ Asserted per paragraph, never as a flat <a:t> list: a flat list reads
    // identically whether two lines are separate paragraphs or fused into one,
    // which is exactly the regression multi-run output can reintroduce.
    const xml = await onlyContentSlide(
      "<p><strong>one</strong> and <em>two</em></p><p>three</p>",
    );
    expect(paraInfos(xml).map((p) => p.text)).toEqual(["one and two", "three"]);
  });

  it("escapes hostile text inside a styled run exactly once", async () => {
    const xml = await onlyContentSlide("<p><strong>Tom &amp; Jerry &lt;x&gt;</strong></p>");
    expect(() => parseXml(xml)).not.toThrow();
    const by = runsByText(xml);
    // Round-tripped through a real XML parse, so this fails on a raw "&" AND
    // on a double-escaped "&amp;amp;".
    expect(by.get("Tom & Jerry <x>")!.attrs.b).toBe("1");
    expect(xml).not.toContain("&amp;amp;");
  });
});

// ---------------------------------------------------------------------------
// Mark-mapping exhaustiveness — the guard DOCX gets from its type and this
// renderer does not
// ---------------------------------------------------------------------------

// ★★★ EXHAUSTIVE over RunMark, mirroring chat-tools-documents.test.ts's
// TAG_SAMPLE idiom: a `Record<RunMark, string>`, never a bare `RunMark[]`
// array — an array has the same completeness hole one level up (nothing
// forces it to grow when RunMark does), so a 9th mark could go unlisted there
// too and the "exhaustive" guard would say nothing while looking complete.
// TS2741 fires the moment RunMark grows and this map does not.
//
// ★★★ THIS IS THE ONLY GUARD ON THE PPTX SIDE. doc-render-docx.ts's
// DOCX_MARK_RPR is a real `Record<RunMark, …>`, so a new mark is a TYPECHECK
// ERROR there. `pptxRun` (doc-render-pptx.ts) is a chain of independent
// `has("…")` calls with no such backstop — vitest never typechecks (AGENTS.md),
// so even the DOCX-side tsc error is invisible to `npm run test:run`, and
// nothing at all flags the PPTX side: a mark added to the union and wired into
// the parser but never read by a new `has(...)` in `pptxRun` renders that run
// completely unstyled in the real .pptx, silently. Measured 2026-08-08: adding
// a 9th `RunMark` produced exactly one tsc error (DOCX's Record) and zero
// vitest failures anywhere before this block existed.
//
// ★ Each sample isolates its mark inside a PLAIN `<p>` (never blockquote/pre),
// so the line KIND cannot also contribute italic/monospace and mask a
// genuinely missing mark-specific branch in `pptxRun`.
const MARK_SAMPLE: Record<RunMark, string> = {
  bold: "<p><strong>x</strong></p>",
  italic: "<p><em>x</em></p>",
  underline: "<p><u>x</u></p>",
  strike: "<p><s>x</s></p>",
  code: "<p><code>x</code></p>",
  highlight: "<p><mark>x</mark></p>",
  sub: "<p><sub>x</sub></p>",
  sup: "<p><sup>x</sup></p>",
};

describe("renderDocumentPptx — every RunMark reaches the slide", () => {
  it("gives each mark an rPr that differs from an unmarked run's", async () => {
    // Baseline: an unmarked run's rPr signature — no b/i/u/strike/baseline
    // attributes and no rPr children (pinned exactly by the CONTROL test in
    // the "paragraph marks" suite above). A mark that silently fails to reach
    // `pptxRun` renders identically to this.
    const baseline = runsByText(await onlyContentSlide("<p>x</p>")).get("x")!;
    const baselineSig = JSON.stringify({ attrs: baseline.attrs, childTags: baseline.childTags });
    for (const mark of Object.keys(MARK_SAMPLE) as RunMark[]) {
      const run = runsByText(await onlyContentSlide(MARK_SAMPLE[mark])).get("x")!;
      const sig = JSON.stringify({ attrs: run.attrs, childTags: run.childTags });
      expect(sig, `<${mark}> produced an rPr identical to an unmarked run`).not.toBe(baselineSig);
    }
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
        // ★ The highlight run is here deliberately. `a:highlight` carries an
        // `a:srgbClr`, so it is the one place a renderer can put an off-palette
        // hex into a slide part — and this file's own palette test is the ONLY
        // gate that sees it (the repo-wide palette sweep scans CSS). Without
        // this block the suite said nothing about the colour a `<mark>` picks.
        { type: "paragraph", html: "<p><mark>lit</mark></p>" },
      ]),
    );
    const hexes = all.flatMap((xml) =>
      [...xml.matchAll(/<a:srgbClr val="([0-9A-Fa-f]{6})"\/>/g)].map((m) => m[1]),
    );
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) expect(sanctioned).toContain(hex);
    // …and the highlight really did render, so the sweep above is not passing
    // because the paragraph produced no colour at all.
    expect(hexes).toContain(COLOR_GREEN);
  });
});

// ---------------------------------------------------------------------------
// The RichLine kinds a rich paragraph block gained in §141(b)
// ---------------------------------------------------------------------------

describe("new RichLine kinds in a document paragraph block (§141(b))", () => {
  // ★★ Asserted through `paraInfos`, NOT `toContain("1. first")` over the raw
  // part. The marker is its OWN <a:r> (it must inherit no marks), so the two
  // strings are never contiguous in the XML and a substring assertion could
  // only ever be weakened to "the digit appears somewhere" — which passes on a
  // marker emitted into the WRONG paragraph. `paraInfos` joins the <a:t>s of
  // ONE <a:p>, so it pins the pairing as well as the text.
  // ★★ EVERY LIST FIXTURE BELOW IS <p>-WRAPPED, and that is the point. Tiptap's
  // listItem spec is `paragraph block*`, so a real value reads
  // "<ul><li><p>a</p></li></ul>" and the bare "<li>a</li>" these cases used to
  // carry never reaches the parser's transparency arm at all — a shape no
  // editor emits, which is how a CRITICAL already hid once in this slice. TWO
  // bare companions are kept, since the golden fixtures and legacy stored
  // values do carry that form and both must reach the same bytes — the
  // numbering case below and the marker-marks case at the end of the block.
  // ★ The count is stated because this comment's own warrant is "a shape no
  // editor emits"; a reader auditing which fixtures are deliberately unreal
  // needs the enumeration to be right. Reproduce:
  // `grep -n "<li>" src/app/doc-render-pptx.test.ts | grep -v "<li><p>" | grep -v data-checked`
  // returns three lines — the two fixtures plus the `it(...)` title above one
  // of them. ★ No coverage rides on the second one being bare: both shapes
  // measurably produce identical lines.
  it("prefixes a list item with its marker and indents it", async () => {
    const xml = await onlyContentSlide("<ol><li><p>first</p></li><li><p>second</p></li></ol>");
    expect(paraInfos(xml)).toEqual([
      { text: "1. first", marL: "228600", indent: "0" },
      { text: "2. second", marL: "228600", indent: "0" },
    ]);
  });

  it("numbers a bare <li> the same way the editor's nested <p> is numbered", async () => {
    const xml = await onlyContentSlide("<ol><li>first</li><li>second</li></ol>");
    expect(paraInfos(xml)).toEqual([
      { text: "1. first", marL: "228600", indent: "0" },
      { text: "2. second", marL: "228600", indent: "0" },
    ]);
  });

  it("uses a bullet for an unordered list and indents deeper for nesting", async () => {
    const xml = await onlyContentSlide(
      "<ul><li><p>top</p><ul><li><p>nested</p></li></ul></li></ul>",
    );
    expect(paraInfos(xml)).toEqual([
      { text: "• top", marL: "228600", indent: "0" },
      { text: "• nested", marL: "457200", indent: "0" },
    ]);
  });

  it("marks a task item with its checked state rather than a bullet", async () => {
    const xml = await onlyContentSlide(
      '<ul data-type="taskList"><li data-checked="true"><p>done</p></li>' +
        '<li data-checked="false"><p>todo</p></li></ul>',
    );
    expect(paraInfos(xml).map((p) => p.text)).toEqual(["[x] done", "[ ] todo"]);
  });

  it("indents a wrapped item's continuation without repeating the marker", async () => {
    // ★★ Shift+Enter inside a bullet. The continuation copies the item's depth,
    // so `pptxIndentFor` gives it the SAME marL — and it must carry no second
    // marker run, or a two-line bullet reads as two bullets.
    const xml = await onlyContentSlide("<ol><li><p>a<br>b</p></li><li><p>c</p></li></ol>");
    expect(paraInfos(xml)).toEqual([
      { text: "1. a", marL: "228600", indent: "0" },
      { text: "b", marL: "228600", indent: "0" },
      { text: "2. c", marL: "228600", indent: "0" },
    ]);
  });

  it("does not indent a heading line", async () => {
    // ★★★ THE DEFECT THIS BLOCK EXISTS FOR. Before the kinds widened, an <h2>
    // inside a paragraph block parsed as `kind: "p"` and took no indent; it now
    // parses as "heading", so a `kind === "p" ? undefined : RICH_INDENT_EMU`
    // test silently starts indenting every section title to the blockquote
    // depth. Nothing else in this suite can see that.
    expect(paraInfos(await onlyContentSlide("<h2>Section</h2>"))).toEqual([
      { text: "Section", marL: null, indent: null },
    ]);
  });

  it("leaves a list item's own runs unstyled by the marker", async () => {
    // The marker is a run, so it must not pick up the item's marks — and the
    // item's text must keep them.
    const xml = await onlyContentSlide("<ul><li><strong>bold item</strong></li></ul>");
    const by = runsByText(xml);
    expect(by.get("bold item")!.attrs.b).toBe("1");
    expect(by.get("• ")!.attrs.b).toBeUndefined();
  });
});
