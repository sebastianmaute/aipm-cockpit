// Runs under jsdom (vitest.config.ts sets `environment: "jsdom"` globally), which
// is what supplies the DOMParser the module under test uses. A `node` environment
// here would fail every case for an environment reason, not a logic one.
import { describe, expect, it } from "vitest";
import { htmlToRichLines, type Align, type RichLine } from "./rich-text-runs";

/** Read `align` off a line whose kind is not yet known.
 *
 *  ★ The `hr` member of `RichLine` deliberately carries NO `align` — a rule has
 *  no text to align, so the field could only ever be `undefined` there. That
 *  makes a bare `line.align` on the union a TYPE ERROR, which is the point: a
 *  consumer has to say what it means for a rule. Every such consumer already
 *  branches on `hr` first; these assertions do not, so they narrow here. */
const alignOfLine = (line: RichLine): Align | undefined =>
  line.kind === "hr" ? undefined : line.align;

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
    expect(alignOfLine(htmlToRichLines('<p data-align="center">p</p>')[0])).toBe("center");
    expect(alignOfLine(htmlToRichLines('<h3 data-align="right">h</h3>')[0])).toBe("right");
    expect(
      alignOfLine(htmlToRichLines('<ul><li data-align="justify">l</li></ul>')[0]),
    ).toBe("justify");
  });

  it("leaves align undefined when the attribute is absent", () => {
    expect(alignOfLine(htmlToRichLines("<p>plain</p>")[0])).toBeUndefined();
  });

  it("ignores an out-of-domain align value", () => {
    // sanitizeRichHtml's ATTR_VALUES predicate already admits only the four,
    // but htmlToRichLines is also called on values that did not come through
    // it, so the parser does not trust the attribute.
    expect(alignOfLine(htmlToRichLines('<p data-align="middle">x</p>')[0])).toBeUndefined();
  });

  it("keeps `align` out of scope on an hr, where it could only be undefined", () => {
    // A rule holds no text, so there is nothing to align. The real guard is the
    // TYPE (a bare `line.align` on the union no longer compiles — see
    // `alignOfLine`); this pins the runtime half, that nothing puts the key on.
    const [rule] = htmlToRichLines("<hr>");
    expect(rule).toEqual({ kind: "hr", runs: [] });
    expect(Object.hasOwn(rule, "align")).toBe(false);
  });
});

