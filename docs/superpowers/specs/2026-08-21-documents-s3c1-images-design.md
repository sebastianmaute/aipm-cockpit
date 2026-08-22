# S3c-1 — Document images, end to end (Turso-gated)

_Opened 2026-08-21 against 0.253.0 "Schroeder" (`6c4e4162`). Supersedes the `S3c — images`
section of `2026-08-08-documents-roadmap-s3-s4-design.md` where the two disagree; every
disagreement is marked **[supersedes]** and says why._

**This is not all of S3c.** The roadmap's S3c spans five layers; this slice ships four of
them. OOXML media machinery — `[Content_Types].xml` Default entries, `_rels` parts,
`word/media/`, `<w:drawing>` / `<wp:inline>` / `<a:blip r:embed>`, EMU extents — is deferred
to **S3c-2** and designed separately, against real stored assets.

---

## 0. Grounding against 0.253.0

Verified by command, not assumed. Re-run before trusting any of it.

| Fact | State | Reproduce |
|---|---|---|
| `<img data-asset-id>` already survives the documents sanitizer | **shipped in S3a** — `DOCUMENT_ALLOWED_TAGS = [...RICH_ALLOWED_TAGS, "img"]`, `DOCUMENT_ALLOWED_ATTR` adds `data-asset-id` + `alt` | `grep -n "DOCUMENT_ALLOWED_TAGS\|DOCUMENT_ALLOWED_ATTR" src/app/sanitize-html.ts` |
| …and is pinned by tests | `ai-rich-text.test.ts`, `document-editor.test.tsx`, `ai-document-blocks.test.ts` | `grep -rn "data-asset-id" src/ \| grep test` |
| `doc-render-html.ts` reserves `img` for "a later slice" | comment says removing it would make a later slice's image markup vanish silently (`img` is void — it does not unwrap to text) | `grep -n -B3 -A12 "data-asset-id" src/app/doc-render-html.ts` |
| Asset storage, upload, library UI, preview resolution | **all greenfield** — no `document_asset`, no `documentAsset` symbol anywhere | `grep -rn "documentAsset\|document_asset" src/ scripts/ e2e/` |
| DOCX/PPTX media machinery | **none** — no `blip`, no `_rels`, no `media/` in either renderer | `grep -rn "blip\|media\|drawing" src/app/doc-render-docx.ts src/app/doc-render-pptx.ts` |
| `documents-panel.tsx` | **792 lines against the 800 cap — 8 lines of headroom** | `node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"` |
| `document-block-editors.tsx` | **800 — zero headroom** | same, that path |
| Production CSP | `object-src 'none'`; `frame-src` admits **only** `login.microsoftonline.com` | `grep -n "frame-src\|object-src" src/proxy.ts` |
| Side-table precedent | `comm-templates-schema.ts` + `comm-templates-store.ts` — DDL prepended to every call | `sed -n '1,22p' src/app/comm-templates-store.ts` |
| `TABLE_NAMES` | `ENTITY_SPECS` tables + `plan` + `fx_rates` + `meta` | `grep -n "TABLE_NAMES" src/app/turso-schema.ts` |

**[supersedes]** The roadmap says asset bytes mirror "the four existing side tables". The
docstring at `turso-schema.ts` above the shared `txt`/`int` builders names **seven**
(comm-templates, comm/committee-report versions, learning, operating-guides, snapshots,
version history, color-schemes). The pattern is the same; the count was stale.

---

## 1. The measurement that unblocked planning

The roadmap's decision 9 blocked planning on an unmeasured number: a 5 MB image is ~6.7 MiB
of base64, `SqlArg.value` is string-only even for integers, and Turso's request-size limit
was unknown. §95 means CI cannot measure it.

**Measured 2026-08-21** against a real database (`aipm-prod-bunkmate042`, aws-eu-west-1),
read-only, one statement per request, binding a growing text arg to `SELECT length(?)`:

| Arg size | Verdict |
|---|---|
| 0.5 / 1 / 2 / 4 MiB | OK |
| **6.7 MiB** (the 5 MB-image case) | **OK, 1810 ms** |
| 8 / 12 / 16 / 24 MiB | OK |
| 32 MiB | OK, 6568 ms |

**No ceiling found below 32 MiB.** Three consequences:

1. **Decision 8's 5 MB cap stands unchanged.** It has ~4.8× headroom. The contingency
   ("if the limit is under ~7 MB, the per-image cap drops or uploads chunk") is dead — do
   not build chunking.
2. **Latency is the real constraint, not size.** An image write is a multi-second round
   trip that a user can interrupt. This drives §5's progress requirement and §2's write
   order, neither of which the original design could have specified.
3. **Assets are written one per request, never batched.** The probe measured a single
   statement, which is the shape decision 6 already mandates (the side table writes one
   image per write). It says nothing about a pipeline carrying several images at once.

★★ **Scope the measurement honestly.** It covers this database, this region and this plan.
A different Turso plan may differ. The probe is read-only — it creates no table and writes
no row — so it is safe to re-run whenever the answer matters again.

---

## 2. Architecture — two stores, and only one of them is workspace data

Asset **metadata** is a workspace slice. Asset **bytes** are not.

| | Metadata | Bytes |
|---|---|---|
| Home | a new `ENTITY_SPECS` row → table `document_assets` | side table `document_asset_data`, **out of `TABLE_NAMES`** |
| Written by | the workspace save, across all six write paths | `document-assets-store.ts`, one row, on demand |
| Shape | `{id, name, mime, size, width?, height?, hash, createdAt}` | `{id, project_id?, data}` — base64 text |
| In JSON / CSV / MD export | yes | **no** — decision 6, accepted |

### Why `ENTITY_SPECS` and not a meta-blob

**[supersedes]** The roadmap says only "metadata as a workspace slice" and does not choose.
It is a spec row, because the record is flat and tabular — which is exactly what a spec row
encodes. `documents` is a meta-blob only because `blocks` is a nested array.

One spec row buys the Turso single-tenant, Turso multi-tenant and CSV paths from a single
`DOCUMENT_ASSETS_CSV_COLUMNS` declaration, leaving Markdown, JSON and IndexedDB to be
written by hand. A meta-blob buys **none** of the six — and `activityLog`'s worked example
records that the Turso **tenant** path was the one that got missed, caught in review rather
than by any gate.

Cost, stated rather than discovered: golden fixtures regenerate for the new CSV and Markdown
table. That is a legitimate format change, not a mask over a diff.

### Why the bytes stay out of `TABLE_NAMES`

Unchanged from decision 6, and the reasoning is load-bearing: the workspace save emits a
per-table `DELETE` plus a full re-INSERT for every table it owns, and `turso-schema.ts` maps
ten workspace slices onto the single `meta` table with an unconditional `DELETE FROM meta`.
A meta-blob for assets would re-upload the entire image library on every insight write and
every knowledge-item edit.

The store mirrors `comm-templates-store.ts` exactly — a `document-assets-schema.ts` holding
DDL and statement builders, a `document-assets-store.ts` prepending
`CREATE TABLE IF NOT EXISTS` to every call. The workspace save never touches it, so a per-row
write costs one row and the self-healing invariant is untouched because it does not apply.

★ Project deletion must clean the side table explicitly, with `project_id` in tenant mode.

### The store is mime-generic on purpose

`width` and `height` are optional, `mime` is free-form, and **format validation lives in the
upload pipeline, not the store.** The table is already named `document_asset_data`, not
`..._image_data`. A later PDF-attachment slice therefore reuses the table, the store module,
dedup and delete with no migration and no schema change. This costs nothing today. See §7.

### Write order: metadata first, then bytes

