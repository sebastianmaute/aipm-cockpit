import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  capHtmlText,
  descriptionHtml,
  htmlPlainProjection,
  htmlTextLength,
  sanitizeRichText,
  separateBlockBoundaries,
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
    // Attributes still close the tag, so a real opener is unaffected.
    expect(descriptionHtml('<p class="lead">done</p>')).toBe('<p class="lead">done</p>');
  });

  // ★★★ HTML_START (shared with narrative-html) once matched a bare OPENER, so a
  // legacy plain value that merely STARTS tag-shaped passed through raw. The
  // tokenizer discards an incomplete tag at EOF, so the whole value vanished
  // from the screen, from search, from exports and from the AI digests — while
  // htmlTextLength still measured 11 for "<li 3 items", so sanitizeRichText KEPT
  // the field and no empty-state fallback fired. Silent loss of the user's text.
  it("escapes a plain value that starts tag-shaped but never closes the tag", () => {
    expect(descriptionHtml("<li 3 items")).toBe("<p>&lt;li 3 items</p>");
    expect(descriptionHtml("<p ok")).toBe("<p>&lt;p ok</p>");
    expect(descriptionHtml("<em dash - not markup")).toBe("<p>&lt;em dash - not markup</p>");
  });

  it("escapes a value that opens with a CLOSING tag", () => {
    // A stored value cannot legitimately begin with a closing tag: the editor
    // cannot emit one, so this is plain text the user typed. Passing it through
    // as HTML makes the sink delete the characters — the loss this guard exists
    // to prevent, in miniature.
    expect(descriptionHtml("</p> means close")).toBe("<p>&lt;/p&gt; means close</p>");
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

  // ★★ A tag deleted with NOTHING in its place fuses the words either side of a
  // block boundary — "Vendor delayMitigation plan" — and that jammed string is
  // what exports, search and the AI digests read. capHtmlText projects, truncates
  // and re-wraps, so on overflow it is also what gets PERSISTED.
  it("separates block boundaries instead of fusing words", () => {
    expect(htmlPlainProjection("<p>Vendor delay</p><p>Mitigation plan</p>")).toBe(
      "Vendor delay Mitigation plan",
    );
    expect(htmlPlainProjection("<ul><li>alpha</li><li>beta</li></ul>")).toBe("alpha beta");
  });

  // ★ This is the REGRESSION case, not a gap: descriptionHtml turns every legacy
  // newline into a <br>, so the most common shape in existing data is exactly
  // the one a boundary-blind projection jams together.
  it("treats a <br> as a word boundary — the shape every upgraded multi-line value has", () => {
    expect(htmlPlainProjection(descriptionHtml("line one\nline two"))).toBe("line one line two");
  });

  // ★★ The HTML tokenizer only opens a tag when `<` is followed by a letter (or
  // `/`), so `<[^>]*>` eats from a bare `<` all the way to the next `>` — here
  // that is 18 characters of the user's text.
  //
  // ★★★ THE FIRST ASSERTION IS THE ONE WITH TEETH, and it needs the trailing
  // inline tag. Block tags are already spaces by the time the inline strip runs,
  // so in "<p>cost < 5k</p>" the only ">" belonged to "</p>" and the bare "<"
  // has nothing left to run to — that fixture survives a tokenizer-BLIND
  // `<[^>]*>` too, and a test built only from it passes against the bug. It
  // takes a following inline tag to supply the ">". Verified by mutation: revert
  // TAG and the <strong> case fails while the two below still pass.
  it("keeps text after a bare < that does not open a tag", () => {
    expect(htmlPlainProjection("<p>cost < 5k and <strong>rising</strong></p>")).toBe(
      "cost < 5k and rising",
    );
    expect(htmlPlainProjection("<p>cost < 5k and rising</p>")).toBe("cost < 5k and rising");
    expect(htmlPlainProjection("<p>a < b</p>")).toBe("a < b");
  });
});

