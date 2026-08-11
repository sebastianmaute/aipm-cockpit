// src/app/sanitize-html.ts — the DOMPurify storage-boundary sanitizers.
//
// ★ MID-TRANSITION, so read the CALL SITES, not the intent. This file exports
// FOUR sanitizers today, and which surface uses which is still moving:
//   • sanitizeRichHtml (RICH_ALLOWED_TAGS) — THE destination. Reached today only
//     through the sanitizeTemplateHtml delegation below: comm templates, meeting
//     reports, and `ai-rich-text.ts`, the model-write boundary for the seven rich
//     entity fields.
//   • sanitizeNoteHtml — note-log entries, the dashboard narrative, the task
//     Description write paths. Still live at ~12 production call sites, still at
//     KEEP_CONTENT:false, and therefore still losing words on every load. Task 6
//     moves those call sites; Task 7 deletes it. Do not add another.
//   • sanitizeTemplateHtml — a one-line delegation to sanitizeRichHtml. Task 7
//     deletes it. Do not add another.
//   • sanitizeDocumentHtml — documents only, wider still.
// Plus htmlToText (the plain-text projection) and plainToHtml (wraps plain text as
// lean HTML, and is deliberately DOM-free; see its own note).
// The allow-lists are exported so html-start.ts can derive each sink's own "is this
// value already HTML?" classifier from the same list that sink sanitizes against,
// instead of a hand-maintained mirror that can drift.
// RICH_ALLOWED_TAGS is the list the Tiptap editor's schema is being converged ON
// (Task 11 configures the editor to match), so sanitizing editor output is a
// defense-in-depth boundary. ★ It does not mirror that schema TODAY — the editor's
// full variant is a bare `StarterKit`, whose heading extension emits h1-h6.
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

/** THE rich-text allow-list — the ONE array every rich surface is converging on:
 *  the seven rich entity fields (`Task.description` + the six in `AI_RICH_FIELDS`),
 *  note-log entries, the dashboard narrative, comm templates and meeting reports.
 *
 *  ★★★ It is the REPLACEMENT for TEMPLATE_ALLOWED_TAGS (11 tags) and
 *  NOTE_ALLOWED_TAGS (8, at KEEP_CONTENT:false) — but both still exist below with
 *  live consumers, and only Task 7 deletes them. Those two disagree with each other
 *  AND with the editor, and the narrow one DELETES the text of anything the wide one
 *  admits — on every JSON and IndexedDB load, with no human and no save involved
 *  (open-followups §137). One list is the closure; do not add a third.
 *
 *  ★ EXPORTED so html-start.ts can derive a sink's classifier from the same array
 *  that sink sanitizes against. ★★ Nothing derives from it YET — `SINK_TAGS` still
 *  has four members (`note`/`template`/`document`/`projection`) and no `rich` one;
 *  Task 4 collapses them onto this array. A classifier narrower than its sink
 *  escapes a value the sink would have kept (§107).
 *
 *  ★ `hr` is here although no toolbar control produces it, because Task 3 will
 *  derive DOCUMENT_ALLOWED_TAGS from this array and documents have always allowed
 *  `hr`. ★★ Today that derivation runs the other way — the document list SPREADS
 *  TEMPLATE_ALLOWED_TAGS (see its own docstring below) — so removing `hr` here would
 *  not narrow documents yet. It would after Task 3. Leave it.
 *
 *  ★ Headings stop at h4 as the INTENDED editor schema; Task 11 configures the
 *  editor to match. ★★ No such configuration exists in `src` today — the full
 *  variant is a bare `StarterKit` and its heading extension emits h1-h6, so h5/h6
 *  reach this sanitizer from the editor itself, not only from legacy data. Either
 *  way they UNWRAP and keep their words. */
export const RICH_ALLOWED_TAGS = [
  "p", "br", "hr",
  "strong", "em", "u", "s", "code", "mark", "sub", "sup",
  "pre", "blockquote",
  "h1", "h2", "h3", "h4",
  "ul", "ol", "li",
  "a",
];
const ALLOWED_ATTR = ["href", "target", "rel"];

