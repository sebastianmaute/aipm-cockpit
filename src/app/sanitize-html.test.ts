// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeTemplateHtml, sanitizeNoteHtml, htmlToText } from "./sanitize-html";

describe("sanitizeTemplateHtml", () => {
  it("drops <script> and event handlers", () => {
    expect(sanitizeTemplateHtml("<script>alert(1)</script>")).not.toContain("script");
    expect(sanitizeTemplateHtml('<p onclick="x()">hi</p>')).not.toContain("onclick");
    expect(sanitizeTemplateHtml('<p onclick="x()">hi</p>')).toContain("hi");
  });
  it("drops a javascript: href but keeps the link text", () => {
    const out = sanitizeTemplateHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript");
    expect(out).toContain("x");
  });
  it("keeps allowed formatting marks and blocks", () => {
    const out = sanitizeTemplateHtml("<p><strong>b</strong> <em>i</em> <u>u</u></p><h1>H</h1><ul><li>one</li></ul>");
    expect(out).toContain("<strong>");
    expect(out).toContain("<em>");
    expect(out).toContain("<u>");
    expect(out).toContain("<h1>");
    expect(out).toContain("<li>");
  });
  it("keeps a safe http link (href preserved)", () => {
    // DOMPurify strips the cosmetic target/rel; the security-relevant part is
    // that the safe href and the anchor survive.
    const out = sanitizeTemplateHtml('<a href="https://ok.example" target="_blank" rel="noopener noreferrer">x</a>');
    expect(out).toContain('href="https://ok.example"');
    expect(out).toContain(">x</a>");
  });
  it("leaves merge-field tokens untouched", () => {
    expect(sanitizeTemplateHtml("<p>Hi {{taskName}}</p>")).toContain("{{taskName}}");
  });
  it("drops <style>", () => {
    expect(sanitizeTemplateHtml("<style>p{}</style><p>x</p>")).not.toContain("<style>");
  });
});

describe("sanitizeNoteHtml", () => {
  it("keeps the lean mark set", () => {
    const out = sanitizeNoteHtml("<p><strong>a</strong> <em>b</em></p><ul><li>x</li></ul>");
    expect(out).toContain("<strong>a</strong>");
    expect(out).toContain("<em>b</em>");
    expect(out).toContain("<li>x</li>");
  });
  it("strips disallowed tags and scripts", () => {
    expect(sanitizeNoteHtml('<script>alert(1)</script><h1>no</h1><p>ok</p>'))
      .toBe("<p>ok</p>");
  });
  it("keeps safe links, drops javascript: urls", () => {
    expect(sanitizeNoteHtml('<a href="https://x.io">l</a>')).toContain('href="https://x.io"');
    expect(sanitizeNoteHtml('<a href="javascript:alert(1)">l</a>')).not.toContain("javascript");
  });
});

describe("htmlToText", () => {
  it("extracts plain text", () => {
    expect(htmlToText("<p><strong>Hi</strong> there</p>")).toBe("Hi there");
  });
  it("returns empty for empty", () => {
    expect(htmlToText("")).toBe("");
  });
});
