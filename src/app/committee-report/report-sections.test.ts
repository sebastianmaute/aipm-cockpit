import { describe, expect, it } from "vitest";
import { applyTake, normalizeHeading, planTake, splitSections } from "./report-sections";

const ai = (html: string) => splitSections(html);

describe("splitSections", () => {
  it("splits at every heading with level and key", () => {
    const s = splitSections("<p>intro</p><h2>Status</h2><p>a</p><h3>Detail</h3><p>b</p><h2>Risks</h2><p>c</p>");
    expect(s).toHaveLength(4);
    expect(s.map((x) => x.level)).toEqual([0, 2, 3, 2]);
    expect(s.map((x) => x.key)).toEqual(["", "status", "detail", "risks"]);
    expect(s[1].html).toBe("<h2>Status</h2><p>a</p>");
  });

  it("derives the key from heading text, tags and entities removed", () => {
    expect(splitSections("<h2><strong>Risks</strong> &amp; issues</h2>")[0].key).toBe("risks & issues");
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
    expect(applyTake(u, a, [0], true)).toBe("<h2>Risks</h2><p>new</p><h2>Next</h2>");
  });

  it("matches an h3 inside another h2 and replaces only that block", () => {
    const u = "<h2>Status</h2><p>s</p><h3>Risks</h3><p>r</p><h3>Other</h3><p>o</p>";
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
    expect(applyTake(u, ai("<h2>A</h2><p>x</p><h2>B</h2><p>b</p>"), [1], true)).toBe(
      "<h2>A</h2><p>a</p><h2>B</h2><p>b</p><h2>C</h2><p>c</p>",
    );
  });

  it("appends an unmatched section at the end when there is no anchor", () => {
    const u = "<h2>A</h2><p>a</p>";
    expect(applyTake(u, ai("<h2>Z</h2><p>z</p>"), [0], true)).toBe("<h2>A</h2><p>a</p><h2>Z</h2><p>z</p>");
  });

  it("yields the AI sections in AI order for empty user text", () => {
    const html = "<p>o</p><h2>A</h2><p>a</p><h3>A1</h3><p>1</p><h2>B</h2><p>b</p>";
    expect(applyTake("", ai(html), [0, 1, 2, 3, 4], true)).toBe(html);
  });

  it("never replaces the user's level-0 text and adds the AI's after it", () => {
    const u = "<p>mine</p><h2>A</h2><p>a</p>";
    expect(applyTake(u, ai("<p>ai intro</p><h2>A</h2><p>x</p>"), [0], true)).toBe(
      "<p>mine</p><p>ai intro</p><h2>A</h2><p>a</p>",
    );
  });
});

describe("planTake", () => {
  it("reports replacements and additions without changing anything", () => {
    const u = "<h2>Risks</h2><p>old</p>";
    const a = ai("<h2>Risks</h2><p>n</p><h2>New</h2><p>m</p>");
    expect(planTake(u, a, [0, 1])).toEqual({
      replacements: [{ aiIndex: 0, userHeading: "Risks", removedSubheadings: [] }],
      additions: [1],
    });
    expect(u).toBe("<h2>Risks</h2><p>old</p>");
  });
});
