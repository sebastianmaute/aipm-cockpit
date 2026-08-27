# Bounding the DOM-free rich-text boundary — design

**Date:** 2026-08-27 · **Branch:** `fix/rich-text-boundary-bounds` · **Base:** 0.262.1 "Swainston" (`adacc564`)

**Closes:** `docs/open-followups.md` §251 · §253 · §31 · §208.
**Deliberately does NOT close:** §252 (the unquoted-`/` divergence) or §250 (already closed) — see
"Out of scope" below.

## Goal

Four filed entries share one boundary — `rich-text-plain.ts` and the asset-id patterns beside it —
and they cannot be fixed independently, because two of them meet in a single line of code. Bound the
*work* that boundary does on hostile input, bound the *bytes* it stores, and stop it silently
deleting an image on the way.

## Why these four are one slice

| | defect | class |
|---|---|---|
| §251 | `TAG` and `BLOCK_TAG` are quadratic on unterminated tags, on every rich-field load path | availability |
| §253 | `IMG_TAG_ASSET_ID_RE` is quadratic on an unterminated `<img` carrying repeated attributes | availability |
| §31 | the cap measures VISIBLE TEXT, so markup bytes are unbounded, on all six backends | bloat / abuse |
| §208 | an over-cap paragraph silently loses its `<img data-asset-id>` | data loss |

§31 and §208 are the same line of code: `capHtmlText`'s overflow branch,
`return plainToHtml(text.slice(0, cut))`. §31 wants a *byte* ceiling on top of it; §208 wants it to
stop discarding markup. Deciding either alone forecloses the other.

§251 and §253 join them because a byte ceiling that truncated raw html would manufacture exactly the
unterminated-tag input the other two entries are about. Fixing the ceiling without the matchers would
turn an abuse case into a self-inflicted one.

## Measurements taken for this design

All run 2026-08-27 on this checkout. Reproduce before relying on any cell; the register records that
these figures re-measure with a 2-3x spread while the SHAPE reproduces every time.

**The quadratic, with a positive control** (`s.replace(re, " ")` over `"<a".repeat(k)` / `"<p".repeat(k)`):

```
TAG        16KB=66ms   32KB=318ms   64KB=1120ms   128KB=6617ms
BLOCK_TAG  16KB=122ms  32KB=616ms   64KB=2236ms   128KB=7226ms
control    TAG over 128KB of CLOSED tags ("<a>".repeat(k)) = 8.4 ms
```

The control is what attributes the cost to the missing `>` rather than to the byte count: ~800x
separation at equal size. `BLOCK_TAG` is affected, confirming §251's own correction of itself.

**html:visible-text ratios**, to derive the byte ceiling. The real corpus is too thin to set a
constant from — `sample-workspace-small.json` has 29 non-empty rich fields of which only 5 are
html-start, max ratio 1.38x, largest field 458 B — so the ceiling is derived from constructed
worst-case LEGITIMATE formatting, with the corpus as a floor check:

```
plain paragraphs                1.0x        every word a link            6.3x
one-word list items             2.8x        table, one word per cell     6.5x
every word bold                 2.9x        highlight+style per word     8.3x   <- worst legitimate
bold+italic per word            3.9x
                                            corpus max                   1.38x

<em></em> x200000        1,800,008 B / 1 visible char =   1,800,008x   <- §31 abuse
500k-char attribute        500,018 B / 1 visible char =     500,018x   <- §31 abuse
```

Three orders of magnitude separate the worst legitimate shape from the abuse shapes. That gap is what
makes a ratio-based ceiling safe.

## Architecture

Three units, each testable alone.

### (a) Bounded matchers

`TAG` and `BLOCK_TAG` (`rich-text-plain.ts`) exclude `<` from their attribute run: `[^>]*` becomes
`[^<>]*`. `IMG_TAG_ASSET_ID_RE` (`document-asset-patterns.ts`) already excludes `<`; its residual
backtracking is the greedy alternation re-splitting WITHIN one unterminated tag region, which a
character class cannot reach, so it takes atomic-group emulation — `(?=((?:…)*))\1` — instead.

