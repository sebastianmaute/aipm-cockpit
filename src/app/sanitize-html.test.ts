// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOCUMENT_ALLOWED_TAGS,
  RICH_ALLOWED_TAGS,
  sanitizeRichHtml,
  sanitizeDocumentHtml,
  htmlToText,
  plainToHtml,
} from "./sanitize-html";
import * as sanitizeHtml from "./sanitize-html";

// ★★★ THE POINT OF THE WHOLE SLICE, asserted structurally rather than in prose.
// Three sanitizers over two disagreeing allow-lists is what produced §137: the
// narrow one (`sanitizeNoteHtml`, 8 tags at KEEP_CONTENT:false) DELETED the text
// of anything the wide one admitted, at whole-object LOAD boundaries, with no
// human and no save involved. Re-adding any of these four names — even as an
// alias, which is the tempting "harmless" version — recreates a second list that
// can drift from the one the classifiers derive from.
describe("one sanitizer, not three", () => {
  it("exports no sanitizeNoteHtml", () => {
    expect("sanitizeNoteHtml" in sanitizeHtml).toBe(false);
  });
  it("exports no sanitizeTemplateHtml", () => {
    expect("sanitizeTemplateHtml" in sanitizeHtml).toBe(false);
  });
  it("exports no NOTE_ALLOWED_TAGS or TEMPLATE_ALLOWED_TAGS", () => {
    expect("NOTE_ALLOWED_TAGS" in sanitizeHtml).toBe(false);
    expect("TEMPLATE_ALLOWED_TAGS" in sanitizeHtml).toBe(false);
  });
  it("still exports the two that remain — anti-vacuity for the three above", () => {
    // Without this, deleting the whole module's exports would turn the three
    // negative assertions green.
    expect("sanitizeRichHtml" in sanitizeHtml).toBe(true);
    expect("sanitizeDocumentHtml" in sanitizeHtml).toBe(true);
  });
});

