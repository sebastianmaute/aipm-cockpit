// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  sanitizeTemplateHtml,
  sanitizeNoteHtml,
  sanitizeDocumentHtml,
  htmlToText,
  plainToHtml,
} from "./sanitize-html";

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

describe("plainToHtml", () => {
  it("escapes < so no literal tag survives", () => {
    const out = plainToHtml("a<b");
    expect(out).toContain("&lt;");
    expect(out).not.toContain("<b");
  });
  it("wraps the text in a single <p>", () => {
    const out = plainToHtml("hello");
    expect(out).toBe("<p>hello</p>");
  });
  it("returns empty string for empty input", () => {
    expect(plainToHtml("")).toBe("");
  });
  it("converts newlines to <br>", () => {
    const out = plainToHtml("line1\nline2");
    expect(out).toContain("<br>");
    expect(out).toContain("line1");
    expect(out).toContain("line2");
  });
});

describe("htmlToText", () => {
  it("extracts plain text", () => {
    expect(htmlToText("<p><strong>Hi</strong> there</p>")).toBe("Hi there");
  });
  it("returns empty for empty", () => {
    expect(htmlToText("")).toBe("");
  });

  it("leaves the default path byte-identical, newline included", () => {
    // ★★ The default collapse is what descriptionText and every search/preview
    // consumer depend on: ALL whitespace, newline included, becomes one space.
    // Expected values are hardcoded so a shared bug cannot make both sides
    // agree. `{}` and an explicit false must behave like the options-less call.
    const cases: Array<[string, string]> = [
      ["<p><strong>Hi</strong> there</p>", "Hi there"],
      ["a\nb", "a b"],
      ["<p>a</p>\n<p>b</p>", "a b"],
      ["a   \t b", "a b"],
      ["  padded  ", "padded"],
      ["", ""],
    ];
    for (const [input, expected] of cases) {
      expect(htmlToText(input)).toBe(expected);
      expect(htmlToText(input, {})).toBe(expected);
      expect(htmlToText(input, { preserveBreaks: false })).toBe(expected);
    }
  });

  it("keeps a caller-inserted newline when asked, collapsing only horizontally", () => {
    // ★★ This is the whole reason the flag exists. descriptionTextWithBreaks
    // separates block boundaries with "\n" BEFORE sanitizing — it has to,
    // because ALLOWED_TAGS:[] deletes tags with nothing in their place — and the
    // default collapse then flattened every one of those boundaries back to a
    // space, silently undoing the caller's separator.
    expect(htmlToText("a\nb", { preserveBreaks: true })).toBe("a\nb");
    expect(htmlToText("a \n\n  b", { preserveBreaks: true })).toBe("a\nb");
    expect(htmlToText("a   \t b", { preserveBreaks: true })).toBe("a b");
    expect(htmlToText("\na\n", { preserveBreaks: true })).toBe("a");
    // Still sanitizes: break mode is a whitespace decision, not a safety one.
    expect(htmlToText("<script>alert(1)</script>\nok", { preserveBreaks: true })).not.toContain(
      "alert",
    );
  });
});

describe("sanitizeDocumentHtml", () => {
  it("keeps the eight tags documents add beyond the template list", () => {
    const html =
      "<p><s>a</s><code>b</code><mark>c</mark><sub>d</sub><sup>e</sup></p>" +
      "<pre>f</pre><blockquote>g</blockquote><hr>";
    const out = sanitizeDocumentHtml(html);
    // ★★ The closing ">" is load-bearing — assert `<s>`, never `<s`. A bare
    // prefix match is satisfied by a DIFFERENT tag in the same output: `<sub`
    // and `<sup` both start with `<s`, so with "s" dropped from the allow-list
    // the prefix form of this loop still passed all 21 tests (measured, not
    // reasoned). None of the eight carries an attribute here, so every one of
    // them renders with its ">" immediately after the name.
    for (const tag of ["s", "code", "mark", "sub", "sup", "pre", "blockquote", "hr"]) {
      expect(out).toContain(`<${tag}>`);
    }
  });

  it("keeps an image reference by id and drops any src", () => {
    const out = sanitizeDocumentHtml('<p><img data-asset-id="7" src="https://x/y.png" alt="a"></p>');
    expect(out).toContain('data-asset-id="7"');
    expect(out).not.toContain("src=");
  });

  it("strips a script but KEEPS the words of an unknown tag", () => {
    // KEEP_CONTENT stays at DOMPurify's default: unwrap, do not delete text.
    expect(sanitizeDocumentHtml("<p><script>alert(1)</script>hi</p>")).not.toContain("<script");
    expect(sanitizeDocumentHtml("<div>kept</div>")).toContain("kept");
  });

  it("does not widen the SHARED template sanitizer", () => {
    // The guard that matters: documents gained tags, everyone else did not.
    expect(sanitizeTemplateHtml("<p><mark>x</mark></p>")).not.toContain("<mark");
    expect(sanitizeTemplateHtml("<blockquote>y</blockquote>")).not.toContain("<blockquote");
  });
});
