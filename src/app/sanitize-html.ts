// src/app/sanitize-html.ts — the DOMPurify storage-boundary sanitizers.
// Five exports: three DOMPurify sanitizers — sanitizeTemplateHtml (comm templates,
// meeting reports and the six rich entity description fields), sanitizeDocumentHtml
// (documents only, a wider list) and sanitizeNoteHtml (the lean note/description
// set) — plus htmlToText (the plain-text projection) and plainToHtml (wraps plain
// text as lean HTML, and is deliberately DOM-free; see its own note).
// The template TAG allow-list mirrors the Tiptap editor's schema (the only producer
// of that HTML), so sanitizing the editor output is a defense-in-depth boundary.
// Merge-field tokens ({{field}}) are plain text and pass through untouched.
//
// ★★ The ATTRIBUTE lists below do NOT mirror the editor, and reading them as if
// they did is the trap: `target` and `rel` are listed but can never survive.
// A custom ALLOWED_URI_REGEXP is tested against EVERY attribute value, not only
// URI-bearing ones, and `_blank` / `noopener noreferrer` do not match an
// end-anchored scheme pattern — so both are dropped, and `ADD_ATTR` does not
// bring them back (verified on dompurify 3.4.12). The editor sets them
// (rich-text-editor.tsx `setLink`), so every STORED link opens in the same tab.
// Not a vulnerability — with no `target="_blank"` there is no reverse-tabnabbing
// surface for the missing `rel="noopener"` to expose, so stripping both is safer
// than stripping one. Tracked as `docs/open-followups.md` §38; fixing it rewrites
// stored `<a>` markup and moves the golden fixtures, so it is its own slice.
// Do not "tidy" `target`/`rel` out of the lists: they document the intent, and
// removing them would erase the only pointer to why links behave this way.
import DOMPurify from "dompurify";

const ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "h1", "h2", "ul", "ol", "li", "a"];
const ALLOWED_ATTR = ["href", "target", "rel"];

// SHARED by all three sanitizers below — one literal, so the three cannot drift.
// End-anchored so each storage boundary stays airtight on its own (not just behind
// the editor's isSafeHttpUrl pre-filter): scheme must lead and no angle-brackets/
// quotes may sneak into the value.
// ★ It is tested against EVERY attribute value, not only URI-bearing ones — that is
// why `target`/`rel` can never survive (see the ★★ note above).
const SAFE_URI_REGEXP = /^(?:https?|mailto):[^<>"]*$/i;

export function sanitizeTemplateHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
  });
}

/** Documents-only allow-list. WIDER than ALLOWED_TAGS on purpose, and separate
 *  from it on purpose: sanitizeTemplateHtml also serves comm templates, meeting
 *  reports and the six rich entity fields, so widening THAT list would change
 *  what a model may store everywhere — retroactively, including how already
 *  stored HTML renders. rich-text-editor.tsx records that hazard as the reason
 *  an earlier slice disabled input rules rather than widen a list.
 *
 *  ★★ KEEP_CONTENT stays at DOMPurify's DEFAULT (unwrap, keep the words), NOT
 *  sanitizeNoteHtml's `false`. A document is prose a person will read; losing a
 *  paragraph's text because it was wrapped in an unlisted tag is worse than
 *  losing its formatting.
 *
 *  ★★ `img` carries `data-asset-id` and NO src: an image is referenced by id so
 *  that no IMAGE URI enters stored block HTML (link `href` is deliberately allowed,
 *  so this is not a "no URIs at all" rule). ★★★ SAFE_URI_REGEXP DOES NOT PROTECT
 *  THAT — do not conclude it does when adding `src` in a later slice. DOMPurify's
 *  _isValidAttribute short-circuits BEFORE the regexp for `src`/`href`/`xlink:href`
 *  on a tag in DATA_URI_TAGS, whose default set includes `img`. So the moment `src`
 *  joins the attribute list, `data:image/svg+xml;base64,…` (an XSS vector — SVG
 *  runs script) and `data:text/html;base64,…` pass on `<img>` REGARDLESS of the
 *  https|mailto pattern; only `javascript:` is still dropped. Measured on
 *  dompurify 3.4.13 by adding `src` to the list. A slice that ships image src must
 *  therefore constrain DATA_URI_TAGS/FORBID_ATTR itself.
 *
 *  ★★ ALLOW_DATA_ATTR is FALSE here, and that is what makes DOCUMENT_ALLOWED_ATTR
 *  the gate it reads as. DOMPurify defaults it to TRUE and its `data-*` branch
 *  short-circuits the WHOLE check before the name test, so at the default every
 *  `data-*` survives on every allowed tag and listing `data-asset-id` is a no-op
 *  (measured: removing it from the list gave byte-identical output). With the flag
 *  off, an attacker-authored `data-anything` is dropped by the name test.
 *  ★★★ TURNING THE FLAG OFF IS NOT SUFFICIENT ON ITS OWN — it also drops
 *  `data-asset-id`, and the reason is the trap already described at the top of this
 *  file. Losing the short-circuit puts the attribute into the VALUE chain, where
 *  SAFE_URI_REGEXP is tested against EVERY value, not just URI-bearing ones; an
 *  opaque id fails it exactly as `target="_blank"` does. Measured on dompurify
 *  3.4.13: with the flag off and no other change, `data-asset-id="7"` was stripped
 *  while `data-asset-id="https://x/y"` survived — value-shaped, not name-shaped.
 *  ADD_URI_SAFE_ATTR restores it by exempting that ONE name from the value test
 *  while leaving the name test in force, which is precisely how the neighbouring
 *  `alt` already survives (it is in DOMPurify's DEFAULT_URI_SAFE_ATTRIBUTES). The
 *  id is an opaque asset key, never a URI, so there is nothing for the value test
 *  to protect. Net effect vs. the default: strictly tighter — every other `data-*`
 *  lost its value-check bypass AND now has to be on the list.
 *  ★ Both options are needed; deleting either one silently changes behaviour in a
 *  different direction (drop ALLOW_DATA_ATTR:false → anything goes; drop
 *  ADD_URI_SAFE_ATTR → the real attribute is stripped). Tests pin both.
 *  Scoped to documents on purpose — the other three sanitizers keep the default
 *  and have other consumers.
 *
 *  `img` is inert until S3c ships the asset store; allow-listed here so stored
 *  markup written by a later slice is never retroactively stripped by this one. */
