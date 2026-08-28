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

describe("task-item state in the plain-text projections (§140)", () => {
  const TASKS =
    '<ul data-type="taskList">' +
    '<li data-type="taskItem" data-checked="true"><p>done thing</p></li>' +
    '<li data-type="taskItem" data-checked="false"><p>open thing</p></li>' +
    "</ul>";

  it("marks task state in the flat export projection", () => {
    const out = descriptionTextWithBreaks(TASKS);
    expect(out).toContain("[x] done thing");
    expect(out).toContain("[ ] open thing");
  });

  it("marks task state in the search/AI projection too — one implementation", () => {
    const out = descriptionText(TASKS);
    expect(out).toContain("[x] done thing");
    expect(out).toContain("[ ] open thing");
  });

  it("leaves non-task HTML byte-identical", () => {
    expect(descriptionText("<p>plain</p><p>text</p>")).toBe("plain text");
  });
});

// ★★★ THE PROOF OBLIGATION THE `[^<>]*` CHANGE RESTS ON. `htmlToText` runs
// DOMPurify with ALLOWED_TAGS: [] and ALLOWED_ATTR: [], and both projections
// here call htmlPlainProjection on its OUTPUT — so no tag and no attribute
// value survives to that point, and a `<` can only arrive as `&lt;`. That makes
// bounding TAG/BLOCK_TAG a provable no-op for search, exports, the AI digests,
// Jira and dedup, which is why those callers need no per-site audit.
//
// ★★ THE POSITIVE CONTROL IS THE HALF THAT MATTERS. Asserting only "no raw <"
// passes just as well if descriptionText returned "" for everything — the
// control proves the pipeline actually carried text through.
describe("the export path never hands htmlPlainProjection a raw <", () => {
  const HOSTILE = [
    '<p>a<b</p>',
    '<img alt="a<b" data-asset-id="real">',
    '<p title="x<y">visible</p>',
    "<p>" + "<a".repeat(50) + "</p>",
    '<p>cost < 5k and rising</p>',
  ];

  it("leaves no bare < in the projected text, and still carries text through", () => {
    // Positive control FIRST: an ordinary value must survive with its text.
    expect(descriptionText("<p>ordinary <strong>text</strong> here</p>")).toBe(
      "ordinary text here",
    );

    for (const html of HOSTILE) {
      for (const out of [descriptionText(html), descriptionTextWithBreaks(html)]) {
        // A `<` may legitimately appear as literal prose ("cost < 5k"), which is
        // the whole point of the last fixture — what must never appear is a `<`
        // that is still acting as a TAG OPENER, i.e. followed by a letter or /.
        expect(/<[a-zA-Z/]/.test(out)).toBe(false);
      }
    }
  });

  // ★★★ THE CONTROL ABOVE IS ON A DIFFERENT INPUT FROM THE HOSTILE FIVE, WHICH
  // IS THE HOLE THIS CLOSES. Mutate `descriptionText` to return "" for any input
  // containing a bare `<` and every assertion above still passes: the control
  // has no bare `<` so it is unaffected, and `/<[a-zA-Z/]/.test("")` is false,
  // so all ten absence checks pass over empty strings. An absence assertion
  // needs a per-input positive observable, not a neighbouring one.
  it("carries the hostile inputs' own text through, not just an empty string", () => {
    // The `<` here is real prose and must SURVIVE as prose — this is the one
    // fixture that proves the pipeline is not simply deleting everything.
    expect(descriptionText("<p>cost < 5k and rising</p>")).toBe("cost < 5k and rising");

    // ★★ Per-fixture EXPECTED values, not a "non-empty" heuristic. The first cut
    // asserted `length > 0` for everything but the image fixture and went red:
    // a run of unterminated `<a` openers is ALL markup and correctly projects
    // nothing, so the heuristic mistook a legitimate empty for a failure. Two
    // fixtures here are supposed to be empty and two are not, and only naming
    // each one says which.
    expect(descriptionText("<p>a<b</p>")).toBe("a");
    expect(descriptionText('<p title="x<y">visible</p>')).toBe("visible");
    // Empty BY DESIGN — asserted so a future change that starts leaking markup
    // here is visible rather than silently widening the "no bare <" check.
    expect(descriptionText('<img alt="a<b" data-asset-id="real">')).toBe("");
    expect(descriptionText("<p>" + "<a".repeat(50) + "</p>")).toBe("");
  });
});
