import { describe, expect, it } from "vitest";
import { sanitizeRichHtml } from "../sanitize-html";
import {
  applyTake,
  normalizeHeading,
  planTake,
  sectionBodyHtml,
  splitProposalSections,
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

  it("matches an h3 inside another h2, replaces only that block and keeps the h3 sibling under its parent", () => {
    const u =
      "<h2>Status</h2><p>s</p><h3>Risks</h3><p>r</p><h3>Other</h3><p>o</p>";
    expect(applyTake(u, ai("<h2>Risks</h2><p>new</p>"), [0], true)).toBe(
      "<h2>Status</h2><p>s</p><h3>Other</h3><p>o</p><h2>Risks</h2><p>new</p>",
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

describe("an unmatched section goes after the nearest preceding AI section the text also holds, else at the end", () => {
  const AI = ai("<p>AI intro</p><h2>Summary</h2><p>S</p><h2>Risks</h2><p>R</p>");

  it("the user's own intro is not the AI's opening: Summary goes to the end", () => {
    expect(applyTake("<p>my intro</p><h2>Notes</h2><p>n</p>", AI, [1], true)).toBe(
      "<p>my intro</p><h2>Notes</h2><p>n</p><h2>Summary</h2><p>S</p>",
    );
  });

  it("with no intro at all it is the end too (the same answer either way)", () => {
    expect(applyTake("<h2>Notes</h2><p>n</p>", AI, [1], true)).toBe("<h2>Notes</h2><p>n</p><h2>Summary</h2><p>S</p>");
  });

  it("take all: the opening is placed, and Summary lands right after it", () => {
    expect(applyTake("<h2>Notes</h2><p>n</p>", AI, [0, 1], true)).toBe(
      "<p>AI intro</p><h2>Summary</h2><p>S</p><h2>Notes</h2><p>n</p>",
    );
    expect(applyTake("<p>my intro</p><h2>Notes</h2><p>n</p>", AI, [0, 1], true)).toBe(
      "<p>my intro</p><p>AI intro</p><h2>Summary</h2><p>S</p><h2>Notes</h2><p>n</p>",
    );
  });

  it("an opening the text already holds word for word IS an anchor", () => {
    expect(applyTake("<p>AI intro</p><h2>Notes</h2><p>n</p>", AI, [1], true)).toBe(
      "<p>AI intro</p><h2>Summary</h2><p>S</p><h2>Notes</h2><p>n</p>",
    );
  });
});

describe("an AI opening that sits inside a user intro", () => {
  const AI = ai("<p>AI intro</p><h2>Summary</h2><p>S</p>");
  const WITH_INTRO = "<p>my intro</p><p>AI intro</p><h2>Notes</h2><p>n</p>";

  it("taking the opening again leaves one copy", () => {
    expect(applyTake(WITH_INTRO, AI, [0], true)).toBe(WITH_INTRO);
    expect(planTake(WITH_INTRO, AI, [0])).toEqual({ replacements: [], additions: [] });
  });

  it("an unmatched section lands after the level-0 section (before the first user heading)", () => {
    expect(applyTake(WITH_INTRO, AI, [1], true)).toBe("<p>my intro</p><p>AI intro</p><h2>Summary</h2><p>S</p><h2>Notes</h2><p>n</p>");
  });
});

describe("splitProposalSections splits an AI draft at its TOP heading level", () => {
  it("keeps nested sub-headings inside their parent section", () => {
    const sections = splitProposalSections("<h2>A</h2><p>a</p><h3>A1</h3><p>x</p><h2>B</h2><p>b</p>");
    expect(sections.map((x) => x.heading)).toEqual(["A", "B"]);
    expect(sections[0].html).toBe("<h2>A</h2><p>a</p><h3>A1</h3><p>x</p>");
    expect(sections[1].html).toBe("<h2>B</h2><p>b</p>");
  });
  it("a draft whose top level is h3 splits at h3", () => {
    const sections = splitProposalSections("<h3>A</h3><p>a</p><h4>A1</h4><p>x</p><h3>B</h3>");
    expect(sections.map((x) => x.heading)).toEqual(["A", "B"]);
    expect(sections[0].html).toContain("<h4>A1</h4>");
  });
  it("a deeper heading is not folded into the level-0 opening: it keeps its own row", () => {
    const rows = splitProposalSections("<p>open</p><h3>Note</h3><p>n</p><h2>A</h2><p>a</p>");
    expect(rows.map((x) => [x.level, x.heading])).toEqual([[0, ""], [3, "Note"], [2, "A"]]);
    expect(rows.map((x) => x.html).join("")).toBe("<p>open</p><h3>Note</h3><p>n</p><h2>A</h2><p>a</p>");
  });
  it("loses nothing: the sections concatenate back to the draft", () => {
    const html = "<p>intro</p><h2>A</h2><h3>A1</h3><p>x</p><h2>B</h2>";
    expect(splitProposalSections(html).map((x) => x.html).join("")).toBe(html);
  });
  it("a Replace of the parent brings its sub-section along", () => {
    const AI = splitProposalSections("<h2>A</h2><p>new</p><h3>A1</h3><p>x</p>");
    expect(applyTake("<h2>A</h2><p>old</p>", AI, [0], true)).toBe("<h2>A</h2><p>new</p><h3>A1</h3><p>x</p>");
  });
});

describe("an unmatched section keeps AI order against the sections that FOLLOW it", () => {
  const AI = ai("<h2>A</h2><p>aA</p><h2>B</h2><p>aB</p>");
  it("Take all with Replace on a text that holds only B gives A then B", () => {
    expect(applyTake("<h2>B</h2><p>b</p>", AI, [0, 1], true)).toBe("<h2>A</h2><p>aA</p><h2>B</h2><p>aB</p>");
  });
  it("A alone goes before the following AI section the text has", () => {
    expect(applyTake("<h2>C</h2><p>c</p><h2>B</h2><p>b</p>", AI, [0], true)).toBe("<h2>C</h2><p>c</p><h2>A</h2><p>aA</p><h2>B</h2><p>b</p>");
  });
  it("with nothing following in the text it still goes to the end", () => {
    expect(applyTake("<h2>C</h2><p>c</p>", AI, [0], true)).toBe("<h2>C</h2><p>c</p><h2>A</h2><p>aA</p>");
  });
  it("the preceding anchor still wins over a following one", () => {
    const three = ai("<h2>A</h2><p>aA</p><h2>B</h2><p>aB</p><h2>C</h2><p>aC</p>");
    expect(applyTake("<h2>A</h2><p>a</p><h2>X</h2><p>x</p><h2>C</h2><p>c</p>", three, [1], true)).toBe(
      "<h2>A</h2><p>a</p><h2>B</h2><p>aB</p><h2>X</h2><p>x</p><h2>C</h2><p>c</p>",
    );
  });
});

describe("anchors respect heading levels: a user's sub-sections stay under their parent", () => {
  it("a following anchor deeper than the inserted section is skipped: Plan goes to the end, Risks stays under Status", () => {
    const AI = ai("<h2>Plan</h2><p>p</p><h2>Risks</h2><p>r</p>");
    expect(applyTake("<h2>Status</h2><p>s</p><h3>Risks</h3><p>mine</p>", AI, [0], true)).toBe(
      "<h2>Status</h2><p>s</p><h3>Risks</h3><p>mine</p><h2>Plan</h2><p>p</p>",
    );
  });

  it("a preceding anchor deeper than the inserted section extends to the end of the enclosing range", () => {
    const AI = ai("<h2>Plan</h2><p>aP</p><h2>Extra</h2><p>e</p>");
    expect(applyTake("<h2>Status</h2><h3>Plan</h3><p>p</p><h3>Later</h3><p>l</p><h2>Next</h2>", AI, [1], true)).toBe(
      "<h2>Status</h2><h3>Plan</h3><p>p</p><h3>Later</h3><p>l</p><h2>Extra</h2><p>e</p><h2>Next</h2>",
    );
  });
});

describe("the following anchor is the first MATCH at a usable level", () => {
  it("skips a deeper same-key section and uses the h2 one after it", () => {
    const AI = ai("<h2>A</h2><p>aA</p><h2>B</h2><p>aB</p>");
    expect(applyTake("<h2>X</h2><h3>B</h3><p>b</p><h2>B</h2><p>B</p>", AI, [0], true)).toBe(
      "<h2>X</h2><h3>B</h3><p>b</p><h2>A</h2><p>aA</p><h2>B</h2><p>B</p>",
    );
  });
});

describe("an AI section SHALLOWER than the user section it matches keeps the user's later siblings in place", () => {
  const USER = "<h2>Status</h2><p>s</p><h3>Risks</h3><p>r</p><h3>After</h3><p>a</p><h2>Z</h2>";
  const AI = ai("<h2>Risks</h2><p>ai</p>");
  it("Replace removes the user's h3 and places the h2 after the whole Status range", () => {
    expect(applyTake(USER, AI, [0], true)).toBe("<h2>Status</h2><p>s</p><h3>After</h3><p>a</p><h2>Risks</h2><p>ai</p><h2>Z</h2>");
    expect(planTake(USER, AI, [0])).toEqual({ replacements: [{ aiIndex: 0, userHeading: "Risks", removedSubheadings: [] }], additions: [] });
  });
  it("Keep both adds the h2 at the same point and removes nothing", () => {
    expect(applyTake(USER, AI, [0], false)).toBe(
      "<h2>Status</h2><p>s</p><h3>Risks</h3><p>r</p><h3>After</h3><p>a</p><h2>Risks</h2><p>ai</p><h2>Z</h2>",
    );
  });
  it("Take all with Replace over two shallower matches under one parent keeps AI order", () => {
    const user = "<h2>S</h2><h3>A</h3><p>a</p><h3>B</h3><p>b</p><h3>C</h3><p>c</p>";
    const two = ai("<h2>A</h2><p>xa</p><h2>B</h2><p>xb</p>");
    expect(applyTake(user, two, [0, 1], true)).toBe("<h2>S</h2><h3>C</h3><p>c</p><h2>A</h2><p>xa</p><h2>B</h2><p>xb</p>");
  });
  it("a same-level match is unchanged", () => {
    expect(applyTake("<h2>Risks</h2><p>r</p><h3>Sub</h3><p>x</p><h2>Z</h2>", AI, [0], true)).toBe("<h2>Risks</h2><p>ai</p><h2>Z</h2>");
  });
});

describe("a blank AI opening is not a section", () => {
  it("splitProposalSections leaves no opening row for whitespace or an empty paragraph", () => {
    for (const html of ["\n<h2>Summary</h2><p>S</p>", "<p></p><h2>Summary</h2><p>S</p>"]) {
      expect(splitProposalSections(html).map((x) => x.heading)).toEqual(["Summary"]);
    }
    expect(splitProposalSections("<p>intro</p><h2>Summary</h2>").map((x) => x.level)).toEqual([0, 2]);
  });

  it("the engine ignores a blank opening handed to it: placement does not depend on whitespace in the user's text", () => {
    const AI = splitSections("\n<h2>Summary</h2><p>S</p>"); // [blank opening, Summary]
    expect(applyTake("<p>my\nintro</p><h2>Notes</h2><p>n</p>", AI, [1], true)).toBe("<p>my\nintro</p><h2>Notes</h2><p>n</p><h2>Summary</h2><p>S</p>");
    expect(applyTake("<p>my intro</p><h2>Notes</h2><p>n</p>", AI, [1], true)).toBe("<p>my intro</p><h2>Notes</h2><p>n</p><h2>Summary</h2><p>S</p>");
    expect(applyTake("<h2>Notes</h2><p>n</p>", AI, [0], true)).toBe("<h2>Notes</h2><p>n</p>"); // taking it adds nothing
    expect(planTake("<h2>Notes</h2><p>n</p>", AI, [0])).toEqual({ replacements: [], additions: [] });
  });

  it("a user text with a blank preamble round-trips byte for byte", () => {
    for (const user of ["\n<h2>Notes</h2><p>n</p>", "<p></p><h2>Notes</h2><p>n</p>", "  <h2>A</h2>"]) {
      expect(splitSections(user).map((x) => x.html).join("")).toBe(user);
      expect(applyTake(user, [], [], true)).toBe(user);
    }
  });
});

describe("the AI opening is recognised by its TEXT, not its markup", () => {
  const AI = ai("<p>A</p>\n<p>B</p><h2>Summary</h2><p>S</p>"); // the model puts a newline between blocks
  it("a taken-and-saved opening, re-serialised by the editor without the newline, is not added again", () => {
    const saved = "<p>A</p><p>B</p><h2>Notes</h2><p>n</p>";
    expect(applyTake(saved, AI, [0], true)).toBe(saved);
    expect(planTake(saved, AI, [0])).toEqual({ replacements: [], additions: [] });
  });
  it("and it still anchors: Summary lands right after that opening", () => {
    expect(applyTake("<p>A</p><p>B</p><h2>Notes</h2><p>n</p>", AI, [1], true)).toBe("<p>A</p><p>B</p><h2>Summary</h2><p>S</p><h2>Notes</h2><p>n</p>");
  });
  it("an opening that only occurs INSIDE a user sentence is added, and does not anchor", () => {
    const one = ai("<p>Summary</p><h2>Plan</h2><p>p</p>");
    const user = "<p>See the Summary below.</p><h2>Notes</h2><p>n</p>";
    expect(applyTake(user, one, [0], true)).toBe("<p>See the Summary below.</p><p>Summary</p><h2>Notes</h2><p>n</p>");
    expect(applyTake(user, one, [1], true)).toBe("<p>See the Summary below.</p><h2>Notes</h2><p>n</p><h2>Plan</h2><p>p</p>");
  });
  it("an opening equal to one whole user paragraph is already there", () => {
    const one = ai("<p>Summary</p><h2>Plan</h2><p>p</p>");
    const user = "<p>Summary</p><h2>Notes</h2><p>n</p>";
    expect(applyTake(user, one, [0], true)).toBe(user);
    expect(applyTake("<p>x</p><p>Summary</p><p>y</p><h2>Notes</h2>", one, [0], true)).toBe("<p>x</p><p>Summary</p><p>y</p><h2>Notes</h2>");
  });
  it("a short opening does not match inside a longer word", () => {
    const short = ai("<p>OK</p><h2>S</h2><p>s</p>");
    expect(applyTake("<p>a book</p><h2>Notes</h2>", short, [0], true)).toBe("<p>a book</p><p>OK</p><h2>Notes</h2>");
  });
});

describe("taking the AI opening twice", () => {
  const AI = ai("<p>AI intro</p><h2>Summary</h2><p>S</p>");
  it("leaves one copy, and the plan reports neither a replacement nor an addition the second time", () => {
    const once = applyTake("<h2>Notes</h2><p>n</p>", AI, [0], true);
    expect(once).toBe("<p>AI intro</p><h2>Notes</h2><p>n</p>");
    expect(applyTake(once, AI, [0], true)).toBe(once);
    expect(applyTake(once, AI, [0], false)).toBe(once);
    expect(planTake(once, AI, [0])).toEqual({ replacements: [], additions: [] });
  });
});

describe("Keep both keeps the AI sections in AI order", () => {
  const USER = "<h2>Risks</h2><p>r</p><h3>Vendor</h3><p>v</p><h2>Next</h2><p>n</p>";
  const AI = ai("<h2>Risks</h2><p>R</p><h2>Vendor</h2><p>V</p>");

  it("declining Replace on Take all lands Risks before Vendor, after the user's range", () => {
    expect(applyTake(USER, AI, [0, 1], false)).toBe(
      "<h2>Risks</h2><p>r</p><h3>Vendor</h3><p>v</p><h2>Risks</h2><p>R</p><h2>Vendor</h2><p>V</p><h2>Next</h2><p>n</p>",
    );
  });

  it("confirming Replace is unchanged: the AI Risks replaces the range, Vendor follows it", () => {
    expect(applyTake(USER, AI, [0, 1], true)).toBe(
      "<h2>Risks</h2><p>R</p><h2>Vendor</h2><p>V</p><h2>Next</h2><p>n</p>",
    );
  });

  it("planTake describes the answer it is asked about, with the same engine as applyTake", () => {
    expect(planTake(USER, AI, [0, 1])).toEqual({
      replacements: [{ aiIndex: 0, userHeading: "Risks", removedSubheadings: ["Vendor"] }],
      additions: [1],
    });
    expect(planTake(USER, AI, [0, 1], false)).toEqual({
      replacements: [
        { aiIndex: 0, userHeading: "Risks", removedSubheadings: ["Vendor"] },
        { aiIndex: 1, userHeading: "Vendor", removedSubheadings: [] },
      ],
      additions: [],
    });
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
