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
