import { describe, expect, it } from "vitest";
import { appendDictationToHtml, descriptionText } from "./rich-text-projection";

describe("descriptionText", () => {
  it("projects stored HTML to plain text", () => {
    expect(descriptionText("<p>cost <strong>up</strong></p>")).toBe("cost up");
  });

  it("projects a legacy plain value without escaping artefacts", () => {
    // ★★ The fixture must be TAG-SHAPED. "cost < 5k & rising" cannot prove the
    // legacy upgrade ran: `< 5` never opens a tag (the tokenizer regex needs a
    // letter after `<`) and DOMPurify re-escapes the `&` identically whether or
    // not descriptionHtml touched it, so the value round-trips the same with the
    // upgrade REMOVED. Here the tags are the user's literal TEXT, so the two
    // paths diverge: upgraded, `<b>` is escaped before the sanitizer sees it and
    // decodes back verbatim; unupgraded, the sanitizer reads it as real markup
    // and strips it to "use bold tags".
    expect(descriptionText("use <b>bold</b> tags")).toBe("use <b>bold</b> tags");
    // Kept for the entity-decode half — no "&amp;" artefact reaches a consumer.
    expect(descriptionText("cost < 5k & rising")).toBe("cost < 5k & rising");
  });

  it("sanitizes, it does not merely strip tags", () => {
    // ★★ The module comment claims "dropping either half is wrong", but with
    // fixtures made only of allow-listed markup, htmlPlainProjection alone
    // produces identical output and removing htmlToText fails nothing. A
    // disallowed element whose BODY would otherwise leak is what separates them:
    // DOMPurify deletes script/style CONTENT, the regex projection only unwraps
    // the tags and leaves the code behind as text.
    expect(descriptionText("<p>ok</p><script>bad()</script>")).toBe("ok"); // "ok bad()" without htmlToText
    expect(descriptionText("<p>a</p><style>.x{color:red}</style>")).toBe("a"); // "a .x{color:red}" without it
  });

  it("returns empty for blank input", () => {
    expect(descriptionText(undefined)).toBe("");
  });
});

describe("appendDictationToHtml", () => {
  it("appends dictated text to an existing value", () => {
    expect(appendDictationToHtml("<p>first</p>", "second")).toBe("<p>first second</p>");
  });

  it("starts a value from empty", () => {
    expect(appendDictationToHtml(undefined, "hello")).toBe("<p>hello</p>");
  });

  it("upgrades a legacy plain value before appending", () => {
    expect(appendDictationToHtml("plain & old", "more")).toBe("<p>plain &amp; old more</p>");
  });
});
