import { describe, it, expect } from "vitest";
import { AI_RICH_FIELDS, sanitizeAiRichText, withAiRichFields } from "./ai-rich-text";

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
