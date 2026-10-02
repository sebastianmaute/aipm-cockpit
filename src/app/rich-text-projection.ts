// src/app/rich-text-projection.ts
//
// BROWSER-ONLY half of the rich-text description layer: everything here goes
// through DOMPurify (htmlToText), so it must NEVER be imported by a codec, an
// entity sanitizer, or anything else that can run under bare node. The DOM-free
// half is rich-text-plain.ts.
//
// Every non-DOM consumer of a rich description — global search, the export
// section builders, the AI entity digests, the inline-AI plan preview — reads
// its value through descriptionText. DOM consumers use RichTextView.
import { htmlToText, plainToHtml, sanitizeRichHtml } from "./sanitize-html";
import { appendDictation } from "./dictation-engine";
import {
  descriptionHtml,
  htmlPlainProjection,
  markTaskItems,
  separateBlockBoundaries,
} from "./rich-text-plain";
import { PROJECTION_SINK, RICH_SINK } from "./html-start";

/** Stored value -> plain text, upgrading a legacy plain value on the way so a
 *  never-edited record projects identically to an edited one.
 *
 *  ★ htmlToText SANITIZES but returns SERIALIZED html — DOMPurify hands back
 *  `body.innerHTML`, so a text node still carries its `&amp;`/`&lt;` escapes.
 *  htmlPlainProjection then decodes them (it is entity-decode + whitespace only
 *  once the tags are already gone, so it cannot re-introduce markup). Dropping
 *  either half is wrong: without htmlToText this stops being sanitized, without
 *  the projection every consumer gets escaping artefacts in its plain text.
 *
 *  ★★ separateBlockBoundaries must run FIRST. htmlToText strips tags with
 *  nothing in their place, so by the time htmlPlainProjection sees the value the
 *  boundary is already gone and "<p>a</p><p>b</p>" has become "ab".
 *
 *  ★★ separateBlockBoundaries is safe ONLY IN FRONT OF A STRIP-EVERYTHING PASS.
 *  Deleting a <p> mid-token can re-splice the markup around it — "<a hre<p>f=..."
 *  becomes "<a hre f=..." — which is harmless here only because htmlToText
 *  strips ALL tags and returns text, so no re-spliced tag survives. Composed in
 *  front of sanitizeRichHtml, which preserves an allow-list, the reasoning
 *  breaks. The old rationale ("never removes a script/style tag, so DOMPurify
 *  still sees every element") was right about the outcome and wrong about why.
 *  ★ descriptionTextWithBreaks below is a SECOND caller and satisfies the same
 *  precondition — it too composes in front of htmlToText. */
export function descriptionText(stored: string | undefined): string {
  return htmlPlainProjection(
    htmlToText(separateBlockBoundaries(markTaskItems(descriptionHtml(stored, PROJECTION_SINK)))),
  );
}

/** Stored value -> plain text with block boundaries kept as newlines.
 *
 *  The EXPORT projection. Search, the AI digests and the inline-AI preview keep
 *  descriptionText's collapsed form — they want whitespace flattened — while an
 *  export is read by a human and a three-paragraph description must not arrive
 *  as one run-on line.
 *
 *  ★★ separateBlockBoundaries runs FIRST here for the same reason it does in
 *  descriptionText: htmlToText deletes tags leaving nothing in their place, so
 *  the newline has to be in the string before DOMPurify sees it. Only the
 *  separator differs.
 *
 *  ★★★ ALL THREE calls need the break flag, and the middle one is the easy
 *  miss: htmlToText's DEFAULT collapse is `\s+` -> " ", which flattens the very
 *  newline separateBlockBoundaries just inserted. Passing the separator without
 *  it produces the collapsed form silently — the boundary is destroyed between
 *  the two functions that were told to keep it. */
export function descriptionTextWithBreaks(stored: string | undefined): string {
  return htmlPlainProjection(
    htmlToText(separateBlockBoundaries(markTaskItems(descriptionHtml(stored, PROJECTION_SINK)), "\n"), {
      preserveBreaks: true,
    }),
    { preserveBreaks: true },
  );
}

/** Block elements a dictated run joins at the END of. Anything else (inline
 *  marks, links) is walked OUT of, so dictated words never inherit bold, italic
 *  or a link target. */
const DICTATION_BLOCKS = new Set(["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "DIV"]);

/** Append a dictated utterance to a rich field, KEEPING its formatting (§16).
 *
 *  ★★★ Web Speech fires `onFinal` SEVERAL TIMES PER HOLD, and each segment must
 *  JOIN the previous one, never replace it. This used to be done by flattening
 *  the field to plain text, joining there, and re-wrapping — which joined
 *  correctly and discarded every bold, italic, list and link already in the
 *  field. Now the join happens in the HTML: the segment becomes a new PLAIN text
 *  node at the end of the block that holds the field's last text, outside any
 *  inline mark. The next segment finds that node as the last text and joins the
 *  same run, so the multi-`onFinal` behaviour is unchanged and nothing else in
 *  the field is touched. A field with no text gets a fresh `<p>`.
 *  ★ The separator rule is `appendDictation`'s (one space unless the existing
 *  text already ends in whitespace). The result is re-sanitised, so a stored
 *  value carrying anything the allow-list drops cannot ride through. */
export function appendDictationToHtml(html: string | undefined, txt: string): string {
  const seg = txt.trim();
  const current = descriptionHtml(html, RICH_SINK);
  if (!seg) return current;
  if (!current.trim()) return plainToHtml(seg);
  const doc = new DOMParser().parseFromString(`<body>${current}</body>`, "text/html");
  const body = doc.body;
  let last: Text | null = null;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.nodeValue ?? "").trim()) last = n as Text;
  }
  if (!last) {
    const p = doc.createElement("p");
    p.textContent = seg;
    body.appendChild(p);
    return sanitizeRichHtml(body.innerHTML);
  }
  let block: Element | null = last.parentElement;
  while (block && block !== body && !DICTATION_BLOCKS.has(block.tagName)) block = block.parentElement;
  const host: Element = block ?? body;
  const joined = appendDictation(host.textContent ?? "", seg);
  // Only the ADDED tail is inserted; `appendDictation` decides the separator.
  host.appendChild(doc.createTextNode(joined.slice((host.textContent ?? "").length)));
  return sanitizeRichHtml(body.innerHTML);
}
