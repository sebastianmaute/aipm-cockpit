import { describe, it, expect } from "vitest";
import { sanitizeAiDocBlocks } from "./ai-document-blocks";
import { sanitizeRichHtml } from "./sanitize-html";

describe("sanitizeAiDocBlocks", () => {
  it("strips a script tag from model-authored paragraph HTML", () => {
    const out = sanitizeAiDocBlocks([{ type: "paragraph", html: "<p>hi</p><script>alert(1)</script>" }]);
    expect(JSON.stringify(out)).not.toContain("script");
    expect(JSON.stringify(out)).toContain("hi");
  });

  // ★★★ THE PROBE TAG MOVED FROM h3 TO div, and h3 is why. This asserted that
  // the tag went and its TEXT stayed — the KEEP_CONTENT distinction against the
  // since-retired sanitizeNoteHtml, which omitted h3 and deleted its text.
  // DOCUMENT_ALLOWED_TAGS now SPREADS RICH_ALLOWED_TAGS, so h3 is allow-listed
  // and `<h3>` SURVIVES here — measured 2026-08-11:
  // "<p>before <h3>Section</h3> after</p>" -> "<p>before </p><h3>Section</h3>
  // after<p></p>". `not.toMatch(/<h3/i)` was therefore asserting the opposite of
  // the truth. `div` is on no list and takes its place.
  // ★★ The NESTING is still load-bearing and is the subtle part: the unwrap-vs-
  // delete distinction only fires when DOMPurify actually SEES the tag as markup,
  // which requires the value to OPEN with a tag this sink keeps. `isHtmlStart`
  // derives the "document" test from DOCUMENT_ALLOWED_TAGS, which has no `div`,
  // so a bare "<div>Section</div>" does NOT qualify — descriptionHtml (layer 1)
  // treats the whole string as plain text and escapes it before DOMPurify ever
  // runs, and the text then survives for an unrelated reason. Wrapping in a
  // recognised "<p>" forces the string down the real DOMPurify path.
  it("keeps the text inside a non-allow-listed tag nested in real HTML", () => {
    const out = sanitizeAiDocBlocks([{ type: "paragraph", html: "<p>before <div>Section</div> after</p>" }]);
    const json = JSON.stringify(out);
    expect(json).toContain("Section");
    expect(json).not.toMatch(/<div/i);
  });

  // ★★★ THE WRONG SANITIZER IS NOW sanitizeRichHtml, AND `img` IS THE ONLY INPUT
  // THAT CAN CATCH IT. This test used to pin the choice against sanitizeNoteHtml
  // (KEEP_CONTENT:false, which deleted "Section" outright); that sanitizer is
  // retired and the file exports two, differing by exactly one tag — `img`.
  // ★★ `img` is the WORST case of the class, not the mildest, which is what makes
  // it worth pinning: it is VOID, so the wrong sanitizer leaves no text behind and
  // the reference vanishes without a trace. Measured 2026-08-11 on
  // '<p>before <img data-asset-id="7" alt="c"> after</p>':
  //   sanitizeRichHtml     -> "<p>before  after</p>"   (reference GONE)
  //   sanitizeDocumentHtml -> unchanged
  it("proves the sanitizer choice is load-bearing: sanitizeRichHtml would have dropped the img", () => {
    const raw = '<p>before <img data-asset-id="7" alt="c"> after</p>';
    // The wrong sanitizer drops the void element outright...
    expect(sanitizeRichHtml(raw)).not.toContain("<img");
    expect(sanitizeRichHtml(raw)).toContain("before"); // anti-vacuity: not simply emptied
    // ...while sanitizeAiDocBlocks (sanitizeDocumentHtml) keeps it.
    const out = sanitizeAiDocBlocks([{ type: "paragraph", html: raw }]);
    expect(JSON.stringify(out)).toContain("<img");
  });

  it("upgrades plain text the model sent instead of HTML", () => {
    const out = sanitizeAiDocBlocks([{ type: "paragraph", html: "just words" }]);
    expect(out[0]).toMatchObject({ type: "paragraph" });
    expect(JSON.stringify(out)).toContain("just words");
  });

  it("does not crash on a paragraph block missing its html field, and drops the resulting empty paragraph", () => {
    expect(sanitizeAiDocBlocks([{ type: "paragraph" }])).toEqual([]);
  });

  it("drops an unknown block type", () => {
    expect(sanitizeAiDocBlocks([{ type: "video", src: "x" }])).toEqual([]);
  });

  it("returns [] for a non-array", () => {
    expect(sanitizeAiDocBlocks("nope")).toEqual([]);
    expect(sanitizeAiDocBlocks(undefined)).toEqual([]);
  });

  it("skips null/primitive entries inside an otherwise-valid array", () => {
    const out = sanitizeAiDocBlocks([null, 5, "str", { type: "paragraph", html: "<p>hi</p>" }]);
    expect(out).toEqual([{ type: "paragraph", html: "<p>hi</p>" }]);
  });

  // ★ Precise, not a shape check: level 9 is out of the 1|2|3 union, and READING
  // document-model.ts shows sanitizeBlock CLAMPS it (Math.min(3, Math.max(1, n)))
  // rather than dropping the block. A vague "length <= 1" assertion would pass
  // whether the block survived clamped OR was dropped — this pins the actual
  // behaviour.
  it("clamps an out-of-range heading level via the structural sanitizer, rather than dropping the block", () => {
    const out = sanitizeAiDocBlocks([{ type: "heading", level: 9, text: "x" }]);
    expect(out).toEqual([{ type: "heading", level: 3, text: "x" }]);
  });

  // ★★ `mark` USED TO BE document-only, so this pinned that the write boundary
  // routes through sanitizeDocumentHtml specifically — not merely through "some
  // sanitizer". DOCUMENT_ALLOWED_TAGS now spreads RICH_ALLOWED_TAGS, so <mark> is
  // on BOTH and this no longer separates the two sanitizers; the test that does is
  // the `img` one above. What survives here is still worth pinning: a model may
  // store a mark AND a script must still go, in the same call.
  // ★★ Assert the CLOSING bracket and the inner text (`<mark>keep</mark>`), never
  // the `<mark` prefix: a prefix is satisfied by any longer tag name that shares
  // it, and that shape has already been caught passing while the thing it claimed
  // to pin was gone. The paired `<script` negative is a prefix on purpose — there
  // it is the WEAKER (broader) form that is wanted.
  it("lets a model store the document marks but still strips a script", () => {
    const blocks = sanitizeAiDocBlocks([
      { type: "paragraph", html: "<p><mark>keep</mark></p>" },
      { type: "paragraph", html: "<p><script>alert(1)</script>text</p>" },
    ]);
    // Anti-vacuity: without this, a dropped first block would shift the indices
    // and silently retarget both assertions below.
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
    expect((blocks[0] as { html: string }).html).toContain("<mark>keep</mark>");
    expect((blocks[1] as { html: string }).html).not.toContain("<script");
    // Positive observable: proves block 1 survived with its text rather than
    // passing because the whole block was emptied away.
    expect((blocks[1] as { html: string }).html).toContain("text");
  });

  it("preserves block order across a mix of paragraph and non-paragraph blocks", () => {
    const out = sanitizeAiDocBlocks([
      { type: "heading", level: 2, text: "Title" },
      { type: "paragraph", html: "<p>body</p>" },
    ]);
    expect(out).toEqual([
      { type: "heading", level: 2, text: "Title" },
      { type: "paragraph", html: "<p>body</p>" },
    ]);
  });
});