// SHARED by all three sanitizers that pass it — sanitizeRichHtml,
// sanitizeDocumentHtml, sanitizeNoteHtml — one literal, so the three cannot drift.
// (sanitizeTemplateHtml is a delegation and passes nothing of its own.)
// End-anchored so each storage boundary stays airtight on its own (not just behind
// the editor's isSafeHttpUrl pre-filter): scheme must lead and no angle-brackets/
// quotes may sneak into the value.
// ★ It is tested against EVERY attribute value, not only URI-bearing ones — that is
// why `target`/`rel` can never survive (see the ★★ note above).
const SAFE_URI_REGEXP = /^(?:https?|mailto):[^<>"]*$/i;

/** THE storage-boundary sanitizer every rich surface except documents is moving to.
 *
 *  ★★★ KEEP_CONTENT stays at DOMPurify's DEFAULT (unwrap, keep the words).
 *  sanitizeNoteHtml — which is NOT retired, and still runs at ~12 production call
 *  sites below — sets it to `false`, which deletes an unlisted element TOGETHER
 *  WITH ITS TEXT. That is the §137 data loss, and it is still live everywhere this
 *  sanitizer has not reached yet. Losing formatting beats losing words. It becomes
 *  one policy across every sink at Task 7, not here. */
export function sanitizeRichHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: RICH_ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
  });
}

/** The pre-§137 template allow-list, kept ONLY to hold two consumers still on the
 *  old shape until they move.
 *
 *  ★★★ @deprecated — do NOT read a tag off this list, and do NOT "simplify" it to
 *  `= RICH_ALLOWED_TAGS`. That alias looks harmless and is not: DOCUMENT_ALLOWED_TAGS
 *  SPREADS this array, and html-start.ts derives its `template` sink from it, so one
 *  alias moves BOTH. Measured, not reasoned: DOCUMENT_ALLOWED_TAGS goes 20 entries →
 *  30 (gains h3/h4, duplicates eight names) and html-start.test.ts goes red on
 *  exactly two assertions — "classifies a document-only tag ... not for note or
 *  template" (blockquote becomes a template tag) and "classifies a tag NO allow-list
 *  carries for render but not for document" (h3 stops being unlisted once the
 *  document list inherits it). ★ The projection ⊇ every-real-sink test does NOT
 *  fail, because projection IS the document list and widens with it — a plausible
 *  third failure that measurement refutes. Both consumers go away together: Task 3
 *  derives the document list from RICH_ALLOWED_TAGS, Task 4 collapses html-start's
 *  five sinks to one `rich` sink, and Task 7 deletes this.
 *
 *  ★★★ KEEPING THE OLD 11 HOLDS THE CLASSIFIER STILL. IT DOES NOT MAKE THE COMMIT
 *  BEHAVIOUR-NEUTRAL, and an earlier revision of this line said it did. The SINK
 *  widened 11 → 21 the moment the delegation below landed, at eight production call
 *  sites: `ai-rich-text.ts` (the model-write boundary for `Task.description` and the
 *  six `AI_RICH_FIELDS`), `comm-send-preview-modal.tsx`, `meeting-report-panel.tsx`,
 *  `use-meeting-report-actions.ts` (two), `use-action-center-handlers.ts`,
 *  `use-task-row-handlers.ts`, and `rich-text-editor.tsx`, whose non-lean variant
 *  picks this sanitizer by ternary rather than by call — so grep the BARE name, not
 *  `sanitizeTemplateHtml(`. `<p>a</p><blockquote>q</blockquote>` stored as
 *  `<p>a</p>q` before and keeps its `<blockquote>` now.
 *
 *  ★ That widening is the POINT of the slice — do not revert it. The ten added tags
 *  are inert under an unchanged attribute policy (`ALLOWED_ATTR` and
 *  SAFE_URI_REGEXP are untouched), so the new reach is markup, not attributes.
 *
 *  ★ What IS neutral is the classifier: a value the narrow `template` test rejects
 *  was escaped whole before this change and is escaped whole after it. Aliasing
 *  would move the classifier AND the document list in one edit — a second, separate
 *  behaviour change, which is why the old literal stays until Task 3 and Task 4. */
export const TEMPLATE_ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "h1", "h2", "ul", "ol", "li", "a"];

/** @deprecated Transitional shim — Task 7 deletes this and its call sites.
 *  ★★ It is a DELEGATION, not the old sanitizer: all eight call sites enumerated
 *  in TEMPLATE_ALLOWED_TAGS' note above already get the wide list and the unwrap
 *  semantics. Only the CLASSIFIER still carries the old width. */
export function sanitizeTemplateHtml(html: string): string {
  return sanitizeRichHtml(html);
}

