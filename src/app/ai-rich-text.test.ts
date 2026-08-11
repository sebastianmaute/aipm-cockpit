import { describe, it, expect } from "vitest";
import {
  AI_RICH_FIELDS,
  sanitizeAiDocumentRichText,
  sanitizeAiRichText,
  withAiRichFields,
} from "./ai-rich-text";
import { MAX_HTML_TEXT_CHARS } from "./document-model";
import { htmlTextLength } from "./rich-text-plain";
import { TEXTAREA_MAX } from "./sanitize";

// The write boundary for a rich field whose value came from a MODEL. Two layers:
// upgrade-aware (accept plain OR HTML) and allow-listed (an actual DOMPurify pass,
// which the DOM-free sanitizeRichText cannot do on its own).

describe("sanitizeAiRichText — upgrade layer", () => {
  it("keeps model-supplied HTML as HTML", () => {
    expect(sanitizeAiRichText("<p>Agree <strong>goals</strong></p>")).toBe(
      "<p>Agree <strong>goals</strong></p>",
    );
  });

  it("upgrades plain prose, escaping its angle brackets", () => {
    expect(sanitizeAiRichText("cost < 5k\nline two")).toBe("<p>cost &lt; 5k<br>line two</p>");
  });

  it("returns empty for a non-string, an empty string and a visually empty value", () => {
    expect(sanitizeAiRichText(undefined)).toBe("");
    expect(sanitizeAiRichText(null)).toBe("");
    expect(sanitizeAiRichText(42)).toBe("");
    expect(sanitizeAiRichText("")).toBe("");
    expect(sanitizeAiRichText("   ")).toBe("");
    expect(sanitizeAiRichText("<p><em></em></p>")).toBe("");
  });
});

describe("sanitizeAiRichText — allow-list layer", () => {
  it("removes a script element and its contents", () => {
    // ★★ sanitizeRichText alone CANNOT do this: it is DOM-free by contract, and
    // descriptionHtml passes anything HTML-shaped through verbatim. Without this
    // layer the raw <script> reached all six storage backends.
    const out = sanitizeAiRichText("<p>ok</p><script>alert(1)</script>");
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
    expect(out).toContain("ok");
  });

  it("drops an event-handler attribute and a javascript: href", () => {
    expect(sanitizeAiRichText('<p onclick="steal()">hi</p>')).not.toContain("onclick");
    const link = sanitizeAiRichText('<p><a href="javascript:alert(1)">x</a></p>');
    expect(link).not.toContain("javascript:");
    // The text survives — only the dangerous attribute goes.
    expect(link).toContain("x");
  });

  it("KEEPS the text inside a tag the allow-list does not cover", () => {
    // ★★★ This is why the boundary must keep DOMPurify's KEEP_CONTENT DEFAULT.
    // The retired sanitizeNoteHtml set it to false, which deleted a disallowed
    // tag's TEXT along with the tag — and a model legitimately emits
    // <div>/<table>, so the user's words vanished silently. That is the data-loss
    // class §137 closed, and this assertion is what stops a future sanitizer
    // reintroducing it here. It is no longer pinning a CHOICE between two
    // existing sanitizers (there is one), but the property it pins is the
    // durable one.
    const out = sanitizeAiRichText("<p>intro</p><div>body text</div>");
    expect(out).toContain("intro");
    expect(out).toContain("body text");
  });

  it("re-applies the empty rule after sanitizing", () => {
    // A value whose ONLY content was a disallowed element is empty once the
    // allow-list has run; it must return "" rather than a phantom "<p></p>",
    // which every `if (description)` gate would store.
    expect(sanitizeAiRichText("<p><script>x</script></p>")).toBe("");
  });

  // ★★★ THE SHARED BOUNDARY MUST NOT WIDEN TO THE DOCUMENTS LIST. S3a gave
  // documents their own, wider allow-list via the sibling
  // sanitizeAiDocumentRichText. THIS function also guards the six rich entity
  // description fields (raid description/mitigation, change description/
  // impactDescription/resolutionNotes, milestone description). Repointing this
  // one at sanitizeDocumentHtml, or "deduplicating" the two into one
  // parameterised helper that defaults the wrong way, silently widens all six
  // AND swaps the cap (TEXTAREA_MAX 5 000 -> MAX_HTML_TEXT_CHARS 20 000).
  // ★★★ THE PROBE MOVED FROM <mark> TO <img>, and the reason is the whole point
  // of this slice. <mark> was document-only against an 11-tag template list;
  // DOCUMENT_ALLOWED_TAGS now SPREADS RICH_ALLOWED_TAGS, so the two lists differ
  // by exactly ONE tag and <mark> survives on both. `img` is that tag — the only
  // input left that can separate the two sanitizers at all. A test still using
  // <mark> here would be asserting a gap that no longer exists.
  // ★★ Anti-vacuity has to work DIFFERENTLY for `img` and this is the trap: it is
  // a VOID element, so there is no inner text to survive the unwrap and the old
  // "the TEXT survives" control cannot be written. The sibling text "tail" plays
  // that role instead — it proves the tag went missing by allow-list rather than
  // by the whole value being dropped, which capHtmlText/the empty rule can also
  // do.
  it("does NOT admit the document-only img — the entity fields stay on the narrow list", () => {
    const out = sanitizeAiRichText('<p><img data-asset-id="7" alt="c">tail</p>');
    expect(out).not.toContain("<img");
    expect(out).toContain("tail");
    // The separating control: the SAME input keeps its img on the document path.
    expect(sanitizeAiDocumentRichText('<p><img data-asset-id="7" alt="c">tail</p>')).toContain("<img");
  });
});

