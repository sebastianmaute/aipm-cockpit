import { describe, it, expect } from "vitest";
import { sanitizeAiRichText } from "./ai-rich-text";

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
    // ★★★ This is why the boundary uses sanitizeTemplateHtml and NOT
    // sanitizeNoteHtml. sanitizeNoteHtml sets KEEP_CONTENT:false, which deletes a
    // disallowed tag's TEXT along with the tag — right for the editor (its schema
    // can only emit the lean set) and WRONG here, because a model legitimately
    // emits <h3>/<div>/<table> and the user's words would vanish silently. That
    // is the data-loss class this release exists to fix, so the boundary must not
    // introduce a fresh instance of it.
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
});