**[supersedes]** Decision 6 accepts that orphans become possible and says they need "a
defined write order and a reclaim action", then defines neither. This settles it.

Two stores, two writes, no transaction spanning them. Either can succeed alone.

| Order | Failure leaves | Machinery needed |
|---|---|---|
| Bytes → metadata | a byte row nobody references — invisible, permanent, costs storage forever | a **reclaim action**: store query, id diff, confirm dialog, somewhere to put it |
| **Metadata → bytes (chosen)** | metadata pointing at bytes that never arrived — **the dangling case** | **none** |

Metadata-first collapses the orphan class into the dangling class, which S4 already shipped
a pattern for and which §4 below already renders with a marker. The failure becomes visible
to the user instead of invisible, and re-uploading over the same id repairs it in place.

Cost: an upload forces a workspace save before the bytes go up.

---

## 3. The Turso gate

`tursoConfig !== null` — **never** `storageConfig.kind === "turso"`, since kind can be set
while the config is unset or quarantined.

**The feature is gated; the view is not.** Documents stays in `A11Y_VIEWS`. The library,
upload and insert controls are disabled with a notice on every other backend; documents
themselves stay universal. Decision 5's costed rejection of view-gating stands unchanged —
gating the view would drop the axe surface exactly as S3b added the largest control cluster
in the app, would force dispatch-time refusal in five AI tools, and would buy no
simplification because the six write paths must stay regardless.

★ A document authored under Turso and exported as JSON, then imported on a file backend,
carries metadata with no bytes. That is the dangling case, rendered as such — not a silent
drop.

---

## 4. Surfaces

### One component, two mountings

`AssetLibrary` lives in its own file and is mounted twice: **inline** as a collapsible
management section beneath the documents list, and **inside a `Modal`** when a block editor
asks to insert. Usage counts, rename and the dangling marker are therefore the same code in
both places and cannot drift apart.

★★ `documents-panel.tsx` is at **792/800**. The wiring lands there and is budgeted in lines;
anything larger is extracted first. `document-block-editors.tsx` is at **800 — zero
headroom** — so the editor-side insert trigger goes in a new file, not there.

### Entry points

- **File picker** — `FilePickerButton`, mirroring `branding-image-input.tsx`'s shape.
- **Clipboard paste at the cursor** — ProseMirror `handlePaste` in the `editorProps` block
  that already exists in `rich-text-editor.tsx`. ★★ It must read `clipboardData.files` and
  fall through untouched for ordinary HTML and text pastes, which the rich-text sanitizers
  already own — swallowing those would be a regression in every rich field, not just
  documents.
- **Drop on the editor at the cursor, and drop on the library.** ★★ The editor's file-drop
  handler is scoped so it can never collide with the block gutter's HTML5 reorder drag:
  dropping a file must not reorder a block, and dragging a block must not start an upload.

### Insertion

Writes `<img data-asset-id="…" alt="…">`. Both the tag and both attributes are **already**
permitted, and already pinned by tests. **No sanitizer change ships in this slice** — this
is the single most valuable property of the id-indirection decision.

★ `ALLOWED_URI_REGEXP` never comes into it: there is no URI in stored markup at all, so no
`data:` widening is needed on any shared sanitizer.

### Rename, delete, dangling

Rename edits `name` only — every reference is by id and stays correct.

★★ **Delete marks, it does not cascade.** An asset delete is not a document mutation, so
`applyDocMutation` never fires and **no version before-image is captured**. A cascade that
stripped blocks would be unrecoverable, because version history is the only recovery path a
document has. Resolution simply fails and the renderer draws a missing-asset marker. This
matches the repo's non-cascading posture — S4's "left dangling and rendered as such, not
silently dropped", and `ResourcePicker`'s `data-dangling-marker`.

★ Dedup by content hash makes delete refcount-aware: the same logo referenced from twenty
documents is one row.

---

## 5. Upload pipeline