describe("sanitizeAiDocumentRichText — cap", () => {
  // ★★★ The cap must be the DOCUMENTS one (MAX_HTML_TEXT_CHARS, 20 000), not the
  // sibling's TEXTAREA_MAX (5 000). Exceeding it does not merely SHORTEN the
  // value: capHtmlText's truncation branch returns plainToHtml(text.slice(...)),
  // which FLATTENS the markup to escaped plain text. So at the wrong cap a
  // model-authored document paragraph above 5 000 visible characters lost half
  // its text AND every mark this slice exists to preserve — the exact tag the
  // wider allow-list was added for. The structural layer
  // (document-model.sanitizeBlock) already caps at MAX_HTML_TEXT_CHARS, so the
  // two boundaries must agree on one number or the tighter one wins silently.
  const long = `<p>${"word ".repeat(2000)}<mark>KEEPME</mark></p>`;

  it("keeps a >5 000-character paragraph's text and its marks intact", () => {
    expect(htmlTextLength(long)).toBeGreaterThan(TEXTAREA_MAX);
    expect(htmlTextLength(long)).toBeLessThan(MAX_HTML_TEXT_CHARS);

    const out = sanitizeAiDocumentRichText(long);
    // Uncapped: the visible text survives whole, not truncated to 5 000.
    expect(htmlTextLength(out)).toBe(htmlTextLength(long));
    // Un-flattened: the mark is still markup, not "&lt;mark&gt;" or plain text.
    expect(out).toContain("<mark>KEEPME</mark>");
  });

  it("still caps at MAX_HTML_TEXT_CHARS — the cap is raised, not removed", () => {
    // Anti-vacuity control for the test above: a boundary that passed Infinity
    // (or dropped the cap argument) would also satisfy it.
    const huge = `<p>${"word ".repeat(6000)}</p>`;
    expect(htmlTextLength(huge)).toBeGreaterThan(MAX_HTML_TEXT_CHARS);
    expect(htmlTextLength(sanitizeAiDocumentRichText(huge))).toBeLessThanOrEqual(
      MAX_HTML_TEXT_CHARS,
    );
  });
});

describe("withAiRichFields", () => {
  it("cleans the named rich fields and leaves everything else untouched", () => {
    const out = withAiRichFields(
      { id: 7, title: "T <keep>", description: "<p>ok</p><script>alert(1)</script>", owner: "Ada" },
      AI_RICH_FIELDS.raid,
    );
    expect(out.description).not.toContain("script");
    expect(out.description).toContain("ok");
    // A non-rich field is NOT sanitized here — its own field sanitizer owns it,
    // and quietly rewriting it would be scope creep at a security boundary.
    expect(out.title).toBe("T <keep>");
    expect(out.owner).toBe("Ada");
    expect(out.id).toBe(7);
  });

  it("SKIPS a field the model did not supply, rather than blanking it", () => {
    // ★★ Load-bearing for updates: an absent key means "leave this alone". If the
    // helper wrote "" for it, every update patch would ERASE the stored
    // description and mitigation of the item it was only meant to retitle.
    const patch = { title: "New title" };
    const out = withAiRichFields(patch, AI_RICH_FIELDS.raid);
    expect("description" in out).toBe(false);
    expect("mitigation" in out).toBe(false);
    // Nothing to clean ⇒ the SAME object comes back, so the caller's spread is
    // byte-for-byte what it was before.
    expect(out).toBe(patch);
  });

  it("covers every rich field of each AI-writable entity", () => {
    // A field missing from these lists is a field a model can write unsanitized —
    // the exact gap that shipped for Task.description. Pinned as a set so adding
    // a rich field to an entity forces a decision here.
    expect([...AI_RICH_FIELDS.raid]).toEqual(["description", "mitigation"]);
    expect([...AI_RICH_FIELDS.change]).toEqual([
      "description",
      "impactDescription",
      "resolutionNotes",
    ]);
    expect([...AI_RICH_FIELDS.milestone]).toEqual(["description"]);
  });

  it("cleans EVERY listed field, not just the first", () => {
    const out = withAiRichFields(
      {
        description: "<p>a</p><script>x</script>",
        impactDescription: "<p>b</p><script>y</script>",
        resolutionNotes: "<p>c</p><script>z</script>",
      },
      AI_RICH_FIELDS.change,
    );
    for (const v of Object.values(out)) expect(v).not.toContain("script");
  });
});

