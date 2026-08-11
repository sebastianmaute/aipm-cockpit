import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
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

  // ★★★ The user-visible half of the termination bug in the retired shared
  // `HTML_START` — `htmlStartRe`'s `[^>]*>` now demands the close. A legacy plain
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
  // the sink eats the "<a href>". html-start.ts records it as deliberate residue;
  // asserted here so that a future change to the classifier has to confront it
  // rather than shift it by accident.
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
    // rendered `unified.description` (sanitizeRichHtml output) raw as text. A
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

  it("lets ONLY the note-HTML modules call htmlToText at all", () => {
    // ★★★ INVERTED, and that is the point. The snapshot above answers "are these
    // six clean?", which is the hand-list shape this same release replaced in
    // rich-text-plain.test.ts ("a guard naming one module by hand goes stale the
    // moment a second one appears") — and the sixth consumer being found
    // mid-release is the evidence. It is also defeated by a legal spelling:
    // `const d = task.description; htmlToText(d)` has no `.description` inside the
    // call, and a SEVENTH consumer anywhere in src/app is not scanned at all.
    //
    // This asks the answerable question instead: WHO may call htmlToText? Only the
    // note-log modules (a different field family with its own model) and the
    // projection module that wraps it. Any other caller — however it spells its
    // argument — shows up here and has to justify itself or use descriptionText.
    const ALLOWED = new Set([
      "note-log-panel.tsx", // composer/edit body — note HTML, not a description
      "note-log.ts", //        the note model's own text projection
      "rich-text-projection.ts", // the wrapper every description consumer uses
      "sanitize-html.ts", //   where htmlToText is defined
    ]);
    const appDir = import.meta.dirname;
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        // Comments may DISCUSS htmlToText freely — only code counts.
        const code = readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        if (/\bhtmlToText\s*\(/.test(code) && !ALLOWED.has(entry.name)) {
          callers.push(full.replace(/\\/g, "/").split("/src/app/")[1] ?? entry.name);
        }
      }
    };
    walk(appDir);
    expect(callers.sort()).toEqual([]);
  });
});

describe("projection classifies at the widest list", () => {
  it("does not emit literal markup for a value leading with a heading", () => {
    // Before the split this projected to the visible text "<h1>Title</h1><p>body</p>"
    // — into search results, the AI digests, and every DOCX/PPTX/XLSX/PDF export.
    expect(descriptionText("<h1>Title</h1><p>body</p>")).toBe("Title body");
  });

  it("does not emit literal markup for a document-only leading tag", () => {
    expect(descriptionText("<blockquote>quoted</blockquote>")).toBe("quoted");
  });

  it("keeps the export projection's block boundary as a newline", () => {
    expect(descriptionTextWithBreaks("<h1>Title</h1><p>body</p>")).toBe("Title\nbody");
  });

  it("still escapes and projects genuine plain text unchanged", () => {
    expect(descriptionText("cost < 5k")).toBe("cost < 5k");
  });
});