`document-asset-upload.ts` — pure, i18n-free, one function per stage, fully unit-testable.

| Guard | Value | Why |
|---|---|---|
| Formats | **PNG · JPEG · WebP** | **[supersedes]** §8 said "PNG + JPEG" while also claiming to inherit the branding allow-list (`png\|jpeg\|webp\|gif`) — two different lists. WebP is admitted because browsers put WebP on the clipboard and paste is a shipping entry point here; rejecting it would make the headline gesture fail on real screenshots |
| SVG | **excluded, permanently** | XSS surface. Inherits branding's reasoning. Not revisitable in a later slice |
| GIF | **excluded** | Downscaling re-encodes and would silently destroy animation. Silent destruction of user content is the §103 shape this repo has already paid for once |
| Raw upload ceiling | **25 MB** | Bounds what is read into memory at all, before any decode |
| Source dimension ceiling | **8000 × 8000** (64 MP), read **from the header** | Rejects a decompression bomb before decode — a 50 KB PNG can expand to 30000×30000. Generous enough that no real camera or screenshot hits it |
| Downscale target | **1920 × 1080** | 8.3 MB decoded, against 14.7 MB at QHD |
| Stored cap | **5 MB, applied AFTER downscale** | ★★ Checking the raw upload first would reject the photo that downscaling exists to rescue — the two rules would cancel out |
| Keep-original rule | if the source was already smaller, keep it | Re-encoding a photo to PNG can come out larger |
| Dedup | **SHA-256 over post-downscale bytes** (WebCrypto) | Under "unlimited per workspace", a logo in twenty documents is otherwise twenty copies |
| Per workspace | **unlimited**, with a visible total | No save amplification and no load cost, so a cap buys nothing. Disclosure without enforcement |
| Per document | **20 distinct images**, enforced at insert | The only moment images are held together is a `.docx`/`.pptx` export assembled as one in-memory Blob. Distinct, not references — OOXML stores a media part once |

Metadata records dimensions **post-downscale**, because the OOXML writers size in EMU
against `CONTENT_WIDTH` and cannot backfill without decoding every image.

★ `MAX_BLOCKS_PER_DOC` does not bound images — they are inline in paragraph HTML, not
blocks, so one paragraph could hold two hundred. The per-document cap is the only bound.

★★ **Enforce at write, disclose at load, never truncate silently.** S2 shipped exactly the
opposite: an over-cap load silently and permanently destroyed the excess documents on all
six paths with no diagnostic (§103, closed). A byte budget has the same shape and a worse
payload.

### Progress is a requirement, not a polish item

From §1: an upload is a multi-second operation. The library shows real progress and disables
its own write controls while a write is in flight. A blocking spinner with no feedback is
not acceptable at 1810 ms, and the failure mode of a user navigating away mid-write is
exactly what the metadata-first order makes visible rather than silent.

---

## 6. Rendering

**Preview** resolves `data-asset-id` to a **blob object URL**, lazily, revoking on unmount.
★★ Never inline base64: `document-preview.tsx` builds one HTML string and hands it to
`dangerouslySetInnerHTML`, so ten inline images would put ~67 MB into that string.

**HTML standalone / PDF-via-print** inlines base64 — a single file must be self-contained,
and PDF is the HTML renderer's `standalone` mode driven through the browser print dialog,
not a fourth renderer. There is no PDF writer and no PDF dependency; keep it that way.

**DOCX and PPTX** render a **visible placeholder** naming the omitted image. Never a silent
drop. This is the honest interim state until S3c-2 lands the media machinery.

---

## 7. PDF — deliberately out, and why the store still accommodates it

Three blockers, measured:

1. **Inline preview is CSP-impossible today.** `src/proxy.ts` sets `object-src 'none'` and
   admits only `login.microsoftonline.com` on `frame-src`, so `<embed>`, `<object>` and a
   blob-URL `<iframe>` are all blocked in production. Showing a PDF inline means widening
   the production CSP — a security decision, not a feature decision.