describe("numeric entity references", () => {
  it("decodes decimal and hex forms so the counter measures visible text", () => {
    expect(htmlPlainProjection("<p>a&#8212;b</p>")).toBe("a—b");
    expect(htmlPlainProjection("<p>a&#x2014;b</p>")).toBe("a—b");
    expect(htmlPlainProjection("<p>a&#X2014;b</p>")).toBe("a—b");
    expect(htmlTextLength("<p>&#8212;</p>")).toBe(1);
  });

  it("REFUSES to emit & < >, which would re-open the double-decode hole", () => {
    // ★★ &#38; IS "&". Decoding it before the named pass turns "&#38;lt;" into
    // "&lt;", which the named pass then decodes to "<" — exactly the
    // double-decode that "&amp; decodes LAST" exists to prevent. &#60;/&#62;
    // would re-introduce a tag delimiter AFTER the tag work has already run.
    expect(htmlPlainProjection("<p>&#38;lt;</p>")).toBe("&#38;lt;");
    expect(htmlPlainProjection("<p>&#60;script&#62;</p>")).toBe("&#60;script&#62;");
    expect(htmlPlainProjection("<p>&#x26;lt;</p>")).toBe("&#x26;lt;");
  });

  it("refuses lone surrogates and out-of-range code points instead of throwing", () => {
    // String.fromCodePoint throws on both; a projection must never throw — it
    // runs inside the entity sanitizers on every load.
    expect(htmlPlainProjection("<p>&#xd800;</p>")).toBe("&#xd800;");
    expect(htmlPlainProjection("<p>&#1114112;</p>")).toBe("&#1114112;");
    expect(htmlPlainProjection("<p>&#0;</p>")).toBe("&#0;");
  });

  it("leaves the existing named decodes and their ordering intact", () => {
    expect(htmlPlainProjection("<p>&amp;lt;</p>")).toBe("&lt;");
    expect(htmlPlainProjection("<p>&#39;a&apos;</p>")).toBe("'a'");
  });
});

