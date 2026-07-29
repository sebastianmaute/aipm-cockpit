import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  capHtmlText,
  descriptionHtml,
  htmlPlainProjection,
  htmlTextLength,
  sanitizeRichText,
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

  it("never reaches a DOM-dependent sanitiser from code", () => {
    expect(code).not.toMatch(/dompurify/i);
    expect(code).not.toMatch(/htmlToText/);
    expect(code).not.toMatch(/sanitizeNoteHtml/);
    expect(code).not.toMatch(/sanitizeTemplateHtml/);
  });
});
