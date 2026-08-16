// Runs under jsdom (vitest.config.ts sets `environment: "jsdom"` globally), which
// is what supplies the DOMParser the module under test uses. A `node` environment
// here would fail every case for an environment reason, not a logic one.
import { describe, expect, it } from "vitest";
import { htmlToRichLines } from "./rich-text-runs";

describe("htmlToRichLines", () => {
  it("splits block boundaries into lines and carries no marks on plain text", () => {
    expect(htmlToRichLines("<p>one</p><p>two</p>")).toEqual([
      { kind: "p", runs: [{ text: "one", marks: [] }] },
      { kind: "p", runs: [{ text: "two", marks: [] }] },
    ]);
  });

  it("carries each mark on the run it wraps", () => {
    const [line] = htmlToRichLines("<p>a<strong>b</strong><em>c</em></p>");
    expect(line.runs).toEqual([
      { text: "a", marks: [] },
      { text: "b", marks: ["bold"] },
      { text: "c", marks: ["italic"] },
    ]);
  });

  it("accumulates nested marks onto one run", () => {
    const [line] = htmlToRichLines("<p><strong><em>x</em></strong></p>");
    expect(line.runs).toEqual([{ text: "x", marks: ["bold", "italic"] }]);
  });

  it("maps every document tag to its mark or line kind", () => {
    expect(htmlToRichLines("<p><s>a</s></p>")[0].runs[0].marks).toEqual(["strike"]);
    expect(htmlToRichLines("<p><u>a</u></p>")[0].runs[0].marks).toEqual(["underline"]);
    expect(htmlToRichLines("<p><mark>a</mark></p>")[0].runs[0].marks).toEqual(["highlight"]);
    expect(htmlToRichLines("<p><code>a</code></p>")[0].runs[0].marks).toEqual(["code"]);
    expect(htmlToRichLines("<p><sub>a</sub></p>")[0].runs[0].marks).toEqual(["sub"]);
    expect(htmlToRichLines("<p><sup>a</sup></p>")[0].runs[0].marks).toEqual(["sup"]);
    expect(htmlToRichLines("<blockquote>q</blockquote>")[0].kind).toBe("blockquote");
    expect(htmlToRichLines("<pre>c</pre>")[0].kind).toBe("pre");
    expect(htmlToRichLines("<hr>")[0].kind).toBe("hr");
  });

  it("maps the legacy bold/italic spellings the sanitizer unwraps today", () => {
    expect(htmlToRichLines("<p><b>a</b></p>")[0].runs[0].marks).toEqual(["bold"]);
    expect(htmlToRichLines("<p><i>a</i></p>")[0].runs[0].marks).toEqual(["italic"]);
  });

  it("does not repeat a mark applied twice on one run", () => {
    expect(htmlToRichLines("<p><strong><b>x</b></strong></p>")[0].runs).toEqual([
      { text: "x", marks: ["bold"] },
    ]);
  });

  it("carries no mark for a tag that only wraps (a link)", () => {
    expect(htmlToRichLines('<p><a href="https://x.test">link</a></p>')[0].runs).toEqual([
      { text: "link", marks: [] },
    ]);
  });

  it("turns <br> into a line break within the same block", () => {
    expect(htmlToRichLines("<p>a<br>b</p>")).toEqual([
      { kind: "p", runs: [{ text: "a", marks: [] }] },
      { kind: "p", runs: [{ text: "b", marks: [] }] },
    ]);
  });

  it("does not emit a blank line for a doubled <br>", () => {
    expect(htmlToRichLines("<p>a<br><br>b</p>")).toEqual([
      { kind: "p", runs: [{ text: "a", marks: [] }] },
      { kind: "p", runs: [{ text: "b", marks: [] }] },
    ]);
  });

  it("returns no lines for empty or whitespace-only html", () => {
    expect(htmlToRichLines("")).toEqual([]);
    expect(htmlToRichLines("<p>   </p>")).toEqual([]);
  });

  it("returns no lines for markup that carries no text at all", () => {
    expect(htmlToRichLines('<p><img alt="x"></p>')).toEqual([]);
  });

  // ── whitespace ────────────────────────────────────────────────────────────
  it("keeps the space between two inline runs so words cannot fuse", () => {
    expect(htmlToRichLines("<p><em>a</em> b</p>")[0].runs).toEqual([
      { text: "a", marks: ["italic"] },
      { text: " b", marks: [] },
    ]);
  });

  it("trims the leading and trailing whitespace of a line", () => {
    expect(htmlToRichLines("<p>  a  </p>")[0].runs).toEqual([{ text: "a", marks: [] }]);
  });

  it("trims across edge runs that are whitespace-only, dropping them", () => {
    expect(htmlToRichLines("<p> <em> a </em> </p>")[0].runs).toEqual([
      { text: "a", marks: ["italic"] },
    ]);
  });

  it("collapses a newline inside running text to a single space", () => {
    expect(htmlToRichLines("<p>a\n   b</p>")[0].runs).toEqual([{ text: "a b", marks: [] }]);
  });

  it("ignores the whitespace between two block elements", () => {
    expect(htmlToRichLines("<p>a</p>\n  <p>b</p>")).toEqual([
      { kind: "p", runs: [{ text: "a", marks: [] }] },
      { kind: "p", runs: [{ text: "b", marks: [] }] },
    ]);
  });

  // ── block structure ───────────────────────────────────────────────────────
  it("starts a line for text that sits outside any block element", () => {
    expect(htmlToRichLines("bare <strong>text</strong>")).toEqual([
      {
        kind: "p",
        runs: [
          { text: "bare ", marks: [] },
          { text: "text", marks: ["bold"] },
        ],
      },
    ]);
  });

  it("gives an <hr> inside a paragraph its own line between the halves", () => {
    // The HTML parser closes the <p> at the <hr>, so this is what the DOM says
    // regardless of what the author wrote — pinned so the flush ORDER stays right.
    expect(htmlToRichLines("<p>a<hr>b</p>")).toEqual([
      { kind: "p", runs: [{ text: "a", marks: [] }] },
      { kind: "hr", runs: [] },
      { kind: "p", runs: [{ text: "b", marks: [] }] },
    ]);
  });

  it("lets the outer blockquote kind win over an inner paragraph", () => {
    expect(htmlToRichLines("<blockquote><p>x</p><p>y</p></blockquote>")).toEqual([
      { kind: "blockquote", runs: [{ text: "x", marks: [] }] },
      { kind: "blockquote", runs: [{ text: "y", marks: [] }] },
    ]);
  });

  it("breaks a blockquote on <br> without losing its kind", () => {
    expect(htmlToRichLines("<blockquote>x<br>y</blockquote>")).toEqual([
      { kind: "blockquote", runs: [{ text: "x", marks: [] }] },
      { kind: "blockquote", runs: [{ text: "y", marks: [] }] },
    ]);
  });

  it("keeps each heading on its own line rather than fusing them", () => {
    // The BREAK is what this pins — two adjacent headings must not append to
    // one line. The kinds carry a level since §141(b); before that both read
    // `{ kind: "p" }`, which is what made "<h1>a</h1><h2>b</h2>" worth pinning
    // in the first place.
    expect(htmlToRichLines("<h1>a</h1><h2>b</h2>")).toEqual([
      { kind: "heading", level: 1, runs: [{ text: "a", marks: [] }] },
      { kind: "heading", level: 2, runs: [{ text: "b", marks: [] }] },
    ]);
  });

  it("treats an <li> with no enclosing list as an unordered item at depth 0", () => {
    // Stray markup, but reachable — the parser is handed values that never went
    // through a sanitizer. There is no counter to read, so `depth` clamps at 0
    // and nothing is incremented.
    expect(htmlToRichLines("<li>a</li>")).toEqual([
      { kind: "li", ordered: false, depth: 0, index: 0, runs: [{ text: "a", marks: [] }] },
    ]);
  });

  it("treats a bare <div> as a paragraph line", () => {
    expect(htmlToRichLines("<div>a</div><div>b</div>")).toEqual([
      { kind: "p", runs: [{ text: "a", marks: [] }] },
      { kind: "p", runs: [{ text: "b", marks: [] }] },
    ]);
  });

  // ── preformatted ──────────────────────────────────────────────────────────
  it("splits a preformatted block on its newlines, keeping every line pre", () => {
    expect(htmlToRichLines("<pre>a\nb</pre>")).toEqual([
      { kind: "pre", runs: [{ text: "a", marks: [] }] },
      { kind: "pre", runs: [{ text: "b", marks: [] }] },
    ]);
  });

  it("preserves indentation inside a preformatted block", () => {
    expect(htmlToRichLines("<pre>if (x) {\n  go();\n}</pre>")).toEqual([
      { kind: "pre", runs: [{ text: "if (x) {", marks: [] }] },
      { kind: "pre", runs: [{ text: "  go();", marks: [] }] },
      { kind: "pre", runs: [{ text: "}", marks: [] }] },
    ]);
  });

  it("carries a mark through a preformatted block", () => {
    expect(htmlToRichLines("<pre><code>a\nb</code></pre>")).toEqual([
      { kind: "pre", runs: [{ text: "a", marks: ["code"] }] },
      { kind: "pre", runs: [{ text: "b", marks: ["code"] }] },
    ]);
  });

  it("drops a preformatted block that holds only whitespace", () => {
    expect(htmlToRichLines("<pre>   </pre>")).toEqual([]);
  });

  it("collapses a BLANK line inside a preformatted block", () => {
    // The uniform "drop a line with no visible text" rule reaches <pre> too, so
    // a blank line between two statements is lost. Documented in the module, and
    // pinned here so the claim is not just prose.
    expect(htmlToRichLines("<pre>a\n\nb</pre>")).toEqual([
      { kind: "pre", runs: [{ text: "a", marks: [] }] },
      { kind: "pre", runs: [{ text: "b", marks: [] }] },
    ]);
  });

  it("steps over a node that is neither an element nor text", () => {
    // A comment is not a word boundary in HTML, so the two halves stay on one
    // line as adjacent runs rather than becoming two lines.
    expect(htmlToRichLines("<p>a<!-- note -->b</p>")).toEqual([
      {
        kind: "p",
        runs: [
          { text: "a", marks: [] },
          { text: "b", marks: [] },
        ],
      },
    ]);
  });
});

