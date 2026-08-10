import { describe, it, expect } from "vitest";
import { sanitizeAiDocBlocks } from "./ai-document-blocks";
import { sanitizeNoteHtml } from "./sanitize-html";

describe("sanitizeAiDocBlocks", () => {
  it("strips a script tag from model-authored paragraph HTML", () => {
    const out = sanitizeAiDocBlocks([{ type: "paragraph", html: "<p>hi</p><script>alert(1)</script>" }]);
    expect(JSON.stringify(out)).not.toContain("script");
    expect(JSON.stringify(out)).toContain("hi");
  });

  // ★★★ sanitizeDocumentHtml, NOT sanitizeNoteHtml. Both allow-lists omit h3 —
  // the difference is the TEXT inside it (sanitizeNoteHtml deletes it via
  // KEEP_CONTENT:false; sanitizeDocumentHtml keeps DOMPurify's default, so it
  // unwraps the tag and keeps the text). That
  // distinction only fires when DOMPurify actually SEES the tag as markup —
  // which requires the value to OPEN with a tag this sink keeps. `isHtmlStart`
  // derives the "document" sink's test from DOCUMENT_ALLOWED_TAGS, which has no
  // h3, so a bare "<h3>Section</h3>" does NOT qualify and descriptionHtml
  // (layer 1) treats the whole string as
  // plain text and escapes it before DOMPurify ever runs — the text survives
  // for an unrelated reason and the test would pass even with the wrong
  // sanitizer wired in. Wrapping in a recognised "<p>" forces the string down
  // the real DOMPurify path, so this genuinely exercises the KEEP_CONTENT
  // choice. Proven directly below, not just asserted.
  it("keeps the text inside a non-allow-listed tag nested in real HTML", () => {
    const out = sanitizeAiDocBlocks([{ type: "paragraph", html: "<p>before <h3>Section</h3> after</p>" }]);
    const json = JSON.stringify(out);
    expect(json).toContain("Section");
    expect(json).not.toMatch(/<h3/i);
  });

  it("proves the sanitizer choice is load-bearing: sanitizeNoteHtml would have deleted the same text", () => {
    const raw = "<p>before <h3>Section</h3> after</p>";
    // The wrong sanitizer (KEEP_CONTENT:false) deletes "Section" outright...
    expect(sanitizeNoteHtml(raw)).not.toContain("Section");
    // ...while sanitizeAiDocBlocks (sanitizeDocumentHtml, KEEP_CONTENT default) keeps it.
    const out = sanitizeAiDocBlocks([{ type: "paragraph", html: raw }]);
    expect(JSON.stringify(out)).toContain("Section");
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

  // ★★ `mark` is in the DOCUMENTS allow-list and NOT in the template one, so this
  // pins that the write boundary routes through sanitizeDocumentHtml specifically
  // — not merely through "some sanitizer". The narrow template list unwraps
  // <mark> (KEEP_CONTENT default) leaving the bare word "keep", so a text-only
  // assertion would pass against the unfixed code.
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