The governing principle is already written in this repo, in `ANY_TAG_ASSET_ID_RE`'s docstring:
*"Disjointness between the branches was never the property that mattered — not crossing a tag
boundary is."* This slice applies that same principle to the three matchers that still lack it.

**The one behaviour change, and it is deliberate.** `[^<>]*` alters exactly one shape:
`<img alt="a<b" …>` projects 0 -> 11 visible characters. That is the SAFE direction for `sanitizeBlock`'s
drop condition (`htmlTextLength(html) === 0 && !ASSET_IMG_TEST_RE.test(html)`) — the block survives
rather than being dropped. The cost is that 11 characters of raw markup surface as "visible text" for
that input. §251 records the objection that this breaks a plain-text export; see the export-path
proof obligation under "Testing" for why that does not reach the export callers, and for what is owed
before anyone relies on it.

### (b) `degradeToPlain(html, max)`

A new DOM-free export in `rich-text-plain.ts`, and the single overflow path:

1. extract the `<img data-asset-id>` tags, **bounded by an explicit cap inside this function**, not by
   an assumption about who calls it — a caller-side cap would be a bound this unit cannot see, which is
   how an "already bounded" input becomes an unbounded one after a refactor. The extraction runs against
   the matcher fixed in (a), so it inherits that bound too;
2. flatten the remainder to text via the existing projection and truncate it at `max`;
3. re-append the extracted image tags.

**The surrogate-pair and `max <= 0` handling MOVES here from `capHtmlText`, which then delegates** —
it is not duplicated. Those two guards are the subject of a three-star comment recording that
`capHtmlText(-1)` once returned a lone surrogate from the very function whose job is to never emit
one, and that `clipText` (`sanitize-core.ts`) carries the identical fix and must agree with it at the
boundary. A second copy is a second thing to get wrong, and the comment's claim that the two agree
would silently become a claim about three.

Note that images are reachable only through `DOCUMENT_SINK` — the rich-entity allow-list has no `img`
— so step 1 and step 3 are no-ops for RAID, change and milestone fields. That is a property to assert,
not to rely on quietly.

Markup-aware truncation is NOT an option and this is a hard constraint, not a preference:
`rich-text-plain.ts` is DOM-free by contract (its header explains that a DOMPurify call there makes
`jsonToWorkspace` silently produce an empty workspace under bare node). Anything that needs to
understand tree structure to truncate correctly is therefore out of reach in this file.

### (c) A raw-byte ceiling in `sanitizeRichText`

`RICH_BYTE_CEILING(max) = max * 32 + 1024`.

- **K = 32** from the table above: 3.9x headroom over the worst legitimate shape measured (8.3x),
  four to five orders of magnitude below the abuse shapes.
- **+1024** so a small `max` still admits its wrapper markup.
- Applied to `TEXTAREA_MAX` (5000) it is 161,024 B; to `MAX_HTML_TEXT_CHARS` (20000), 641,024 B.

Expressed as a ratio rather than two absolute constants so the four rich entities and the document
sink cannot drift apart from the visible-text caps they are paired with.

Over-ceiling input routes through `degradeToPlain`, so the ceiling can never emit malformed html.

## Data flow

Unchanged except at overflow:

```
codec / import / AI write
  -> sanitize-records.ts        (the entity sanitizers)
    -> sanitizeRichText(raw, max, sink)
      -> descriptionHtml        (legacy plain -> html, or verbatim pass-through)
      -> capHtmlText(html, max)
        -> overflow?            -> degradeToPlain(html, max)      <- NEW, one path
      -> raw bytes > ceiling?   -> degradeToPlain(html, max)      <- NEW
```