/** Documents-only allow-list, and today still the WIDEST — it spreads
 *  TEMPLATE_ALLOWED_TAGS and adds nine.
 *
 *  ★★ THE ARRAY IT SPREADS IS NOW DEAD WEIGHT, so read this paragraph as history
 *  until Task 3 rewires it. Widening TEMPLATE_ALLOWED_TAGS no longer changes what a
 *  model may store: `sanitizeTemplateHtml` stopped reading that array when it became
 *  a delegation to `sanitizeRichHtml`, so the array's only remaining consumers are
 *  this spread and html-start's `template` classifier. The hazard the next sentence
 *  describes was real and is now carried by RICH_ALLOWED_TAGS instead — that is the
 *  list whose width reaches comm templates, meeting reports and the seven rich
 *  entity fields (`Task.description` plus the six in `AI_RICH_FIELDS`),
 *  retroactively, including how already stored HTML renders. rich-text-editor.tsx
 *  records that hazard as the reason an earlier slice disabled input rules rather
 *  than widen a list.
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
 *  Scoped to documents on purpose — the file now exports FOUR sanitizers and the
 *  other three (sanitizeRichHtml, its sanitizeTemplateHtml delegation, and
 *  sanitizeNoteHtml) keep the default and have other consumers. ★★ The gap GREW
 *  with this commit and was not created by it: sanitizeRichHtml inherits the
 *  template config's `ALLOW_DATA_ATTR` default, so it is unchanged in KIND but now
 *  covers ten more tags. ★ It is still a two-line fix rather than the slice an
 *  earlier note implied: the set of `data-*` names their call sites depend on was
 *  enumerated on 2026-08-08 and is EMPTY — StarterKit registers no extension that
 *  emits one. See open-followups §115 for the enumeration and the Tiptap scan.
 *
 *  `img` is inert until S3c ships the asset store. It is allow-listed here so this
 *  sanitizer does not strip markup a later slice writes.
 *  ★★ THAT IS TRUE OF THIS SANITIZER AND NOT OF THE LOAD PATH, so do not read it as
 *  "an image-only paragraph is safe". `document-model.ts`'s `sanitizeBlock` drops any
 *  paragraph whose visible text measures zero (`htmlTextLength(html) === 0`), and an
 *  `<img>` contributes no text — so a paragraph containing ONLY an image is deleted on
 *  every load path today. Measured 2026-08-08. A paragraph with text AND an image
 *  survives. S3c must fix that before it can rely on image markup persisting;
 *  open-followups §117(a) carries the reproduce.
 *  ★★ Two more S3c prerequisites live in §117: this attribute's VALUE is never
 *  validated (`ADD_URI_SAFE_ATTR` exempts it from every value check), and `img` is in
 *  DOMPurify's default `DATA_URI_TAGS` — so adding `src` to the list admits
 *  `data:text/html` and `data:image/svg+xml`, both XSS vectors, bypassing
 *  `ALLOWED_URI_REGEXP` entirely. Neither is reachable today. */
export const DOCUMENT_ALLOWED_TAGS = [
  ...TEMPLATE_ALLOWED_TAGS,
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

// ★★ html-start.ts DERIVES the "note" classifier from this list (its factory drops
// "#text", which is not a tag name). It is no longer a mirror a human maintains —
// editing this array moves the classifier in the same edit. The hazard it used to
// warn about is still real and is now structurally prevented: recognising a tag
// THIS list omits means the sink below deletes the element AND its text
// (KEEP_CONTENT: false), which is why the note sink must never be classified with
// a wider list. See open-followups §107.
export const NOTE_ALLOWED_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li", "a", "#text"];
const NOTE_ALLOWED_ATTR = ["href", "target", "rel"];

/** Storage-boundary sanitizer for task Description + note-log HTML (lean set:
 *  bold/italic/lists/links). Mirrors the LEAN Tiptap editor variant's schema.
 *
 *  @deprecated Being retired — Task 6 moves its ~12 production call sites to
 *  `sanitizeRichHtml` and Task 7 deletes it. Do not wire a new one here.
 *
 *  ★★★ It is STILL LIVE and still losing words while those call sites remain. The
 *  `KEEP_CONTENT: false` below deletes an unlisted element TOGETHER WITH ITS TEXT,
 *  and it runs at whole-object LOAD boundaries — no human, no save. Measured on
 *  this function: "<h1>Title</h1><p>body</p>" → "<p>body</p>", "<u>underlined</u>
 *  rest" → " rest", "<blockquote>quoted</blockquote>" → "". That is
 *  open-followups §137, and the reason `sanitizeRichHtml` exists. Do not "fix" it
 *  by flipping this flag on its own: the note allow-list is 8 tags, so the words
 *  would survive while the markup around them still vanished. The fix is the call
 *  sites. */
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
