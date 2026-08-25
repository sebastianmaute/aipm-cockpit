// src/app/document-asset-patterns.ts — the THREE regexes that read
// `data-asset-id`, in one place, with the full reasoning each one was written
// with. They arrived here from three different files (open-followups §209).
//
// ★★★ THEY ARE DELIBERATELY DIFFERENT AND MUST NOT BE MERGED. Each answers a
// different question, and each is right on its own terms:
//
//   ANY_TAG_ASSET_ID_RE  the attribute inside ANY start tag, double-quoted,
//                        tag-case-agnostic, /g, captures the id.
//                        Answers: what spends a slot of the 20-image cap?
//   IMG_TAG_ASSET_ID_RE  the same attribute but only inside an `<img …>`
//                        tag, double-quoted, /g, captures the id.
//                        Answers: what can an export actually draw?
//   ASSET_IMG_TEST_RE    anchored on `<img`, all three quoting styles,
//                        case-INSENSITIVE, NOT /g, captures nothing.
//                        Answers: does an image-only paragraph survive load?
//
// Collapsing any two of them changes what a cap counts, what an export fetches
// or what a load keeps — see each docstring for the measured failure it closed.
// What was missing before this module was anywhere they could be read AGAINST
// each other; `document-asset-patterns.test.ts` asserts that divergence as a
// table, and `assetRefsInDocument` (`document-asset-usage.ts`) carries what the
// first two mean for a caller.
//
// ★★★ DOM-FREE BY CONTRACT, AND IT IMPORTS NOTHING. `document-model.ts` — itself
// DOM-free, the ONE structural validator every load path routes through —
// depends on this module, so a DOMPurify or `document.`/`window` reference here
// would break bare-node use (the sample generator), and an import here could
// grow the `settings-types` ⇄ `workspace` ⇄ `document-model` cycle
// open-followups §92 records. Both properties are source scans in this module's
// test, over the shared parser-backed stripper (`src/test/strip-comments.ts`) —
// ★★ never a local regex pair, which cannot tell a regex literal from a comment
// delimiter and silently blanks real code in a module made of regex literals.
//
// ★★★ THE TWO /g PATTERNS SHARE `lastIndex`, AND BOTH ARE MODULE SINGLETONS.
// `ANY_TAG_ASSET_ID_RE` and `IMG_TAG_ASSET_ID_RE` may be used ONLY with `String.replace`
// (which resets it) or `String.matchAll` (which clones it). A `.test()` or a
// bare `.exec()` in a loop would carry position between unrelated callers — a
// bug that only shows up once two of them run in one tick, i.e. in production
// and never in a focused test. `ASSET_IMG_TEST_RE` is deliberately NOT /g, for
// the same reason, stated again at its own declaration.

/** The attribute inside ANY start tag, stepping over quoted attribute values.
 *
 *  ★★★ TAG-AGNOSTIC ON PURPOSE, AND THAT IS THE HALF NOT TO "SIMPLIFY".
 *   A reference the sanitizer preserved on a non-`img` element still matters
 *   for deletion safety and the "used in N documents" count, so a
 *   `<span data-asset-id>` MUST keep counting (open-followups §218). Anchoring
 *   this on `<img` would silently change what the cap counts and what that
 *   column means — "a <span> is counted but never drawable" goes red if you
 *   do. Tag-name CASE is not a discriminator either: `<IMG …>` counts here.
 *
 *  ★★ QUOTE-AWARE, sharing the alternation `IMG_TAG_ASSET_ID_RE` uses: a preceding
 *   `alt="…"` is consumed whole as one alternative, so its contents cannot
 *   supply an opening quote for this attribute. Before that, a crafted alt
 *   ending in `data-asset-id=` produced a phantom id and hid the real one, and
 *   a text node spelling the attribute spent a cap slot (open-followups §231).
 *   The QUANTIFIER is lazy where `IMG_TAG_ASSET_ID_RE`'s is greedy — see `AssetRefs`
 *   (`document-asset-usage.ts`).
 *
 *  ★★ `[^\s/>"']*` IS THE TAG NAME, AND THE `"'` IN IT IS NOT DECORATION.
 *   Without them the class can eat a quote, which makes it ambiguous against
 *   branches 2 and 3 of the alternation — the pattern's only backtracking
 *   ambiguity. Measured on `('<a' + '"'.repeat(64)).repeat(m)`: 375 ms at
 *   4 KB and ~7.5x per doubling, against 0.27 ms with the two characters
 *   present. The two patterns agree on every input without a quote in the tag
 *   name, which is every input the loader can produce. Not
 *   reachable through the loader (DOMPurify serialises from the DOM, so a tag
 *   name is always followed by a space or `>`), but "ALREADY-SANITIZED" is a
 *   comment rather than a check and the tests here scan raw HTML. */
export const ANY_TAG_ASSET_ID_RE =
  /<[a-zA-Z][^\s/>"']*(?:[^>"']|"[^"]*"|'[^']*')*?\bdata-asset-id="([^"]*)"/g;

