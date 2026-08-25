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
// ★★★ EACH /g PATTERN CARRIES ITS OWN `lastIndex` ACROSS CALLERS, AND BOTH ARE
// MODULE SINGLETONS. `ANY_TAG_ASSET_ID_RE` and `IMG_TAG_ASSET_ID_RE` may be used
// ONLY with `String.replace` (which resets it) or `String.matchAll` (which
// clones it). A `.test()` or a
// bare `.exec()` in a loop would carry position between unrelated callers — a
// bug that only shows up once two of them run in one tick, i.e. in production
// and never in a focused test. `ASSET_IMG_TEST_RE` is deliberately NOT /g, for
// the same reason, stated again at its own declaration.

/** The attribute inside ANY start tag, stepping over quoted attribute values.
 *
 *  ★★★ TAG-AGNOSTIC ON PURPOSE, AND THAT IS THE HALF NOT TO "SIMPLIFY".
 *   A reference the sanitizer preserved on a non-`img` element still matters
 *   for deletion safety and the "used in N documents" count, so a
 *   `<p data-asset-id>` MUST keep counting (open-followups §218). Anchoring
 *   this on `<img` would silently change what the cap counts and what that
 *   column means. Tag-name CASE is not a discriminator either: `<IMG …>`
 *   counts here.
 *   ★★ NAME A CARRIER THE LOADER CAN ACTUALLY PRODUCE. This said `<span>`, as
 *   §218 and its table still do, and a `<span>` is the one non-`img` carrier
 *   that CANNOT reach the cap: `span` and `div` are absent from
 *   `DOCUMENT_ALLOWED_TAGS`, so the sanitizer unwraps the element at
 *   KEEP_CONTENT and the attribute leaves with it. `p`, `strong`, `li` and `a`
 *   all keep it through a real load (measured, open-followups §249). A reader
 *   who checked the documented example would conclude this branch is dead code
 *   and "simplify" exactly the half this note is defending.
 *   ★ The `<span …>` row in the divergence table is still correct and stays:
 *   that test scans UN-loaded html, where a span is a fine stand-in for "any
 *   non-img tag". It pins the PATTERN, not the loader.
 *
 *  ★★ QUOTE-AWARE, sharing the alternation `IMG_TAG_ASSET_ID_RE` uses: a preceding
 *   `alt="…"` is consumed whole as one alternative, so its contents cannot
 *   supply an opening quote for this attribute. Before that, a crafted alt
 *   ending in `data-asset-id=` produced a phantom id and hid the real one, and
 *   a text node spelling the attribute spent a cap slot (open-followups §231).
 *   The QUANTIFIER is lazy where `IMG_TAG_ASSET_ID_RE`'s is greedy — see `AssetRefs`
 *   (`document-asset-usage.ts`).
 *
 *  ★★★ `[a-zA-Z0-9-]*` IS THE TAG NAME, AND IT MUST STAY DISJOINT FROM BRANCH 1
 *   OF THE ALTERNATION. An earlier spelling used a NEGATED class here
 *   (`[^\s/>"']*`), which overlaps branch 1 (`[^<>"']`) on every ordinary
 *   character — so the split point between the two was ambiguous over any run
 *   of tag-name characters and the engine explored it exhaustively. That is
 *   ~cubic, and adding `"'` to the negated class (the first attempt at this)
 *   did NOT fix it: it removed the ambiguity against branches 2 and 3 only,
 *   which is a constant factor. Measured on `"<a".repeat(k)`, negated-class
 *   spelling vs this one:
 *     2 000 B  1 071 ms  ->  0.02 ms
 *     4 000 B 12 126 ms  ->  0.03 ms
 *   128 000 B  (did not finish)  ->  0.60 ms
 *   Reproduce by pasting both literals into a script and timing
 *   `[...s.matchAll(re)]`; there is no repo fixture this large on purpose.
 *   ★★ "Linear" here is a MEASURED SHAPE, not a proof — it is linear on this
 *   family and on realistic document html (230 KB of prose + images, 0.74 ms,
 *   2 000/2 000 matches identical to the old spelling). Do not widen the claim.
 *
 *  ★★ `[\s/]` BEFORE THE ATTRIBUTE, NOT `\b`. `\b` matches between `-` and `d`,
 *   so `foo-data-asset-id="s"` satisfied it and — because the quantifier is
 *   LAZY — won over the real attribute later in the same tag: the id that
 *   actually counts went missing from the result while a bogus one took its
 *   place. Same shape as §231, reached by a different vector. `[\s/]` admits
 *   the separators a tag can really use (space, newline, tab, and the `/` an
 *   HTML parser tolerates before an attribute) and nothing else. Not reachable
 *   through the loader today (DOMPurify's `ALLOWED_ATTR` drops the decoy), but
 *   "ALREADY-SANITIZED" is a comment rather than a check and the tests here
 *   scan raw HTML. */
