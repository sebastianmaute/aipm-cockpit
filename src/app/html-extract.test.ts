import { describe, it, expect } from "vitest";
import { extractHtmlMarkdown, decodeEntities } from "./html-extract";

describe("extractHtmlMarkdown", () => {
  // ★★★ THE DEFECT THIS EXISTS FOR. .html classified as `text`, so the raw
  //  source — script bodies included — was handed to the model verbatim.
  it("drops script and style bodies entirely", () => {
    const out = extractHtmlMarkdown(
      `<html><body><style>.a{color:red}</style>` +
      `<script>var secret = 41 + 1;</script><p>Kept</p></body></html>`,
    );
    expect(out).toContain("Kept");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("color:red");
  });

  // Style now lives outside <head> above, so this pins the "head" guard on
  // its own — deleting only "head" from DROP_SUBTREE cannot pass the test
  // above by riding along on the "style" guard.
  it("drops the entire <head> subtree, not just recognized children", () => {
    const out = extractHtmlMarkdown(
      `<html><head><title>Ignored Title</title><meta name="x" content="y"></head>` +
      `<body><p>Kept</p></body></html>`,
    );
    expect(out).toContain("Kept");
    expect(out).not.toContain("Ignored Title");
  });

  it("drops nav and footer chrome", () => {
    const out = extractHtmlMarkdown(
      `<body><nav>Home About</nav><p>Body text</p><footer>(c) 2026</footer></body>`,
    );
    expect(out).toContain("Body text");
    expect(out).not.toContain("Home About");
    expect(out).not.toContain("(c) 2026");
  });

  it("drops aside chrome", () => {
    const out = extractHtmlMarkdown(`<body><aside>Related links</aside><p>Kept</p></body>`);
    expect(out).toContain("Kept");
    expect(out).not.toContain("Related links");
  });

  it("drops noscript fallback content", () => {
    const out = extractHtmlMarkdown(`<body><noscript>Enable JS please</noscript><p>Kept</p></body>`);
    expect(out).toContain("Kept");
    expect(out).not.toContain("Enable JS please");
  });

  it("drops inline svg markup", () => {
    const out = extractHtmlMarkdown(
      `<body><svg><circle cx="1" cy="1" r="1"></circle></svg><p>Kept</p></body>`,
    );
    expect(out).toContain("Kept");
    expect(out).not.toContain("circle");
  });

  it("drops to end of input for an unterminated drop-subtree tag", () => {
    const out = extractHtmlMarkdown(`<p>before</p><script>var x = 1;`);
    expect(out).toBe("before");
  });

  it("renders headings and list items as Markdown", () => {
    const out = extractHtmlMarkdown(`<h2>Title</h2><ul><li>one</li><li>two</li></ul>`);
    expect(out).toContain("## Title");
    expect(out).toContain("- one");
    expect(out).toContain("- two");
  });

  it("renders a table as a Markdown table", () => {
    const out = extractHtmlMarkdown(
      `<table><tr><th>Role</th><th>Hours</th></tr><tr><td>PM</td><td>40</td></tr></table>`,
    );
    expect(out).toContain("| Role | Hours |");
    expect(out).toContain("| PM | 40 |");
  });

  it("renders a multi-row table with a header separator and every data row", () => {
    const out = extractHtmlMarkdown(
      `<table><tr><th>Role</th><th>Hours</th></tr>` +
      `<tr><td>PM</td><td>40</td></tr><tr><td>Dev</td><td>80</td></tr></table>`,
    );
    const lines = out.split("\n").filter(Boolean);
    expect(lines[0]).toBe("| Role | Hours |");
    expect(lines[1]).toBe("| --- | --- |");
    expect(lines[2]).toBe("| PM | 40 |");
    expect(lines[3]).toBe("| Dev | 80 |");
  });

  it("decodes entities", () => {
    expect(extractHtmlMarkdown(`<p>A &amp; B &lt; C &#39;quoted&#39; &nbsp;end</p>`))
      .toContain("A & B < C 'quoted'");
  });

  it("decodes hexadecimal numeric entities", () => {
    expect(extractHtmlMarkdown(`<p>&#x41;</p>`)).toContain("A");
  });

  it("leaves an out-of-range numeric entity un-decoded rather than throwing", () => {
    expect(() => extractHtmlMarkdown(`<p>&#0;&#1114112;</p>`)).not.toThrow();
    const out = extractHtmlMarkdown(`<p>&#0;&#1114112;</p>`);
    expect(out).toContain("&#0;");
    expect(out).toContain("&#1114112;");
  });

  it("decodes nbsp to a plain ASCII space, not a non-breaking space (spec: U+0020)", () => {
    expect(decodeEntities("&nbsp;").codePointAt(0)).toBe(32);
  });

  it("does not let a double-encoded entity smuggle a raw pipe past table escaping", () => {
    const out = extractHtmlMarkdown(`<table><tr><td>a&amp;#124;b</td><td>c</td></tr></table>`);
    // A real forged pipe here would split "a|b" into its own column.
    expect(out).toContain("| a&#124;b | c |");
    expect(out).not.toMatch(/\|\s*a\s*\|\s*b\s*\|\s*c\s*\|/);
  });

  it("converts <br> to a newline", () => {
    expect(extractHtmlMarkdown(`<p>line one<br>line two</p>`)).toMatch(/line one\nline two/);
  });

  it("keeps block boundaries apart rather than running words together", () => {
    expect(extractHtmlMarkdown(`<p>one</p><p>two</p>`)).toMatch(/one\s*\n\s*\n?\s*two/);
  });

  it("strips HTML comments, including ones hiding a boundary-breaking '>' inside them", () => {
    const out = extractHtmlMarkdown(`<!-- hidden > INJECTED --><p>ok</p>`);
    expect(out).toBe("ok");
    expect(out).not.toContain("INJECTED");
  });

  it("does not throw on an unterminated HTML comment, and drops the rest of the input", () => {
    expect(() => extractHtmlMarkdown(`<p>before</p><!-- never closed <p>after</p>`)).not.toThrow();
    expect(extractHtmlMarkdown(`<p>before</p><!-- never closed <p>after</p>`)).toBe("before");
  });

  it("returns the empty-document marker for markup with no text", () => {
    expect(extractHtmlMarkdown(`<html><head><title>x</title></head><body></body></html>`))
      .toBe("_(document contained no extractable text)_");
  });

  it("does not throw on unterminated markup and keeps the text before it", () => {
    expect(() => extractHtmlMarkdown(`<p>text <div><span`)).not.toThrow();
    expect(extractHtmlMarkdown(`<p>text <div><span`)).toContain("text");
  });

  it("drops a trailing unterminated tag instead of leaving it as literal text", () => {
    expect(extractHtmlMarkdown(`<p>Kept text</p><div><span`)).toBe("Kept text");
  });

  it("clamps pathologically large input before processing it", () => {
    const big = "a".repeat(600_000);
    const out = extractHtmlMarkdown(big);
    expect(out.length).toBeLessThanOrEqual(500_000);
    expect(out.length).toBeLessThan(big.length);
  });

  it("clamps a pathologically wide table to a bounded column count", () => {
    const manyCols = Array.from({ length: 200 }, (_, i) => `<td>c${i}</td>`).join("");
    const out = extractHtmlMarkdown(`<table><tr>${manyCols}</tr></table>`);
    const headerLine = out.split("\n").filter(Boolean)[0];
    const colCount = headerLine.split(" | ").length;
    expect(colCount).toBeLessThanOrEqual(64);
  });

  it("clamps a pathologically tall table to a bounded row count", () => {
    const manyRows = Array.from({ length: 2000 }, (_, i) => `<tr><td>r${i}</td></tr>`).join("");
    const out = extractHtmlMarkdown(`<table>${manyRows}</table>`);
    const lineCount = out.split("\n").filter(Boolean).length;
    // header + separator + up to 999 data rows (first collected row becomes the header)
    expect(lineCount).toBeLessThanOrEqual(1001);
  });
});
