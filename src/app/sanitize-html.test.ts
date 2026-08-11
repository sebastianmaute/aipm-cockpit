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

describe("sanitizeRichHtml — the wider allow-list", () => {
  // ★★★ THESE FIVE FIXTURES PIN THE LIST WIDTH AND NOTHING ELSE. They are the
  // five cases open-followups §137 measured, but §137 measured them against the
  // OLD 8-tag note list, where `h1`, `u` and `blockquote` were UNLISTED and
  // KEEP_CONTENT:false deleted each word along with its tag. All three are on the
  // 21-tag rich list now, so KEEP_CONTENT never reaches them. Measured, not
  // reasoned: re-applying the note config (KEEP_CONTENT:false + "#text") to
  // sanitizeRichHtml leaves every one of them GREEN — only 1 of 35 tests went
  // red, and it was the h5 one. The KEEP_CONTENT default therefore needs its own
  // fixtures, which is the describe block below; do not read this one as covering
  // it.
  //
  // ★★ Assert with toBe, never toContain. `toContain("Title")` is satisfied by
  // "<p>&lt;h1&gt;Title&lt;/h1&gt;</p>" — the ESCAPED form a classifier miss
  // produces — so a substring assertion cannot tell markup from escaped text from
  // bare text, which is the one distinction these fixtures exist to draw. Every
  // output below is stable, so every assertion is exact.
  it("keeps a heading as markup, not as escaped text", () => {
    expect(sanitizeRichHtml("<h1>Title</h1><p>body</p>")).toBe("<h1>Title</h1><p>body</p>");
  });

  it("keeps underlined text as markup", () => {
    expect(sanitizeRichHtml("<u>underlined</u> rest")).toBe("<u>underlined</u> rest");
  });

  it("keeps a blockquote as markup", () => {
    expect(sanitizeRichHtml("<blockquote>quoted</blockquote>")).toBe("<blockquote>quoted</blockquote>");
  });

  it("keeps a mid-sentence underline without eating the sentence", () => {
    expect(sanitizeRichHtml("<p>plain <u>under</u> tail</p>")).toBe("<p>plain <u>under</u> tail</p>");
  });

  it("is idempotent on already-clean html", () => {
    const clean = sanitizeRichHtml("<p>a <strong>b</strong></p>");
    expect(sanitizeRichHtml(clean)).toBe(clean);
  });

  it("carries EXACTLY the 21 tags, no more", () => {
    // ★★★ The membership tests below document intent; THIS one is the gate, and
    // it is the only assertion bounding the list from ABOVE. Without it,
    // appending "iframe", "style", "form" and "input" to RICH_ALLOWED_TAGS left
    // the whole file green — measured. This is the app's single rich-text storage
    // allow-list, so a silent widening is the direction that matters.
    const expected = ["p", "br", "hr", "strong", "em", "u", "s", "code", "mark", "sub", "sup",
                      "pre", "blockquote", "h1", "h2", "h3", "h4", "ul", "ol", "li", "a"];
    expect([...RICH_ALLOWED_TAGS].sort()).toEqual([...expected].sort());
  });

  it("admits every tag the unified allow-list must carry", () => {
    // ★ Named for what it asserts. It used to say "every tag the Simple-template
    // toolbar can produce", which is not true of `mark`/`sub`/`sup` — those
    // extensions are installed but registered on no editor, so no control emits
    // them yet. They are here because the list must cover DOCUMENT_ALLOWED_TAGS
    // once Task 3 derives it from this array, not because a button exists.
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

describe("sanitizeRichHtml — KEEP_CONTENT stays at DOMPurify's default", () => {
  // ★★★ THIS is the §137 pin, and the block above cannot stand in for it. Every
  // tag below is on NO allow-list, so the default (unwrap the tag, keep the
  // words) is the only thing that can preserve the word — setting
  // KEEP_CONTENT:false deletes the element TOGETHER WITH ITS TEXT, which is the
  // data loss that ran on every JSON and IndexedDB load with no human and no save
  // involved. Mutation-verified: the note config turns all four of these red.
  //
  // ★ The four are deliberately different SHAPES — a near-miss of a listed tag
  // (h5 against h1-h4), a block sibling, an INLINE tag mid-sentence, and a
  // container whose text is nested two levels down. A single fixture would pin
  // one traversal path.
  it("unwraps a heading just past the listed range and keeps its words", () => {
    expect(sanitizeRichHtml("<p>a</p><h5>Sub</h5>")).toBe("<p>a</p>Sub");
  });

  it("unwraps an unlisted block and keeps its words", () => {
    expect(sanitizeRichHtml("<p>a</p><div>kept</div>")).toBe("<p>a</p>kept");
  });

  it("unwraps an unlisted inline tag mid-sentence without eating the sentence", () => {
    expect(sanitizeRichHtml("<p>x <span>y</span> z</p>")).toBe("<p>x y z</p>");
  });

  it("keeps text nested inside an unlisted container", () => {
    expect(sanitizeRichHtml("<table><tr><td>cell</td></tr></table>")).toBe("cell");
  });

  it("still deletes a script AND its text — the one tag whose content must go", () => {
    // ★ FORBID_CONTENTS, not KEEP_CONTENT: the unwrap default must not be read as
    // "keep every tag's text". Assert the exact output — `not.toContain("<script")`
    // alone passes while a bare `alert(1)` sits in the prose.
    expect(sanitizeRichHtml("<p>ok</p><script>alert(1)</script>")).toBe("<p>ok</p>");
  });
});

describe("sanitizeRichHtml — the URI policy", () => {
  it("strips a javascript: href", () => {
    // ★ This one does NOT pin SAFE_URI_REGEXP: DOMPurify's DEFAULT policy blocks
    // javascript: too, so the assertion survives deleting the custom regexp.
    // It is kept as the canonical payload; the two below are the actual pins.
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
  });

  it("strips an ftp: href, which the DEFAULT policy would allow", () => {
    expect(sanitizeRichHtml('<a href="ftp://x/y">x</a>')).toBe("<a>x</a>");
  });

  it("strips a tel: href, which the DEFAULT policy would allow", () => {
    // ★★ Together with the ftp case this is what makes SAFE_URI_REGEXP load-bearing:
    // both schemes are in DOMPurify's default ALLOWED_URI_REGEXP, so both assertions
    // go red the moment the custom end-anchored https|mailto pattern is dropped.
    expect(sanitizeRichHtml('<a href="tel:+1234">x</a>')).toBe("<a>x</a>");
  });

  it("keeps an https href", () => {
    expect(sanitizeRichHtml('<a href="https://example.com/a">x</a>')).toBe(
      '<a href="https://example.com/a">x</a>',
    );
  });
});
