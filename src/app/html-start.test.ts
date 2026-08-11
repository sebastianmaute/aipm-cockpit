import { describe, expect, it } from "vitest";
import {
  DOCUMENT_ALLOWED_TAGS,
  RICH_ALLOWED_TAGS,
  sanitizeDocumentHtml,
  sanitizeRichHtml,
} from "./sanitize-html";
import DOMPurify from "dompurify";
import { htmlStartRe, isHtmlStart, SINK_TAGS } from "./html-start";

describe("htmlStartRe", () => {
  it("drops non-tag entries so #text cannot enter the alternation", () => {
    const re = htmlStartRe(["p", "#text"]);
    expect(re.source).not.toContain("#text");
    expect(re.test("<p>x</p>")).toBe(true);
  });

  it("never matches a leading CLOSING tag", () => {
    // A stored value cannot legitimately begin with one, and passing it through
    // makes the sink delete the literal characters the user typed.
    expect(htmlStartRe(["p"]).test("</p> means close")).toBe(false);
  });

  it("does not let a short tag swallow a longer one that shares its prefix", () => {
    const re = htmlStartRe(["strong", "s", "sub", "sup"]);
    expect(re.test("<strong>a</strong>")).toBe(true);
    expect(re.test("<s>a</s>")).toBe(true);
    expect(re.test("<sub>a</sub>")).toBe(true);
    expect(re.test("<sup>a</sup>")).toBe(true);
    // A tag name that is NOT in the list but shares a prefix with one that is
    // must not match — without the word boundary, "s" matches "<strongish>" and
    // "<script>" by swallowing the rest of the name as if it were attributes,
    // which is invisible to the four assertions above (they only check that a
    // REAL member of the list still matches, and "s" alone reports true for
    // those too via the same swallow).
    expect(re.test("<strongish>x</strongish>")).toBe(false);
    expect(re.test("<script>x</script>")).toBe(false);
  });

  it("requires the opening tag to actually CLOSE", () => {
    // ★★★ The guard the factory's own comment documents and nothing pinned: a
    // legacy PLAIN value that merely STARTS tag-shaped is not markup. Passed
    // through raw, the tokenizer DISCARDS an incomplete tag at EOF, so the whole
    // value vanishes — while a text-length count over it still reads 11, so no
    // empty-state fallback fires either.
    expect(htmlStartRe(["li"]).test("<li 3 items")).toBe(false);
  });

  it("matches void spellings and attribute-bearing tags", () => {
    const re = htmlStartRe(["hr", "img", "a"]);
    expect(re.test("<hr/>")).toBe(true);
    expect(re.test("<hr />")).toBe(true);
    expect(re.test('<img data-asset-id="7" alt="x">')).toBe(true);
    expect(re.test('<a href="https://x.test">y</a>')).toBe(true);
  });

  it("is case-insensitive and tolerates leading whitespace", () => {
    expect(htmlStartRe(["p"]).test("  \n<P>x</P>")).toBe(true);
  });

  it("matches nothing when no valid tag name survives the filter", () => {
    // Guard against an empty alternation, which would compile to a regex that
    // matches "<>" and any stray angle bracket.
    const re = htmlStartRe(["#text"]);
    expect(re.test("<p>x</p>")).toBe(false);
    expect(re.test("<>")).toBe(false);
  });
});

describe("the rich sink", () => {
  it("derives from RICH_ALLOWED_TAGS", () => {
    expect(SINK_TAGS.rich).toBe(RICH_ALLOWED_TAGS);
  });

  it("recognises a leading heading, which the retired note sink escaped", () => {
    expect(isHtmlStart("<h1>Title</h1><p>body</p>", "rich")).toBe(true);
  });

  it("recognises a leading blockquote", () => {
    expect(isHtmlStart("<blockquote>quoted</blockquote>", "rich")).toBe(true);
  });

  it("still rejects plain prose", () => {
    expect(isHtmlStart("risk: vendor delay", "rich")).toBe(false);
  });

  it("still rejects an unterminated tag-shaped prefix", () => {
    expect(isHtmlStart("<li 3 items", "rich")).toBe(false);
  });

  it("still rejects a leading CLOSING tag", () => {
    expect(isHtmlStart("</p> means close", "rich")).toBe(false);
  });

  it("keeps projection as its OWN member, not an alias of document", () => {
    expect(Object.keys(SINK_TAGS).sort()).toEqual(["document", "projection", "rich"]);
  });
});

