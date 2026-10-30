import { describe, expect, it } from "vitest";
import { sanitizeRichHtml } from "../sanitize-html";
import {
  applyTake,
  normalizeHeading,
  planTake,
  sectionBodyHtml,
  splitSections,
} from "./report-sections";

const ai = (html: string) => splitSections(html);

describe("splitSections", () => {
  it("splits at every heading with level and key", () => {
    const s = splitSections(
      "<p>intro</p><h2>Status</h2><p>a</p><h3>Detail</h3><p>b</p><h2>Risks</h2><p>c</p>",
    );
    expect(s).toHaveLength(4);
    expect(s.map((x) => x.level)).toEqual([0, 2, 3, 2]);
    expect(s.map((x) => x.key)).toEqual(["", "status", "detail", "risks"]);
    expect(s[1].html).toBe("<h2>Status</h2><p>a</p>");
  });

  it("derives the key from heading text, tags and entities removed", () => {
    expect(
      splitSections("<h2><strong>Risks</strong> &amp; issues</h2>")[0].key,
    ).toBe("risks & issues");
  });

  it("returns nothing for empty input", () => {
    expect(splitSections("")).toEqual([]);
  });
});

describe("normalizeHeading", () => {
  it("trims, collapses whitespace and lower-cases", () => {
    expect(normalizeHeading("  Next   STEPS ")).toBe("next steps");
  });
});

describe("applyTake", () => {
  const user = "<h2>Risks</h2><p>old</p><h2>Next</h2><p>n</p>";

  it("replaces the matching user section on confirm", () => {
    expect(applyTake(user, ai("<h2>risks </h2><p>new</p>"), [0], true)).toBe(
      "<h2>risks </h2><p>new</p><h2>Next</h2><p>n</p>",
    );
  });

  it("adds after the matching user section on decline", () => {
    expect(applyTake(user, ai("<h2>risks </h2><p>new</p>"), [0], false)).toBe(
      "<h2>Risks</h2><p>old</p><h2>risks </h2><p>new</p><h2>Next</h2><p>n</p>",
    );
  });

  it("removes sub-headings with a replaced section and reports them", () => {
    const u = "<h2>Risks</h2><p>r</p><h3>Vendor</h3><p>v</p><h2>Next</h2>";
    const a = ai("<h2>Risks</h2><p>new</p>");
    expect(planTake(u, a, [0]).replacements).toEqual([
      { aiIndex: 0, userHeading: "Risks", removedSubheadings: ["Vendor"] },
    ]);
    expect(applyTake(u, a, [0], true)).toBe(
      "<h2>Risks</h2><p>new</p><h2>Next</h2>",
    );
  });

  it("matches an h3 inside another h2 and replaces only that block", () => {
    const u =
      "<h2>Status</h2><p>s</p><h3>Risks</h3><p>r</p><h3>Other</h3><p>o</p>";
    expect(applyTake(u, ai("<h2>Risks</h2><p>new</p>"), [0], true)).toBe(
      "<h2>Status</h2><p>s</p><h2>Risks</h2><p>new</p><h3>Other</h3><p>o</p>",
    );
  });

  it("replaces only the first of duplicate user headings", () => {
    const u = "<h2>Risks</h2><p>1</p><h2>Risks</h2><p>2</p>";
    expect(applyTake(u, ai("<h2>Risks</h2><p>new</p>"), [0], true)).toBe(
      "<h2>Risks</h2><p>new</p><h2>Risks</h2><p>2</p>",
    );
  });

  it("anchors an unmatched section after the user section of the preceding AI section", () => {
    const u = "<h2>A</h2><p>a</p><h2>C</h2><p>c</p>";
    expect(
      applyTake(u, ai("<h2>A</h2><p>x</p><h2>B</h2><p>b</p>"), [1], true),
    ).toBe("<h2>A</h2><p>a</p><h2>B</h2><p>b</p><h2>C</h2><p>c</p>");
  });

  it("appends an unmatched section at the end when there is no anchor", () => {
    const u = "<h2>A</h2><p>a</p>";
    expect(applyTake(u, ai("<h2>Z</h2><p>z</p>"), [0], true)).toBe(
      "<h2>A</h2><p>a</p><h2>Z</h2><p>z</p>",
    );
  });

  it("yields the AI sections in AI order for empty user text", () => {
    const html =
      "<p>o</p><h2>A</h2><p>a</p><h3>A1</h3><p>1</p><h2>B</h2><p>b</p>";
    expect(applyTake("", ai(html), [0, 1, 2, 3, 4], true)).toBe(html);
  });

  it("never replaces the user's level-0 text and adds the AI's after it", () => {
    const u = "<p>mine</p><h2>A</h2><p>a</p>";
    expect(
      applyTake(u, ai("<p>ai intro</p><h2>A</h2><p>x</p>"), [0], true),
    ).toBe("<p>mine</p><p>ai intro</p><h2>A</h2><p>a</p>");
  });
  it("matches headings across numeric entities", () => {
    expect(
      applyTake(
        "<h2>Risks &#8211; x</h2><p>old</p>",
        ai("<h2>Risks – x</h2><p>new</p>"),
        [0],
        true,
      ),
    ).toBe("<h2>Risks – x</h2><p>new</p>");
    expect(
      applyTake(
        "<h2>Risks &#x2013; x</h2><p>old</p>",
        ai("<h2>Risks – x</h2><p>new</p>"),
        [0],
        true,
      ),
    ).toBe("<h2>Risks – x</h2><p>new</p>");
  });

  it("matches a heading with inline markup and an entity end to end", () => {
    const u = "<h2><strong>Risks</strong> &amp; issues</h2><p>old</p>";
    expect(
      applyTake(u, ai("<h2>Risks &amp; issues</h2><p>new</p>"), [0], true),
    ).toBe("<h2>Risks &amp; issues</h2><p>new</p>");
  });

  it("adds after the whole range, sub-sections included, on decline", () => {
    const u =
      "<h2>Risks</h2><p>r</p><h3>Vendor</h3><p>v</p><h2>Next</h2><p>n</p>";
    expect(applyTake(u, ai("<h2>Risks</h2><p>new</p>"), [0], false)).toBe(
      "<h2>Risks</h2><p>r</p><h3>Vendor</h3><p>v</p><h2>Risks</h2><p>new</p><h2>Next</h2><p>n</p>",
    );
  });

  it("take-all mixes replacements and additions in AI order", () => {
    const u = "<p>mine</p><h2>B</h2><p>b</p><h2>D</h2><p>d</p>";
    const a = ai(
      "<p>i</p><h2>A</h2><p>a</p><h2>B</h2><p>nb</p><h2>C</h2><p>c</p><h2>D</h2><p>nd</p>",
    );
    expect(applyTake(u, a, [0, 1, 2, 3, 4], true)).toBe(
      "<p>mine</p><p>i</p><h2>A</h2><p>a</p><h2>B</h2><p>nb</p><h2>C</h2><p>c</p><h2>D</h2><p>nd</p>",
    );
  });

  it("adds an empty-text heading and never replaces with it", () => {
    const u = "<h2></h2><p>x</p><h2>A</h2><p>a</p>";
    expect(applyTake(u, ai("<h2></h2><p>y</p>"), [0], true)).toBe(
      "<h2></h2><p>x</p><h2>A</h2><p>a</p><h2></h2><p>y</p>",
    );
  });

  it("replaces a matching section while the user intro text survives", () => {
    const u = "<p>mine</p><h2>A</h2><p>a</p>";
    expect(
      applyTake(u, ai("<p>ai intro</p><h2>A</h2><p>x</p>"), [0, 1], true),
    ).toBe("<p>mine</p><p>ai intro</p><h2>A</h2><p>x</p>");
  });
});

