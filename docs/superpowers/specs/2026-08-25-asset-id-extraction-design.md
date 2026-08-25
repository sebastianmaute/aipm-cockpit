# Asset-id extraction: one pattern family, and a cap that counts only references

★★★ **SUPERSEDED IN PART — THE HEADER LINE BELOW AND THE "## The pattern" SECTION ARE BOTH OUT OF
DATE.** Three things in this file no longer describe the tree. It is a dated record and is
deliberately NOT rewritten to match; the register and `docs/AGENTS/documents.md` are the current
account.

- **"Narrows: §209" is wrong — §209 is CLOSED 2026-08-25**, not narrowed. The remaining ask this
  file expected to leave open was the `document-export-assets.ts` re-export the three renderers
  reached the pattern through; that re-export was DELETED instead, and every consumer now imports
  `document-asset-patterns.ts` directly. Reproduce with `grep -n "^## 209\." docs/open-followups.md`
  and `grep -rln "document-asset-patterns" src/app`. **"Closes: §231 (both halves)" is still
  correct**, and so is "Does not touch: §218".
- **"## The pattern" publishes a literal that is now TWO revisions behind `ANY_TAG_ASSET_ID_RE`.**
  Implementation added `"'` to the tag-name class; 0.259.2 then narrowed that class to
  `[a-zA-Z0-9-]*`, excluded `<` from the first alternation branch (both to stop the engine
  rescanning across a tag boundary on adversarial input — the timings are in the module's own
  docstring) and anchored the attribute on the lookbehind `(?<![-\w])` instead of `\b`. ★★ That
  anchor was briefly `[\s/]` within the same release, which rejected real attributes written with
  no separator and deleted their paragraphs on load — §250 records it. The last of those changes
  BEHAVIOUR, so this is not a cosmetic drift: the literal below
  yields `["s"]` for `<p foo-data-asset-id="s" data-asset-id="real">` where the live pattern yields
  `["real"]` — a hyphen-prefixed decoy that beat the real attribute, because the quantifier is lazy.
  Read today's off the source, never off this page:
  `grep -n -A 1 "const ANY_TAG_ASSET_ID_RE" src/app/document-asset-patterns.ts`. ★★ The same
  staleness reaches `_probes/asset-id-extraction.mjs`, which carries its own COPY of the pattern
  (its header says so): it still reproduces the "Measured behaviour" table row for row, and diverges
  from the live pattern off that table, on exactly the shape above. The probe is left as it is.
- **The survival predicate changed after this spec was written, and this file could not know it.**
  "Quoting and case stay as they are" under "Constraints that shaped the design" was scoped to
  `ASSET_ID_RE` and still holds for its successor. But `ASSET_IMG_RE` — named `ASSET_IMG_TEST_RE`
  in the "Module shape" table below — was itself changed in 0.259.2, closing a live
  data-loss defect a cold review of this branch found: the old `[^>]*` walk truncated at a `>`
  inside an earlier attribute value, and where that `>` was followed by tag-like text a genuine
  `<img data-asset-id>` paragraph was silently DELETED on load. That is
  `docs/open-followups.md` §250, CLOSED 2026-08-25. ★★★ It is now a UNION of the old `[^>]*` form
  and a quote-aware one, NOT the quote-aware regex alone. The first fix made it quote-aware alone,
  on the reasoning — written into three files at once — that quote-awareness "can only KEEP more
  blocks, it cannot introduce a drop". That is false in both directions, and combined with the
  `[\s/]` anchor above it deleted four further classes of real image paragraph. Anyone reading this
  page for the design rationale should read §250 for what the rationale got wrong. `IMG_TAG_RE` was also renamed
  `IMG_TAG_ASSET_ID_RE`, so every mention of the old name here is a historical one.

**Date:** 2026-08-25
**Closes:** open-followups §231 (both halves). **Narrows:** §209 (three hand-maintained spellings → one module).
**Does not touch:** §218 (the divergence itself is deliberate and stays).

## Goal

`ASSET_ID_RE` (`document-asset-usage.ts`) is a bare `/data-asset-id="([^"]*)"/g` over stored
block HTML. It has no tag anchor and no quote awareness, so it matches the attribute's spelling
anywhere in the string — inside a text node, and inside another attribute's value. Two consequences,
both reproduced before this spec was written:

1. **Typed prose spends a cap slot.** `<p>data-asset-id="abc"</p>` counts against the 20-image
   per-document cap. Since 0.258.1 the cap message renders a number derived from it, offering the
   slot back as room that "removing the references no export can draw" would reclaim — which here
   means deleting the sentence the user wrote.
