import { describe, it, expect } from "vitest";
import { sanitizeDocumentRichFields } from "./document-rich-fields";
import type { DocBlock, ProjectDocument } from "./document-model";

const base: ProjectDocument = {
  id: 1,
  title: "Doc",
  blocks: [],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

/** The blocks are `readonly DocBlock[]`, so every assertion has to narrow. */
function htmlOf(block: DocBlock): string {
  if (block.type !== "paragraph") throw new Error(`expected a paragraph, got ${block.type}`);
  return block.html;
}

describe("sanitizeDocumentRichFields", () => {
  it("strips a script tag from a paragraph", () => {
    const out = sanitizeDocumentRichFields({
      ...base,
      blocks: [{ type: "paragraph", html: "<p>ok</p><script>alert(1)</script>" }],
    });
    expect(htmlOf(out.blocks[0])).not.toMatch(/script/i);
    expect(htmlOf(out.blocks[0])).toMatch(/ok/);
  });

  it("KEEPS the text inside a heading tag a model legitimately emits", () => {
    // ★★ This is the sanitizeTemplateHtml-vs-sanitizeNoteHtml distinction, and it
    // is the only test that can see it. `h3` is in NEITHER allow-list, so both
    // sanitizers delete the TAG; only KEEP_CONTENT decides whether the WORDS
    // survive. sanitizeNoteHtml sets KEEP_CONTENT:false and would leave "".
    // Mutation-proved: swapping the import turns this red and nothing else.
    const out = sanitizeDocumentRichFields({
      ...base,
      blocks: [{ type: "paragraph", html: "<h3>Section</h3>" }],
    });
    expect(htmlOf(out.blocks[0])).toMatch(/Section/);
  });

  it("drops a javascript: href, proving the allow-list is live and not a pass-through", () => {
    const out = sanitizeDocumentRichFields({
      ...base,
      blocks: [
        {
          type: "paragraph",
          html: '<p><a href="javascript:alert(1)">x</a><a href="https://ok.example">y</a></p>',
        },
      ],
    });
    const html = htmlOf(out.blocks[0]);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain("https://ok.example");
  });

  it("leaves non-paragraph blocks untouched", () => {
    const blocks: DocBlock[] = [
      { type: "heading", level: 1, text: "T" },
      { type: "pageBreak" },
    ];
    expect(sanitizeDocumentRichFields({ ...base, blocks }).blocks).toEqual(blocks);
  });

  it("returns the SAME document object when nothing needed cleaning", () => {
    // ★ Covers the `html === b.html` arm — a paragraph the sanitizer leaves byte
    // -identical must not fabricate a new doc/block identity, or every load
    // boundary would churn references (and defeat any downstream memo).
    const doc: ProjectDocument = {
      ...base,
      blocks: [{ type: "paragraph", html: "<p>already clean</p>" }, { type: "pageBreak" }],
    };
    const out = sanitizeDocumentRichFields(doc);
    expect(out).toBe(doc);
    expect(out.blocks[0]).toBe(doc.blocks[0]);
  });

  it("keeps the identity of clean siblings while replacing only the dirty block", () => {
    const clean: DocBlock = { type: "paragraph", html: "<p>fine</p>" };
    const doc: ProjectDocument = {
      ...base,
      blocks: [clean, { type: "paragraph", html: "<p>bad</p><script>alert(1)</script>" }],
    };
    const out = sanitizeDocumentRichFields(doc);
    expect(out).not.toBe(doc);
    expect(out.blocks[0]).toBe(clean);
    expect(htmlOf(out.blocks[1])).not.toMatch(/script/i);
  });

  it("survives being used directly as a .map callback", () => {
    // ★ .map passes (value, index, array). A second parameter would be fed 0,1,2…
    const docs = [base, { ...base, id: 2 }];
    expect(docs.map(sanitizeDocumentRichFields)).toHaveLength(2);
    expect(docs.map(sanitizeDocumentRichFields)[1].id).toBe(2);
  });

  it("takes exactly one declared parameter", () => {
    // ★★ The .map test above passes even for a (doc, fields) signature — `.map`
    // would just feed it 0, 1, 2… and it would normalise nothing while every
    // assertion stayed green. `.length` is the only thing that actually pins it.
    expect(sanitizeDocumentRichFields).toHaveLength(1);
  });
});