describe("the sink map", () => {
  it("classifies a document-only tag for document and projection, not for rich", () => {
    // ★ The fixture was <blockquote>, which separated the old "document" list from
    // the two lean ones. It stopped separating anything once RICH_ALLOWED_TAGS
    // admitted it (open-followups §137) — `img` is the one tag documents still
    // carry alone, so the relation this pins survives with a different fixture.
    const img = '<img data-asset-id="7">';
    expect(isHtmlStart(img, "document")).toBe(true);
    expect(isHtmlStart(img, "projection")).toBe(true);
    expect(isHtmlStart(img, "rich")).toBe(false);
  });

  it("classifies every tag the retired template sink carried and the note sink did not", () => {
    // ★ This used to assert the DISAGREEMENT — "template" said HTML, "note" said
    // plain text, over the same three values. That disagreement WAS the §137 data
    // loss: the note sink is KEEP_CONTENT:false, so a value it called plain text
    // had its words deleted rather than merely reformatted. The two sinks merged,
    // so the surviving property is that the one "rich" sink recognises all three.
    for (const html of ["<h1>T</h1>", "<h2>T</h2>", "<u>T</u>"]) {
      expect(isHtmlStart(html, "rich")).toBe(true);
    }
  });

  it("classifies a tag NO allow-list carries for render but not for document", () => {
    // The whole point of the render sink. Its consumers keep every tag's text
    // (KEEP_CONTENT default / the rich-line parser), so a value opening with an
    // unlisted tag is HTML there — while "document", the widest DERIVED sink,
    // calls the same value plain text and escapes it whole.
    // ★ The heading fixture was <h3> and is now <h5>: h3 stopped being unlisted
    // the moment DOCUMENT_ALLOWED_TAGS began deriving from RICH_ALLOWED_TAGS,
    // which carries h1-h4. h5 is the heading-shaped tag NO list carries —
    // sanitize-html.test.ts pins that the rich list admits neither h5 nor h6, and
    // the document list is that list plus img.
    for (const html of ["<h5>Sub</h5>", "<div>Status</div>", "<table><tr><td>c</td></tr></table>"]) {
      expect(isHtmlStart(html, "render")).toBe(true);
      expect(isHtmlStart(html, "document")).toBe(false);
    }
  });

  it("recognises a tag ANYWHERE for render, while the derived sinks stay leading-only", () => {
    // ★★★ The two sinks ask two DIFFERENT questions. A DERIVED sink is a STORAGE
    // boundary: the escaped form is what gets persisted, so it asks "does this
    // START with a tag I keep?" and treats a mid-sentence "<" conservatively.
    // The render sink stores nothing and its consumers keep every tag's text, so
    // the only failure mode left is escaping real markup — it therefore asks
    // "does this CONTAIN a tag at all?". Anchoring it at the start escaped real
    // markup that simply does not OPEN with a tag, which is how it reached Word,
    // PowerPoint, the HTML preview and the PDF as literal "&lt;strong&gt;".
    for (const value of ["Intro <strong>bold</strong> tail", "See <em>the plan</em>"]) {
      expect(isHtmlStart(value, "render")).toBe(true);
      for (const sink of ["rich", "document", "projection"] as const) {
        expect(isHtmlStart(value, sink)).toBe(false);
      }
    }
    // A value that DOES lead with a tag is unaffected in either direction.
    expect(isHtmlStart("<p>leads with a tag</p>", "render")).toBe(true);
    expect(isHtmlStart("<p>leads with a tag</p>", "document")).toBe(true);
  });

  it("still calls a value carrying no tag at all plain text at the render sink", () => {
    // The two things the widening must NOT change. "a\nb" is open-followups
    // §118 — no tag anywhere, so it upgrades and its newline becomes a real
    // break instead of fusing into one run-on line. "cost < 5k" is a "<" that is
    // not followed by a letter, i.e. literal text the tokenizer would eat.
    expect(isHtmlStart("a\nb", "render")).toBe(false);
    expect(isHtmlStart("cost < 5k", "render")).toBe(false);
  });

  it("keeps all three guards on the render sink", () => {
    // Recognising every TAG is not the same as recognising every "<": a value
    // that merely starts tag-SHAPED is still plain text somebody typed, and
    // passing it through makes the sink eat it.
    expect(isHtmlStart("<li 3 items", "render")).toBe(false); // never closes
    expect(isHtmlStart("<3 open", "render")).toBe(false); // not a letter
    expect(isHtmlStart("</p> means close", "render")).toBe(false); // closing tag
  });

  // ★★★ THE PROPERTY THE LIST-WIDTH TESTS STRUCTURALLY CANNOT SEE, and the gap
  // that let §137 through every gate. Every other test in this file compares one
  // ARRAY against another, so a change to a SANITIZER's config — the thing that
  // decides what is actually kept — is invisible to all of them. Mutation M4 is
  // the shape: adding `"figure"` to sanitizeRichHtml's `ALLOWED_TAGS` while
  // leaving RICH_ALLOWED_TAGS alone left both this file and sanitize-html.test.ts
  // green at 66/66, and a stored `<figure>…` would then be escaped WHOLE and
  // permanently (§107/§114). This test derives BOTH sides EMPIRICALLY — it runs
  // the real sanitizer and the real classifier over a tag universe — so it cannot
  // degenerate into comparing an array with itself.
  //
  // ★★ THE CLASSIFIER DIRECTION IS `kept ⊆ recognised`, NOT equality, and that is
  // deliberate. The rule this file states at the top is one-directional: "never
  // recognise LESS than your sink KEEPS." Equality holds today, but asserting it
  // would fail a legitimate future widening of a classifier — and the projection
  // sink already documents a case where recognising MORE than a sink keeps is the
  // chosen trade. A tag that is recognised but not kept costs formatting; a tag
  // that is KEPT but not recognised costs the whole value, escaped, forever.
  // ★★★ DO NOT GENERALISE THAT INTO "never assert equality here". The two tests
  // above DO assert equality, and correctly: they compare a sanitizer's config and
  // its behaviour against ITS OWN array, which are meant to be the same thing. The
  // subset rule governs only the SANITIZER-to-CLASSIFIER relation. Collapsing the
  // two ideas is how a future reader talks themselves out of the config test.
  //
  // ★★ SCOPE — THIS PAIR COVERS TWO SINKS, NOT FOUR, and the file has four.
  // `render` has no allow-list to compare against; it is covered elsewhere in this
  // file (re-deriving it from one turns two pre-existing tests red). `projection`
  // is covered by NEITHER, which is defensible rather than an oversight: it has no
  // sanitizer at all — descriptionText/descriptionTextWithBreaks strip every tag —
  // so there is no "kept" set for it to be measured against. Its width is a
  // documented TRADE, pinned by the superset test further down.
  // ★ Known and accepted: the `it.each` rows below enumerate sinks as literals, so
  // a future FOURTH `DerivedSink` would land here unpinned until somebody adds a
  // row. The type level already forces half of it — `SINK_TAGS` and `SINK_RE` are
  // `Record<DerivedSink, …>`, so a new member fails tsc until it is given a list
  // and a regex. Only the behavioural rows would silently skip it.
  //
  // ★★★ THE UNIVERSE IS THE FULL HTML ELEMENT SET, and a SAMPLE of it is not good
  // enough — that was this test's own defect, found by cold review. The first cut
  // hand-picked ~75 "allow-listed tags plus plausible outsiders", which caught the
  // `figure` mutant only because `figure` happened to be in the list. Measured:
  // `[...RICH_ALLOWED_TAGS, "details", "kbd", "abbr", "dfn"]` in sanitizeRichHtml's
  // config left this file and sanitize-html.test.ts at 68/68 GREEN, exit 0, while
  // through the real load path every one of those four was kept by the sink and
  // escaped whole by the classifier:
  //   details: sanitizerKeeps=true recognised=false
  //            -> "<p>&lt;details&gt;WORD&lt;/details&gt;</p>"
  // That is §107 in full, with the gate green. A hand-picked universe tests the
  // mutants you thought of.
  // ★★ Deriving the universe from the two allow-list arrays does NOT fix it and is
  // the tempting wrong move: the mutant tag is outside those arrays too, so it
  // would still never be probed.
  // ★ Intended as the standard HTML element set, plus obsolete elements
  // (font/center/big/strike/tt/marquee/frame*) and the two foreign-content roots
  // (svg/math), which is where a security-relevant surprise would come from.
  // ★★ It was written out by hand and NOTHING checks it against the spec, so treat
  // it as best-effort rather than authoritative — do not cite it as "the WHATWG
  // index" (an earlier revision of this line did, and no one had read the index).
  // That is safe in the one direction that matters: a MISSING element only weakens
  // the behavioural tests, never breaks them, and the config test above is
  // unaffected by this list entirely. Adding an element can only make things
  // stricter, so add freely.
  const TAG_UNIVERSE = [
    "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base",
    "bdi", "bdo", "blockquote", "body", "br", "button", "canvas", "caption",
    "cite", "code", "col", "colgroup", "data", "datalist", "dd", "del",
    "details", "dfn", "dialog", "div", "dl", "dt", "em", "embed", "fieldset",
    "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
    "h6", "head", "header", "hgroup", "hr", "html", "i", "iframe", "img",
    "input", "ins", "kbd", "label", "legend", "li", "link", "main", "map",
    "mark", "menu", "meta", "meter", "nav", "noscript", "object", "ol",
    "optgroup", "option", "output", "p", "param", "picture", "pre", "progress",
    "q", "rp", "rt", "ruby", "s", "samp", "script", "search", "section",
    "select", "slot", "small", "source", "span", "strong", "style", "sub",
    "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot",
    "th", "thead", "time", "title", "tr", "track", "u", "ul", "var", "video",
    "wbr",
    // obsolete + foreign-content roots
    "font", "center", "big", "strike", "tt", "marquee", "frame", "frameset",
    "noframes", "svg", "math",
  ];

  /** `<T>x</T>` for a normal tag, `<T>` for a void one — a void element has no
   *  closing tag, and writing one makes the parser emit a stray close that muddies
   *  what "the tag survived" means. */
  const VOID_TAGS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "param", "source", "track", "wbr",
  ]);
  const probeFor = (tag: string) => (VOID_TAGS.has(tag) ? `<${tag}>` : `<${tag}>x</${tag}>`);

  /** Did the SANITIZER keep this tag? Matched on the tag name plus a terminator,
   *  never a bare `<tag` prefix — a prefix is satisfied by any longer tag name
   *  that shares it, which is the exact confusion `\b` exists to prevent in the
   *  classifier. */
  const keeps = (sanitize: (h: string) => string, tag: string) =>
    new RegExp(`<${tag}(?:\\s|>|/)`, "i").test(sanitize(probeFor(tag)));

  /** The RESOLVED `ALLOWED_TAGS` a sanitizer actually handed DOMPurify, read back
   *  through an `uponSanitizeElement` hook (`data.allowedTags`).
   *
   *  ★★★ THIS IS THE ONLY TAG-INDEPENDENT PROBE HERE, and it is why the universe
   *  above no longer has to be complete to close the class. Every other check in
   *  this file samples BEHAVIOUR over a finite tag list, so it can only catch a
   *  mutant whose tag is in that list — widen the universe as far as you like and
   *  a config carrying a name nobody enumerated still slips through. Reading the
   *  config asks the question directly and sees ANY added name, in the universe or
   *  not.
   *  ★★ MEASURED, not argued, and this is the experiment that separates the two
   *  halves of the fix. `[...RICH_ALLOWED_TAGS, "quux"]` — a name deliberately
   *  absent from TAG_UNIVERSE — turns exactly ONE test red: this one. Both
   *  behavioural tests stay GREEN, because they never probe a tag nobody listed.
   *  So widening the universe alone would NOT have closed the class; it only
   *  raises the odds that a realistic mutant lands inside it.
   *  ★★ The hook is GLOBAL on the DOMPurify singleton, so it is removed in a
   *  `finally`. A leaked hook would corrupt every later sanitize in this file. */
  function configuredTags(sanitize: (h: string) => string): string[] {
    let seen: Record<string, unknown> | null = null;
    DOMPurify.addHook("uponSanitizeElement", (_node, data) => {
      if (seen === null) {
        seen = (data as { allowedTags?: Record<string, unknown> }).allowedTags ?? null;
      }
    });
    try {
      sanitize("<p>x</p>");
    } finally {
      DOMPurify.removeHook("uponSanitizeElement");
    }
    // "#text" is added by DOMPurify itself, not by our config.
    return Object.keys(seen ?? {}).filter((t) => t !== "#text").sort();
  }

  // ★★★ THE TAG-INDEPENDENT HALF: the config a sanitizer passes must BE its own
  // exported array. This is what actually closes the mutation class — a widened
  // `ALLOWED_TAGS` shows up here whatever tag it adds, so it does not depend on
  // TAG_UNIVERSE being complete. `sanitize-html.test.ts` pins the other end (the
  // array carries exactly the 21 names), and the subset test below pins the
  // classifier end; together they are config == array == classifier.
  // ★ Asserted as a SORTED NAME SET, not by reference: `toBe(RICH_ALLOWED_TAGS)`
  // is unavailable (DOMPurify normalises the array into a lookup object) and a
  // reference check would in any case pass for a mutated array and fail for a
  // harmless reorder — the names are what the classifier derives from.
  it.each([
    ["rich", sanitizeRichHtml, RICH_ALLOWED_TAGS] as const,
    ["document", sanitizeDocumentHtml, DOCUMENT_ALLOWED_TAGS] as const,
  ])("%s: the ALLOWED_TAGS handed to DOMPurify IS the exported array", (sink, sanitize, array) => {
    const configured = configuredTags(sanitize);
    // Anti-vacuity: if the hook never fired, `configured` is [] and the compare
    // below would still fail — but say so explicitly, because an empty result
    // means "probe broken", not "config wrong".
    expect(configured.length, `the uponSanitizeElement hook never fired for "${sink}"`)
      .toBeGreaterThan(0);
    expect(configured).toEqual([...array].filter((t) => t !== "#text").sort());
  });

  // ★★ The BEHAVIOURAL counterpart: config == array is what the sanitizer was
  // ASKED for, this is what it actually does. They are not the same claim — a
  // DOMPurify upgrade could start dropping a tag we still list — and this one is
  // universe-bound, which is precisely why the config test above exists beside it.
  it.each([
    ["rich", sanitizeRichHtml, RICH_ALLOWED_TAGS] as const,
    ["document", sanitizeDocumentHtml, DOCUMENT_ALLOWED_TAGS] as const,
  ])("%s: the tags the sanitizer actually KEEPS are exactly its own array", (sink, sanitize, array) => {
    const kept = TAG_UNIVERSE.filter((tag) => keeps(sanitize, tag)).sort();
    expect(kept).toEqual([...array].filter((t) => t !== "#text").sort());
  });

  it.each([
    ["rich", sanitizeRichHtml] as const,
    ["document", sanitizeDocumentHtml] as const,
  ])("%s: every tag the sanitizer KEEPS is recognised by the classifier", (sink, sanitize) => {
    const kept: string[] = [];
    const missed: string[] = [];
    for (const tag of TAG_UNIVERSE) {
      if (!keeps(sanitize, tag)) continue;
      kept.push(tag);
      if (!isHtmlStart(probeFor(tag), sink)) missed.push(tag);
    }
    // Anti-vacuity: a sanitizer that kept NOTHING would satisfy the subset check
    // for free, and so would a universe that never hit the allow-list.
    expect(kept.length).toBeGreaterThan(15);
    expect(missed, `sink "${sink}" KEEPS these tags but its classifier does not recognise them, so a stored value opening with one is escaped whole and permanently (§107)`).toEqual([]);
  });

  it("the universe actually separates the sinks — otherwise the pair above is one test twice", () => {
    // `img` is the only tag DOCUMENT_ALLOWED_TAGS adds, so it is the sole witness
    // that the two rows of it.each are not measuring the same thing.
    expect(keeps(sanitizeRichHtml, "img")).toBe(false);
    expect(keeps(sanitizeDocumentHtml, "img")).toBe(true);
    // And the universe must contain tags NEITHER sanitizer keeps, or "kept ⊆
    // recognised" could be satisfied by a classifier that says yes to everything.
    expect(keeps(sanitizeRichHtml, "figure")).toBe(false);
    expect(isHtmlStart(probeFor("figure"), "rich")).toBe(false);
  });

  it("makes render a superset of every derived sink", () => {
    for (const sink of ["rich", "document", "projection"] as const) {
      for (const tag of SINK_TAGS[sink]) {
        if (tag === "#text") continue;
        const html = `<${tag}>x`;
        expect(isHtmlStart(html, sink)).toBe(true);
        expect(isHtmlStart(html, "render")).toBe(true);
      }
    }
  });

  it("keeps projection a superset of every real sink", () => {
    // Projection has no sink — htmlToText strips everything — so THE RULE does
    // not bind and the width is a TRADE, not a free choice. Recognising less is
    // the §107 direction (literal "&lt;h1&gt;" into search, digests and exports);
    // recognising more is the §32 direction (a plain "<mark> means highlight in
    // this project" projects to "means highlight in this project", fragment
    // dropped — measured). We take the wide side because the §107 direction is
    // commoner and louder. If the document list ever narrows, this is what
    // catches it.
    // ★★★ WHAT THIS ACTUALLY CATCHES IS NARROWER THAN IT READ. It said "if the
    // document list ever narrows, this is what catches it", and that is FALSE:
    // measured 2026-08-11 by dropping `img` from DOCUMENT_ALLOWED_TAGS, this test
    // stays GREEN, because `SINK_TAGS.projection` IS that array — it narrows in
    // lockstep with the thing it is being compared against. What it can catch is
    // projection falling below the RICH list, i.e. DOCUMENT_ALLOWED_TAGS ceasing
    // to spread RICH_ALLOWED_TAGS (mutation-measured red). While projection and
    // document are the same array, the document half of this loop is a tautology
    // kept for the day they diverge.
    // ★ The loop used to run over NOTE_ALLOWED_TAGS and TEMPLATE_ALLOWED_TAGS as
    // well. Both are deleted now; both were subsets of the rich list, so keeping
    // them would have asserted an implied property while coupling this file to
    // two retired arrays.
    const projection = new Set(SINK_TAGS.projection);
    for (const tags of [RICH_ALLOWED_TAGS, DOCUMENT_ALLOWED_TAGS]) {
      for (const tag of tags) {
        if (tag === "#text") continue;
        expect(projection.has(tag)).toBe(true);
      }
    }
  });
});