2. **The sanitizer would widen too.** `DOCUMENT_ALLOWED_TAGS` adds exactly one tag to the
   rich list. `embed`/`object`/`iframe` is a far larger surface than `img`.
3. **Rasterizing needs pdf.js** (~1 MB+), against a codebase that just shipped a lazy-bundle
   slice to cut editor weight (§129).

The right shape for PDF is a **`DocBlock` kind**, not inline markup — blocks are a typed
union, so an attachment block sidesteps the HTML sanitizer entirely and gives export an
honest placeholder story. That is its own slice.

What this slice does for it: keeps the store mime-generic (§2). No migration owed later.

---

## 8. Testing

- **Pure modules carry the coverage** — the upload pipeline's stages and the store's
  statement builders are i18n-free and DOM-light where they can be.
- **Six write paths.** The metadata round-trip goes in `entity-persistence-registry.test.ts`.
  ★ Count to six per slice rather than trusting the file's name — `activityLog` is exercised
  there over the two text backends only, and its Turso tenant path was the one missed.
- **Golden fixtures regenerate** for the new CSV and Markdown table. That is a real format
  change; never regenerate to mask a diff.
- ★★★ **axe cannot see duplicate accessible names — in any view, at any seed size.** Of
  axe-core 4.12.1's 105 rules, none of the 69 carrying the four tags `e2e/a11y.spec.ts`
  requests flags two controls sharing a name. So every per-row control in the library
  (rename, delete, insert) gets a **row-unique** accessible name, pinned by a unit test
  rendering **≥2 rows**. That unit test is the only detector that will ever exist for it.
- ★ The gate is also silent on WCAG 2.5.3 (`label-content-name-mismatch` is tagged
  `experimental`, and axe's default `tagExclude` drops it), so any control whose visible
  label differs from its accessible name needs its own unit test.
- **Turso paths cannot be exercised in CI (§95).** The store module's statement builders are
  unit-tested; the round trip is eye-verified against a real database before release, using
  the same read-only probe shape as §1.

---

## 9. Out of scope

- **OOXML media machinery** — S3c-2. DOCX/PPTX show a placeholder until then.
- **Images on any non-Turso backend.** The table exists and stays empty there.
- **Bytes in the workspace JSON export** — decision 6, accepted.
- **PDF and any other attachment kind** — §7.
- **SVG — permanently.**
- **A reclaim action for orphaned byte rows.** The metadata-first write order means the
  orphan class does not exist; if a future change inverts that order, this comes back.

---

## 10. Bookkeeping this slice must fix

★★★ **The "S3c" label is ambiguous and the ambiguity was hiding this work.** The documents
roadmap defines S3c as *images end to end*. What shipped under that label in 0.252.0 "Brust"
was **structural blocks** — add, delete, reorder — a different scope. Reading that release as
closing S3c retires the images design without anyone deciding to.

Three corrections land with this slice, in the same commits:

1. **`2026-08-08-documents-roadmap-s3-s4-design.md`** — its header still reads "design
   approved, unimplemented" for the whole roadmap. S3a, S4 and S3b have all shipped. That is
   stale in the dangerous direction: it makes finished work look pending while the genuinely
   pending images slice sits in the same file, unread.
2. **`docs/open-followups.md` §113** — same correction, plus renaming what shipped in
   0.252.0 so the label collision cannot recur. The structural-blocks work needs a label of
   its own; images keep S3c.
3. **`docs/work-inventory.md` §3** — its "Designed but NOT built" row for document images
   becomes this spec, and its note that the S3c label question must be settled first is
   discharged here.

★ None of this is gated. `docs:symbols:check` never reads `docs/superpowers/`, and
`docs:claims:check` excludes it by name — so a stale header here rots silently and forever.
That is exactly how the label survived a release.