2. **A crafted `alt` hides the real id.** `<img alt="data-asset-id=" data-asset-id="real">` pairs the
   alt's trailing `=` with the real attribute's opening quote, yielding a phantom id while the real
   one is absent. An absent id spends no slot and can be re-inserted, defeating dedup.

Make the scanner see only what is actually an attribute, without changing what kind of element counts.

## Constraints that shaped the design

**The cap stays tag-agnostic.** §218 settled this: a reference the sanitizer preserved on a
non-`img` element still matters for deletion safety and the "used in N documents" count. Giving
`ASSET_ID_RE` an `<img>` anchor would silently change what the cap counts and what that column
means. `<span data-asset-id>` must keep counting.

**The extractor stays DOM-free.** "Route the cap through a parse" is the other fix §231 names, and it
forecloses §209's own prescription: §209 asks for a pure module that `document-model.ts` imports, and
that file is DOM-free by contract, enforced by a comment-stripped source scan asserting no `window`
or `document.`:

```bash
grep -n "codeOnly" -A 2 src/app/document-model.test.ts
```

**Quoting and case stay as they are.** Double-quote-only and case-sensitive on the attribute name are
load-bearing, not oversights: DOMPurify re-serialises every attribute double-quoted on load, and two
tests pin that a single-quoted `<img>` and an uppercase `<IMG DATA-ASSET-ID>` survive load while
staying invisible to this scanner. Widening either is a separate decision, out of scope here.

## The pattern

```
/<[a-zA-Z][^\s/>]*(?:[^>"']|"[^"]*"|'[^']*')*?\bdata-asset-id="([^"]*)"/g
```

`(?:[^>"']|"[^"]*"|'[^']*')` is the quote-stepping alternation `IMG_TAG_RE` already uses and that
§209 records as measured against attribute-order failures in both directions. A preceding `alt="…"`
is consumed whole as one alternative, so its contents cannot supply an opening quote. Text content
cannot match at all: there is no start tag.

The empty-id filter stays at the call site (`.filter(id => id.length > 0)`). `ASSET_ID_RE` and
`ASSET_IMG_RE` agree on emptiness through two different mechanisms in two files, and §209 says to
keep that variation as a parameter rather than flatten it.

## Measured behaviour

Reproduce with `node docs/superpowers/specs/_probes/asset-id-extraction.mjs` (committed beside this
spec). Every row below is that script's output, not reasoning.

| input | `all` today | `all` after | `drawable` (unchanged) |
|---|---|---|---|
| `<img data-asset-id="real" alt="x">` | `["real"]` | `["real"]` | `["real"]` |
| `<span data-asset-id="x">t</span>` | `["x"]` | `["x"]` | `[]` |
| `<p>data-asset-id="abc"</p>` | `["abc"]` | `[]` | `[]` |
| `<img alt="data-asset-id=" data-asset-id="real">` | `[" data-asset-id="]` | `["real"]` | `["real"]` |
| `<img data-asset-id="r1" alt="data-asset-id="><img data-asset-id="r2" alt="x">` | `["r1","><img data-asset-id="]` | `["r1","r2"]` | `["r1","r2"]` |
| `<img data-asset-id='sq'>` | `[]` | `[]` | `[]` |
| `<IMG DATA-ASSET-ID="d">` | `[]` | `[]` | `[]` |
| `<IMG data-asset-id="up">` | `["up"]` | `["up"]` | `[]` |
| `<img data-asset-id="">` | `[]` | `[]` | `[]` |
| `<img alt="a>b" data-asset-id="real">` | `["real"]` | `["real"]` | `["real"]` |

★★ **THREE behaviours change, not two.** Beyond the two halves of §231, a malformed
`<imgdata-asset-id="x">` (no space before the attribute) counts today and will not after — the tag
name is consumed and `\b` refuses the boundary between `g` and `d`. It is invalid HTML the sanitizer
drops, but it is a third narrowing and is recorded here so it is not discovered later.

★ **Case-sensitivity applies to the ATTRIBUTE name, never the tag name.** `<IMG data-asset-id="up">`
is counted before and after; `<IMG DATA-ASSET-ID="d">` is counted by neither. The existing uppercase
test uses the second shape, so it is unaffected — a reader checking only the test name would expect
otherwise.

★ An HTML comment (`<!-- <img data-asset-id="c"> -->`) is counted before and after: `<!` is not a tag
start, but the inner `<img` is. Unchanged, and the sanitizer strips comments upstream regardless.

★ **`drawable ⊆ all` holds on every row above after the change, and is still not guaranteed by
construction.** The two sets come from two patterns over raw HTML. What changes is that no known
input violates it; the type's warning stays, and the constructor test below is what actually protects
the cap message's arithmetic.

## Module shape (§209)

