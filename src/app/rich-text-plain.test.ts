import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  capHtmlText,
  degradeToPlain,
  descriptionHtml,
  htmlPlainProjection,
  htmlTextLength,
  markTaskItems,
  sanitizeRichText,
  separateBlockBoundaries,
} from "./rich-text-plain";

describe("descriptionHtml", () => {
  it("escapes and wraps a legacy plain value", () => {
    expect(descriptionHtml("cost < 5k & rising", "rich")).toBe(
      "<p>cost &lt; 5k &amp; rising</p>",
    );
  });

  it("keeps a plain value whose stray < is not a tag", () => {
    expect(descriptionHtml("5 < 10 items", "rich")).toBe("<p>5 &lt; 10 items</p>");
    expect(descriptionHtml("<3 open", "rich")).toBe("<p>&lt;3 open</p>");
  });

  it("passes through a value that already opens with an allowed tag", () => {
    expect(descriptionHtml("<p>done</p>", "rich")).toBe("<p>done</p>");
    expect(descriptionHtml("<strong>lead</strong> rest", "rich")).toBe(
      "<strong>lead</strong> rest",
    );
    // Attributes still close the tag, so a real opener is unaffected.
    expect(descriptionHtml('<p class="lead">done</p>', "rich")).toBe(
      '<p class="lead">done</p>',
    );
  });

  // ★★★ The retired shared `HTML_START` (it lived in narrative-html.ts) once
  // matched a bare OPENER — `htmlStartRe`'s `[^>]*>` is what now requires the tag
  // to actually CLOSE — so a
  // legacy plain value that merely STARTS tag-shaped passed through raw. The
  // tokenizer discards an incomplete tag at EOF, so the whole value vanished
  // from the screen, from search, from exports and from the AI digests — while
  // htmlTextLength still measured 11 for "<li 3 items", so sanitizeRichText KEPT
  // the field and no empty-state fallback fired. Silent loss of the user's text.
  it("escapes a plain value that starts tag-shaped but never closes the tag", () => {
    expect(descriptionHtml("<li 3 items", "rich")).toBe("<p>&lt;li 3 items</p>");
    expect(descriptionHtml("<p ok", "rich")).toBe("<p>&lt;p ok</p>");
    expect(descriptionHtml("<em dash - not markup", "rich")).toBe(
      "<p>&lt;em dash - not markup</p>",
    );
  });

  it("escapes a value that opens with a CLOSING tag", () => {
    // A stored value cannot legitimately begin with a closing tag: the editor
    // cannot emit one, so this is plain text the user typed. Passing it through
    // as HTML makes the sink delete the characters — the loss this guard exists
    // to prevent, in miniature.
    expect(descriptionHtml("</p> means close", "rich")).toBe(
      "<p>&lt;/p&gt; means close</p>",
    );
  });

  it("is idempotent — it runs on every load", () => {
    for (const raw of ["cost < 5k", "<p>done</p>", "", "  "]) {
      expect(descriptionHtml(descriptionHtml(raw, "rich"), "rich")).toBe(
        descriptionHtml(raw, "rich"),
      );
    }
  });

  it("converts newlines to <br>", () => {
    expect(descriptionHtml("a\nb", "rich")).toBe("<p>a<br>b</p>");
  });

  it("returns empty for blank input", () => {
    expect(descriptionHtml(undefined, "rich")).toBe("");
    expect(descriptionHtml("   ", "rich")).toBe("");
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
    expect(htmlPlainProjection(descriptionHtml("line one\nline two", "projection"))).toBe(
      "line one line two",
    );
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

  it("refuses lone surrogates and out-of-range code points", () => {
    // ★ Out-of-range is a THROW guard: String.fromCodePoint(1114112) throws and
    // a projection must never throw — it runs inside the entity sanitizers on
    // every load. A lone surrogate does NOT throw; it is refused because
    // emitting one reproduces the backend-dependent corruption capHtmlText
    // documents (U+FFFD on CSV/MD, survives on JSON/IDB).
    expect(htmlPlainProjection("<p>&#xd800;</p>")).toBe("&#xd800;");
    expect(htmlPlainProjection("<p>&#1114112;</p>")).toBe("&#1114112;");
    expect(htmlPlainProjection("<p>&#0;</p>")).toBe("&#0;");
  });

  it("refuses every control character CONTROL_CHARS would have stripped", () => {
    // ★★ sanitizeRichText strips controls from the RAW string and only then
    // projects, so a reference is downstream of that strip: decoding "&#7;"
    // puts a BEL into the projected text, and on the OVERFLOW path capHtmlText
    // re-wraps that text with plainToHtml — which escapes only & < > — writing
    // the control character into storage on all six backends.
    expect(htmlPlainProjection("<p>a&#7;b</p>")).toBe("a&#7;b");
    expect(htmlPlainProjection("<p>a&#x1b;b</p>")).toBe("a&#x1b;b");
    expect(htmlPlainProjection("<p>a&#31;b</p>")).toBe("a&#31;b");
    // \t and \n ARE decoded — they are whitespace the collapse handles, and
    // CONTROL_CHARS deliberately excludes them for the same reason.
    expect(htmlPlainProjection("<p>a&#9;b</p>")).toBe("a b");
    expect(htmlPlainProjection("<p>a&#10;b</p>")).toBe("a b");
  });

  it("decodes an astral code point as the surrogate PAIR it really is", () => {
    // ★ The highest-value edge: a decoded emoji is two UTF-16 units, so this is
    // the input that exercises capHtmlText's own surrogate back-off.
    expect(htmlPlainProjection("<p>&#x1f600;</p>")).toBe("\u{1f600}");
    expect(htmlTextLength("<p>&#x1f600;</p>")).toBe(2);
    // Written as a surrogate PAIR of references it is correctly refused, so
    // such a value still over-counts — the documented named/paired tail.
    expect(htmlPlainProjection("<p>&#xd83d;&#xde00;</p>")).toBe("&#xd83d;&#xde00;");
  });

  it("treats a whitespace-only reference as visually empty — a DROP, pinned as intended", () => {
    // ★★ A one-way consequence of decoding, recorded deliberately rather than
    // left to be rediscovered as a bug report. "<p>&#32;</p>" used to project to
    // 5 characters and now projects to 0: the decoded space collapses and trims
    // away, htmlTextLength reads 0, sanitizeRichText returns "", and the entity
    // sanitizers' `if (description)` gate DROPS the field on the next load.
    //
    // That is the module's existing rule — visually empty means empty, the same
    // rule that makes "<p><br></p>" from an emptied editor stop occupying a
    // field — and every one of these renders blank. It is pinned because it is a
    // deletion of stored data triggered by a code change, not a user action.
    for (const only of ["&#32;", "&#9;", "&#10;", "&#13;", "&#11;&#12;", "&#8232;"]) {
      expect(htmlTextLength(`<p>${only}</p>`)).toBe(0);
    }
    // ★ Not a blanket "references vanish": a reference with real text beside it
    // keeps both, and a NON-whitespace reference counts as its one character.
    expect(htmlPlainProjection("<p>a&#32;b</p>")).toBe("a b");
    expect(htmlTextLength("<p>&#8212;</p>")).toBe(1);
  });

  it("refuses an uppercase-X unsafe reference, not just the lowercase form", () => {
    // The X branch was otherwise covered only by an ACCEPTING case.
    expect(htmlPlainProjection("<p>&#X26;lt;</p>")).toBe("&#X26;lt;");
    expect(htmlPlainProjection("<p>&#X3C;script&#X3E;</p>")).toBe("&#X3C;script&#X3E;");
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

  // §208: the same overflow that used to discard markup now preserves images.
  it("keeps an asset image when the paragraph overflows the cap", () => {
    const img = '<img data-asset-id="a1" alt="chart">';
    const out = capHtmlText(`<p>${img}${"x".repeat(30)}</p>`, 10);
    expect(out).toContain('data-asset-id="a1"');
  });

  // ★ The under-cap path must stay byte-identical — it returns the input
  // untouched and never reaches degradeToPlain.
  it("still returns an image-bearing paragraph untouched when it fits", () => {
    const html = '<p><img data-asset-id="a1" alt="chart"> short</p>';
    expect(capHtmlText(html, 5000)).toBe(html);
  });
});

describe("sanitizeRichText", () => {
  it("upgrades, caps and rejects a non-string", () => {
    expect(sanitizeRichText("plain", 5000, "rich")).toBe("<p>plain</p>");
    expect(sanitizeRichText(42, 5000, "rich")).toBe("");
    expect(sanitizeRichText(undefined, 5000, "rich")).toBe("");
  });

  it("strips control characters but keeps newlines", () => {
    expect(sanitizeRichText("a\x07b\nc", 5000, "rich")).toBe("<p>ab<br>c</p>");
  });

  // ★★ A TAB is a word separator, not a stray byte: deleting it fused the words
  // either side ("Vendor delayMitigation plan"), the same boundary loss the
  // BLOCK_TAG rule exists to prevent — here at the WRITE boundary, where it is
  // permanent. It also made the sanitizer disagree with the projection, which
  // renders a tab as a space, so the editor's counter measured a length the
  // stored value no longer had.
  it("keeps a tab as the word boundary it is", () => {
    const out = sanitizeRichText("Vendor delay\tMitigation plan", 5000, "rich");
    expect(out).toBe("<p>Vendor delay Mitigation plan</p>");
    // The counter measured the pre-sanitize value; the stored value must agree.
    expect(htmlTextLength(out)).toBe(htmlTextLength("<p>Vendor delay\tMitigation plan</p>"));
  });

  // ★ A run collapses to ONE space, matching WS_RUN in the projection — so the
  // two still agree when a paste carries several whitespace controls in a row.
  it("collapses a run of whitespace controls to a single space", () => {
    expect(sanitizeRichText("a\t\t\v\fb", 5000, "rich")).toBe("<p>a b</p>");
  });

  // ★★ A value the user cleared in the editor comes back as "<p></p>", which is
  // TRUTHY — so without this every `if (description)` gate in the entity
  // sanitizers would store a phantom empty paragraph. This is the ONE place the
  // rule lives, which is what also covers the non-modal writers (AI tools,
  // inline-AI apply, proposal seed, bulk edit).
  it("treats a cleared editor value as absent", () => {
    for (const empty of ["<p></p>", "<p><br></p>", "<p>&nbsp;</p>", "<ul><li></li></ul>", "   "]) {
      expect(sanitizeRichText(empty, 5000, "rich")).toBe("");
    }
  });

  // ★ Guards the check against being "simplified" into something that strips
  // markup and concludes there is nothing there: the visible text is what
  // counts, and here all of it lives inside a tag.
  it("keeps a value whose only content is inside markup", () => {
    expect(sanitizeRichText("<p><strong>x</strong></p>", 5000, "rich")).toBe(
      "<p><strong>x</strong></p>",
    );
  });

  // ★★ Silent data loss: an under-counting projection makes the value read as
  // visually empty, sanitizeRichText returns "", and every `if (description)`
  // gate in sanitize-records.ts then DROPS the field. Reachable from a
  // hand-edited CSV/Markdown workspace or an AI create_raid_item call.
  it("does not drop a field whose text is only a bare <", () => {
    expect(sanitizeRichText("<p>< 5k</p>", 5000, "rich")).not.toBe("");
  });

  // ★★ …and the text must survive INTACT, not merely keep the field. This is the
  // non-vacuous half: see the note on the projection test above — the fixture
  // needs a following inline tag to supply the ">" a tokenizer-blind regex would
  // run to. Without the [a-zA-Z] guard this loses "< 5k " and counts 10, not 15.
  it("keeps the text around a bare < when an inline tag follows it", () => {
    const out = sanitizeRichText("<p>Budget < 5k <em>cap</em></p>", 5000, "rich");
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

  it("never reaches a DOM-dependent sanitiser from code", () => {
    // ★★★ This ban is NOT redundant with the import pin below, and removing it
    // in favour of that pin (as 0.210.0 briefly did) OPENED the likelier hole:
    // `./sanitize-html` is an ALLOWED specifier — plainToHtml legitimately comes
    // from it — and that same module exports htmlToText, sanitizeRichHtml and
    // sanitizeDocumentHtml, both of which CALL DOMPurify. So a call added here
    // passes the specifier pin untouched. The two guards answer different
    // questions: this one is "does the CODE call a DOM sanitiser", the pin is
    // "can a NEW module be reached at all". Keep both.
    expect(code).not.toMatch(/dompurify/i);
    expect(code).not.toMatch(/htmlToText/);
    expect(code).not.toMatch(/sanitizeRichHtml/);
    expect(code).not.toMatch(/sanitizeDocumentHtml/);
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
    expect(specifiers).toEqual(["./html-start", "./sanitize-html"]);
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
    // ★★★ The DOM-free set is the sample generator's IMPORT GRAPH, resolved here,
    // NOT a list of path patterns. It used to be the latter, and that was the
    // defect: the filter matched 18 of the 76 files the generator actually loads,
    // and both times it was widened (workspace.ts/storage.ts, then
    // rich-text-plain/narrative-html) it was because a reviewer happened to notice
    // one specific file. `templates.ts` — the file AGENTS.md now warns a reader not
    // to add a DOMPurify import to — was among the 58 it missed.
    //
    // ★★ Resolving the graph means the guard covers whatever the generator loads
    // TODAY, including files nobody thought to name. `.tsx` is followed too: a
    // component in the graph would be just as fatal, and only its absence from the
    // graph keeps it out.
    const repoRoot = join(import.meta.dirname, "..", "..");
    const offenders: string[] = [];
    const resolveSpec = (fromFile: string, spec: string): string | null => {
      if (!spec.startsWith(".")) return null; // a package, not our source
      const base = resolve(dirname(fromFile), spec);
      for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
        if (existsSync(cand) && statSync(cand).isFile()) return cand.replace(/\\/g, "/");
      }
      return null;
    };
    const graph = new Set<string>();
    const pending = [join(repoRoot, "scripts", "generate-sample-workspace.ts").replace(/\\/g, "/")];
    while (pending.length > 0) {
      const file = pending.pop()!;
      if (graph.has(file)) continue;
      graph.add(file);
      const text = readFileSync(file, "utf8");
      // Static `from "…"`, bare side-effect `import "…"`, and dynamic `import("…")`.
      for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const next = resolveSpec(file, m[1]);
        if (next !== null) pending.push(next);
      }
    }
    // ★★ The graph is the SET THAT MATTERS, but scanning only it would drop a
    // DOM-free-by-contract file that has not entered the graph yet — the resolver
    // lost `sanitize-report.ts` that way. Union the graph with the name patterns so
    // coverage only ever grows: the graph catches what is reachable TODAY, the
    // patterns catch a sanitizer/codec that is reachable TOMORROW.
    for (const extra of [join(repoRoot, "src", "app"), join(repoRoot, "scripts")]) {
      const stack = [extra];
      while (stack.length > 0) {
        const dir = stack.pop()!;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name).replace(/\\/g, "/");
          if (entry.isDirectory()) {
            if (entry.name !== "node_modules" && entry.name !== ".next") stack.push(full);
            continue;
          }
          if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
          if (/\/sanitize[^/]*\.ts$/.test(full) || /-codecs[^/]*\.ts$/.test(full) || /\/scripts\//.test(full)) {
            graph.add(full);
          }
        }
      }
    }
    let scanned = 0;
    for (const full of graph) {
      if (/\.test\.tsx?$/.test(full)) continue;
      const rel = full;
      scanned += 1;
      {
        // ★ Strip comments first, the same shape this describe uses for `code`.
        // Without it an apostrophe in prose ("rich-text-projection's
        // descriptionText") plays the part of a quote and the file reports
        // itself — a false positive on the very module being protected.
        const src = readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        // ★★ BOTH DOMPurify-calling modules, not just rich-text-projection.
        // `ai-rich-text.ts` (added in 0.210.0) calls DOMPurify too, so importing
        // it from a sanitizer/codec/script reproduces the exact bare-node throw →
        // jsonToWorkspace catch-all → EMPTY workspace → near-empty sample files
        // failure this guard exists to prevent. A guard naming one module by hand
        // goes stale the moment a second one appears; if you add a third, add it
        // here in the same commit.
        // ★ Any quote style, any extension, static or dynamic — see the pin above.
        if (/["'`][^"'`]*(rich-text-projection|ai-rich-text)[^"'`]*["'`]/.test(src)) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
    // ★★ The graph is 76 files today. A floor well above the old name-filter's 18
    // proves the RESOLVER worked, not merely that a walk ran: if the entry point
    // moves or `resolveSpec` stops resolving, this collapses to 1 and fails.
    expect(scanned).toBeGreaterThan(50);
    // ★ And the file the old filter missed must actually be in the scanned set —
    // it is the one AGENTS.md warns a reader away from.
    expect([...graph].some((f) => f.endsWith("/src/app/templates.ts"))).toBe(true);
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

  it("pins how a decoded newline reference behaves in each mode", () => {
    // ★ The decoder runs BEFORE the whitespace pass, so break output is not
    // purely structure-derived: a &#10; the author typed becomes a real break in
    // break mode and collapses to a space in the default one. Consistent with
    // how a literal newline is treated in each mode — pinned because it is the
    // one place the two features interact.
    expect(htmlPlainProjection("<p>a&#10;b</p>")).toBe("a b");
    expect(htmlPlainProjection("<p>a&#10;b</p>", { preserveBreaks: true })).toBe("a\nb");
    // \t and \r stay horizontal in BOTH modes.
    expect(htmlPlainProjection("<p>a&#9;b</p>", { preserveBreaks: true })).toBe("a b");
    expect(htmlPlainProjection("<p>a&#13;b</p>", { preserveBreaks: true })).toBe("a b");
  });

  it("trims leading and trailing breaks", () => {
    expect(htmlPlainProjection("<p>a</p>", { preserveBreaks: true })).toBe("a");
  });

  it("separateBlockBoundaries takes the separator", () => {
    expect(separateBlockBoundaries("<p>a</p><p>b</p>", "\n")).toBe("\na\n\nb\n");
    expect(separateBlockBoundaries("<p>a</p>")).toBe(" a ");
  });

  it("adding preserveBreaks left the default path byte-identical", () => {
    // ★ The NAME matters here: the default path is not byte-identical to base —
    // 0.210.0's numeric-entity decode deliberately moved it ("<p>a&#8212;b</p>" was
    // "a&#8212;b", now "a—b"), and that row is in this very table. What this suite
    // pins is that adding the `preserveBreaks` PARAMETER moved nothing, which is
    // the storage-critical invariant.
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
      // ★★ A LITERAL newline in the html is what pins the DEFAULT branch's
      // whitespace pass. Without these two rows, swapping WS_RUN for the
      // break-mode pair passes every other assertion in this file — the arm the
      // suite exists to guard was unguarded (mutant-verified). Stored HTML
      // routinely carries newlines between block tags, and descriptionText
      // pipes htmlToText output — which preserves them — straight in here.
      ["<p>a\nb</p>", "a b"],
      ["<p>a\r\n\r\nb</p>", "a b"],
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

describe("BLOCK_TAG covers pre", () => {
  it("treats a code block as a word boundary, not inert markup", () => {
    // ★ The fixture has NO OTHER block tag around the <pre>. A first draft of
    // this test wrapped "before"/"after" in <p>, which inserts its OWN
    // boundary via </p><p> regardless of whether `pre` is covered — that
    // version passed even with `pre` absent from BLOCK_TAG, silently vacuous.
    // Isolate on `pre` alone, and assert the exact string: separateBlockBoundaries
    // never strips non-BLOCK_TAG markup, so a substring-fuse check against the
    // literal "<pre>...</pre>" characters can pass without exercising the tag
    // list at all (also measured: it did).
    expect(separateBlockBoundaries("before<pre>code</pre>after", " ")).toBe(
      "before code after",
    );
  });

  it("emits a newline boundary for a code block in the breaks projection", () => {
    expect(separateBlockBoundaries("before<pre>code</pre>after", "\n")).toBe(
      "before\ncode\nafter",
    );
  });
});

// ★★★ THE ONE SHAPE THIS CHANGE MOVES, PINNED DELIBERATELY. Excluding `<` from
// the attribute run alters exactly one input: an attribute value containing a
// bare `<`. The projection goes 0 -> 11, i.e. the value stops reading as
// "invisible" — the SAFE direction for sanitizeBlock's drop condition, which
// deletes a block only when the projection is zero AND no asset id is present.
// The cost is that those 11 characters are raw markup surfacing as prose.
describe("htmlPlainProjection — the bounded attribute run", () => {
  it("moves the quoted-attribute shape, in the safe direction", () => {
    // Today this projects "" — the unbounded run swallows from the first `<`
    // through to the final `>`. Bounded, the first opener no longer matches at
    // all (there is no `>` before the next `<`), the SECOND one does, and what
    // is left is the 11 characters of the first tag's head.
    expect(htmlPlainProjection('<img alt="a<b" data-asset-id="real">')).toBe('<img alt="a');
  });

  // ★★★ THE SECOND MOVED SHAPE, found by document-model.test.ts rather than by
  // planning — the bound applies to UNQUOTED attributes too. This one matters
  // more than the quoted case: the block carries a REAL data-asset-id and was
  // being DELETED on every load path as a pinned "accepted loss". See the TAG
  // docstring for why that loss stopped being acceptable.
  it("moves the unquoted-attribute shape too, keeping a real asset block", () => {
    expect(htmlPlainProjection('<img alt=a<b data-asset-id="real">')).toBe("<img alt=a");
  });

  // ★★★ THESE ARE THE PRE-CHANGE VALUES, MEASURED, AND THEY ARE THE POINT OF
  // THE TEST: everything except the one shape above must come out byte-identical
  // after the bound. Measured 2026-08-27 against the UNFIXED matchers. Do NOT
  // write this as `expect(htmlPlainProjection(h)).toBe(htmlPlainProjection(h))`
  // — a self-comparison passes against ANY implementation and pins nothing.
  it("leaves every other shape byte-identical", () => {
    const BEFORE: ReadonlyArray<readonly [string, string]> = [
      // A `>` inside an attribute ALREADY terminates the run today, so this row
      // surfaces markup as prose before and after. It is here to prove the
      // change does not alter that, not to endorse it.
      ['<img alt="a>b" data-asset-id="real">', 'b" data-asset-id="real">'],
      ['<img alt="><c d" data-asset-id="real">', ""],
      ['<img data-asset-id="real" alt="><c d">', ""],
      ["<p>plain</p>", "plain"],
      ["<p>a &lt; b</p>", "a < b"],
      ["<ul><li><p>one</p></li><li><p>two</p></li></ul>", "one two"],
    ];
    for (const [html, expected] of BEFORE) {
      expect(htmlPlainProjection(html)).toBe(expected);
    }
  });
});

// ★★★ THE BUDGET IS ~1000x THE MEASURED LINEAR COST AND THAT IS DELIBERATE,
// copied from document-asset-patterns.differential.test.ts's rationale: the
// loosest threshold that still separates linear from quadratic cannot flake on
// a loaded machine while still failing instantly on a regression. Measured
// 2026-08-27 on the UNFIXED patterns: 128 KB cost 6617 ms (TAG) and 7226 ms
// (BLOCK_TAG) against 8.4 ms for the same byte count with tags CLOSED.
// ★★ 128 KB, not 1 MB: the unfixed cost at 1 MB would blow vitest's 20 s test
// timeout before the assertion ran, turning a precise number into a bare
// timeout that names neither figure.
describe("htmlPlainProjection — complexity", () => {
  const CEILING_MS = 2000;
  const BYTES = 128 * 1024;

  for (const [label, unit] of [
    ["unterminated inline openers", "<a"],
    ["unterminated block openers", "<p"],
    ["unterminated task items", "<li"],
  ] as const) {
    it(`stays bounded on ${label}`, () => {
      const input = unit.repeat(Math.round(BYTES / unit.length));
      const started = performance.now();
      htmlPlainProjection(input);
      expect(performance.now() - started).toBeLessThan(CEILING_MS);
    });
  }
});

// ★ markTaskItems carries THREE unbounded runs in one pattern and runs on both
// projection paths. Same defect as TAG/BLOCK_TAG, found separately.
describe("markTaskItems — complexity", () => {
  it("stays bounded on unterminated list-item openers", () => {
    const input = "<li".repeat(Math.round((128 * 1024) / 3));
    const started = performance.now();
    markTaskItems(input);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  // The pattern consumes the `<li …>` opener and the OPTIONAL `<p>` that
  // follows it — nothing else. The `</p>` and `</li>` are left in place for the
  // tag strip downstream to remove, so they belong in these expectations.
  // Measured 2026-08-27 against the unfixed pattern; the bound must not move
  // either value.
  it("still marks a real task item, checked and unchecked", () => {
    expect(markTaskItems('<li data-type="taskItem" data-checked="true"><p>done</p></li>')).toBe(
      "[x] done</p></li>",
    );
    expect(markTaskItems('<li data-type="taskItem" data-checked="false"><p>open</p></li>')).toBe(
      "[ ] open</p></li>",
    );
  });
});

// ★★★ THE SINGLE OVERFLOW PATH. Both capHtmlText's cap branch and
// sanitizeRichText's byte ceiling route through here, so an asset image
// survives an overflow on every path at once — §208 was the same code emitting
// plainToHtml(slice) and discarding every tag, image included.
describe("degradeToPlain", () => {
  it("flattens to text and truncates", () => {
    expect(degradeToPlain("<p><strong>abcdefghij</strong></p>", 4)).toBe("<p>abcd</p>");
  });

  it("carries an asset image across the degrade — §208", () => {
    const img = '<img data-asset-id="a1" alt="chart">';
    const out = degradeToPlain(`<p>${img}${"x".repeat(50)}</p>`, 10);
    expect(out).toContain('data-asset-id="a1"');
    expect(out).toContain("xxxxxxxxxx");
  });

  it("keeps every image when a paragraph carries several", () => {
    const html = `<p><img data-asset-id="a1"><img data-asset-id="a2">${"x".repeat(50)}</p>`;
    const out = degradeToPlain(html, 5);
    expect(out).toContain('data-asset-id="a1"');
    expect(out).toContain('data-asset-id="a2"');
  });

  // ★★ THE BOUND IS INSIDE THIS FUNCTION, not at its callers. A caller-side cap
  // is a bound this unit cannot see, and it stops holding the moment someone
  // adds a caller.
  it("stops extracting images at its own cap", () => {
    const many = '<img data-asset-id="a">'.repeat(200);
    const out = degradeToPlain(`<p>${many}text</p>`, 4);
    expect((out.match(/data-asset-id/g) ?? []).length).toBeLessThanOrEqual(20);
  });

  // ★★ These two guards MOVED here from capHtmlText — they are not duplicated.
  it("drops a character straddling the cap whole, never half of it", () => {
    const out = degradeToPlain("<p>ab\u{1F600}cd</p>", 3);
    expect(out).toBe("<p>ab</p>");
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out)).toBe(
      false,
    );
  });

  it("returns empty for a cap of zero or less", () => {
    expect(degradeToPlain("<p>abc</p>", 0)).toBe("");
    expect(degradeToPlain("<p>abc</p>", -1)).toBe("");
  });

  // ★★★ THIS IS THE OVERFLOW PATH, so the one input guaranteed to reach it is an
  // oversized one. ASSET_IMG_TAG's two runs sit nested around the id, which is
  // quadratic on an <img that never closes unless the guard lookahead is there.
  // Measured 2026-08-27 without the guard: 57 ms at 32 KB, 226 at 64, 1062 at
  // 128. Deleting `(?=[^<>]*>)` from the pattern turns this red.
  it("stays bounded on an unterminated <img carrying repeated ids", () => {
    const unit = 'data-asset-id="x" ';
    const input = "<img " + unit.repeat(Math.round((128 * 1024) / unit.length));
    const started = performance.now();
    degradeToPlain(input, 100);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
