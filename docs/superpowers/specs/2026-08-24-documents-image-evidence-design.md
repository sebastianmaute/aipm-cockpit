# Documents images — package evidence and the asset-reference divergence (§216 · §218)

Date: 2026-08-24
Baseline: 0.257.1 "Shepard", `main` @ `08a3b26e`
Closes: `docs/open-followups.md` §216, §218
Deliberately does NOT touch: §217, §219, §221, §222 — see "What this slice refuses".

## Problem

Two open entries in the documents-image cluster can be closed without opening an Office
file. Both are evidence problems, not behaviour problems.

**§216 — the OOXML builders' additive contract is pinned by hand-written substring
assertions and by nothing else.** Measured 2026-08-22: hardcoding a
`<Default Extension="png"/>` into the EMPTY-media case of both builders reddens four
tests, and **neither "byte" test catches it by its byte comparison**. The DOCX one
compares `buildDocxPackage(body, "", "portrait")` against
`buildDocxPackage(body, "", "portrait", [])` — the builder against ITSELF, so any change
moving the 3-arg and 4-arg shapes equally passes. The PPTX one
("leaves the media-free package byte-for-byte what it was") survived the mutant outright:
it pins a sorted part-key set, one `slide1.xml.rels` part, and the absence of
`ppt/media/`, never reading `[Content_Types].xml` at all. What caught the mutant in all
four cases was somebody having thought to assert that specific string.

**§218 — the patterns that read asset ids out of a document do not agree on what an
asset reference is,** and the divergence is invisible at every layer. A
`<span data-asset-id="x">` consumes one of the 20 per-document slots, contributes to no
export, and lands in none of `inlined` / `omitted` / `missing`. Nothing tells the user
why the cap filled.

## What already exists

Measured against `08a3b26e`. Reproduce commands given where a number is load-bearing.

| Thing | Where | Shape |
|---|---|---|
| DOCX builder | `buildDocxPackage` (`ooxml-docx-primitives.ts`) | `(bodyXml, extraStyles?, page?, media?) => Blob`; throws if a media part claims `rId1` (the styles part) |
| PPTX builder | `buildPptxPackage` (`ooxml-pptx-primitives.ts`) | `(slides) => Blob` where a slide is `{xml, media}`; throws if a media part claims `rId1` (the slide layout) |
| Zip writer | `buildZip` (`zip.ts`) | STORE-only; **stamps `new Date()` into every local header and the central directory** |
| Unzip (test-only) | `unzipBytes`, `partText` (`src/test/unzip-bytes.ts`) | `Blob => Map<path, Uint8Array>`, walking local file headers |
| Committed fixtures | `src/app/__fixtures__/` | `golden-workspace.csv` and `golden-workspace.md` — **no OOXML fixture of any kind** |
| Cap scanner | `ASSET_ID_RE` (`document-asset-usage.ts`) | `data-asset-id="…"` on ANY element, double-quote only, `/g` |
| Export resolver | `IMG_TAG_RE` (`document-export-assets.ts`) | `<img` tag, quote-aware, double-quote value; shared by `documentAssetIds` and all three renderers |
| Load survival | `ASSET_IMG_RE` (`document-model.ts`) | `<img`, case-INSENSITIVE, all three quoting styles, NOT `/g`, `.test()` only |
| Cap enforcement | `insertAssets` (`documents-asset-section.tsx`) | running `present` set; sets `capMessage` when an insert is skipped |
| Cap message | `assetLibraryMaxPerDocument` | one positional arg, the cap number |
| Load composition | several call sites | `sanitizeProjectDocuments(raw).map(sanitizeDocumentRichFields)` — structural pass THEN DOMPurify |

Enumerate the load sites rather than trusting any count:

```bash
grep -rn "sanitizeProjectDocuments(.*)\.map(sanitizeDocumentRichFields)" src/app --include="*.ts" | grep -v "\.test\."
```

★★ Note the callers that run the STRUCTURAL pass alone (`ai-document-blocks.ts`,
`document-versions.ts`) — they are the reason Decision 5 pins an ordering rather than
assuming one, and any work here must check what they do with the result.

## Decisions

Each was an explicit fork, resolved before design.

### 1. An ORDERED part manifest, not a committed package blob