/**
 * The one regex an EXPORT uses for `<img data-asset-id>`. It replaced three
 * identical copies, one per renderer.
 *
 * ★★ The consequence to know: a `<span data-asset-id>` counts against the cap
 * and is invisible here — but no longer SILENTLY, since `assetRefsInDocument`
 * (`document-asset-usage.ts`) returns it as `undrawable` and the cap message
 * reports how much room removing every such reference would reclaim
 * (open-followups §218).
 *
 * ★★★ QUOTE-AWARE, and it must stay that way. A plain `[^>]*` stops at the
 * first `>` even inside a quoted attribute value, and that is reachable from
 * the product's own rename control: the insert path escapes `>` to `&gt;`, but
 * the HTML serialiser does not re-escape it in an attribute, so a DOM round
 * trip hands back `alt="chart>v2.png"` verbatim. Measured: with `alt` AFTER
 * data-asset-id the match truncates and `v2.png">` survives as visible text in
 * every export; with `alt` BEFORE it the tag is missed entirely, so no bytes
 * load and the image disappears without a word. The three alternation branches
 * start on disjoint character classes, so there is no backtracking risk.
 */
export const IMG_TAG_ASSET_ID_RE =
  /<img\b(?:[^>"']|"[^"]*"|'[^']*')*\bdata-asset-id="([^"]*)"(?:[^>"']|"[^"]*"|'[^']*')*>/g;

/** An `<img>` carrying a NON-EMPTY `data-asset-id` — the only markup that makes
 *  a paragraph meaningful while projecting to no visible text.
 *
 *  ★★★ WITHOUT THIS THE LOADER ATE EVERY IMAGE-ONLY PARAGRAPH. An inserted
 *   image is a paragraph whose whole html is the `<img>` tag; `htmlTextLength`
 *   strips tags and does not project `alt`, so it measured 0 and the block was
 *   dropped — on all six write paths at once, since every load routes through
 *   here. It rendered in the authoring session (in memory) and was gone after
 *   reload, with no error and nothing in the truncation diag. Fixed on the LOAD
 *   side deliberately: that also repairs documents already stored broken, which
 *   no write-side change could.
 *
 *  ★★ SCOPED TO `data-asset-id`, NOT TO `<img>` AT LARGE, and the reason is
 *   that a bare `<img>` here can never become anything: the document allow-list
 *   gives `img` only `alt` and `data-asset-id` and deliberately NO `src`
 *   (sanitize-html.ts records why), and `document-asset-images.ts` plus all
 *   three renderers key off a non-empty `data-asset-id`. So an `<img>` without
 *   one is invisible on every surface — keeping it would reintroduce exactly
 *   the accumulating blank paragraph the empty-drop exists to prevent, in a
 *   form the user cannot see well enough to delete. Empty value likewise: the
 *   allow-list strips the attribute and the renderers resolve nothing.
 *
 *  ★ DELIBERATELY LOOSER THAN THE ALLOW-LIST'S OWN `data-asset-id` PREDICATE
 *   (`/^[A-Za-z0-9_-]{1,64}$/`, sanitize-html.ts), which is not reused because
 *   this module is DOM-free and must not depend on the sanitizer. The two
 *   disagree only for a hand-crafted value the allow-list would strip anyway,
 *   and this side errs toward KEEPING — the failure it guards against is
 *   silent data loss, so a stray blank paragraph is the cheap direction.
 *
 *  ★★ Case-INSENSITIVE, unlike `IMG_TAG_ASSET_ID_RE` (above), which only ever sees html
 *   already lower-cased by DOMPurify. This one runs BEFORE any allow-list pass
 *   (`sanitizeProjectDocuments(raw).map(sanitizeDocumentRichFields)` — see
 *   document-rich-fields.ts), so a hand-edited or imported `<IMG DATA-ASSET-ID>`
 *   reaches it verbatim and must not be dropped before it can be normalised.
 *
 *  ★★★ ALL THREE HTML QUOTING STYLES, FOR THE SAME REASON THE `/i` EXISTS.
 *   Whatever writes `<IMG DATA-ASSET-ID>` in caps is hand-written or foreign
 *   HTML, and that is precisely the input class that spells attributes
 *   `id='x'` or bare `id=x`; both are valid HTML5 and both measure zero
 *   visible text, so a double-quote-only pattern DELETES the block on load
 *   with no error.
 *   ★★ The unquoted branch excludes `"` and `'` (not merely whitespace and
 *   `>`), so `data-asset-id=""` and `data-asset-id=''` still fail every branch
 *   and are still dropped — an empty value renders nothing on every surface,
 *   which is the case the paragraph branch of `sanitizeBlock`
 *   (`document-model.ts`), this pattern's only caller, deliberately keeps out.
 *
 *  ★ NOT `/g` — a global regex carries `lastIndex` across `.test` calls and
 *   would drop every other image-only paragraph in a document. */
export const ASSET_IMG_TEST_RE =
  /<img\b[^>]*\bdata-asset-id\s*=\s*(?:"[^"]+"|'[^']+'|[^\s"'>]+)/i;