describe("open-followups §107 — a leading template tag is no longer escaped", () => {
  it("keeps a leading h1 as markup", () => {
    expect(sanitizeAiRichText("<h1>Title</h1><p>body</p>")).toBe("<h1>Title</h1><p>body</p>");
  });

  it("keeps a leading u as markup", () => {
    expect(sanitizeAiRichText("<u>Title</u><p>body</p>")).toBe("<u>Title</u><p>body</p>");
  });

  it("still leaves a mid-value heading alone (this case was never broken)", () => {
    expect(sanitizeAiRichText("<p>Title</p><h1>Section</h1>")).toBe("<p>Title</p><h1>Section</h1>");
  });

  it("still escapes genuine plain text", () => {
    expect(sanitizeAiRichText("cost < 5k and rising")).toBe("<p>cost &lt; 5k and rising</p>");
  });
});

describe("open-followups §114 — the nine document-only tags, one leading tag at a time", () => {
  // Measured individually on purpose: the register got the count wrong the first
  // time by reasoning about the group instead of testing each member.
  const cases: Array<[string, string]> = [
    ["s", "<s>a</s><p>b</p>"],
    ["code", "<code>a</code><p>b</p>"],
    ["pre", "<pre>a</pre><p>b</p>"],
    ["blockquote", "<blockquote>a</blockquote><p>b</p>"],
    ["hr", "<hr><p>b</p>"],
    ["mark", "<mark>a</mark><p>b</p>"],
    ["sub", "<sub>a</sub><p>b</p>"],
    ["sup", "<sup>a</sup><p>b</p>"],
    ["img", '<img data-asset-id="7" alt="a"><p>b</p>'],
  ];

  // ★★★ THE POSITIVE ASSERTION IS THE LOAD-BEARING ONE — `not.toContain("&lt;")`
  // ALONE IS VACUOUS. Mutation-proved 2026-08-10: with `sanitizeAiDocumentRichText`
  // stubbed to return `""` unconditionally, all ten tests in this describe PASSED,
  // because the empty string contains no `&lt;` either. "Was not escaped" and "was
  // produced at all" are two different claims and only the second one can fail on
  // a dropped value. The `<tag[ >]` form (not a bare `<tag` substring) is
  // deliberate: `<s` is a prefix of `<sub`, `<sup` and `<strong`, so a substring
  // check would let the `s` case pass on output that never contained an `<s>`.
  for (const [tag, html] of cases) {
    it(`keeps a leading <${tag}> as markup`, () => {
      const out = sanitizeAiDocumentRichText(html);
      expect(out, `<${tag}> did not survive the write boundary`)
        .toMatch(new RegExp(`<${tag}[ >]`));
      expect(out).not.toContain("&lt;");
    });
  }

  it("does not widen the entity path: a document-only tag is still not markup there", () => {
    // ★★★ THE PROBE MOVED FROM <blockquote> TO <img>, for the reason the sibling
    // test above spells out: `blockquote` joined RICH_ALLOWED_TAGS when the note
    // and template lists merged, so it IS markup on the entity path now and the
    // old assertion pinned a gap that no longer exists. `img` is the one tag
    // DOCUMENT_ALLOWED_TAGS adds, so it is the only input that still separates
    // the two classifiers.
    // sanitizeAiRichText's sink is sanitizeRichHtml, which has no img, so the
    // "rich" classifier does not recognise a leading one and the value must take
    // the escape path — a classifier WIDER than its sink would hand the sink a
    // tag it silently deletes (img is void: nothing unwraps).
    expect(sanitizeAiRichText('<img data-asset-id="7" alt="c">')).toContain("&lt;img");
  });
});
