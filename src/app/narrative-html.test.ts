import { describe, it, expect } from "vitest";
import { narrativeToHtml, normalizeNarrativeHtml, isNarrativeEmpty } from "./narrative-html";

describe("narrativeToHtml", () => {
  it("wraps and escapes a legacy plain-text narrative", () => {
    expect(narrativeToHtml("All on track & green")).toBe("<p>All on track &amp; green</p>");
  });

  it("passes rich-text HTML through untouched", () => {
    expect(narrativeToHtml("<p>Already <strong>rich</strong></p>")).toBe("<p>Already <strong>rich</strong></p>");
  });

  // Not producible by the lean editor (its output is always block-wrapped) but
  // perfectly reachable from an imported or hand-edited workspace. Escaping it
  // showed the user literal `&lt;strong&gt;` markup instead of bold text.
  it("passes HTML that starts with an INLINE tag through untouched", () => {
    expect(narrativeToHtml("<strong>bold</strong> lead")).toBe("<strong>bold</strong> lead");
    expect(narrativeToHtml("<em>note</em> follows")).toBe("<em>note</em> follows");
    expect(narrativeToHtml('<a href="https://x.test">link</a> first')).toBe(
      '<a href="https://x.test">link</a> first',
    );
    expect(narrativeToHtml("<br>then text")).toBe("<br>then text");
  });

  // ★★ Tags the SINK sanitizer does not KEEP must not be recognised here — the
  // classifier is derived from RICH_ALLOWED_TAGS so the two cannot drift.
  // ★★★ THIS TEST'S FIXTURES MOVED SIDES AND ITS PROPERTY DID NOT. It used to
  // assert that `h1`, `blockquote` and every heading level h1-h6 were ESCAPED,
  // because the sink was `sanitizeNoteHtml`: 8 tags at KEEP_CONTENT false, which
  // deleted a recognised-but-unlisted element AND its text — `<h1>Q3
  // status</h1><p>All good</p>` rendered as just "All good", a div- or
  // blockquote-wrapped narrative as nothing at all. Escaping was the only way to
  // save the words. Those tags are on RICH_ALLOWED_TAGS now, so h1-h4 and
  // blockquote are real markup here and asserting the escape would pin a policy
  // this slice deliberately removed. Measured 2026-08-11: `<h1>...` and
  // `<blockquote>...` pass through unchanged; h5/h6, div, table and section still
  // escape (h5/h6 are NOT on the list — headings stop at h4).
  // The surviving property is the one that always mattered: whatever the route,
  // the words the user typed are still in the output.
  it("escapes a legacy value opening with a tag the rich sanitizer does not keep", () => {
    expect(narrativeToHtml("<div>Status text</div>")).toBe("<p>&lt;div&gt;Status text&lt;/div&gt;</p>");
    expect(narrativeToHtml("<table>Grid</table>")).toBe("<p>&lt;table&gt;Grid&lt;/table&gt;</p>");
    expect(narrativeToHtml("<section>Body</section>")).toBe("<p>&lt;section&gt;Body&lt;/section&gt;</p>");
    // Headings stop at h4 on RICH_ALLOWED_TAGS, so h5/h6 are still escaped while
    // h1-h4 are markup — the boundary is what this loop pins.
    for (const n of [5, 6]) {
      expect(narrativeToHtml(`<h${n}>Head</h${n}>`)).toBe(`<p>&lt;h${n}&gt;Head&lt;/h${n}&gt;</p>`);
    }
    for (const n of [1, 2, 3, 4]) {
      expect(narrativeToHtml(`<h${n}>Head</h${n}>`)).toBe(`<h${n}>Head</h${n}>`);
    }
    // The property that actually matters: the words the user typed are still in
    // the output, on BOTH sides of that boundary.
    // (dashboard-narrative.test.tsx asserts they survive the SINK too.)
    expect(narrativeToHtml("<h1>Q3 status</h1><p>All good</p>")).toContain("Q3 status");
    expect(narrativeToHtml("<div>Status text</div>")).toContain("Status text");
    expect(narrativeToHtml("<blockquote>Quoted</blockquote>")).toContain("Quoted");
  });

  // ★★★ A value that merely STARTS tag-shaped is NOT markup. Matching a bare
  // opener passed these through raw, and the HTML tokenizer discards an
  // incomplete tag at EOF — so the whole narrative vanished from the screen,
  // from search, from exports and from the AI digests, while still reporting a
  // non-zero length so no empty-state fallback fired. Escaped, the user reads
  // their own text.
  it("escapes a plain value that starts tag-shaped but never closes the tag", () => {
    expect(narrativeToHtml("<li 3 items")).toBe("<p>&lt;li 3 items</p>");
    expect(narrativeToHtml("<p ok")).toBe("<p>&lt;p ok</p>");
    expect(narrativeToHtml("<em dash - not markup")).toBe("<p>&lt;em dash - not markup</p>");
    // The property that matters: the words survive into the output.
    expect(narrativeToHtml("<li 3 items")).toContain("3 items");
  });

  it("escapes a value that opens with a CLOSING tag", () => {
    // A stored value cannot legitimately begin with a closing tag: the editor
    // cannot emit one, so this is plain text the user typed. Passing it through
    // as HTML makes the sink delete the characters — the loss this guard exists
    // to prevent, in miniature.
    expect(narrativeToHtml("</p> means close")).toBe("<p>&lt;/p&gt; means close</p>");
  });

  // ★ The termination requirement must not cost a true positive — an opener
  // carrying ATTRIBUTES still closes, and still passes through.
  it("passes a tag with attributes through untouched", () => {
    expect(narrativeToHtml('<p class="lead">ok</p>')).toBe('<p class="lead">ok</p>');
    expect(narrativeToHtml("<br/>then text")).toBe("<br/>then text");
  });

  // The widened test must not start treating prose as markup: a `<` that is not
  // leading, or is not followed by a tag name, is still plain text.
  it("still escapes plain text containing a literal angle bracket", () => {
    expect(narrativeToHtml("5 < 10 items")).toBe("<p>5 &lt; 10 items</p>");
    expect(narrativeToHtml("<3 open items")).toBe("<p>&lt;3 open items</p>");
    expect(narrativeToHtml("< p > spaced")).toBe("<p>&lt; p &gt; spaced</p>");
  });

  it("returns empty string for undefined / blank", () => {
    expect(narrativeToHtml(undefined)).toBe("");
    expect(narrativeToHtml("   ")).toBe("");
  });
});

