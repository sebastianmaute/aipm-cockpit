// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  RICH_ALLOWED_TAGS,
  sanitizeRichHtml,
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
  it("keeps eight of the nine tags documents add beyond the template list", () => {
    const html =
      "<p><s>a</s><code>b</code><mark>c</mark><sub>d</sub><sup>e</sup></p>" +
      "<pre>f</pre><blockquote>g</blockquote><hr>";
    const out = sanitizeDocumentHtml(html);
    // ★★ The closing ">" is load-bearing — assert `<s>`, never `<s`. A bare
    // prefix match is satisfied by a DIFFERENT tag in the same output: `<sub`
    // and `<sup` both start with `<s`, so with "s" dropped from the allow-list
    // the prefix form of this loop still passed the whole file green (measured,
    // not reasoned). None of the eight carries an attribute here, so every one of
    // them renders with its ">" immediately after the name.
    // ★ img is the NINTH tag documents add. It is deliberately not in this loop:
    // what is worth pinning about it is WHICH ATTRIBUTES survive, so it gets the
    // dedicated test below rather than a bare tag-presence check.
    for (const tag of ["s", "code", "mark", "sub", "sup", "pre", "blockquote", "hr"]) {
      expect(out).toContain(`<${tag}>`);
    }
  });

  it("keeps an image reference by id and its alt, and drops any src", () => {
    // ★★ Both attribute assertions must be able to FAIL. They could not before:
    // `data-asset-id` used to survive via ALLOW_DATA_ATTR regardless of the list
    // (so its assertion was vacuous), and `alt` was fed in but never asserted at
    // all. Mutation-proved: dropping either name from DOCUMENT_ALLOWED_ATTR now
    // turns this test red.
    const out = sanitizeDocumentHtml('<p><img data-asset-id="7" src="https://x/y.png" alt="a"></p>');
    expect(out).toContain('data-asset-id="7"');
    expect(out).toContain('alt="a"');
    expect(out).not.toContain("src=");
  });

  it("drops a data-* attribute that is not on the allow-list", () => {
    // ★★ The pin for ALLOW_DATA_ATTR:false. DOMPurify defaults that flag to TRUE
    // and its data-* branch short-circuits before the name test, so WITHOUT the
    // flag every attacker-authored data-* survived on every allowed tag and
    // DOCUMENT_ALLOWED_ATTR was not the gate it reads as.
    const out = sanitizeDocumentHtml('<p data-anything="x" data-onclick-payload="y">hi</p>');
    expect(out).not.toContain("data-anything");
    expect(out).not.toContain("data-onclick-payload");
    expect(out).toContain("hi");
    // ...and the listed one still survives alongside, so this is a name gate and
    // not a blanket data-* ban (that distinction is the whole point of the pair).
    expect(sanitizeDocumentHtml('<img data-asset-id="7" data-anything="x">')).toBe(
      '<img data-asset-id="7">',
    );
  });

  it("drops event handlers on img, the tag this sanitizer adds", () => {
    // ★ <img onerror> is the canonical payload for the one tag documents allow
    // and templates do not. Handlers are stripped today; this pins it against an
    // ADD_ATTR / ALLOW_UNKNOWN_PROTOCOLS-shaped regression.
    const out = sanitizeDocumentHtml('<img data-asset-id="7" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert");
    expect(out).toContain('data-asset-id="7"');
    expect(sanitizeDocumentHtml('<p onclick="x()">hi</p>')).toBe("<p>hi</p>");
  });

  it("strips a script and its text but KEEPS the words of an unknown tag", () => {
    // KEEP_CONTENT stays at DOMPurify's default: unwrap, do not delete text.
    // ★ The script's TEXT is what matters and FORBID_CONTENTS removes it, so
    // assert the exact output — `not.toContain("<script")` alone would pass while
    // a bare `alert(1)` sat in the prose.
    expect(sanitizeDocumentHtml("<p><script>alert(1)</script>hi</p>")).toBe("<p>hi</p>");
    expect(sanitizeDocumentHtml("<div>kept</div>")).toContain("kept");
  });

  it("stays WIDER than the shared rich sanitizer", () => {
    // ★★ This test used to read "does not widen the SHARED template sanitizer"
    // and pinned the OPPOSITE of what it asserts now: that `mark` and
    // `blockquote` were stripped everywhere except documents. That was the right
    // guard while the template list was the narrow 11-tag one; the rich list
    // admits both on purpose (open-followups §137), so the old assertions now
    // encode a policy the code deliberately left. What is still worth pinning is
    // the RELATION — documents must remain strictly wider — so the guard moves to
    // the one tag documents still add alone.
    expect(sanitizeDocumentHtml('<img data-asset-id="7">')).toContain("<img");
    expect(sanitizeRichHtml('<img data-asset-id="7">')).not.toContain("<img");
  });
});

describe("sanitizeRichHtml — the §137 losses become lossless", () => {
  // Each input is one of the five cases measured in open-followups §137 through
  // the real sanitizeNoteHtml, where KEEP_CONTENT:false deleted the WORD along
  // with its tag. Assert the surviving WORD, never merely "no error" — a test
  // that asserts absence passes vacuously.
  it("keeps heading text", () => {
    expect(sanitizeRichHtml("<h1>Title</h1><p>body</p>")).toContain("Title");
  });

  it("keeps underlined text", () => {
    expect(sanitizeRichHtml("<u>underlined</u> rest")).toContain("underlined");
  });

  it("keeps blockquote text", () => {
    expect(sanitizeRichHtml("<blockquote>quoted</blockquote>")).toContain("quoted");
  });

  it("keeps mid-sentence underline without eating the sentence", () => {
    expect(sanitizeRichHtml("<p>plain <u>under</u> tail</p>")).toContain("under");
  });

  it("unwraps an UNLISTED tag but keeps its words", () => {
    // h5 is deliberately not on the list (headings 1-4 only). Unwrap, never delete.
    const out = sanitizeRichHtml("<p>a</p><h5>Sub</h5>");
    expect(out).toContain("Sub");
    expect(out).not.toContain("<h5>");
  });

  it("still strips script and its content", () => {
    const out = sanitizeRichHtml("<p>ok</p><script>alert(1)</script>");
    expect(out).toContain("ok");
    expect(out).not.toContain("alert");
    expect(out).not.toContain("<script");
  });

  it("still strips a javascript: href", () => {
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
  });

  it("keeps an https href", () => {
    expect(sanitizeRichHtml('<a href="https://example.com/a">x</a>')).toContain('href="https://example.com/a"');
  });

  it("is idempotent on already-clean html", () => {
    const clean = sanitizeRichHtml("<p>a <strong>b</strong></p>");
    expect(sanitizeRichHtml(clean)).toBe(clean);
  });

  it("admits every tag the Simple-template toolbar can produce", () => {
    for (const tag of ["p", "br", "hr", "strong", "em", "u", "s", "code", "pre",
                       "blockquote", "h1", "h2", "h3", "h4", "ul", "ol", "li",
                       "mark", "sub", "sup", "a"]) {
      expect(RICH_ALLOWED_TAGS).toContain(tag);
    }
  });

  it("does NOT admit headings 5 and 6", () => {
    expect(RICH_ALLOWED_TAGS).not.toContain("h5");
    expect(RICH_ALLOWED_TAGS).not.toContain("h6");
  });

  it("carries no #text pseudo-entry", () => {
    // NOTE_ALLOWED_TAGS carried "#text"; it is not a tag name and htmlStartRe drops it.
    expect(RICH_ALLOWED_TAGS).not.toContain("#text");
  });
});
