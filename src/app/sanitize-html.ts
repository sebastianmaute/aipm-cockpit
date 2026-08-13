// src/app/sanitize-html.ts — the DOMPurify storage-boundary sanitizers.
//
// TWO DOMPurify sanitizers, and the second one exists for exactly one reason:
//   • sanitizeRichHtml (RICH_ALLOWED_TAGS) — EVERY rich surface except documents:
//     the seven rich entity fields (`Task.description` plus the six in
//     `AI_RICH_FIELDS`), note-log entries, the dashboard narrative, comm templates
//     and meeting reports. One list, one KEEP_CONTENT policy (the DEFAULT: unwrap
//     an unlisted tag, keep its words).
//   • sanitizeDocumentHtml — documents only. It is NOT a second policy; it is the
//     same one plus `img` + `data-asset-id`, which forces `ALLOW_DATA_ATTR: false`
//     and an `ADD_URI_SAFE_ATTR` exemption that no other surface needs (see its own
//     note). Everything else about it matches sanitizeRichHtml.
// ★★★ There used to be THREE, and the third is why §137 happened: `sanitizeNoteHtml`
// ran an 8-tag list at `KEEP_CONTENT: false`, which DELETES an unlisted element
// together with its text, at whole-object LOAD boundaries — no human, no save. A
// stored "<h1>Title</h1><p>body</p>" loaded as "<p>body</p>". Do not add a third
// sanitizer, and do not add a KEEP_CONTENT:false one at any width: losing formatting
// beats losing words, and a surface that needs less markup should RENDER less rather
// than sanitize differently.
// Plus htmlToText (the plain-text projection) and plainToHtml (wraps plain text as
// lean HTML, and is deliberately DOM-free; see its own note).
// The allow-lists are exported so html-start.ts can derive each sink's own "is this
// value already HTML?" classifier from the same list that sink sanitizes against,
// instead of a hand-maintained mirror that can drift.
// RICH_ALLOWED_TAGS is the list the Tiptap editor's schema is converged ON, so
// sanitizing editor output is a defense-in-depth boundary rather than the only
// gate. ★★ It DOES mirror that schema now, and this comment said the opposite
// until the editor collapse landed: `rich-text-editor.tsx` configures
// `StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } })`, so the editor can
// no longer emit h5/h6 — StarterKit's own default is [1,2,3,4,5,6]. Those two
// levels therefore reach this sanitizer only from LEGACY STORED DATA now, never
// from a keystroke. They still UNWRAP and keep their words either way.
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
 *  ★★★ It REPLACED two lists that disagreed — TEMPLATE_ALLOWED_TAGS (11 tags) and
 *  NOTE_ALLOWED_TAGS (8, at KEEP_CONTENT:false) — both now deleted. They disagreed
 *  with each other AND with the editor, and the narrow one DELETED the text of
 *  anything the wide one admitted, on every JSON and IndexedDB load with no human
 *  and no save involved (open-followups §137). One list is the closure; do not add
 *  a third, and do not "temporarily" alias one — an alias is a fourth list waiting
 *  to drift.
 *
 *  ★ EXPORTED so html-start.ts can derive a sink's classifier from the same array
 *  that sink sanitizes against. `SINK_TAGS.rich` IS this array, and
 *  `SINK_TAGS.document`/`.projection` are DOCUMENT_ALLOWED_TAGS, which spreads it —
 *  so all three derived classifiers move when this array moves. A classifier
 *  narrower than its sink escapes a value the sink would have kept (§107), and
 *  `html-start.test.ts` pins that direction empirically for both sanitizers rather
 *  than by comparing constants.
 *
 *  ★ `hr` is here although no toolbar control produces it, because
 *  DOCUMENT_ALLOWED_TAGS derives from this array and documents have always allowed
 *  `hr`. Removing it here would narrow documents in the same edit. Leave it.
 *
 *  ★ Headings stop at h4 because that IS the editor schema — `rich-text-editor.tsx`
 *  passes `StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } })`, narrowing
 *  StarterKit's own [1,2,3,4,5,6] default. ★★ This docstring read "No such
 *  configuration exists in `src` today" until the editor collapse landed; it does
 *  now, so h5/h6 can only arrive from LEGACY STORED DATA, not from the editor.
 *  Either way they UNWRAP and keep their words. */
