# Documents S3c-2 — real image bytes in every export format

**Status:** design approved 2026-08-22, unimplemented.

**Goal.** A document containing images exports with those images actually present — embedded as
OOXML media parts in `.docx` and `.pptx`, and as `data:` URIs in standalone HTML and the PDF that
prints from it. Closes `docs/open-followups.md` §202 (OOXML media machinery) and §210 (standalone
HTML/PDF carry a sourceless `<img>`).

**Scope decision.** The two follow-ups are one slice, not two, because all four formats route
through a single synchronous `downloadDocument` and all four need the same thing: asset bytes,
which live in an async Turso side table. Building that spine for OOXML alone would leave HTML and
PDF emitting an `<img>` with no `src` at all — the worse of the two defects, since DOCX and PPTX at
least name the missing asset in visible text.

---

## What exists already, and what does not

Verified against `main` at 0.255.0 "Bisson" on 2026-08-22. Re-run each command before trusting it.

| Claim | Command | State |
|---|---|---|
| No OOXML media code anywhere | `git grep -ln "word/media" -- src scripts` (and `ppt/media`, `mediaPart`) | zero hits |
| The zip writer already takes binary | `grep -n "Uint8Array" src/app/zip.ts` | `ZipEntry.data` accepts `Uint8Array` today |
| Sizing needs no decode | `grep -n "width" src/app/document-asset.ts` | metadata stores post-downscale `{width, height}` for exactly this |
| The `data:` URI sink is built | `grep -n "assetSrcAttr" src/app/doc-render-html.ts` | built, mime- and base64-validated, unit-tested — and unreachable |
| Nothing passes `assets` | `grep -rn "renderDocumentHtml(" src/app --include=*.ts --include=*.tsx` then drop `.test.` | four real calls, all four-argument |

So §202's framing — "the largest unknown, no scaffolding" — overstates two thirds of it. The zip
layer and the sizing data are in place. The genuine unknown is the OOXML XML itself
(`[Content_Types].xml` defaults, `_rels` parts, `<w:drawing>`/`<wp:inline>`, `<p:pic>`/`<a:blip>`)
plus the user-gesture problem below.

---

## Architecture

### The async spine

`downloadDocument` becomes `async`. A new module `document-export-assets.ts` owns one job:

```
loadExportAssets(doc, ws, config, projectId, budgetBytes)
  -> { inlined: Record<string, string>, omitted: Set<string>, missing: Set<string> }
```

Three outcomes, deliberately distinct, because they mean different things to a reader of the
exported file:

- **inlined** — bytes fetched and within the byte budget
- **omitted** — bytes available but the budget was already spent. A POLICY decision
- **missing** — no byte row exists. A DATA problem (the dangling case §212 repairs)

Collapsing `omitted` into `missing` would tell a user their image is lost when it is not, and
collapsing it into `inlined` would silently blow the budget. Keep all three.

Renderers stay synchronous and pure, taking this result as data. Every renderer test is therefore
an in-memory test with no Turso mock, and the budget policy lives in exactly one place instead of
being re-decided by three call sites.

**Id scanning moves here.** `doc-render-docx.ts`, `doc-render-pptx.ts` and `doc-render-html.ts` each
declare their own copy of `IMG_TAG_RE` today — three copies of one regex. It moves into the new
module and all four import it. This is a DRY repair the slice pays for anyway, not added scope.

### The user-gesture problem

★★★ **The PDF branch calls `window.open` inside the click handler.** Awaiting bytes before it
spends the gesture, so the popup blocker fires for every user and they land on the fallback path
built for the genuinely-blocked case — turning a missing image into an apparently broken button.

Fix: open the tab FIRST, synchronously, and write a minimal "preparing" document into it; then
await the bytes and overwrite via `document.write`. The `!tab` blocked-popup check still runs
before any await, so that path is unchanged. Plain downloads (`html`, `docx`, `pptx`) are not
gesture-gated and simply await.

### Call sites

Three, not two:

- `documents-panel.tsx` — the toolbar download and the per-row download
- `chat-tool-block.tsx` — the AI chat download card

The chat card has `ws` and `lang` but no Turso config or `projectId`, and its format is
`DOC_FORMATS[0]` — an image-bearing format like any other.

**Decision: thread `config` and `projectId` to it.** The same document downloaded from the chat card
and from the Documents panel must be the same file; a user has no way to know that one of two
identical-looking download buttons silently drops images. The alternative — letting the chat path
degrade to placeholders — is cheaper by one prop and produces a defect nobody could diagnose from
the UI. This is exactly the caller a per-task review misses.

---

## The renderers

### Shared leaf: `ooxml-media.ts` (new, pure, DOM-free)

Owns what DOCX and PPTX both need and neither should own alone:

- `mediaExtension(mime)` — `image/png` maps to `png`; drives both the part name and the
  `[Content_Types].xml` `Default` entry