describe("planTake", () => {
  it("reports replacements and additions without changing anything", () => {
    const u = "<h2>Risks</h2><p>old</p>";
    const a = ai("<h2>Risks</h2><p>n</p><h2>New</h2><p>m</p>");
    expect(planTake(u, a, [0, 1])).toEqual({
      replacements: [
        { aiIndex: 0, userHeading: "Risks", removedSubheadings: [] },
      ],
      additions: [1],
    });
    expect(u).toBe("<h2>Risks</h2><p>old</p>");
  });
});

describe("sectionBodyHtml", () => {
  it("drops the leading heading and keeps the body", () => {
    expect(sectionBodyHtml("<h2>Risks</h2><p>a</p>")).toBe("<p>a</p>");
  });
  it("leaves a level-0 opening section untouched", () => {
    expect(sectionBodyHtml("<p>intro</p>")).toBe("<p>intro</p>");
  });
  it("drops a heading with inline markup and entities", () => {
    expect(sectionBodyHtml("<h3 class=\"x\">R&amp;D <em>plan</em> &#8211; Q1</h3><p>b</p>")).toBe("<p>b</p>");
  });
  it("a section that is only a heading has an empty body", () => {
    expect(sectionBodyHtml("<h2>Next steps</h2>")).toBe("");
  });
  it("drops only the first heading, not a later one", () => {
    expect(sectionBodyHtml("<h2>A</h2><p>x</p><h4>B</h4>")).toBe("<p>x</p><h4>B</h4>");
  });
  it("does not strip a heading that does not open the html", () => {
    expect(sectionBodyHtml("<p>x</p><h2>A</h2>")).toBe("<p>x</p><h2>A</h2>");
  });
});


describe("splitSections — a heading nested in a list item or blockquote", () => {
  // PINNED, not endorsed: HEADING_RE is markup-blind, so a nested heading IS a section boundary. The pieces are
  // unbalanced fragments, but they concatenate back to the input byte for byte and the sanitizer repairs the
  // join, so nothing is lost or crashes. Only top-level splitting would need a tag-depth parser.
  for (const html of ["<ul><li><h2>Nested</h2>text</li></ul><p>after</p>", "<blockquote><h3>Quoted</h3><p>q</p></blockquote>"]) {
    it(`does not throw, loses no byte and stays sanitizable: ${html}`, () => {
      const sections = splitSections(html);
      expect(sections.map((x) => x.html).join("")).toBe(html);
      expect(sections.some((x) => x.heading !== "")).toBe(true);
      const clean = sanitizeRichHtml(applyTake("", sections, sections.map((_, i) => i), true));
      expect(clean).toMatch(/Nested|Quoted/);
      expect(clean).not.toMatch(/<script/i);
    });
  }
});