export const RICH_ALLOWED_TAGS = [
  "p", "br", "hr",
  "strong", "em", "u", "s", "code", "mark", "sub", "sup",
  "pre", "blockquote",
  "h1", "h2", "h3", "h4",
  "ul", "ol", "li",
  "a",
];
/** The four `data-*` attributes this app admits, each with the FULL set of
 *  values it may carry. This literal IS the policy — §140.
 *
 *  ★★★ WHY A TABLE AND NOT A CSS GRAMMAR. Alignment could have ridden `style`
 *  (which survives DOMPurify: `style` is in DEFAULT_URI_SAFE_ATTRIBUTES, so
 *  ALLOWED_URI_REGEXP never sees it). It was rejected because nothing parses a
 *  CSS value — `position:fixed;inset:0;z-index:99999` passes verbatim — and
 *  these fields are AI-writable. A guard over CSS can be widened one
 *  declaration at a time until it is a CSS allow-list; a guard over a 4-member
 *  string set cannot drift that way.
 *
 *  ★ Lower-case only, deliberately tighter than necessary: Tiptap emits
 *  lower-case, so accepting "CENTER" would widen the set for nothing.
 *
 *  ★ `data-asset-id` is strict on CHARSET and LENGTH and deliberately silent on
 *  FORMAT — it admits uuid, ulid, nanoid, a content hash or an integer, so it
 *  cannot constrain whatever id the images slice mints, while rejecting empty,
 *  whitespace, quotes, angle brackets, path separators and 65+ chars. §117(b). */
const ATTR_VALUES: Readonly<Record<string, (value: string) => boolean>> = {
  "data-align": (v) => v === "left" || v === "center" || v === "right" || v === "justify",
  "data-type": (v) => v === "taskList" || v === "taskItem",
  "data-checked": (v) => v === "true" || v === "false",
  "data-asset-id": (v) => /^[A-Za-z0-9_-]{1,64}$/.test(v),
};

/** The three names task list and alignment need. Kept separate from
 *  ALLOWED_ATTR's own literal only so the ADD_URI_SAFE_ATTR lists below can
 *  reuse it — every name here must appear in BOTH places or it is stripped.
 *
 *  ★★★ ADDING A NAME HERE WITHOUT AN `ATTR_VALUES` PREDICATE OPENS THE BOUNDARY,
 *  and it does so SILENTLY. This array auto-propagates into `ALLOWED_ATTR` and
 *  into BOTH `ADD_URI_SAFE_ATTR` spreads, so a name added here alone: passes the
 *  name test, is exempted from `ALLOWED_URI_REGEXP` by that exemption, and is
 *  then IGNORED by the hook (`Object.hasOwn` is false → early return). Net
 *  effect: the attribute survives carrying a completely unconstrained value.
 *  That is the same failure the `ADD_URI_SAFE_ATTR` comment below warns about,
 *  reached by an ADDITION rather than a deletion — the direction the
 *  "cannot WIDEN the boundary" test does NOT cover.
 *  ★ EXPORTED for that reason only: `sanitize-html.test.ts` loops over this
 *  array and asserts every name rejects a hostile value THROUGH the real
 *  sanitizer, so a name with no predicate — or a predicate that accepts
 *  everything — fails. Do not consume it elsewhere. */
export const GUARDED_DATA_ATTR = ["data-align", "data-type", "data-checked"] as const;

let attrHookRegistered = false;

