// src/app/document-rich-fields.ts — the DOM-bound allow-list for a document's
// paragraph HTML, run at the whole-object load boundaries that cast verbatim.
//
// ★★ FIVE modules compose it, not the two this header used to name ("jsonToWorkspace
// and the IndexedDB load" — a count that read as exhaustive and was not):
// workspace.ts (JSON) · browser-backend.ts (IndexedDB) · csv-codecs-config.ts ·
// markdown-codecs-core.ts · turso-schema.ts. Each calls it TWICE — once for
// `documents`, once for `documentVersions` — so ten call sites, 2026-08-08.
// ★★ Reproduce with the filtered form, and RUN it rather than deriving a number:
//   grep -rn "sanitizeDocumentRichFields" src/app --include="*.ts" \
//     | grep -v "\.test\." | grep -vE ":\s*(//|\*)" | grep -v ":import"
// → ELEVEN lines: the ten calls plus this file's own `export function`. The two
// trailing filters are not tidiness — without them the same grep returns 27,
// because five `import` lines and eleven PROSE mentions (this header included)
// match the bare name. A count taken from the unfiltered command is wrong by 16.
//
// ★★★ It is a SEPARATE module from document-model.ts on purpose: that module is
// the DOM-FREE structural validator every load path runs, and structural
// validation is a different job from HTML sanitization. Splitting them lets a
// caller run the structure check anywhere and add the allow-list wherever a DOM
// exists. Same split, same reason, as ai-rich-text.ts vs rich-text-plain.ts.
//
// ★★ The split is NOT because a DOMPurify call would throw for want of a DOM.
// That was the old rationale and it is obsolete — the sample generator installs
// JSDOM before its dynamic imports and decodes with `{ strict: true }`. Adding
// this pass to a load path that lacks it is therefore a normal change, not a
// contract violation: compose it at the CALLER, as
// `sanitizeProjectDocuments(raw).map(sanitizeDocumentRichFields)`.
//
// ★★★ `sanitizeDocumentHtml` — NOT `sanitizeRichHtml`. There is now exactly ONE
// wrong swap available (the file exports two sanitizers), and it is far quieter
// than the two it replaced, because the lists differ by a single tag: `img`.
//
//   • The failure is REACH, silently and on the way IN. This module used the
//     since-retired `sanitizeTemplateHtml` until S3a and that narrowed the LOAD
//     boundary below what the render sink allows: a stored `<mark>`/`<s>`/`<code>`
//     was UNWRAPPED ON READ — and the next save persisted the loss — so
//     doc-render-html's wider list never saw one, and its own test ("renders a
//     document paragraph's new marks instead of stripping them") passed over HTML
//     that could no longer reach it. ★★ ONE DOOR OF TWO — a document allow-list
//     has to be applied at the sink AND here, or the pair that looks fixed is not.
//   • Those eight marks are on RICH_ALLOWED_TAGS now, so the surviving swap costs
//     only `img` — and `img` is the WORST case of this class, not the mildest,
//     because it is VOID. An unwrapped `<div>` leaves its words behind; an
//     unwrapped `<img>` leaves nothing at all, so the reference disappears with no
//     trace in the text. Measured 2026-08-11 on
//     `<p>before</p><p><img data-asset-id="7" alt="chart">tail</p>`:
//     sanitizeDocumentHtml returns it unchanged, sanitizeRichHtml returns
//     `<p>before</p><p>tail</p>`.
//
// ★★★ MUTATION-MEASURED 2026-08-11, and the honest number is ZERO: swapping in
// sanitizeRichHtml here left document-rich-fields.test.ts 9/9 GREEN. That is a
// MISSING TEST, not an equivalent mutant — the probe above proves the behaviours
// differ, the suite simply had no `<img>` at this boundary. The earlier counts
// (sanitizeTemplateHtml 1 red, sanitizeNoteHtml 2 red) were true against
// sanitizers that no longer exist; do not carry a count forward across a
// refactor, re-run it. The "keeps an <img> reference at the LOAD boundary" test
// added alongside this note is what now kills the mutant — delete it and the only
// remaining wrong swap goes undetected again.
// `<script>`/`<style>` are removed WITH their contents by both (measured — each
// returns "<p>ok</p>" for `<p>ok</p><script>alert(1)</script><style>b{x:1}</style>`),
// and the shared end-anchored ALLOWED_URI_REGEXP drops a `javascript:` href.

import type { DocBlock, ProjectDocument } from "./document-model";
import { sanitizeDocumentHtml } from "./sanitize-html";

/** Clean the rich (HTML-bearing) fields of one document.
 *
 *  ★★ EXACTLY ONE declared parameter, on purpose: every call site is `.map(fn)`,
 *  and `.map` passes (value, INDEX, array). A `(doc, fields)` signature would be
 *  fed 0, 1, 2… as its field list, normalise nothing, and leave every .map-based
 *  test green. A test pins `.length === 1` because no behavioural assertion can.
 *
 *  ★ Returns the SAME object (and the same block objects) when the allow-list
 *  changed nothing, so a clean load does not churn identities. */
export function sanitizeDocumentRichFields(doc: ProjectDocument): ProjectDocument {
  let changed = false;
  const blocks: DocBlock[] = doc.blocks.map((b) => {
    if (b.type !== "paragraph") return b;
    const html = sanitizeDocumentHtml(b.html);
    if (html === b.html) return b;
    changed = true;
    return { ...b, html };
  });
  return changed ? { ...doc, blocks } : doc;
}