// ── the shape the EDITOR actually produces ───────────────────────────────────
//
// ★★★ EVERY INPUT IN THIS BLOCK WRAPS THE ITEM TEXT IN A <p>, AND THAT IS THE
// WHOLE POINT. Tiptap's listItem content spec is `paragraph block*`, so a list
// a user typed is stored as "<ul><li><p>a</p></li></ul>". The bare
// "<li>a</li>" form every OTHER test here uses — and that the golden fixtures
// carry — is hand-authored data no editor emits.
//
// That gap hid a CRITICAL defect through nine green tests: the <p> started a
// line of its own, which flushed the still-empty `li` line, which `flush` then
// dropped, and the text arrived as a plain `p`. `ordered`, `depth`, `index`,
// `task` and alignment were discarded for every list a real user had typed,
// while `bulletMarker` rendered nothing.
//
// ★ A test whose input is "<li>text</li>" CANNOT detect that. Keep every case
// below in the <p>-wrapped form.
describe("list items in the form the editor stores (listItem = `paragraph block*`)", () => {
  it("carries a bullet list wrapped in paragraphs", () => {
    expect(htmlToRichLines("<ul><li><p>one</p></li><li><p>two</p></li></ul>")).toEqual([
      { kind: "li", ordered: false, depth: 0, index: 0, runs: [{ text: "one", marks: [] }] },
      { kind: "li", ordered: false, depth: 0, index: 1, runs: [{ text: "two", marks: [] }] },
    ]);
  });

  it("carries an ordered list wrapped in paragraphs, numbering it from zero", () => {
    expect(
      htmlToRichLines("<ol><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ol>"),
    ).toEqual([
      { kind: "li", ordered: true, depth: 0, index: 0, runs: [{ text: "a", marks: [] }] },
      { kind: "li", ordered: true, depth: 0, index: 1, runs: [{ text: "b", marks: [] }] },
      { kind: "li", ordered: true, depth: 0, index: 2, runs: [{ text: "c", marks: [] }] },
    ]);
  });

  it("keeps the marks inside the transparent paragraph", () => {
    // The <p> contributes its RUNS to the item, not just its text.
    // ★ Asserting the WHOLE line, not just `[0].runs`: the broken parser emitted
    // the identical run array on a `p` line, so a runs-only assertion passes
    // with the fix reverted (measured — it was one of two vacuous cases in the
    // first cut of this block).
    expect(htmlToRichLines("<ul><li><p>a<strong>b</strong></p></li></ul>")).toEqual([
      {
        kind: "li",
        ordered: false,
        depth: 0,
        index: 0,
        runs: [
          { text: "a", marks: [] },
          { text: "b", marks: ["bold"] },
        ],
      },
    ]);
  });

  it("carries task state in the real stored form", () => {
    const lines = htmlToRichLines(
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="true"><p>done</p></li>' +
        '<li data-type="taskItem" data-checked="false"><p>open</p></li>' +
        "</ul>",
    );
    expect(lines).toEqual([
      {
        kind: "li",
        ordered: false,
        depth: 0,
        index: 0,
        task: "checked",
        runs: [{ text: "done", marks: [] }],
      },
      {
        kind: "li",
        ordered: false,
        depth: 0,
        index: 1,
        task: "unchecked",
        runs: [{ text: "open", marks: [] }],
      },
    ]);
  });

  it("nests a list in the real stored form, restarting and resuming the counters", () => {
    const lines = htmlToRichLines(
      "<ol>" +
        "<li><p>a</p></li>" +
        "<li><p>b</p><ol><li><p>b1</p></li><li><p>b2</p></li></ol></li>" +
        "<li><p>c</p></li>" +
        "</ol>",
    );
    expect(lines.map((l) => (l.kind === "li" ? [l.depth, l.index] : l.kind))).toEqual([
      [0, 0], // a
      [0, 1], // b
      [1, 0], // b1 <- nested counter restarts
      [1, 1], // b2
      [0, 2], // c  <- outer counter resumes
    ]);
  });

  it("takes alignment from the transparent paragraph, where the editor puts it", () => {
    // TextAlign is configured `types: ["heading", "paragraph"]`
    // (rich-text-editor.tsx), so a centred list item stores `data-align` on the
    // INNER <p> and never on the <li>. Reading only the <li> finds nothing.
    // ★ Again the WHOLE line: the broken parser emitted `p` with align "center",
    // so an `[0].align` assertion passes with the fix reverted.
    expect(htmlToRichLines('<ul><li><p data-align="center">a</p></li></ul>')).toEqual([
      {
        kind: "li",
        align: "center",
        ordered: false,
        depth: 0,
        index: 0,
        runs: [{ text: "a", marks: [] }],
      },
    ]);
  });

  it("lets the item's own alignment win over the transparent paragraph's", () => {
    expect(
      alignOfLine(
        htmlToRichLines(
          '<ul><li data-align="right"><p data-align="center">a</p></li></ul>',
        )[0],
      ),
    ).toBe("right");
  });

  it("does not let a whitespace-only run count as the item already having text", () => {
    // Pretty-printed markup puts a whitespace text node between the <li> and its
    // <p>. A `runs.length === 0` guard would see the item as non-empty and lose
    // the whole list again.
    expect(htmlToRichLines("<ul>\n  <li>\n    <p>a</p>\n  </li>\n</ul>")).toEqual([
      { kind: "li", ordered: false, depth: 0, index: 0, runs: [{ text: "a", marks: [] }] },
    ]);
  });

  // ── the decisions this made, each pinned so none of them is accidental ─────
  it("ends the item at a SECOND paragraph, continuing on a plain line", () => {
    // Only the paragraph that IS the item's text is transparent. A second one is
    // a genuine second paragraph, so it takes the ordinary LINE_TAGS path — the
    // same two-line shape "<li>a<br>b</li>" has always produced.
    expect(htmlToRichLines("<ul><li><p>a</p><p>b</p></li></ul>")).toEqual([
      { kind: "li", ordered: false, depth: 0, index: 0, runs: [{ text: "a", marks: [] }] },
      { kind: "p", runs: [{ text: "b", marks: [] }] },
    ]);
  });

  it("matches the <br> continuation shape it was modelled on", () => {
    expect(htmlToRichLines("<ul><li>a<br>b</li></ul>")).toEqual([
      { kind: "li", ordered: false, depth: 0, index: 0, runs: [{ text: "a", marks: [] }] },
      { kind: "p", runs: [{ text: "b", marks: [] }] },
    ]);
  });

  it("keeps a blockquote inside an item as a blockquote, not as item text", () => {
    // NOT transparent, and deliberately: P and DIV carry no kind of their own,
    // so folding one into the item loses nothing. A blockquote carries a kind
    // that merging would destroy — and it can only reach here from markup the
    // editor cannot produce (`paragraph block*` puts a <p> first).
    expect(htmlToRichLines("<ul><li><blockquote>q</blockquote></li></ul>")).toEqual([
      { kind: "blockquote", runs: [{ text: "q", marks: [] }] },
    ]);
  });

  it("keeps a heading inside an item as a heading, level intact", () => {
    expect(htmlToRichLines("<ul><li><h2>h</h2></li></ul>")).toEqual([
      { kind: "heading", level: 2, runs: [{ text: "h", marks: [] }] },
    ]);
  });

  it("still folds a paragraph that FOLLOWS a nested list into no item", () => {
    // The nested <ul> closes the item on the way in, so `current` is no longer
    // the item and the trailing <p> is an ordinary line.
    expect(htmlToRichLines("<ul><li><p>a</p><ul><li><p>a1</p></li></ul><p>t</p></li></ul>")).toEqual([
      { kind: "li", ordered: false, depth: 0, index: 0, runs: [{ text: "a", marks: [] }] },
      { kind: "li", ordered: false, depth: 1, index: 0, runs: [{ text: "a1", marks: [] }] },
      { kind: "p", runs: [{ text: "t", marks: [] }] },
    ]);
  });
});

