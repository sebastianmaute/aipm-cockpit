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
import { htmlToText, plainToHtml } from "./sanitize-html";
import { appendDictation } from "./dictation-engine";
import {
  descriptionHtml,
  htmlPlainProjection,
  markTaskItems,
  separateBlockBoundaries,
} from "./rich-text-plain";
import { PROJECTION_SINK } from "./html-start";

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

/** Append a dictated utterance to a rich field.
 *
 *  ★ Round-tripping through text is what lets appendDictation join mid-utterance
 *  segments (Web Speech fires onFinal repeatedly per hold). The cost is that any
 *  existing bold/italic/list formatting in the field is FLATTENED on dictation —
 *  shipped behaviour on Task.description since 0.196.0, carried forward here so
 *  all six rich fields behave identically. Fixing it needs per-utterance segment
 *  tracking; see docs/open-followups.md. */
export function appendDictationToHtml(html: string | undefined, txt: string): string {
  return plainToHtml(appendDictation(descriptionText(html), txt));
}