export const ANY_TAG_ASSET_ID_RE =
  /<[a-zA-Z][a-zA-Z0-9-]*(?:[^<>"']|"[^"]*"|'[^']*')*?[\s/]data-asset-id="([^"]*)"/g;

/**
 * The one regex an EXPORT uses for `<img data-asset-id>`. It replaced three
 * identical copies, one per renderer.
 *
 * ★★ The consequence to know: a `<p data-asset-id>` counts against the cap and
 * is invisible here — but no longer SILENTLY, since `assetRefsInDocument`
 * (`document-asset-usage.ts`) returns it as `undrawable` and the cap message
 * reports how much room removing every such reference would reclaim
 * (open-followups §218). ★ Carrier deliberately not `<span>`: that is the one
 * non-`img` tag the loader unwraps, so it cannot demonstrate this (§249).
 *
 * ★★★ QUOTE-AWARE, and it must stay that way. A plain `[^>]*` stops at the
 * first `>` even inside a quoted attribute value, and that is reachable from
 * the product's own rename control: the insert path escapes `>` to `&gt;`, but
 * the HTML serialiser does not re-escape it in an attribute, so a DOM round
 * trip hands back `alt="chart>v2.png"` verbatim. Measured: with `alt` AFTER
 * data-asset-id the match truncates and `v2.png">` survives as visible text in
 * every export; with `alt` BEFORE it the tag is missed entirely, so no bytes
 * load and the image disappears without a word.
 *
 * ★★★ BRANCH 1 EXCLUDES `<`, AND THAT IS WHAT KEEPS IT LINEAR. This docstring
 * used to claim "the three alternation branches start on disjoint character
 * classes, so there is no backtracking risk", which was false: the branches are
 * disjoint from each other, but branch 1 admitted `<`, so a run of unterminated
 * tags let each `<img` start rescan the whole tail. Measured quadratic on
 * `"<img".repeat(k) + ">"` before excluding it (exponent ~1.9); 256 KB of that
 * shape now costs 0.61 ms. Disjointness between the branches was never the
 * property that mattered — not crossing a tag boundary is.
 *
 * ★ The quantifier stays GREEDY where `ANY_TAG_ASSET_ID_RE`'s is lazy. That is
 * the documented divergence (this one reports the LAST `data-asset-id` on a
 * tag, that one the FIRST); `document-asset-patterns.test.ts` pins it. Do not
 * "harmonise" the two while fixing character classes.
 */
export const IMG_TAG_ASSET_ID_RE =
  /<img\b(?:[^<>"']|"[^"]*"|'[^']*')*[\s/]data-asset-id="([^"]*)"(?:[^<>"']|"[^"]*"|'[^']*')*>/g;

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
 *   would drop every other image-only paragraph in a document.
 *
 *  ★★★ THIS PREDICATE WAS SILENTLY DELETING REAL IMAGE BLOCKS ON LOAD, and the
 *   comment that used to sit here said the opposite. It read: the unguarded
 *   `[^>]*` is "harmless TODAY and only by cancellation", because
 *   `sanitizeBlock`'s drop is `htmlTextLength(html) === 0 &&
 *   !ASSET_IMG_TEST_RE.test(html)` and `htmlPlainProjection`'s own
 *   `TAG = /<\/?[a-zA-Z][^>]*>/g` truncates at the SAME `>`, so the first term
 *   stays non-zero and the `&&` short-circuits before the false predicate is
 *   reached. That is true for `<img alt="a>b" …>` — the one shape it was
 *   measured on — and false in general. Put a `<` after the `>` and the
 *   REMAINDER is itself eaten by `TAG`, the projection goes to zero, BOTH terms
 *   are false, and a genuine `<img>` carrying a genuine `data-asset-id` is
 *   dropped. Measured through the real `sanitizeProjectDocuments`, blocks kept
 *   out of 1:
 *     <img alt="a>b"    data-asset-id="real">  projection 24  -> 1  (kept)
 *     <img alt="><c d"  data-asset-id="real">  projection  0  -> 0  (DELETED)
 *     <img alt="></b"   data-asset-id="real">  projection  0  -> 0  (DELETED)
 *     <img data-asset-id="real" alt="><c d">   projection  0  -> 1  (kept)
 *   Attribute ORDER is the whole discriminator, and the app's own insert path
 *   writes `data-asset-id` first — which is why this survived: the two paths
 *   that do NOT control order are the AI document tool and workspace import.
 *
 *  ★★ FIXED BY MAKING THIS ONE QUOTE-AWARE, which is the SAFE direction of a
 *   choice the old comment got backwards. It warned "do NOT make one
 *   quote-aware without the other" as if the two were symmetric. They are not.
 *   Quote-awareness here only ever makes the predicate return TRUE more often,
 *   so it can only KEEP more blocks — it cannot introduce a drop. The dangerous
 *   direction is the other one: making `TAG` quote-aware alone would zero the
 *   projection for `alt="a>b"` while this predicate still said "no image", and
 *   THAT drops blocks. `rich-text-plain.ts` carries a signpost saying so.
 *   ★ One shape deliberately changes verdict the other way:
 *   `<img alt="data-asset-id=x">` was TRUE (the truncating `[^>]*` matched a
 *   decoy inside the quoted alt) and is now FALSE. It carries no real asset
 *   reference, so it is now treated like every other non-asset image — which
 *   the loader already dropped. Pinned in both directions by the tests.
 *
 *  ★ `[\s/]` and the `<`-free branch 1 are here for the same reasons as the
 *   other two patterns above: attribute-separator anchoring, and not rescanning
 *   across a tag boundary. The old spelling was quadratic — `"<img".repeat(k)`
 *   ran on RAW, uncapped, pre-sanitizer html on every load path (the cap is
 *   applied to the RETURN value, not the input), 512 KB costing 39 s of frozen
 *   main thread and persisting to IndexedDB so it repeated on every boot. Same
 *   input now costs 0.54 ms. */
export const ASSET_IMG_TEST_RE =
  /<img\b(?:[^<>"']|"[^"]*"|'[^']*')*?[\s/]data-asset-id\s*=\s*(?:"[^"]+"|'[^']+'|[^\s"'>]+)/i;