§216 offers "a committed package or a checked-in MANIFEST" as a free choice. **The
package arm does not work as stated.** `zip.ts` builds its DOS timestamp from
`new Date()` and writes it into every local file header and the central directory, so two
builds a second apart differ in bytes. A committed `.docx` would fail on essentially
every run. Only the PART bytes are deterministic; the zip container is not.

The manifest records, per package, the part paths **in ZIP ORDER** with a SHA-256 each:

```json
{ "docx": { "parts": [ { "path": "[Content_Types].xml", "sha256": "…" } ] },
  "pptx": { "parts": [ /* same shape */ ] } }
```

**Ordered, not sorted, and that is the whole reason this beats the obvious version.** A
sorted list cannot see entry reordering, and OPC readers can care which part leads a
package. Ordered, all four failure classes — reorder, addition, removal, content change —
go red, and each names a part. A blob would have pinned the container too but failed as
"bytes differ", which is strictly worse diagnostics for the common case.

### 2. Regeneration is an explicit act, never a test flag

`npm run ooxml:manifest` regenerates. There is deliberately no `vitest -u` path to it.
§216's "Not free" paragraph names re-baselining-to-admit-your-own-change as the failure
mode this fixture must be designed against; an inline snapshot would have handed exactly
that to anyone with a red pipeline.

★ A new script also needs a `scriptsDescriptions` entry or `docs:scripts:check` fails.

### 3. The clock seam is injectable, and the DEFAULT DOES NOT CHANGE

`buildZip` gains an optional `modified` parameter defaulting to `new Date()`. The
manifest test passes a fixed date so package bytes become fully deterministic under test.

**Real exports are unchanged and remain irreproducible.** That is deliberate: `zip.ts`
justifies the live timestamp by Windows Explorer showing a plausible date, and changing
the default would alter what every user sees in a file listing — a visible behaviour
change made for a property no user asked for. The seam leaves that one flip away for
whoever wants it, on its own evidence.

### 4. The three id patterns are made VISIBLE, not merged

§218 is explicit that neither pattern should be made to match the other: the export
resolver is deliberately tag-anchored (it must only fetch bytes for something it can
draw) and the usage scanner deliberately tag-agnostic (a reference the sanitizer
preserved on a non-`img` element still matters for deletion safety). So the fix states
the divergence rather than collapsing it.

`ASSET_IMG_RE` is a third pattern §218 does not name, and it cannot join the shared
helper's return shape because **it yields no ids** — it is `.test()`-only, a survival
predicate deciding whether an image-only paragraph is kept on load. It gets a test.

### 5. The quoting divergence is pinned at its CAUSE

`ASSET_IMG_RE` accepts `data-asset-id='x'` and a bare unquoted value; `ASSET_ID_RE` and
`IMG_TAG_RE` both require a double-quoted value. Today that is harmless, and the reason
is an ORDERING: the structural pass runs before any allow-list pass, and DOMPurify
normalises attribute quoting before the other two patterns ever see the HTML.

**Nothing currently pins that ordering.** If a load path were ever composed the other way
round — or a caller ran the structural pass alone and stored the result — a single-quoted
reference would survive load and be invisible to both the cap and every export, with no
error anywhere. This slice asserts the order itself, not merely its consequence.

## Design

### §216 — the package manifest

**New:** `docs/baselines/ooxml-parts.json`; a regeneration script; a test in the existing
`unit-tests` job.

**No new CI job.** The check rides `unit-tests`, which is already blocking, so
`.gitlab-ci.yml` and AGENTS.md's CI line are untouched. A new gate would have required
both, plus an entry in the hard-constraints list.

**The subjects are the media-free packages**, since that is the contract §216 says is
unpinned: `buildDocxPackage("<w:p/>", "", "portrait")` and
`buildPptxPackage([{xml: "<p:sld/>", media: []}])`.

**Shared manifest logic** lives beside `unzipBytes` in `src/test/`, so the test and the
regeneration script compute it identically. A manifest the script and the gate derive
differently is a gate that cannot fail.

**Failure output names the part.** A digest mismatch prints the path; a length or order
difference prints both sequences. "Bytes differ" is not an acceptable failure message
for this fixture — diagnosability is the reason it beat the blob.

### §218 — the shared helper

`document-asset-usage.ts` (42 lines) gains one export:

```ts
export type AssetRefs = {
  /** Ids on ANY element — what the 20-image cap counts. */
  all: ReadonlySet<string>;
  /** Ids on an <img> tag — what an export can actually draw. */
  drawable: ReadonlySet<string>;
  /** all minus drawable: holds a cap slot, exports nothing, appears in no bucket. */
  undrawable: ReadonlySet<string>;
};
export function assetRefsInDocument(doc: ProjectDocument): AssetRefs;
```

`assetIdsInDocument` remains, returning `assetRefsInDocument(doc).all`, so its existing
callers are untouched.

**Import direction is `document-asset-usage` → `document-export-assets`, which is
acyclic today** (export-assets reaches only `document-model` and
`document-asset-images`). Stated because §92 records a live
`settings-types` ⇄ `workspace` ⇄ `document-model` cycle in this neighbourhood; verify
before adding the edge, do not assume.

### §218 — the user-visible cap reason

`capMessage` currently renders `assetLibraryMaxPerDocument` with the bare cap number. A
user at 20/20 whose document holds three `<span data-asset-id>` sees a full cap and no
explanation.

A second key is added, rendered only when `undrawable.size > 0`:

> EN: *Maximum {0} images per document. {1} of these slots are held by references no
> export can draw.*

DE gets the parallel string with real umlauts. **`i18n.de.ts` is CRLF and the Edit tool
corrupts umlauts in it** — patch via a node utf8 write matching CRLF, then re-verify;
the `i18n-encoding` test bans both ASCII substitutes (`fuer`) and `\u00XX` escapes.

## Testing

**§216**

- The manifest gate itself, over both packages.
- **Mutation proof is required, not optional.** The entry exists because two tests named
  "byte" did not fail on a mutant. Re-run the §216 mutant — a hardcoded
  `<Default Extension="png"/>` in the empty-media case of each builder — and record that
  the new gate reddens. A gate that cannot be shown to catch the mutant that motivated it
  has not been demonstrated to work.
- A reorder mutant: swap two `ZipEntry`s in one builder and confirm the ordered manifest
  goes red where a sorted one would not. This is the claim Decision 1 rests on.
- The clock seam: two builds at different injected dates differ; two at the same injected
  date are byte-identical.

**§218**

- `assetRefsInDocument` over a document mixing `<img data-asset-id>`,
  `<span data-asset-id>`, a repeated id, and a paragraph with neither: all three sets
  asserted.
- The three-pattern relationship test: for a fixed set of inputs, exactly which of
  `ASSET_IMG_RE` / `ASSET_ID_RE` / `IMG_TAG_RE` matches — including the single-quoted and
  bare-value cases where they deliberately disagree.
- The load-path ORDER assertion (Decision 5): a single-quoted reference entering a real
  load path comes out double-quoted, so the cap and the export both see it.
- The cap message's conditional branch, both ways: `undrawable` empty renders the old
  string, non-empty renders the new one with the count.

No axe change: the cap message is text, not a new interactive control.

## What this slice refuses

**§217, §221 and §222 stay open, and this is not an oversight.** Each is blocked on §219
— the manual pass nobody here can run, because nothing in this repo opens an Office file:

- §217 (dedup media parts) needs a second counter so a part can be shared while
  `wp:docPr` / `p:cNvPr` shape ids stay unique. The failure mode is that one reader
  tolerates a duplicate id and another does not — precisely what unzipping cannot see.
- §221 (webp) already carries a recorded decision to document rather than fix,
  revisitable when §219 item 6 has an answer.
- §222 (deck length) has a cheap fix that changes emitted bytes and therefore needs its
  own before/after on §219's pass.

Shipping any of them on unzip evidence alone would put a byte change into the export path
verified against nothing that reads it. **This slice changes no emitted OOXML byte** — the
clock seam is injectable with an unchanged default, and every other change is a test, a
fixture, a pure helper or a string.

§215 (CI has no live Turso, so the twelve document-image tests never run there) is also
open and out of scope: it is CI infrastructure with its own credentials question.

## Out of scope

- Any change to what `buildDocxPackage` / `buildPptxPackage` emit.
- Collapsing, widening or narrowing any of the three id patterns.
- A committed `.docx` / `.pptx` blob fixture (Decision 1).
- Changing `buildZip`'s live timestamp behaviour (Decision 3).
- Media-BEARING package manifests. The unpinned contract §216 names is the media-FREE
  one; adding image bytes to a fixture reintroduces the binary-blob-in-git problem
  Decision 1 avoids.