describe("heading, list, alignment and task structure (open-followups §141(b))", () => {
  it("carries the heading level", () => {
    const lines = htmlToRichLines("<h2>Title</h2>");
    expect(lines).toEqual([
      { kind: "heading", level: 2, runs: [{ text: "Title", marks: [] }] },
    ]);
  });

  it("clamps h5 and h6 to level 4", () => {
    // The editor emits h1-h4 (StarterKit levels: [1,2,3,4]), but stored legacy
    // markup can carry h5/h6. DOCX declares no Heading5, and Word SILENTLY
    // ignores an undeclared style, so the level is clamped rather than widened.
    expect(htmlToRichLines("<h5>a</h5>")[0]).toMatchObject({ kind: "heading", level: 4 });
    expect(htmlToRichLines("<h6>b</h6>")[0]).toMatchObject({ kind: "heading", level: 4 });
  });

  it("carries bullet list items at depth 0", () => {
    const lines = htmlToRichLines("<ul><li>one</li><li>two</li></ul>");
    expect(lines).toEqual([
      { kind: "li", ordered: false, depth: 0, index: 0, runs: [{ text: "one", marks: [] }] },
      { kind: "li", ordered: false, depth: 0, index: 1, runs: [{ text: "two", marks: [] }] },
    ]);
  });

  it("numbers an ordered list from zero", () => {
    const lines = htmlToRichLines("<ol><li>a</li><li>b</li><li>c</li></ol>");
    expect(lines.map((l) => (l.kind === "li" ? l.index : null))).toEqual([0, 1, 2]);
    expect(lines.every((l) => l.kind === "li" && l.ordered)).toBe(true);
  });

  it("restarts the counter for an ol nested in an ol", () => {
    // The renderer must never count: a nested list restarting at 1 is the
    // property, and a single flat counter gets it wrong at exactly this shape.
    const lines = htmlToRichLines(
      "<ol><li>a</li><li>b<ol><li>b1</li><li>b2</li></ol></li><li>c</li></ol>",
    );
    const li = lines.filter((l) => l.kind === "li");
    expect(li.map((l) => [l.depth, l.index])).toEqual([
      [0, 0], // a
      [0, 1], // b
      [1, 0], // b1  <- restarts
      [1, 1], // b2
      [0, 2], // c   <- outer counter resumes
    ]);
  });

  it("marks task items in both states", () => {
    const lines = htmlToRichLines(
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="true">done</li>' +
        '<li data-type="taskItem" data-checked="false">open</li>' +
        "</ul>",
    );
    expect(lines.map((l) => (l.kind === "li" ? l.task : null))).toEqual([
      "checked",
      "unchecked",
    ]);
  });

  it("reads alignment on EVERY kind, not just paragraphs", () => {
    // align is ORTHOGONAL to kind — that is why it is a shared base field and
    // not a kind. One assertion on a paragraph does not cover the property.
    expect(htmlToRichLines('<p data-align="center">p</p>')[0].align).toBe("center");
    expect(htmlToRichLines('<h3 data-align="right">h</h3>')[0].align).toBe("right");
    expect(
      htmlToRichLines('<ul><li data-align="justify">l</li></ul>')[0].align,
    ).toBe("justify");
  });

  it("leaves align undefined when the attribute is absent", () => {
    expect(htmlToRichLines("<p>plain</p>")[0].align).toBeUndefined();
  });

  it("ignores an out-of-domain align value", () => {
    // sanitizeRichHtml's ATTR_VALUES predicate already admits only the four,
    // but htmlToRichLines is also called on values that did not come through
    // it, so the parser does not trust the attribute.
    expect(htmlToRichLines('<p data-align="middle">x</p>')[0].align).toBeUndefined();
  });
});
