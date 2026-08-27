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
 *   which is a constant factor. On `"<a".repeat(k)` the negated-class spelling
 *   grows superlinearly into whole SECONDS by ~128 KB while this one stays
 *   sub-millisecond across the same range.
 *   ★★ NO FIGURES ARE QUOTED, DELIBERATELY: three independent re-measurements
 *   of the removed literal disagreed with each other and with the table that
 *   used to sit here. Only the direction reproduces. Reproduce by pasting both
 *   literals into a script and timing `[...s.matchAll(re)]`; there is no repo
 *   fixture this large on purpose.
 *   ★★ "Linear" here is a MEASURED SHAPE, not a proof — it is linear on this
 *   family and on realistic document html (230 KB of prose + images, 0.74 ms,
 *   2 000/2 000 matches identical to the old spelling). Do not widen the claim.
 *
 *  ★★★ `(?<![-\w])` BEFORE THE ATTRIBUTE, NOT `\b` AND NOT `[\s/]`. Both
 *   rejected spellings are recorded here because each was wrong in the
 *   OPPOSITE direction and the second was shipped.
 *   `\b` is too WIDE: it matches between `-` and `d`, so `foo-data-asset-id="s"`
 *   satisfied it and — because the quantifier is LAZY — won over the real
 *   attribute later in the same tag: the id that actually counts went missing
 *   while a bogus one took its place. Same shape as §231, different vector.
 *   `[\s/]` is too NARROW, and this is the expensive one. It admits only the
 *   separators a WELL-FORMED tag uses, but an HTML parser also recovers from a
 *   MISSING one: on `<img alt="x"data-asset-id="real">` the tokenizer closes
 *   the quoted value, hits a character that is not whitespace, `/` or `>`,
 *   raises `missing-whitespace-between-attributes` and RECONSUMES it in
 *   before-attribute-name state — so the second attribute is real, and a
 *   parser confirms it. `[\s/]` sees no separator, matches nothing, and every
 *   consumer of this pattern goes blind at once: the cap undercounts, the
 *   duplicate check misses, the export cannot draw the image, and — via
 *   `ASSET_IMG_TEST_RE` below, which shared the anchor — the whole paragraph
 *   was SILENTLY DELETED on load. That is §250's own defect, reintroduced by
 *   its own fix; §250 records the round.
 *   ★★ The lookbehind is what both spellings were reaching for: it rejects a
 *   `-` or word character immediately before the attribute name (killing the
 *   `foo-` decoy and a bare `xdata-asset-id`) while caring nothing about what
 *   the separator IS, or whether one exists at all. Not reachable through the
 *   loader today (DOMPurify's `ALLOWED_ATTR` drops the decoy), but
 *   "ALREADY-SANITIZED" is a comment rather than a check and the tests here
 *   scan raw HTML. */
export const ANY_TAG_ASSET_ID_RE =
  /<[a-zA-Z][a-zA-Z0-9-]*(?:[^<>"']|"[^"]*"|'[^']*')*?(?<![-\w])data-asset-id="([^"]*)"/g;

/**
 * The one regex an EXPORT uses for `<img data-asset-id>`.
 *
 * ★ Two different "three"s meet here and they are unrelated. This pattern
 * folded three IDENTICAL copies, one per renderer, in `e7b327a0` — long before
 * this module existed. The module header's "three different files" is the
 * separate, later fold of the three DIVERGENT spellings (§209).
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
 * ★★★ THE GUARD LOOKAHEAD IS WHAT MAKES THIS LINEAR. Excluding `<` (which the
 * runs already do) bounds a scan to one tag REGION; it does nothing about the
 * two runs NESTED around the id re-splitting inside that region when the closing
 * `>` never arrives. Measured 2026-08-27: 143 ms at 32 KB rising to 16098 at
 * 256 KB, against 2.5 ms for the guarded form at the same size. The guard fails
 * once, in linear time, on a tag that never closes — so neither run ever starts.
 * ★★★ ATOMIC-GROUP EMULATION — `(?=(X*))\1` — WAS TRIED HERE AND MATCHES
 * NOTHING. The atomic run swallows the attribute list and will not give it back,
 * so the `data-asset-id="` that must follow can never match: `<img
 * data-asset-id="x">` yields zero matches, i.e. every asset image silently stops
 * being recognised. Do NOT reintroduce it.
 * ★ The id is capture group 1 and the guard is deliberately non-capturing so it
 * stays that way. A renumbering here fails SILENTLY — a reader left on `m[1]`
 * would get the whole attribute run, which is a non-empty string, so a
 * truthiness check still passes.
 *
 * ★ The quantifier stays GREEDY where `ANY_TAG_ASSET_ID_RE`'s is lazy. That is
 * the documented divergence (this one reports the LAST `data-asset-id` on a
 * tag, that one the FIRST); `document-asset-patterns.test.ts` pins it. Do not
 * "harmonise" the two while fixing character classes.
 */
export const IMG_TAG_ASSET_ID_RE =
  /<img\b(?=(?:[^<>"']|"[^"]*"|'[^']*')*>)(?:[^<>"']|"[^"]*"|'[^']*')*(?<![-\w])data-asset-id="([^"]*)"(?:[^<>"']|"[^"]*"|'[^']*')*>/g;

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
 *  ★★★ FIXED BY A UNION, AND THE FIRST ATTEMPT AT THIS FIX MADE THE DEFECT
 *   WORSE. That attempt made the predicate quote-aware ALONE, on the reasoning
 *   — written here as fact — that "quote-awareness only ever makes the
 *   predicate return TRUE more often, so it can only KEEP more blocks; it
 *   cannot introduce a drop." That is FALSE, and it was contradicted by the
 *   very next line of the comment that asserted it, which named a shape whose
 *   verdict flipped the other way. Quote-awareness is not monotone in EITHER
 *   direction: it also flips `<img alt=it's data-asset-id="real">` from TRUE to
 *   FALSE, and unlike the decoy that one carries a REAL attribute. Narrowing
 *   the anchor to `[\s/]` at the same time cost three more. Net effect of the
 *   "safe" fix, all four confirmed against a real parser and all four DELETED
 *   on load where the pre-fix predicate kept them:
 *     <img alt="x"data-asset-id="real">     missing separator, double-quoted
 *     <img alt='x'data-asset-id="real">     missing separator, single-quoted
 *     <img alt=it's data-asset-id="real">   unpaired quote in unquoted value
 *     <img alt=a<b  data-asset-id="real">   `<` in an unquoted value
 *   Branch 1 recovers the first three; branch 2 is quote-aware and recovers
 *   `alt="a>b"`, which truncates branch 1.
 *
 *  ★★★ NEITHER BRANCH MAY SCAN PAST A `<`, AND THE FIX FOR THE ABOVE BROKE
 *   THAT. Its branch 1 was the pre-fix `[^>]*`, which walks across tag
 *   boundaries, so every `<img` in the input restarts a scan over the whole
 *   tail: quadratic, and MEASURED WORSE THAN THE SPELLING IT REPLACED. It is
 *   reachable — `sanitizeBlock` only evaluates this predicate when the
 *   projection is zero, and `"<img ".repeat(n) + ">"` projects to zero because
 *   `TAG` eats it as one match. This runs on RAW, uncapped, pre-sanitizer html
 *   on every load path (the cap applies to the RETURN value, not the input),
 *   and the offending block is itself stored, so the cost repeats on every
 *   boot. `[^<>]*` bounds each scan to one tag and restores linearity.
 *   ★★ So the constraint is two-sided and both sides have now been violated
 *   once: this predicate must not NARROW (it guards a deletion — see the shapes
 *   above) and must not scan across `<` (it runs unbounded on hostile input).
 *   A change satisfying only one of those has been shipped twice on this
 *   branch. Measure any replacement against BOTH the shape table in
 *   `document-asset-patterns.test.ts` and `"<img ".repeat(n) + ">"`.
 *   ★ THE PRICE, and it is a real one: `<img alt=a<b data-asset-id="real">`
 *   carries a genuine attribute and is now dropped, because no branch may
 *   cross the `<`. It needs an unquoted attribute value containing `<` in raw
 *   stored html — DOMPurify quotes and escapes it — which is why the freeze was
 *   judged the worse of the two. Do not "restore" it by widening branch 1 back.
 *   ★★ THAT IS THE BEFORE CASE ONLY, and reading it as "a bare `<` costs the
 *   block" is wrong in a way that hides a live divergence. Put the same value
 *   AFTER the target attribute — `<img data-asset-id="real" alt=a<b>` — and
 *   this predicate says KEEP and `ANY_TAG_ASSET_ID_RE` charges the id against
 *   the 20-image cap, while `IMG_TAG_ASSET_ID_RE` still returns NOTHING,
 *   because the closing `>` is unreachable without crossing the `<`. So the
 *   loader keeps a paragraph every renderer draws nothing for. Which side of
 *   the attribute the `<` falls on decides WHICH consumer loses, and neither
 *   direction is fixable without scanning past `<`. Both rows are in the shape
 *   table.
 *   ★ ONE shape is deliberately kept that a narrower pattern would drop:
 *   `<img alt="data-asset-id=x">` (a decoy inside a quoted value, no real
 *   asset) stays TRUE via branch 1 — the false-TRUE direction, where the block
 *   survives as a source-less image instead of vanishing.
 *   `IMG_TAG_ASSET_ID_RE` and `ANY_TAG_ASSET_ID_RE` correctly return NOTHING
 *   for it, so it costs no cap slot and no export. */
export const ASSET_IMG_TEST_RE =
  /<img\b[^<>]*(?<![-\w])data-asset-id\s*=\s*(?:"[^"]+"|'[^']+'|[^\s"'>]+)|<img\b(?:[^<>"']|"[^"]*"|'[^']*')*?(?<![-\w])data-asset-id\s*=\s*(?:"[^"]+"|'[^']+'|[^\s"'>]+)/i;