/** Registers the value-allow-list hook exactly once, LAZILY.
 *
 *  ★★★ NEVER CALL DOMPurify.addHook AT MODULE EVAL. With no DOM it is
 *  `undefined` and calling it throws a TypeError — measured 2026-08-13 under
 *  bare node on dompurify 3.4.13, not reasoned: `typeof addHook` is
 *  "undefined" and the call reports "DOMPurify.addHook is not a function".
 *  And this module IS module-eval-reachable during Next SSR:
 *  `templates-builtin.ts` imports `plainToHtml` from here and calls it from the
 *  top-level `MINIMAL_TASKS` initializer. A top-level registration is a 500 on
 *  every page. `sanitize-html.test.ts` carries a source scan that enforces this
 *  by brace DEPTH, so a reformat can neither satisfy nor break it.
 *
 *  ★★ The hook is INERT for any attribute not in ATTR_VALUES, which is what
 *  makes ONE globally-registered hook safe for every DOMPurify.sanitize call in
 *  this file — sanitizeRichHtml, sanitizeDocumentHtml and htmlToText's
 *  strip-everything projection. ★ NAMED rather than counted: an earlier
 *  revision of this line said "all four", and there are THREE. This file is
 *  also the only NON-TEST module in `src` that imports dompurify, so those
 *  three calls are the hook's entire production blast radius (`html-start.test.ts`
 *  imports it too, against its own local instance). Re-derive rather than trust
 *  it — anchored at line start so this very comment cannot match itself, which
 *  is how the last such claim went stale unnoticed:
 *    grep -rn "^import .*dompurify" src/ --include=*.ts --include=*.tsx
 *
 *  ★★ THE HOOK CAN ONLY REMOVE, NEVER ADD, and that is what makes ATTR_VALUES a
 *  pure tightening rather than a second way in. `uponSanitizeAttribute` fires
 *  BEFORE the name test, so leaving `keepAttr` alone does not survive a name
 *  the ALLOWED_ATTR list omits. So a name must be on BOTH the table and the list
 *  to survive — the table can never widen the boundary on its own. Pinned by
 *  "cannot WIDEN the boundary" in sanitize-html.test.ts, which uses
 *  `data-asset-id` on a `<p>`: it is on the table and on DOCUMENT_ALLOWED_ATTR
 *  but NOT on ALLOWED_ATTR. ★ The carrier tag must be one the rich list admits —
 *  an `<img>` would be dropped as a TAG, so that assertion would pass for a
 *  reason unrelated to the attribute name test. */
function ensureAttrHook(): void {
  if (attrHookRegistered) return;
  attrHookRegistered = true;
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    // ★★★ `Object.hasOwn` FIRST — a bare `ATTR_VALUES[name]` truthiness test is
    // a PROTOTYPE-CHAIN LOOKUP, and it shipped that way in the first cut of this
    // slice. `ATTR_VALUES["__proto__"]` is not `undefined`: it resolves to
    // `Object.prototype`, which is TRUTHY but NOT CALLABLE, so the "absent →
    // return inert" line never runs and the next line throws
    // `TypeError: isAllowedValue is not a function`.
    //
    // ★★★ THE THROW IS SILENT DATA LOSS, which is why this is worth six lines of
    // comment. `sanitizeRichHtml` runs inside `jsonToWorkspace`'s try, whose
    // catch returns `emptyWorkspace()` — so ONE `__proto__=` attribute anywhere
    // in a rich field (`Task.description`, note-log html, the six
    // `AI_RICH_FIELDS`) makes a whole JSON workspace load as EMPTY, with no
    // error surfaced. It also throws at RENDER time through RichTextView's
    // `dangerouslySetInnerHTML`, and on the IDB load path.
    //
    // ★★ ONLY TWO NAMES CAN REACH THIS AT ALL, and the reason is not obvious:
    // HTML lowercases attribute names before the hook sees them (measured — the
    // hook receives "hasownproperty", "valueof", "tostring"), so of
    // `Object.prototype`'s 12 own members exactly TWO survive intact —
    // `constructor` and `__proto__`. `constructor` resolves to `Object`, which
    // IS callable and returns truthy, so it merely wastes a call and is then
    // dropped by the name test; `__proto__` is the one that crashes. Everything
    // else lowercases into a name the prototype does not carry.
    //
    // Do not "simplify" this back to a truthiness check. Reproduce the class:
    //   node -e "console.log(typeof ({})['__proto__'])"   // object, not function
    if (!Object.hasOwn(ATTR_VALUES, data.attrName)) return;
    if (!ATTR_VALUES[data.attrName](data.attrValue)) data.keepAttr = false;
  });
}

const ALLOWED_ATTR = ["href", "target", "rel", ...GUARDED_DATA_ATTR];

