import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  capHtmlText,
  descriptionHtml,
  htmlPlainProjection,
  htmlTextLength,
  sanitizeRichText,
} from "./rich-text-plain";

describe("descriptionHtml", () => {
  it("escapes and wraps a legacy plain value", () => {
    expect(descriptionHtml("cost < 5k & rising")).toBe("<p>cost &lt; 5k &amp; rising</p>");
  });

  it("keeps a plain value whose stray < is not a tag", () => {
    expect(descriptionHtml("5 < 10 items")).toBe("<p>5 &lt; 10 items</p>");
    expect(descriptionHtml("<3 open")).toBe("<p>&lt;3 open</p>");
  });

  it("passes through a value that already opens with an allowed tag", () => {
    expect(descriptionHtml("<p>done</p>")).toBe("<p>done</p>");
    expect(descriptionHtml("<strong>lead</strong> rest")).toBe("<strong>lead</strong> rest");
  });

  it("is idempotent — it runs on every load", () => {
    for (const raw of ["cost < 5k", "<p>done</p>", "", "  "]) {
      expect(descriptionHtml(descriptionHtml(raw))).toBe(descriptionHtml(raw));
    }
  });

  it("converts newlines to <br>", () => {
    expect(descriptionHtml("a\nb")).toBe("<p>a<br>b</p>");
  });

  it("returns empty for blank input", () => {
    expect(descriptionHtml(undefined)).toBe("");
    expect(descriptionHtml("   ")).toBe("");
  });
});

describe("htmlPlainProjection", () => {
  it("strips tags and decodes entities", () => {
    expect(htmlPlainProjection("<p>cost &lt; 5k &amp; rising</p>")).toBe("cost < 5k & rising");
  });

  it("decodes &amp; LAST so &amp;lt; does not double-decode", () => {
    expect(htmlPlainProjection("<p>&amp;lt;b&amp;gt;</p>")).toBe("&lt;b&gt;");
  });

  it("treats &nbsp; in every spelling as a space", () => {
    expect(htmlPlainProjection("<p>a&nbsp;b&#160;c&#xa0;d</p>")).toBe("a b c d");
  });
});

describe("htmlTextLength", () => {
  // ★ headline claim first: markup must not consume the user's budget.
  it("counts text, not markup", () => {
    const html = "<ul><li><strong>ab</strong></li><li>cd</li></ul>";
    expect(htmlTextLength(html)).toBe(4);
    expect(html.length).toBeGreaterThan(40);
  });
});

describe("capHtmlText", () => {
  it("returns the input untouched when the text fits", () => {
    const html = "<p><strong>keep</strong> me</p>";
    expect(capHtmlText(html, 5000)).toBe(html);
  });

  it("never leaves a severed tag when it truncates", () => {
    const html = "<p><strong>abcdefghij</strong></p>";
    const out = capHtmlText(html, 4);
    expect(out).toBe("<p>abcd</p>");
    expect(out).not.toContain("<strong");
  });
});

describe("sanitizeRichText", () => {
  it("upgrades, caps and rejects a non-string", () => {
    expect(sanitizeRichText("plain", 5000)).toBe("<p>plain</p>");
    expect(sanitizeRichText(42, 5000)).toBe("");
    expect(sanitizeRichText(undefined, 5000)).toBe("");
  });

  it("strips control characters but keeps newlines", () => {
    expect(sanitizeRichText("a\x07b\nc", 5000)).toBe("<p>ab<br>c</p>");
  });
});

// ★★ Guard: this module runs inside the entity sanitizers, which execute under
// bare node in the sample/fixture scripts. A DOMPurify CALL there throws, and
// jsonToWorkspace's catch-all turns that into an EMPTY workspace.
describe("DOM-free guard", () => {
  it("never calls a DOMPurify-backed helper", () => {
    const src = readFileSync(join(import.meta.dirname, "rich-text-plain.ts"), "utf8");
    expect(src).not.toMatch(/dompurify/i);
    expect(src).not.toMatch(/htmlToText/);
    expect(src).not.toMatch(/sanitizeNoteHtml/);
    expect(src).not.toMatch(/sanitizeTemplateHtml/);
  });
});
