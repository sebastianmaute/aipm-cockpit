// @vitest-environment jsdom
// TEMPORARY reviewer probe — delete before reporting.
import { describe, it, expect } from "vitest";
import {
  RICH_ALLOWED_TAGS,
  DOCUMENT_ALLOWED_TAGS,
  sanitizeRichHtml,
  sanitizeDocumentHtml,
  sanitizeNoteHtml,
} from "./sanitize-html";
import { isHtmlStart, SINK_TAGS } from "./html-start";

// A broad universe of tag names: every allow-list member plus plausible others.
const UNIVERSE = [
  ...new Set([
    ...RICH_ALLOWED_TAGS,
    ...DOCUMENT_ALLOWED_TAGS,
    "div", "span", "table", "tr", "td", "th", "tbody", "thead", "section", "article",
    "h5", "h6", "figure", "figcaption", "dl", "dt", "dd", "small", "big", "b", "i",
    "font", "center", "form", "input", "button", "iframe", "style", "script", "svg",
    "img", "video", "audio", "canvas", "abbr", "cite", "q", "kbd", "samp", "var",
    "time", "data", "output", "progress", "meter", "details", "summary", "main",
    "aside", "nav", "header", "footer", "address", "caption", "col", "colgroup",
  ]),
];

/** Does the sanitizer KEEP this tag as markup (i.e. the tag itself survives)? */
function keptAsMarkup(fn: (s: string) => string, tag: string): boolean {
  const out = fn(`<${tag}>x</${tag}>`);
  return new RegExp(`<${tag}[\\s>/]`, "i").test(out);
}

function report(name: string, fn: (s: string) => string, sink: "rich" | "document" | "projection") {
  const kept: string[] = [];
  const recognised: string[] = [];
  for (const tag of UNIVERSE) {
    if (keptAsMarkup(fn, tag)) kept.push(tag);
    if (isHtmlStart(`<${tag}>x</${tag}>`, sink)) recognised.push(tag);
  }
  const keptNotRecognised = kept.filter((t) => !recognised.includes(t));
  const recognisedNotKept = recognised.filter((t) => !kept.includes(t));
  // eslint-disable-next-line no-console
  console.log(
    `\n[${name} / sink=${sink}] kept=${kept.length} recognised=${recognised.length}` +
      `\n  KEPT-BUT-NOT-RECOGNISED (the CRITICAL direction): ${JSON.stringify(keptNotRecognised)}` +
      `\n  RECOGNISED-BUT-NOT-KEPT: ${JSON.stringify(recognisedNotKept)}`,
  );
  return { keptNotRecognised, recognisedNotKept };
}

describe("reviewer probe", () => {
  it("classifier vs sink", () => {
    const rich = report("sanitizeRichHtml", sanitizeRichHtml, "rich");
    const doc = report("sanitizeDocumentHtml", sanitizeDocumentHtml, "document");
    const proj = report("sanitizeDocumentHtml", sanitizeDocumentHtml, "projection");
    // eslint-disable-next-line no-console
    console.log(
      `\nCOUNTS: RICH=${RICH_ALLOWED_TAGS.length} DOCUMENT=${DOCUMENT_ALLOWED_TAGS.length} ` +
        `SINK_TAGS.projection=${SINK_TAGS.projection.length}`,
    );
    // What would happen if a call site classified with "rich" but sanitized with
    // sanitizeNoteHtml (the KEEP_CONTENT:false sink still live at ~12 call sites)?
    const lost: string[] = [];
    for (const tag of RICH_ALLOWED_TAGS) {
      const value = `<${tag}>WORD</${tag}>`;
      if (isHtmlStart(value, "rich") && !sanitizeNoteHtml(value).includes("WORD")) lost.push(tag);
    }
    // eslint-disable-next-line no-console
    console.log(`\nrich-classifier + sanitizeNoteHtml => WORD DELETED for: ${JSON.stringify(lost)}`);
    expect(rich.keptNotRecognised.length + doc.keptNotRecognised.length + proj.keptNotRecognised.length).toBe(-1);
  });
});