describe("a list index is spent only on an item that reaches the output", () => {
  it("does not skip a number for an item holding nothing", () => {
    // The increment used to happen at startLine, before the item was known to
    // survive, so an empty <li> still consumed its number and `bulletMarker`
    // rendered the rest of the list one too high ("2." for the first item).
    const lines = htmlToRichLines("<ol><li></li><li>a</li><li>b</li></ol>");
    expect(lines.map((l) => (l.kind === "li" ? [l.index, l.runs[0].text] : l.kind))).toEqual([
      [0, "a"],
      [1, "b"],
    ]);
  });

  it("does not skip a number for an item holding only whitespace", () => {
    const lines = htmlToRichLines("<ol><li>   </li><li>a</li></ol>");
    expect(lines.map((l) => (l.kind === "li" ? l.index : l.kind))).toEqual([0]);
  });

  it("does not skip a number for an item whose only child keeps its own kind", () => {
    const lines = htmlToRichLines("<ol><li><h2>h</h2></li><li>a</li></ol>");
    expect(lines.map((l) => (l.kind === "li" ? l.index : l.kind))).toEqual(["heading", 0]);
  });

  it("numbers a run of mixed bare and paragraph-wrapped items consecutively", () => {
    // Before the transparency fix the middle item vanished as a plain `p` AND
    // spent its number, so this rendered "1. a / b / 3. c".
    const lines = htmlToRichLines("<ol><li>a</li><li><p>b</p></li><li>c</li></ol>");
    expect(lines.map((l) => (l.kind === "li" ? [l.index, l.runs[0].text] : l.kind))).toEqual([
      [0, "a"],
      [1, "b"],
      [2, "c"],
    ]);
  });

  it("keeps a dropped item from skewing a SIBLING list's counter only", () => {
    // Two lists side by side: the first item of the second list is still 0.
    const lines = htmlToRichLines("<ol><li></li><li>a</li></ol><ol><li>b</li></ol>");
    expect(lines.map((l) => (l.kind === "li" ? [l.depth, l.index] : l.kind))).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
});