describe("htmlTextLength", () => {
  // ★ headline claim first: markup must not consume the user's budget. The
  // fixture is deliberately free of block boundaries, so the count is exactly
  // the four visible characters and nothing about it is ambiguous.
  it("counts text, not markup", () => {
    const html = "<p><strong>ab</strong><em>cd</em></p>";
    expect(htmlTextLength(html)).toBe(4);
    expect(html.length).toBeGreaterThan(30);
  });

  // ★ Same claim across a block boundary, which is a real word separator and so
  // projects to the one space it means: "ab cd" is 5. Markup contributes nothing
  // else — 47 characters of list/inline tags still cost zero.
  it("counts a block boundary as the single space it projects to", () => {
    const html = "<ul><li><strong>ab</strong></li><li>cd</li></ul>";
    expect(htmlTextLength(html)).toBe(5);
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

  // ★★ `slice` counts UTF-16 code units, so a cap landing inside an astral
  // character kept its lone HIGH SURROGATE — not a character, and UTF-8 encoding
  // replaces it with U+FFFD permanently. JSON.stringify escapes it as "\ud83d"
  // and survives, so JSON/IndexedDB did not corrupt while CSV/Markdown did: a
  // backend-dependent silent corruption. The emoji must be dropped WHOLE.
  it("drops a character straddling the cap whole, never half of it", () => {
    const out = capHtmlText("<p>ab\u{1F600}cd</p>", 3);
    expect(out).toBe("<p>ab</p>");
    // The property, independent of the exact cut: no unpaired surrogate...
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out)).toBe(
      false,
    );
    // ...and therefore a UTF-8 round-trip is lossless (no U+FFFD substitution).
    expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
  });

  // ★ The emoji survives INTACT when the cap has room for both its code units —
  // proves the fix backs off by ONE unit only, rather than always shedding a
  // trailing character.
  it("keeps a character that fits entirely inside the cap", () => {
    expect(capHtmlText("<p>ab\u{1F600}cd</p>", 4)).toBe("<p>ab\u{1F600}</p>");
  });

  // ★ max <= 0 is unreachable from the app (every caller passes TEXTAREA_MAX),
  // but charCodeAt(-1) is NaN and NaN fails every comparison — asserted rather
  // than assumed, since the fix reads text[max - 1].
  it("survives a zero cap", () => {
    expect(capHtmlText("<p>abc</p>", 0)).toBe("");
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

  // ★★ A TAB is a word separator, not a stray byte: deleting it fused the words
  // either side ("Vendor delayMitigation plan"), the same boundary loss the
  // BLOCK_TAG rule exists to prevent — here at the WRITE boundary, where it is
  // permanent. It also made the sanitizer disagree with the projection, which
  // renders a tab as a space, so the editor's counter measured a length the
  // stored value no longer had.
  it("keeps a tab as the word boundary it is", () => {
    const out = sanitizeRichText("Vendor delay\tMitigation plan", 5000);
    expect(out).toBe("<p>Vendor delay Mitigation plan</p>");
    // The counter measured the pre-sanitize value; the stored value must agree.
    expect(htmlTextLength(out)).toBe(htmlTextLength("<p>Vendor delay\tMitigation plan</p>"));
  });

  // ★ A run collapses to ONE space, matching WS_RUN in the projection — so the
  // two still agree when a paste carries several whitespace controls in a row.
  it("collapses a run of whitespace controls to a single space", () => {
    expect(sanitizeRichText("a\t\t\v\fb", 5000)).toBe("<p>a b</p>");
  });

  // ★★ A value the user cleared in the editor comes back as "<p></p>", which is
  // TRUTHY — so without this every `if (description)` gate in the entity
  // sanitizers would store a phantom empty paragraph. This is the ONE place the
  // rule lives, which is what also covers the non-modal writers (AI tools,
  // inline-AI apply, proposal seed, bulk edit).
  it("treats a cleared editor value as absent", () => {
    for (const empty of ["<p></p>", "<p><br></p>", "<p>&nbsp;</p>", "<ul><li></li></ul>", "   "]) {
      expect(sanitizeRichText(empty, 5000)).toBe("");
    }
  });

  // ★ Guards the check against being "simplified" into something that strips
  // markup and concludes there is nothing there: the visible text is what
  // counts, and here all of it lives inside a tag.
  it("keeps a value whose only content is inside markup", () => {
    expect(sanitizeRichText("<p><strong>x</strong></p>", 5000)).toBe("<p><strong>x</strong></p>");
  });

  // ★★ Silent data loss: an under-counting projection makes the value read as
  // visually empty, sanitizeRichText returns "", and every `if (description)`
  // gate in sanitize-records.ts then DROPS the field. Reachable from a
  // hand-edited CSV/Markdown workspace or an AI create_raid_item call.
  it("does not drop a field whose text is only a bare <", () => {
    expect(sanitizeRichText("<p>< 5k</p>", 5000)).not.toBe("");
  });

  // ★★ …and the text must survive INTACT, not merely keep the field. This is the
  // non-vacuous half: see the note on the projection test above — the fixture
  // needs a following inline tag to supply the ">" a tokenizer-blind regex would
  // run to. Without the [a-zA-Z] guard this loses "< 5k " and counts 10, not 15.
  it("keeps the text around a bare < when an inline tag follows it", () => {
    const out = sanitizeRichText("<p>Budget < 5k <em>cap</em></p>", 5000);
    expect(htmlTextLength(out)).toBe("Budget < 5k cap".length);
  });
});

// ★★ Guard: this module runs inside the entity sanitizers, which execute under
// bare node in the sample/fixture scripts. A DOMPurify CALL there throws, and
// jsonToWorkspace's catch-all turns that into an EMPTY workspace.
//
// ★ Comments are STRIPPED before the scan (the strip-then-ban shape the palette
// guards use), so the module can name the landmine explicitly in prose while its
// CODE stays unable to reach the sanitiser under any alias: an aliased default
// import still carries the "dompurify" module specifier, and an aliased named
// import still carries the original symbol name.
describe("DOM-free guard", () => {
  const code = readFileSync(join(import.meta.dirname, "rich-text-plain.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("strips comments before scanning", () => {
    // Proves the strip works — otherwise every assertion below passes vacuously
    // on a file whose code was never examined.
    expect(code).not.toMatch(/NOTHING HERE MAY CALL/);
    expect(code).toMatch(/export function descriptionHtml/);
  });

  it("imports exactly the two modules it is allowed to import", () => {
    // ★ The old guard banned four SYMBOL names. That let two things past:
    // plainToHtml growing a DOMPurify.sanitize call (its own comment warns
    // against exactly that), and a future `import { descriptionText } from
    // "./rich-text-projection"` — neither the module name nor the symbol was on
    // the list, and that module DOES call DOMPurify. Pinning the import SURFACE
    // means a new import has to be added here deliberately, which is the point.
    //
    // ★★ The pattern must accept EVERY spelling of a specifier, not the one
    // this file happens to use today. A double-quote-only `from "…"` regex is
    // defeated by a single-quoted import (no lint rule pins quote style here),
    // by a bare side-effect `import "…"`, and by `await import("…")` — which is
    // an established idiom in this codebase. Each of those would leave the
    // received array unchanged and the guard green with the reach present.
    const specifiers = [...code.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'`]([^"'`]+)["'`]/g)]
      .map((m) => m[1])
      .sort();
    expect(specifiers).toEqual(["./narrative-html", "./sanitize-html"]);
  });

  it("keeps rich-text-projection out of every DOM-free reach", () => {
    // ★ Nothing guarded this direction at all. rich-text-projection calls
    // DOMPurify, so a codec, an entity sanitizer or anything under scripts/
    // importing it would throw under bare node — where jsonToWorkspace's
    // catch-all converts the throw into an EMPTY workspace that then
    // "successfully" writes near-empty sample files.
    //
    // ★★ rich-text-plain.ts and narrative-html.ts are IN this set. They are the
    // two DOM-free modules inside this file's own dependency graph, so a reach
    // added there is pulled in transitively while the direct-import pin above
    // stays green — the one-hop blind spot of a name-based filter.
    //
    // ★★ `scanned` is asserted for the same reason "strips comments before
    // scanning" exists: `offenders` is empty when the walk root is wrong, when
    // the filter matches nothing, and when a rename empties the matched set. A
    // scanning guard needs proof its scan ran.
    const repoRoot = join(import.meta.dirname, "..", "..");
    const offenders: string[] = [];
    let scanned = 0;
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".next") continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (/\.test\.tsx?$/.test(entry.name)) continue;
        const rel = full.replace(/\\/g, "/");
        const isDomFree =
          /\/scripts\//.test(rel) ||
          /\/sanitize[^/]*\.ts$/.test(rel) ||
          /-codecs[^/]*\.ts$/.test(rel) ||
          /\/(rich-text-plain|narrative-html)\.ts$/.test(rel);
        if (!isDomFree) continue;
        scanned += 1;
        // ★ Strip comments first, the same shape this describe uses for `code`.
        // Without it an apostrophe in prose ("rich-text-projection's
        // descriptionText") plays the part of a quote and the file reports
        // itself — a false positive on the very module being protected.
        const src = readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        // Any quote style, any extension, static or dynamic — see the pin above.
        if (/["'`][^"'`]*rich-text-projection[^"'`]*["'`]/.test(src)) {
          offenders.push(rel);
        }
      }
    };
    walk(join(repoRoot, "src"));
    walk(join(repoRoot, "scripts"));
    expect(offenders).toEqual([]);
    expect(scanned).toBeGreaterThan(10);
  });
});

