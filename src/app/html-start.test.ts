import { describe, expect, it } from "vitest";
import {
  DOCUMENT_ALLOWED_TAGS,
  NOTE_ALLOWED_TAGS,
  TEMPLATE_ALLOWED_TAGS,
} from "./sanitize-html";
import { htmlStartRe, isHtmlStart, SINK_TAGS } from "./html-start";

describe("htmlStartRe", () => {
  it("drops non-tag entries so #text cannot enter the alternation", () => {
    const re = htmlStartRe(["p", "#text"]);
    expect(re.source).not.toContain("#text");
    expect(re.test("<p>x</p>")).toBe(true);
  });

  it("never matches a leading CLOSING tag", () => {
    // A stored value cannot legitimately begin with one, and passing it through
    // makes the sink delete the literal characters the user typed.
    expect(htmlStartRe(["p"]).test("</p> means close")).toBe(false);
  });

  it("does not let a short tag swallow a longer one that shares its prefix", () => {
    const re = htmlStartRe(["strong", "s", "sub", "sup"]);
    expect(re.test("<strong>a</strong>")).toBe(true);
    expect(re.test("<s>a</s>")).toBe(true);
    expect(re.test("<sub>a</sub>")).toBe(true);
    expect(re.test("<sup>a</sup>")).toBe(true);
    // A tag name that is NOT in the list but shares a prefix with one that is
    // must not match — without the word boundary, "s" matches "<strongish>" and
    // "<script>" by swallowing the rest of the name as if it were attributes,
    // which is invisible to the four assertions above (they only check that a
    // REAL member of the list still matches, and "s" alone reports true for
    // those too via the same swallow).
    expect(re.test("<strongish>x</strongish>")).toBe(false);
    expect(re.test("<script>x</script>")).toBe(false);
  });

  it("requires the opening tag to actually CLOSE", () => {
    // ★★★ The guard the factory's own comment documents and nothing pinned: a
    // legacy PLAIN value that merely STARTS tag-shaped is not markup. Passed
    // through raw, the tokenizer DISCARDS an incomplete tag at EOF, so the whole
    // value vanishes — while a text-length count over it still reads 11, so no
    // empty-state fallback fires either.
    expect(htmlStartRe(["li"]).test("<li 3 items")).toBe(false);
  });

  it("matches void spellings and attribute-bearing tags", () => {
    const re = htmlStartRe(["hr", "img", "a"]);
    expect(re.test("<hr/>")).toBe(true);
    expect(re.test("<hr />")).toBe(true);
    expect(re.test('<img data-asset-id="7" alt="x">')).toBe(true);
    expect(re.test('<a href="https://x.test">y</a>')).toBe(true);
  });

  it("is case-insensitive and tolerates leading whitespace", () => {
    expect(htmlStartRe(["p"]).test("  \n<P>x</P>")).toBe(true);
  });

  it("matches nothing when no valid tag name survives the filter", () => {
    // Guard against an empty alternation, which would compile to a regex that
    // matches "<>" and any stray angle bracket.
    const re = htmlStartRe(["#text"]);
    expect(re.test("<p>x</p>")).toBe(false);
    expect(re.test("<>")).toBe(false);
  });
});