// SHARED by both sanitizers that pass it — sanitizeRichHtml and
// sanitizeDocumentHtml — one literal, so the two cannot drift.
// End-anchored so each storage boundary stays airtight on its own (not just behind
// the editor's isSafeHttpUrl pre-filter): scheme must lead and no angle-brackets/
// quotes may sneak into the value.
// ★ It is tested against EVERY attribute value, not only URI-bearing ones — that is
// why `target`/`rel` can never survive (see the ★★ note above).
const SAFE_URI_REGEXP = /^(?:https?|mailto):[^<>"]*$/i;

/** THE storage-boundary sanitizer for every rich surface except documents.
 *
 *  ★★★ KEEP_CONTENT stays at DOMPurify's DEFAULT (unwrap, keep the words). The
 *  retired `sanitizeNoteHtml` set it to `false`, which deletes an unlisted element
 *  TOGETHER WITH ITS TEXT, and that ran at whole-object LOAD boundaries — that was
 *  the §137 data loss. Losing formatting beats losing words. Do not flip this. */
export function sanitizeRichHtml(html: string): string {
  ensureAttrHook();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: RICH_ALLOWED_TAGS,
    ALLOWED_ATTR,
    // ★★★ §115. The default is TRUE, which SHORT-CIRCUITS every data-*
    // attribute past both the name test and the value test — so the explicit
    // ALLOWED_ATTR list was not the whole gate, and the hook above would never
    // have been asked about a data-checked. Turning it off is simultaneously
    // the §115 fix and the precondition for ATTR_VALUES to be reachable.
    ALLOW_DATA_ATTR: false,
    // ★★ Turning it off drops these three into the VALUE chain, where
    // ALLOWED_URI_REGEXP is tested against EVERY attribute value (not only
    // URI-bearing ones) and rejects any non-URI. So each kept name needs the
    // exemption HERE as well as the entry in ALLOWED_ATTR — measured 2026-08-13
    // on dompurify 3.4.13, not reasoned: with this line deleted and nothing else
    // changed, `<p data-align="center">x</p>` sanitizes to `<p>x</p>`. That is
    // the same value-shaped stripping `target="_blank"` already suffers.
    // ★★★ The exemption is also why the ATTR_VALUES table HAS to exist: it skips
    // the value test outright, so the table is the only remaining guard on these
    // values. Deleting the table does not fall back to a weaker check — it falls
    // back to NO check.
    ADD_URI_SAFE_ATTR: [...GUARDED_DATA_ATTR],
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
  });
}

/** Documents-only allow-list, and the WIDEST — it spreads RICH_ALLOWED_TAGS and
 *  adds exactly one tag of its own, `img`.
 *
 *  ★★ THE SPREAD IS THE POINT: RICH_ALLOWED_TAGS is now the only place a tag can
 *  be added to documents, so the two lists cannot disagree about `blockquote` or a
 *  heading level again. It also means widening RICH_ALLOWED_TAGS widens this list
 *  in the same edit — and that array's width already reaches comm templates,
 *  meeting reports and the seven rich entity fields (`Task.description` plus the
 *  six in `AI_RICH_FIELDS`), retroactively, including how already stored HTML
 *  renders. rich-text-editor.tsx records that hazard as the reason an earlier slice
 *  disabled input rules rather than widen a list.
 *
 *  ★ Documents GAINED `h3` and `h4` from the derivation and lost nothing — the
 *  hand-maintained literal it replaced carried 20 names, every one of which is on
 *  the rich list or is `img`. sanitize-html.test.ts pins both directions against a
 *  spelled-out copy of that old literal.
 *
 *  ★★ KEEP_CONTENT stays at DOMPurify's DEFAULT (unwrap, keep the words) — the
 *  same policy sanitizeRichHtml runs, so the two sanitizers now differ ONLY in
 *  their tag and attribute lists. A document is prose a person will read; losing a
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
 *  Scoped to documents on purpose — the file exports TWO sanitizers and the other
 *  one (sanitizeRichHtml) keeps the `ALLOW_DATA_ATTR` default and has every other
 *  consumer. ★★ That gap is WIDER than it was before sanitizeRichHtml existed, and
 *  was not created by it: sanitizeRichHtml inherits the old template config's
 *  `ALLOW_DATA_ATTR` default, so it is unchanged in KIND but now covers ten more
 *  tags. ★ It is still a two-line fix rather than the slice an
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
export const DOCUMENT_ALLOWED_TAGS = [...RICH_ALLOWED_TAGS, "img"];
const DOCUMENT_ALLOWED_ATTR = [...ALLOWED_ATTR, "data-asset-id", "alt"];

export function sanitizeDocumentHtml(html: string): string {
  ensureAttrHook();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: DOCUMENT_ALLOWED_TAGS,
    ALLOWED_ATTR: DOCUMENT_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ADD_URI_SAFE_ATTR: ["data-asset-id", ...GUARDED_DATA_ATTR],
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
  });
}

/** Wrap plain text as sanitized lean HTML for the rich `description`/note body.
 *  Escapes &<>, converts newlines to <br>, wraps in a single <p>. Empty→"".
 *  The escape neutralizes every HTML metacharacter, so the only tags in the
 *  result are the <p>/<br> added here — both on RICH_ALLOWED_TAGS — which makes
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