describe("break-preserving mode", () => {
  it("maps a block boundary to ONE newline, not two", () => {
    // An open+close pair ("</p><p>") is two boundaries; the whitespace collapse
    // absorbs them into a single break, which is what a reader expects.
    expect(htmlPlainProjection("<p>a</p><p>b</p>", { preserveBreaks: true })).toBe("a\nb");
    expect(htmlPlainProjection("<p>a<br>b</p>", { preserveBreaks: true })).toBe("a\nb");
    expect(htmlPlainProjection("<ul><li>a</li><li>b</li></ul>", { preserveBreaks: true })).toBe("a\nb");
  });

  it("still collapses horizontal runs to one space", () => {
    expect(htmlPlainProjection("<p>a   \t b</p>", { preserveBreaks: true })).toBe("a b");
  });

  it("trims leading and trailing breaks", () => {
    expect(htmlPlainProjection("<p>a</p>", { preserveBreaks: true })).toBe("a");
  });

  it("separateBlockBoundaries takes the separator", () => {
    expect(separateBlockBoundaries("<p>a</p><p>b</p>", "\n")).toBe("\na\n\nb\n");
    expect(separateBlockBoundaries("<p>a</p>")).toBe(" a ");
  });

  it("leaves the default path byte-identical", () => {
    // ★★ This is the acceptance gate for the whole export-fidelity change.
    // rich-text-plain feeds capHtmlText -> sanitizeRichText -> every backend, so
    // adding a parameter must not move a single character on the options-less
    // call. Expected values are HARDCODED, not derived, so a shared bug in the
    // implementation cannot make both sides agree.
    const cases: Array<[string, string]> = [
      ["<p>a</p><p>b</p>", "a b"],
      ["<p>a<br>b</p>", "a b"],
      ["<ul><li>a</li><li>b</li></ul>", "a b"],
      ["<p>a   \t b</p>", "a b"],
      ["<p>x&nbsp;y</p>", "x y"],
      ["<p>x&#160;y</p>", "x y"],
      ["<p>cost &lt; 5k</p>", "cost < 5k"],
      ["<p>&amp;lt;</p>", "&lt;"],
      ["<p>a&#8212;b</p>", "a—b"],
      ["<p>&#38;lt;</p>", "&#38;lt;"],
      ["<p><strong>bold</strong></p>", "bold"],
      ["", ""],
    ];
    for (const [input, expected] of cases) {
      expect(htmlPlainProjection(input)).toBe(expected);
      expect(htmlPlainProjection(input, {})).toBe(expected);
      expect(htmlPlainProjection(input, { preserveBreaks: false })).toBe(expected);
    }
  });
});