describe("the sink map", () => {
  it("classifies a document-only tag for document and projection, not for note or template", () => {
    expect(isHtmlStart("<blockquote>q</blockquote>", "document")).toBe(true);
    expect(isHtmlStart("<blockquote>q</blockquote>", "projection")).toBe(true);
    expect(isHtmlStart("<blockquote>q</blockquote>", "template")).toBe(false);
    expect(isHtmlStart("<blockquote>q</blockquote>", "note")).toBe(false);
  });

  it("classifies a template-only tag for template but never for note", () => {
    // The note sink is KEEP_CONTENT: false — recognising a tag it strips deletes
    // the text with it (open-followups §107).
    for (const html of ["<h1>T</h1>", "<h2>T</h2>", "<u>T</u>"]) {
      expect(isHtmlStart(html, "template")).toBe(true);
      expect(isHtmlStart(html, "note")).toBe(false);
    }
  });

  it("classifies a tag NO allow-list carries for render but not for document", () => {
    // The whole point of the render sink. Its consumers keep every tag's text
    // (KEEP_CONTENT default / the rich-line parser), so a value opening with an
    // unlisted tag is HTML there — while "document", the widest DERIVED sink,
    // calls the same value plain text and escapes it whole.
    for (const html of ["<h3>Sub</h3>", "<div>Status</div>", "<table><tr><td>c</td></tr></table>"]) {
      expect(isHtmlStart(html, "render")).toBe(true);
      expect(isHtmlStart(html, "document")).toBe(false);
    }
  });

  it("recognises a tag ANYWHERE for render, while the derived sinks stay leading-only", () => {
    // ★★★ The two sinks ask two DIFFERENT questions. A DERIVED sink is a STORAGE
    // boundary: the escaped form is what gets persisted, so it asks "does this
    // START with a tag I keep?" and treats a mid-sentence "<" conservatively.
    // The render sink stores nothing and its consumers keep every tag's text, so
    // the only failure mode left is escaping real markup — it therefore asks
    // "does this CONTAIN a tag at all?". Anchoring it at the start escaped real
    // markup that simply does not OPEN with a tag, which is how it reached Word,
    // PowerPoint, the HTML preview and the PDF as literal "&lt;strong&gt;".
    for (const value of ["Intro <strong>bold</strong> tail", "See <em>the plan</em>"]) {
      expect(isHtmlStart(value, "render")).toBe(true);
      for (const sink of ["note", "template", "document", "projection"] as const) {
        expect(isHtmlStart(value, sink)).toBe(false);
      }
    }
    // A value that DOES lead with a tag is unaffected in either direction.
    expect(isHtmlStart("<p>leads with a tag</p>", "render")).toBe(true);
    expect(isHtmlStart("<p>leads with a tag</p>", "document")).toBe(true);
  });

  it("still calls a value carrying no tag at all plain text at the render sink", () => {
    // The two things the widening must NOT change. "a\nb" is open-followups
    // §118 — no tag anywhere, so it upgrades and its newline becomes a real
    // break instead of fusing into one run-on line. "cost < 5k" is a "<" that is
    // not followed by a letter, i.e. literal text the tokenizer would eat.
    expect(isHtmlStart("a\nb", "render")).toBe(false);
    expect(isHtmlStart("cost < 5k", "render")).toBe(false);
  });

  it("keeps all three guards on the render sink", () => {
    // Recognising every TAG is not the same as recognising every "<": a value
    // that merely starts tag-SHAPED is still plain text somebody typed, and
    // passing it through makes the sink eat it.
    expect(isHtmlStart("<li 3 items", "render")).toBe(false); // never closes
    expect(isHtmlStart("<3 open", "render")).toBe(false); // not a letter
    expect(isHtmlStart("</p> means close", "render")).toBe(false); // closing tag
  });

  it("makes render a superset of every derived sink", () => {
    for (const sink of ["note", "template", "document", "projection"] as const) {
      for (const tag of SINK_TAGS[sink]) {
        if (tag === "#text") continue;
        const html = `<${tag}>x`;
        expect(isHtmlStart(html, sink)).toBe(true);
        expect(isHtmlStart(html, "render")).toBe(true);
      }
    }
  });

  it("keeps projection a superset of every real sink", () => {
    // Projection has no sink — htmlToText strips everything — so THE RULE does
    // not bind and the width is a TRADE, not a free choice. Recognising less is
    // the §107 direction (literal "&lt;h1&gt;" into search, digests and exports);
    // recognising more is the §32 direction (a plain "<mark> means highlight in
    // this project" projects to "means highlight in this project", fragment
    // dropped — measured). We take the wide side because the §107 direction is
    // commoner and louder. If the document list ever narrows, this is what
    // catches it.
    const projection = new Set(SINK_TAGS.projection);
    for (const tags of [NOTE_ALLOWED_TAGS, TEMPLATE_ALLOWED_TAGS, DOCUMENT_ALLOWED_TAGS]) {
      for (const tag of tags) {
        if (tag === "#text") continue;
        expect(projection.has(tag)).toBe(true);
      }
    }
  });
});