New file **`src/app/document-asset-patterns.ts`** — DOM-free, imports nothing, so it cannot join the
`settings-types ⇄ workspace ⇄ document-model` cycle §92 records. §209 rejects a mechanical fold and
asks for the divergences as parameters; this keeps them as three named exports whose differences sit
side by side in one file, where a reader fixing one can see the other two.

| export | anchor | quoting | attr case | global | captures | consumer |
|---|---|---|---|---|---|---|
| `ANY_TAG_ASSET_ID_RE` | any start tag | `"` only | sensitive | yes | id | cap + usage |
| `IMG_TAG_RE` | `<img …>` | `"` only | sensitive | yes | id | exports, renderers |
| `ASSET_IMG_TEST_RE` | `<img` | `"` / `'` / bare | INsensitive | no | — | load predicate |

`document-export-assets.ts` keeps a one-line re-export of `IMG_TAG_RE`, so the three renderers'
imports do not change.

★ The third stays NON-global deliberately: a `/g` regex carries `lastIndex` across `.test()` calls and
would drop every other image-only paragraph. The two global ones are safe as module consts because
`String.prototype.matchAll` does not mutate the original's `lastIndex`; both call sites use `matchAll`.

## Test plan

Two existing tests in `document-asset-usage.test.ts` pin the DEFECT and must invert. That is the
honest cost of the change and both inversions are deliberate:

- **"lets a crafted alt put an id in `drawable` that is NOT in `all`"** → becomes "a crafted alt no
  longer hides the real id from `all`". Its second half pinned the CONSTRUCTOR (`undrawable` is built
  by filtering `all`, so `undrawable ⊆ all` is constant-true) and survives as its own test — the cap
  message's reclaimable-room arithmetic subtracts one size from the other and would go negative.
- **"does NOT escape a data-asset-id a user merely TYPED as prose"** → the sanitizer claim stays true
  and stays asserted (text-node serialisation escapes `&`, `<`, `>` and never `"`). What flips is the
  consequence: `all` becomes empty. The module header's replacement claim is rewritten with it —
  sanitising still is not a guard, but the module no longer needs it to be.

Kept untouched, and the regression guard that matters most: **"counts a `<span>` reference against the
cap but NOT as drawable"**. That test fails if anyone later narrows this to `<img>`-only.

New tests:

In commit 1, beside the two inversions:

1. The two-images-in-one-paragraph bleed: `["r1","><img data-asset-id="]` → `["r1","r2"]`.
2. The malformed glued-tagname narrowing, so the third behaviour change is pinned rather than latent.

In commit 2, with the module it describes:

3. A `document-asset-patterns.test.ts` asserting the three exports' divergence table directly, so the
   family's differences are gated in the file that declares them. The existing
   "what each deliberately does not see" block in `document-asset-usage.test.ts` stays where it is
   and imports from the new module — it probes through the LOAD path, which the new file's test does
   not, so the two are not redundant.

★ Mutation check before the slice is called done: revert the pattern to the old spelling and confirm
the two new tests AND both inverted tests go red. A test that passes against the old regex is pinning
nothing.

## Commit shape

Two commits, in this order. §209 warns that giving `ASSET_ID_RE` an `<img>`-ward change silently
inside a deduplication commit is worse than either change made deliberately; this inverts that.

1. **Behaviour.** Change the pattern in place in `document-asset-usage.ts`, invert the two
   characterization tests, add the two new cases, rewrite the module header. Green.
2. **Structure.** Add `document-asset-patterns.ts`, move all three declarations into it, re-export
   `IMG_TAG_RE` from `document-export-assets.ts`, point `document-model.ts` and
   `document-asset-usage.ts` at the new module. Behaviour-PRESERVING, verified against the tests
   commit 1 just added.

## Out of scope

- §218's divergence — deliberate, stays.
- Single-quote and uppercase-attribute widening — a separate decision with its own pinned tests.
- §217, §221 — both blocked on §219 (nothing in this repo has opened a produced `.docx`/`.pptx`).
- §225 — deliberate, recorded to STOP the obvious tightening.
- The cap message's wording. Once prose no longer counts, half one dissolves without touching copy.

## Register updates owed in the same slice

- §231 → CLOSED, with the measured table above.
- §209 → narrowed: the remaining ask was `ASSET_ID_RE` ⟷ `ASSET_IMG_RE`; after this the family lives
  in one module and what stays open is only whether the renderers should import from there directly
  rather than through the re-export.
- `document-asset-usage.ts`'s module header: the §231 paragraph describes behaviour this slice
  removes. Sweep for prose describing the old behaviour rather than editing only the entry.

## Data and migration

None. These counts are derived per render, never stored. A document sitting at the cap because of
typed prose silently regains slots, which is the fix.