// ★★ COVERAGE INHERITED FROM THE RETIRED `sanitizeTemplateHtml` DESCRIBE. Its
// remaining cases ARE covered by the `sanitizeRichHtml` describes below — the mark
// set and idempotence by "the wider allow-list", `<script>` by the KEEP_CONTENT
// block, and a `javascript:` href by "the URI policy" — so only the cases below
// are retargeted rather than deleted with the shim.
// ★★★ THE EVENT-HANDLER CASE IS ONE OF THEM, and an earlier draft of this note
// listed it as inherited. It is NOT: the only `onclick` assertion elsewhere in
// this file is `sanitizeDocumentHtml`'s, so deleting the shim's describe without
// this test would have left `sanitizeRichHtml` — the sanitizer guarding the seven
// rich entity fields, the note log and the narrative — with NO event-handler
// coverage at all. Checked by grep, not by memory.
// ★ The retired `sanitizeNoteHtml` describe is NOT reproduced: its distinctive
// case asserted `'<script>…</script><h1>no</h1><p>ok</p>'` === `"<p>ok</p>"`, i.e.
// that a heading and its word were DELETED. That is the §137 behaviour itself, and
// pinning it now would pin the defect.
describe("sanitizeRichHtml — cases inherited from the retired template sanitizer", () => {
  it("drops an event-handler attribute but keeps the element's text", () => {
    expect(sanitizeRichHtml('<p onclick="x()">hi</p>')).toBe("<p>hi</p>");
  });
  it("keeps a safe http link (href preserved)", () => {
    // DOMPurify strips the cosmetic target/rel; the security-relevant part is
    // that the safe href and the anchor survive.
    const out = sanitizeRichHtml('<a href="https://ok.example" target="_blank" rel="noopener noreferrer">x</a>');
    expect(out).toContain('href="https://ok.example"');
    expect(out).toContain(">x</a>");
  });
  it("leaves merge-field tokens untouched", () => {
    expect(sanitizeRichHtml("<p>Hi {{taskName}}</p>")).toContain("{{taskName}}");
  });
  it("drops <style>", () => {
    expect(sanitizeRichHtml("<style>p{}</style><p>x</p>")).not.toContain("<style>");
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
  it("keeps the extended mark and block set the rich list carries", () => {
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
    // ★ These eight reach this sanitizer through DOCUMENT_ALLOWED_TAGS' spread of
    // RICH_ALLOWED_TAGS, so the loop is a config assertion, not a list assertion —
    // it fails if sanitizeDocumentHtml stops passing the derived list.
    // ★ img is the one tag documents add ON TOP of that spread. It is deliberately
    // not in this loop: what is worth pinning about it is WHICH ATTRIBUTES survive,
    // so it gets the dedicated test below rather than a bare tag-presence check.
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

describe("DOCUMENT_ALLOWED_TAGS derives from RICH_ALLOWED_TAGS", () => {
  it("is a strict superset of the rich list", () => {
    for (const tag of RICH_ALLOWED_TAGS) expect(DOCUMENT_ALLOWED_TAGS).toContain(tag);
  });

  it("adds exactly img and nothing else", () => {
    const extra = DOCUMENT_ALLOWED_TAGS.filter((t) => !RICH_ALLOWED_TAGS.includes(t));
    expect(extra).toEqual(["img"]);
  });

  it("gained h3 and h4 versus the pre-slice document list and LOST nothing", () => {
    // Pre-slice DOCUMENT_ALLOWED_TAGS, spelled literally so the assertion cannot
    // drift with the code it guards.
    const before = ["p","br","strong","em","u","h1","h2","ul","ol","li","a",
                    "s","code","pre","blockquote","hr","mark","sub","sup","img"];
    const lost = before.filter((t) => !DOCUMENT_ALLOWED_TAGS.includes(t));
    const gained = DOCUMENT_ALLOWED_TAGS.filter((t) => !before.includes(t));
    expect(lost).toEqual([]);
    expect(gained.sort()).toEqual(["h3", "h4"]);
  });
});

describe("sanitizeRichHtml — the wider allow-list", () => {
  // ★★★ THESE FIVE FIXTURES PIN THE LIST WIDTH AND NOTHING ELSE. They are the
  // five cases open-followups §137 measured, but §137 measured them against the
  // OLD 8-tag note list, where `h1`, `u` and `blockquote` were UNLISTED and
  // KEEP_CONTENT:false deleted each word along with its tag. All three are on the
  // 21-tag rich list now, so KEEP_CONTENT never reaches them. Measured, not
  // reasoned: re-applying the retired note config (KEEP_CONTENT:false + "#text")
  // to sanitizeRichHtml leaves every one of these five GREEN. The KEEP_CONTENT
  // default therefore needs its own fixtures, which is the describe block below;
  // do not read this one as covering it.
  // ★★ RE-MEASURED 2026-08-11, because retiring sanitizeNoteHtml moved this
  // file's test count and the old note quoted one: 4 of 43 go red, and ALL FOUR
  // are in the KEEP_CONTENT describe below — which is the claim above, stated the
  // right way round. (It read "only 1 of 35 tests went red, and it was the h5
  // one"; neither number nor the named test survives today's tree. A count is the
  // easiest claim to check and the easiest to leave rotting — re-run it, never
  // adjust it by reasoning.)
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

describe("attribute value allow-list (§140)", () => {
  it("keeps data-align at each of the four legal values", () => {
    for (const v of ["left", "center", "right", "justify"]) {
      expect(sanitizeRichHtml(`<p data-align="${v}">x</p>`)).toBe(`<p data-align="${v}">x</p>`);
    }
  });

  it("drops data-align at an illegal value", () => {
    expect(sanitizeRichHtml('<p data-align="middle">x</p>')).toBe("<p>x</p>");
  });

  it("drops a compound data-align that smuggles a second declaration", () => {
    expect(sanitizeRichHtml('<p data-align="justify;position:fixed">x</p>')).toBe("<p>x</p>");
  });

  it("is case-sensitive — upper case is not a legal alignment", () => {
    expect(sanitizeRichHtml('<p data-align="CENTER">x</p>')).toBe("<p>x</p>");
  });

  it("keeps the task-list attributes at their legal values", () => {
    const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>x</p></li></ul>';
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it("drops data-checked at a non-boolean value", () => {
    expect(sanitizeRichHtml('<li data-type="taskItem" data-checked="maybe">x</li>'))
      .toBe('<li data-type="taskItem">x</li>');
  });

  // THIS ASSERTION IS THE §115 FIX. Before this slice sanitizeRichHtml kept
  // every data-* attribute, because ALLOW_DATA_ATTR defaults to TRUE.
  it("drops an unlisted data-* attribute", () => {
    expect(sanitizeRichHtml('<p data-foo="1">x</p>')).toBe("<p>x</p>");
  });

  it("still keeps href, which is guarded by ALLOWED_URI_REGEXP not by the table", () => {
    expect(sanitizeRichHtml('<a href="https://example.com">x</a>'))
      .toContain('href="https://example.com"');
  });

  // §117(b): data-asset-id is exempted from every value test by
  // ADD_URI_SAFE_ATTR, so the table is the only thing that can guard it.
  it("keeps a well-formed data-asset-id on the document boundary", () => {
    expect(sanitizeDocumentHtml('<img data-asset-id="a1-B2_c3" alt="x">'))
      .toContain('data-asset-id="a1-B2_c3"');
  });

  it("drops a data-asset-id with an illegal character", () => {
    expect(sanitizeDocumentHtml('<img data-asset-id="a/../b" alt="x">'))
      .not.toContain("data-asset-id");
  });

  it("drops a data-asset-id longer than 64 characters", () => {
    expect(sanitizeDocumentHtml(`<img data-asset-id="${"a".repeat(65)}" alt="x">`))
      .not.toContain("data-asset-id");
  });

  // ★★★ THE PROTOTYPE-CHAIN REGRESSION. The first cut of this slice looked the
  // name up with a bare `ATTR_VALUES[data.attrName]` truthiness test, so
  // `__proto__` resolved to `Object.prototype` — truthy, NOT callable — and the
  // hook threw `TypeError: isAllowedValue is not a function` instead of
  // returning inert. That throw is swallowed by `jsonToWorkspace`'s catch into
  // `emptyWorkspace()`, so one such attribute in any rich field silently emptied
  // a whole workspace on load.
  // ★★ These must assert BOTH "no throw" AND "attribute dropped". A
  // `not.toThrow()` alone would pass if the guard let the attribute survive, and
  // a `not.toContain` alone reports a THROWN test rather than a clear failure.
  describe("prototype-chain attribute names", () => {
    // ★★★ Only `constructor` and `__proto__` can actually reach the lookup:
    // HTML lowercases attribute names before the hook sees them, and those are
    // the only two of Object.prototype's 12 own members that survive lowercasing
    // intact. The other three below arrive as "valueof"/"tostring"/
    // "hasownproperty" and are absent from the prototype too — they are here to
    // pin the CLASS, and they would pass even on the broken code. That is
    // deliberate and is why `__proto__` is asserted separately and first.
    const PROTO_NAMES = ["__proto__", "constructor", "valueOf", "toString", "hasOwnProperty"];

    it("drops __proto__ without throwing, on both sanitizers", () => {
      expect(() => sanitizeRichHtml('<p __proto__="x">hi</p>')).not.toThrow();
      expect(sanitizeRichHtml('<p __proto__="x">hi</p>')).toBe("<p>hi</p>");
      expect(() => sanitizeDocumentHtml('<p __proto__="x">hi</p>')).not.toThrow();
      expect(sanitizeDocumentHtml('<p __proto__="x">hi</p>')).toBe("<p>hi</p>");
    });

    it("drops __proto__ on a NESTED element, not just the outer one", () => {
      // ★★ A top-level-only fixture would pass against a guard that covered only
      // the outer element. DOMPurify walks every node, so the hook fires per
      // element — this is the shape a real stored description would carry.
      const html = "<p>hello <strong __proto__=\"x\">world</strong></p>";
      expect(() => sanitizeRichHtml(html)).not.toThrow();
      expect(sanitizeRichHtml(html)).toBe("<p>hello <strong>world</strong></p>");
      expect(() => sanitizeDocumentHtml(html)).not.toThrow();
    });

    it("drops every prototype-shaped name without throwing", () => {
      for (const name of PROTO_NAMES) {
        expect(() => sanitizeRichHtml(`<p ${name}="x">hi</p>`)).not.toThrow();
        expect(sanitizeRichHtml(`<p ${name}="x">hi</p>`)).toBe("<p>hi</p>");
      }
    });

    it("still admits a real listed attribute — anti-vacuity for the loop above", () => {
      // Without this, a guard that rejected EVERYTHING would turn the whole
      // describe green while breaking the feature the slice exists to ship.
      expect(sanitizeRichHtml('<p data-align="center">x</p>')).toBe('<p data-align="center">x</p>');
    });
  });

  it("cannot WIDEN the boundary — a table name absent from the rich list is dropped", () => {
    // ★★★ The security property that makes ATTR_VALUES safe to add at all.
    // `uponSanitizeAttribute` fires BEFORE the name test, and the hook only ever
    // sets keepAttr=false — so a name on the TABLE but off ALLOWED_ATTR must
    // still be stripped. `data-asset-id` is exactly that on the rich boundary:
    // the table accepts "abc", DOCUMENT_ALLOWED_ATTR lists it, ALLOWED_ATTR does
    // not. A carrier tag that IS on the rich list is required — asserting this
    // with <img> would pass for the unrelated reason that img is not a rich tag.
    expect(sanitizeRichHtml('<p data-asset-id="abc">x</p>')).toBe("<p>x</p>");
    // ...and the same name DOES survive on the boundary that lists it, so the
    // assertion above cannot pass merely because the value was rejected.
    expect(sanitizeDocumentHtml('<img data-asset-id="abc">')).toContain('data-asset-id="abc"');
  });
});

// ★★★ The hook that backs the table above must be registered LAZILY. With no DOM
// `DOMPurify.addHook` is `undefined` and a top-level call throws a TypeError, and
// this module IS module-eval-reachable during Next SSR: templates-builtin.ts
// imports `plainToHtml` from here and calls it while building the built-in
// templates. A top-level registration is therefore a 500 on every page.
// ★ Comments are STRIPPED before the scan (the strip-then-ban shape the other
// source guards in this repo use), so the module can name the landmine in prose
// while its CODE stays unable to reach addHook at module eval.
describe("the value-allow-list hook is registered lazily, never at module eval", () => {
  const code = readFileSync(join(import.meta.dirname, "sanitize-html.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("strips comments before scanning", () => {
    // Proves the strip works — otherwise both assertions below pass vacuously on
    // a file whose code was never examined.
    expect(code).not.toMatch(/NEVER CALL DOMPurify\.addHook AT MODULE EVAL/);
    expect(code).toMatch(/export function sanitizeRichHtml/);
  });

  it("calls addHook only from inside a function body", () => {
    // ★ Brace DEPTH, not indentation: a formatting change must not be able to
    // turn this guard green or red. Depth > 0 means the call sits inside some
    // block, which is the only property that keeps it off the module-eval path.
    // ★★ KNOWN LIMIT — this counter has NO string/regex-literal awareness: it
    // counts every { and } in the stripped source, wherever it sits. It balances
    // today (the only brace-bearing literal, /^[A-Za-z0-9_-]{1,64}$/, is itself
    // balanced), so the depths are real. But an UNBALANCED brace inside a string
    // or regex literal would skew every depth after it and could in principle
    // invert this guard in either direction. If you are staring at an
    // inexplicable pass or fail here, that is the first thing to check.
    const depths: number[] = [];
    let depth = 0;
    for (let i = 0; i < code.length; i += 1) {
      if (code.startsWith("addHook", i)) depths.push(depth);
      if (code[i] === "{") depth += 1;
      else if (code[i] === "}") depth -= 1;
    }
    // Anti-vacuity: an empty `depths` passes the loop below on a file that lost
    // the hook entirely, or on a wrong read path.
    expect(depths.length).toBeGreaterThan(0);
    for (const d of depths) expect(d).toBeGreaterThan(0);
  });
});
