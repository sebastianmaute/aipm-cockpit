import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendDictationToHtml,
  descriptionText,
  descriptionTextWithBreaks,
} from "./rich-text-projection";

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

  // ★★★ The user-visible half of the HTML_START termination bug. A legacy plain
  // value that merely STARTS tag-shaped was passed through raw; the tokenizer
  // discards an incomplete tag at EOF, so descriptionText — the value every
  // non-DOM consumer reads, i.e. global search, the export sections and the AI
  // digests — returned "" for the whole thing. sanitizeRichText meanwhile
  // measured a non-zero length and KEPT the field, so nothing anywhere reported
  // a problem. Measured before the fix: "<li 3 items" -> "", "<p ok" -> "".
  it("does not swallow a plain value that starts tag-shaped but never closes", () => {
    expect(descriptionText("<li 3 items")).toBe("<li 3 items");
    expect(descriptionText("<p ok")).toBe("<p ok");
    expect(descriptionText("<em dash - not markup")).toBe("<em dash - not markup");
  });

  // ★ PINNED RESIDUE, not an aspiration: this one is genuinely tag-shaped AND
  // terminated, so the opening-tag heuristic cannot tell it from real markup and
  // the sink eats the "<a href>". Asserted so that a future change to HTML_START
  // has to confront it deliberately rather than shift it by accident.
  it("still loses a leading token that is tag-shaped AND closed", () => {
    expect(descriptionText("<a href> tags are banned")).toBe("tags are banned");
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

describe("descriptionTextWithBreaks", () => {
  it("keeps paragraph boundaries as newlines", () => {
    expect(descriptionTextWithBreaks("<p>Vendor delay</p><p>Mitigation plan</p>")).toBe(
      "Vendor delay\nMitigation plan",
    );
  });

  it("upgrades a legacy plain value the same way descriptionText does", () => {
    // descriptionHtml turns a legacy newline into <br>, which is a real boundary.
    expect(descriptionTextWithBreaks("line one\nline two")).toBe("line one\nline two");
  });

  it("still sanitizes — a script tag survives neither projection", () => {
    const stored = "<p>ok</p><script>alert(1)</script>";
    expect(descriptionTextWithBreaks(stored)).not.toContain("alert");
    expect(descriptionTextWithBreaks(stored)).not.toContain("<");
  });

  it("differs from descriptionText ONLY in the boundary character", () => {
    const stored = "<p>a</p><p>b</p>";
    expect(descriptionText(stored)).toBe("a b");
    expect(descriptionTextWithBreaks(stored)).toBe("a\nb");
  });

  it("returns empty for an empty value", () => {
    expect(descriptionTextWithBreaks(undefined)).toBe("");
    expect(descriptionTextWithBreaks("")).toBe("");
  });
});

describe("description consumers use the correct projection", () => {
  const SITES = [
    "workspace-context.tsx",
    "gantt.tsx",
    "task-row.tsx",
    "task-dedup/dedup.ts",
    "jira-api.ts",
    // ★ The SIXTH consumer, added later in the same release: the dedup modal
    // rendered `unified.description` (sanitizeNoteHtml output) raw as text. A
    // hardcoded snapshot list goes stale the moment the branch that owns it finds
    // another consumer — if you convert a seventh, add it here in that commit.
    "task-dedup-modal.tsx",
  ];

  it("never projects a description with bare htmlToText", () => {
    // ★★ htmlToText strips tags leaving NOTHING in their place, so
    // "<p>a</p><p>b</p>" fuses to "ab". These five read Task.description; every
    // one of them must go through descriptionText, which runs
    // separateBlockBoundaries first.
    //
    // ★ note-log-panel.tsx and note-log.ts also call htmlToText and are CORRECT
    // — they operate on note HTML, not descriptions. They are deliberately not
    // in this list.
    //
    // ★ The scan catches MULTI-LINE calls too: `[^)]` matches a newline, and it
    // cannot run past the call's own closing paren, so an unrelated
    // `htmlToText(noteHtml)` earlier in the file cannot reach a later
    // `.description` and false-positive. Verified both directions.
    for (const site of SITES) {
      const src = readFileSync(join(import.meta.dirname, site), "utf8");
      expect({ site, hit: /htmlToText\([^)]*\.description/.test(src) }).toEqual({
        site,
        hit: false,
      });
    }
  });
});