const DOCUMENT_ALLOWED_TAGS = [
  ...ALLOWED_TAGS,
  "s",
  "code",
  "pre",
  "blockquote",
  "hr",
  "mark",
  "sub",
  "sup",
  "img",
];
const DOCUMENT_ALLOWED_ATTR = [...ALLOWED_ATTR, "data-asset-id", "alt"];

export function sanitizeDocumentHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: DOCUMENT_ALLOWED_TAGS,
    ALLOWED_ATTR: DOCUMENT_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ADD_URI_SAFE_ATTR: ["data-asset-id"],
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
  });
}

// ★ narrative-html.ts's HTML_START mirrors this list (minus "#text"): it decides
// whether a stored narrative is already HTML, and recognising a tag THIS list
// omits means the sink below deletes the element and its text. Edit both together.
const NOTE_ALLOWED_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li", "a", "#text"];
const NOTE_ALLOWED_ATTR = ["href", "target", "rel"];

/** Storage-boundary sanitizer for task Description + note-log HTML (lean set:
 *  bold/italic/lists/links). Mirrors the Tiptap editor schema. */
export function sanitizeNoteHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: NOTE_ALLOWED_TAGS,
    ALLOWED_ATTR: NOTE_ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
    // Drop the TEXT of a disallowed block too (not just the tag) — DOMPurify's
    // default unwraps an unknown element but keeps its inner text, which would
    // leak a stray heading/table body into the lean note body.
    KEEP_CONTENT: false,
  });
}

/** Wrap plain text as sanitized lean HTML for the rich `description`/note body.
 *  Escapes &<>, converts newlines to <br>, wraps in a single <p>. Empty→"".
 *  The escape neutralizes every HTML metacharacter, so the only tags in the
 *  result are the <p>/<br> added here — both in the note allow-list — which makes
 *  a DOMPurify pass a provable no-op. Skipping it keeps this function SSR-safe:
 *  DOMPurify needs a DOM/`window` (absent during Next server render), and this is
 *  called at module-eval time by the built-in templates. */
export function plainToHtml(text: string): string {
  if (!text) return "";
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return "<p>" + esc.replace(/\r?\n/g, "<br>") + "</p>";
}

/** Plain-text projection of sanitized HTML — for search/export/preview cells.
 *
 *  ★★ `preserveBreaks` is OPT-IN and the default path is byte-identical. It
 *  exists because the DEFAULT collapse (`\s+` -> " ") destroys a newline that a
 *  caller put in DELIBERATELY: descriptionTextWithBreaks separates block
 *  boundaries with "\n" BEFORE sanitizing (it must — DOMPurify with
 *  ALLOWED_TAGS:[] deletes tags leaving nothing in their place, so the boundary
 *  has to already be in the string), and the default collapse then flattened
 *  every one of them back to a space. Break mode collapses a run CONTAINING a
 *  newline to one "\n" and a purely horizontal run to one " ", the same shape
 *  htmlPlainProjection's break mode uses.
 *
 *  ★★ The LOAD-BEARING property is only that this must not DESTROY a newline —
 *  htmlPlainProjection runs immediately after and re-normalises whatever it
 *  gets, so the two are not required to agree character-for-character, and an
 *  earlier version of this comment claimed they mirrored each other "exactly",
 *  an invariant stronger than the code needs and stronger than any test holds.
 *  The duplication is deliberate: importing rich-text-plain's regexes here would
 *  point the DOM-free module's consumer at the DOM-dependent one. If you tighten
 *  this collapse, the projection still fixes up the result — but do not RELAX it
 *  into anything that can eat a "\n".
 *
 *  ★ As written the two collapses ARE character-identical (same two regexes, same
 *  order) — the looseness above is a PERMISSION, not an observed difference, so
 *  do not go hunting for a divergence here. Where the two genuinely differ is the
 *  projection's extra entity/NBSP decode running BEFORE its collapse: "x\n&nbsp;\ny"
 *  leaves this function untouched and normalises to "x\ny" there. */
export function htmlToText(html: string, opts?: { preserveBreaks?: boolean }): string {
  const stripped = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  if (opts?.preserveBreaks !== true) return stripped.replace(/\s+/g, " ").trim();
  return stripped
    .replace(/[^\S\n]*\n\s*/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}
