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
    expect(htmlToRichLines("<h1>a</h1><h2>b</h2>")).toEqual([
      { kind: "p", runs: [{ text: "a", marks: [] }] },
      { kind: "p", runs: [{ text: "b", marks: [] }] },
    ]);
  });

  it("renders a list item as a plain paragraph line", () => {
    expect(htmlToRichLines("<ul><li>a</li><li>b</li></ul>")).toEqual([
      { kind: "p", runs: [{ text: "a", marks: [] }] },
      { kind: "p", runs: [{ text: "b", marks: [] }] },
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