describe("normalizeNarrativeHtml", () => {
  it("collapses newlines so the markdown round-trip cannot truncate", () => {
    expect(normalizeNarrativeHtml("<p>a</p>\n<p>b</p>")).toBe("<p>a</p> <p>b</p>");
    expect(normalizeNarrativeHtml("<p>a</p>\r\n<p>b</p>")).toBe("<p>a</p> <p>b</p>");
  });

  it("trims", () => {
    expect(normalizeNarrativeHtml("  <p>a</p>  ")).toBe("<p>a</p>");
  });
});

describe("narrativeToHtml — sink regression (open-followups §143)", () => {
  // RICH_ALLOWED_TAGS and DOCUMENT_ALLOWED_TAGS differ by exactly one tag,
  // "img" — the ONE input that tells a correct "rich" sink apart from an
  // accidentally-swapped "document" one. Measured: swapping the sink at this
  // call site left narrative-html.test.ts and dashboard-narrative.test.tsx
  // both fully green before this test existed (open-followups §143).
  it("escapes a value opening with <img> (rich sink doesn't carry it; document sink does)", () => {
    const html = narrativeToHtml('<img src="x.png">Status update');
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });
});

describe("isNarrativeEmpty", () => {
  it("treats the editor's empty paragraph as empty", () => {
    expect(isNarrativeEmpty("<p></p>")).toBe(true);
    expect(isNarrativeEmpty("<p><br></p>")).toBe(true);
    expect(isNarrativeEmpty("<p>&nbsp;</p>")).toBe(true);
  });

  // A numeric-entity blank is what a paste from Word/Outlook produces. It used to
  // read as non-empty, so Save stored a narrative whose summary card rendered
  // blank — visible nothing, stored something.
  it("treats a numeric-entity non-breaking space as empty", () => {
    expect(isNarrativeEmpty("<p>&#160;</p>")).toBe(true);
    expect(isNarrativeEmpty("<p>&#0160;</p>")).toBe(true);
    expect(isNarrativeEmpty("<p>&#xa0;</p>")).toBe(true);
    expect(isNarrativeEmpty("<p>&#xA0;</p>")).toBe(true);
    expect(isNarrativeEmpty("<p>&#x00a0;</p>")).toBe(true);
    expect(isNarrativeEmpty(`<p>${String.fromCharCode(160)}</p>`)).toBe(true);
    expect(isNarrativeEmpty("<p>&nbsp;&#160;&#xa0;</p>")).toBe(true);
  });

  it("is false when there is visible text", () => {
    expect(isNarrativeEmpty("<p>x</p>")).toBe(false);
    // The entity spelling must not swallow neighbouring text.
    expect(isNarrativeEmpty("<p>&#160;x</p>")).toBe(false);
  });
});
