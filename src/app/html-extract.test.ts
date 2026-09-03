import { describe, it, expect } from "vitest";
import { extractHtmlMarkdown } from "./html-extract";

describe("extractHtmlMarkdown", () => {
  // ★★★ THE DEFECT THIS EXISTS FOR. .html classified as `text`, so the raw
  //  source — script bodies included — was handed to the model verbatim.
  it("drops script and style bodies entirely", () => {
    const out = extractHtmlMarkdown(
      `<html><head><style>.a{color:red}</style></head>` +
      `<body><script>var secret = 41 + 1;</script><p>Kept</p></body></html>`,
    );
    expect(out).toContain("Kept");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("color:red");
  });

  it("drops nav and footer chrome", () => {
    const out = extractHtmlMarkdown(
      `<body><nav>Home About</nav><p>Body text</p><footer>(c) 2026</footer></body>`,
    );
    expect(out).toContain("Body text");
    expect(out).not.toContain("Home About");
    expect(out).not.toContain("(c) 2026");
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

  it("decodes entities", () => {
    expect(extractHtmlMarkdown(`<p>A &amp; B &lt; C &#39;quoted&#39; &nbsp;end</p>`))
      .toContain("A & B < C 'quoted'");
  });

  it("keeps block boundaries apart rather than running words together", () => {
    expect(extractHtmlMarkdown(`<p>one</p><p>two</p>`)).toMatch(/one\s*\n\s*\n?\s*two/);
  });

  it("returns the empty-document marker for markup with no text", () => {
    expect(extractHtmlMarkdown(`<html><head><title>x</title></head><body></body></html>`))
      .toBe("_(document contained no extractable text)_");
  });

  it("does not throw on unterminated markup", () => {
    expect(() => extractHtmlMarkdown(`<p>text <div><span`)).not.toThrow();
  });
});
