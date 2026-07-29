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
import { descriptionHtml, htmlPlainProjection } from "./rich-text-plain";

/** Stored value -> plain text, upgrading a legacy plain value on the way so a
 *  never-edited record projects identically to an edited one.
 *
 *  ★ htmlToText SANITIZES but returns SERIALIZED html — DOMPurify hands back
 *  `body.innerHTML`, so a text node still carries its `&amp;`/`&lt;` escapes.
 *  htmlPlainProjection then decodes them (it is entity-decode + whitespace only
 *  once the tags are already gone, so it cannot re-introduce markup). Dropping
 *  either half is wrong: without htmlToText this stops being sanitized, without
 *  the projection every consumer gets escaping artefacts in its plain text. */
export function descriptionText(stored: string | undefined): string {
  return htmlPlainProjection(htmlToText(descriptionHtml(stored)));
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