- `emuFromPx(px)` and `fitExtent({width, height}, maxWidthEmu, maxHeightEmu)` — aspect-preserving
  scale computed from the stored post-downscale dimensions, so nothing decodes an image to size it

★★ **`width` and `height` are OPTIONAL on the asset record and the plan must not assume otherwise.**
`document-asset.ts` declares both `?:` and says why in its own header: the module is MIME-generic by
contract, so the same table can serve a later non-image asset type. `fitExtent` therefore takes a
partial dimension pair and reports that it cannot size the asset.

**Decision: a dimensionless asset gets the placeholder in DOCX and PPTX, and is still inlined in
HTML and PDF.** OOXML requires a concrete extent, and the only ways to invent one are to guess an
aspect ratio (which stretches the image — a silent visual corruption) or to decode the bytes (which
the stored dimensions exist to avoid). HTML needs no extent at all: `<img>` sizes itself. The
asymmetry is principled, not an oversight, and belongs in a test.
- `MediaPart = { path: string; data: Uint8Array; mime: string; relId: string }` — the one shape
  both package builders consume

It exists as its own file rather than living in either primitives module because both need it, and
because `ooxml-docx-primitives.ts` (578 lines) and `ooxml-pptx-primitives.ts` (547) would otherwise
absorb most of their remaining headroom under the 800-line ratchet.

### DOCX

`buildDocxPackage` gains an optional trailing `media: MediaPart[] = []`.

★★★ **The empty case must be byte-identical to today.** The workspace exporter shares this
function and its bytes are pinned by the `export-ooxml` golden suite. An empty array must add no
`Default` entry, no part and no relationship. A red golden suite means the additive contract broke,
and regenerating the fixture would mask it.

Non-empty adds: one `<Default Extension="...">` per distinct extension, `word/media/*` parts, and
one `<Relationship>` per image in `word/_rels/document.xml.rels`, numbered after the existing
`rId1` (styles).

In the body, an **inlined** asset yields `<w:drawing><wp:inline>` sized by `fitExtent` capped at
`CONTENT_WIDTH` — the same constant that already sizes tables, so an image cannot overflow a page a
table fits. An **omitted** or **missing** asset keeps today's translated placeholder run.

★★★ **THE TWO BRANCHES CANNOT SHARE THE SUBSTITUTION POINT, and an earlier revision of this section
said they could.** It claimed both would substitute on the RAW html BEFORE the parse, "preserving
the existing property that the substitution participates in the DOMParser walk". That is true of
the placeholder because a placeholder is TEXT. It is false of a drawing: `docxRichParagraphs` feeds
the html to `htmlToRichLines`, which parses with DOMParser, and a `<w:drawing>` blob put through an
HTML parse is mangled — the WordprocessingML would not survive to the output.

So the paragraph is **split around inlined images**:

- html segments between images go through `docxRichParagraphs` unchanged, still carrying the
  placeholder substitution for any omitted/missing image inside them
- each inlined image becomes its OWN `<w:p>` holding a single drawing run

★★ Consequence, accepted: an image that sat inline with text gets its own paragraph in the `.docx`.
This matches how the product actually inserts images — the block editor produces image-only
paragraphs — so the common case is unaffected, and the alternative (teaching the shared
`rich-text-runs.ts` walk an `<img>` run kind) changes a module three registers depend on for a
layout case that does not arise.

★ Omitted and missing images keep the existing inline behaviour exactly, so today's placeholder
tests stay valid as written.

### PPTX

Images sit BELOW the body text on the slide where they appear (decided 2026-08-22; the alternatives
were a slide per image and appending all images at the end).

★★ **This is the slice's main visual risk and the design accepts it deliberately.** The renderer's
own header states a slide is TEXT ONLY and that nothing measures text — `bodyPr` emits no
`normAutofit`, so overflow runs off the shape invisibly and only a human opening the deck can see
it. Same-slide placement puts an image into that same unmeasured space.

Two changes:

**1. `paginateLines` becomes cost-based.** A text line costs 1; an image costs
`ceil(heightEmu / lineHeightEmu)`, where `lineHeightEmu` derives from the same
`BODY_SIZE` times `LINE_SPACING` arithmetic that already yields `BODY_LINES_PER_SLIDE` — so there
is still exactly one number to change and the two cannot drift.

★★★ Image height is capped at `BODY_BOX.cyEmu` BEFORE the cost is computed. Without that cap an
oversized image costs more than the whole budget, every chunk is empty, and pagination does not
terminate. The cap also means a very large image consumes a whole slide on its own — the own-slide
layout emerges as a limiting case rather than needing a branch.

**2. A `pptxPicture(...)` primitive** beside the existing `pptxTextBox`, emitting `<p:pic>` with
`<a:blip r:embed>`. Images stack at `BODY_BOX.y` plus `textLineCount` times `lineHeightEmu`, each
centered horizontally within `BODY_BOX.cxEmu`.