## This applies on LOAD as well as write

`sanitizeRichText` is called from `sanitize-records.ts`, which runs on every load path. The byte
ceiling therefore rewrites already-stored data when an oversized record is read.

That is the same posture the VISIBLE-TEXT cap has held all along — `capHtmlText` already truncates on
load — so this is consistency, not a new power. It is also the only way §31's existing 1.8 MB rows are
ever repaired; a write-only ceiling leaves them oversized forever on all six backends.

It is stated here because it is the decision in this design most likely to surprise someone later.

## Error handling: `logDiag`, deliberately not the truncation channel

A degrade logs `logDiag("warn", …)` carrying the field and the before/after byte counts.

It must NOT raise `lastLoadTruncation`. That channel blocks writes through
`mayCommitAfterTruncation`, on the premise that *the source still holds what was not loaded* — true
for a document whose blocks were dropped, false here. A degrade is idempotent and already committed,
so blocking the flush would strand the user with a workspace the app refuses to save, to protect data
that is not recoverable from anywhere else. The diagnostic is the right channel; the write barrier is
not.

## Testing

- **Differential corpus.** Old matcher vs new over a corpus of tag shapes — quoted, unquoted,
  single-quoted, `>` inside an attribute, `<` inside an attribute, unterminated, mixed case. They must
  agree on every shape except the one enumerated above, which is asserted explicitly with its
  before/after values.
- **The export-path claim, with a positive control.** `htmlToText` runs DOMPurify with
  `ALLOWED_TAGS: [], ALLOWED_ATTR: []`, and `rich-text-projection.ts` calls `htmlPlainProjection` on
  its OUTPUT — so no tag and no attribute value survives to that point and `<` can only appear as
  `&lt;`. If that holds, the matcher change is a provable no-op for `descriptionText` /
  `descriptionTextWithBreaks`, and therefore for search, exports, the AI digests, Jira and dedup.
  **This was derived by reading, not measured. It is a proof obligation of task 1, not an
  established fact, and the design does not get to lean on it until a test with a positive control
  says so.**
- **Documents' own load-path tests.** `document-model.test.ts` runs against the new matchers. §251
  requires this by name, and it is the suite that would catch a repeat of §250.
- **§208.** An over-cap paragraph carrying an asset image round-trips with the image intact.
- **§31.** The 1,800,008 B fixture stores bounded bytes; the 8.3x legitimate fixture is untouched.
- **Timing assertions, calibrated against vacuity.** A budget test pins nothing unless it FAILS on the
  unfixed regex. Each timing assertion is proved red against the pre-fix pattern before it is kept,
  and the budget is a wall-clock ceiling generous enough to survive a loaded machine — the register
  records these figures moving 2-3x between runs.

## Risks

- **Narrowing these patterns has a history.** §250 was a silent data-loss defect and §253 a ReDoS,
  produced one per attempt at narrowing this family. The mitigation is the differential corpus plus
  documents' load-path tests, not care.
- **The load-side rewrite** above. Stated, tested, logged.
- **`rich-text-plain.ts` file size.** It is 343 lines today; `degradeToPlain` and its docstring fit
  well inside the 800-line ratchet.

## Out of scope

- **§252** (all three `data-asset-id` patterns treat `/` as an attribute separator unconditionally).
  It is a correctness divergence needing quote-state tracking, which is the third of the three
  independent narrowings §250 warns against conflating. It also errs toward KEEPING blocks, so it
  cannot delete data. Fixing it beside two other changes to the same patterns is how §250 happened.
- **§250** — already closed; this slice must not regress it, which is what the load-path tests are for.
- The visible-text caps themselves (`TEXTAREA_MAX`, `MAX_HTML_TEXT_CHARS`) keep their current values.

## Verification owed beyond CI

None specific to this slice: every unit here is DOM-free engine code reachable from vitest. No axe
view, no Turso-gated surface, no eye-verify.