**`buildPptxPackage` must change signature.** Today every slide SHARES one `_rels` part; image
relationships are per-slide, so it becomes `buildPptxPackage(slides: { xml, media }[])` emitting one
rels part per slide. Callers passing no media get byte-identical output, same contract as DOCX.

### HTML and PDF

`renderDocumentHtml`'s `assets` argument stops being optional-and-never-passed — the standalone
callers pass it. `inlineDocumentImages` grows the third branch:

| Outcome | Rendered as |
|---|---|
| inlined | `src="data:<mime>;base64,..."` via the existing validated `assetSrcAttr` |
| omitted by budget | the same translated placeholder text DOCX/PPTX use |
| missing | `data-asset-missing="true"` |

★★ **The missing marker needs a style added, or it is invisible in the one file that matters.**
`img[data-asset-missing]` is styled only in `src/app/globals.css`, the APP stylesheet. A standalone
export inlines `PRINT_STYLES` + `DOCUMENT_PAGE_STYLES` and loads nothing else. Wiring the attribute
without adding the rule produces an attribute nothing draws — §210 records this as the half readers
skip.

### The byte budget

Standalone HTML must be self-contained, so images inline as base64 — a ~33% inflation on top of a
per-document cap of 20 images at 5 MB stored each, i.e. a worst case around 133 MB in ONE string,
which the PDF path then writes into a fresh tab.

**Decision: cap the total inlined bytes at 25 MB of stored bytes (~33 MB base64) for HTML and PDF
only, and disclose the remainder as placeholders.** DOCX and PPTX embed everything — they carry raw
bytes with no base64 inflation.

Rationale: nothing silently vanishes, no export can hang a browser, and a typical document (a few
screenshots) is entirely unaffected. The number is a judgement call and is stated as one; it lives
as a single named constant so it can be moved on evidence.

---

## Error handling

One failed byte fetch must never fail the export. `loadExportAssets` settles each id independently —
`Promise.all` over per-id catches, the pattern `attachAssetImages` already uses — and a rejection
classifies as **missing**. The export still produces a file with that image disclosed. The byte
store is a network call; an export that throws on a flaky connection loses the user's whole
document to save one image.

Part names derive from the asset **id** (a UUID), never from its user-supplied `name`. A name
reaches an export only as escaped placeholder text, never as a zip path or a relationship target.
Mime is checked against `ASSET_MIME_ALLOWED` on the OOXML path too — imported, never restated — so
the three formats cannot drift on what they accept.

---

## Testing

`unzip.ts` already exists, so these are SUBSTRATE tests, not argument-shape tests: build a real
Blob, unzip it, and assert against what came out.

- `word/media/*` and `ppt/media/*` **byte-compare equal** to the input bytes. A stub cannot pass
  this and neither can a wrong-bytes bug
- the `r:embed` id resolves to a relationship that resolves to a part that exists
- `[Content_Types].xml` declares every extension actually used

Four anti-vacuity requirements, each of which passes green if written the obvious way:

1. **The no-media path is byte-identical.** The `export-ooxml` golden suite is the guard. Do not
   regenerate its fixtures for this slice — a diff there means the additive default broke
2. **`fitExtent` under a property test** — aspect ratio preserved within rounding, never exceeds
   either bound
3. **Cost-based pagination needs a fixture where an image actually forces a break.** A fixture whose
   text alone already fits proves nothing — same shape as the id-mint race trap, where the test
   passes whichever way the code decides
4. **The budget branch needs a fixture that exceeds the budget.** Testing only under-budget
   documents passes with the entire cap deleted

### What no test here can reach

Stated so a green suite is not mistaken for coverage:

- **Whether Word and LibreOffice actually open the files.** Manual, and ALREADY OWED from 0.254.0
  for the placeholder path. This slice does not discharge it; it enlarges it
- **PPTX overflow.** jsdom has no layout and nothing measures text. The budget converts unbounded
  overflow into bounded overflow. Only opening a real deck confirms a slide fits
- **The Turso byte path in CI** — `docs/open-followups.md` §215: CI has no live Turso database, so
  the twelve interactive tests skip in every pipeline while the `e2e` job reports green

---

## Known costs

- `loadAssetData` is ONE ASSET PER REQUEST by design (its own header warns that batching is
  unmeasured), so a 20-image document is 20 parallel round trips
- `buildZip` uses STORE, no compression — a 60 MB image set yields a 60 MB `.docx`

Both acceptable. Both recorded here rather than discovered later.

---

## Out of scope

- **Non-Turso backends.** No images exist there at all; the table stays empty
- **SVG and GIF.** Permanently excluded upstream — SVG as an XSS surface, GIF because downscaling
  re-encodes and would destroy animation
- **DEFLATE compression** in the zip writer
- **Any change to the upload caps** (25 MB raw, 8000x8000 source, 1920x1080 downscale, 5 MB stored,
  20 per document)
- **Images in table cells or `dataSection` blocks.** Images live in paragraph HTML only
