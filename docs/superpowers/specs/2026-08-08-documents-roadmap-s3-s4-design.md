# Documents — the block editor, entity attachment and images (S3a · S4 · S3b · S3b-2 · S3c-1 · S3c-2)

Date: 2026-08-08
Status: **S3a · S4 · S3b · S3b-2 (structural blocks) · S3c-1 (images) all SHIPPED.**
Only S3c-2 (OOXML media parts) remains "design approved, unimplemented" — see the S3c
section below. Updated 2026-08-21; this line was stale for three releases (S3a/S4/S3b
shipped without anyone flipping it) — re-derive from `CHANGELOG.md`, don't trust a
status line, this one included.
Baseline: 0.222.0 "Charnas", `main` @ `e2316f4f`

> Supersedes the S3 and S4 outlines in `2026-08-06-ai-document-authoring-design.md:414-432`.
> Those were ~18 lines between them; this document replaces both and reorders them.
> A pointer entry lives at `docs/open-followups.md` §113 — that file is tracked, this
> tree is not, and §44 exists because a multi-slice plan that lived only here became
> invisible to every other machine.

## Problem

S1 (0.219.0 "Elgin") shipped the document model, storage across six write paths, the
Documents view and three renderers. S2 (0.222.0 "Charnas") shipped five AI tools and
per-write version history. **The model can write a document; a person cannot edit one.**
The pane is read-only. A user who wants to fix a sentence must ask the assistant to
rewrite the block.

Separately, a document cannot hold an image, and no document can be attached to the
task, milestone, RAID item or change it is about.

## What already exists

Measured against `e2316f4f`, not assumed. Reproduce commands given where a number is
load-bearing.

| Capability | Where | Shape |
|---|---|---|
| Block model | `document-model.ts:48` | `heading{level,text}` · `paragraph{html}` · `bullets{ordered?,items}` · `table{caption?,columns,rows}` · `dataSection{key}` · `pageBreak` |
| Caps | `document-model.ts:40-46` | `MAX_BLOCKS_PER_DOC` 500 · `MAX_TABLE_ROWS` 500 · `MAX_TABLE_COLUMNS` 30 · `MAX_BULLET_ITEMS` 200 · `MAX_TITLE_CHARS` 200 · `MAX_TEXT_CHARS` 5 000 · `MAX_HTML_TEXT_CHARS` 20 000 |
| Read-only pane | `document-preview.tsx` (87 lines) | `renderDocumentHtml(doc, ws, lang, "preview")` into `dangerouslySetInnerHTML`; the pane renders `doc.title` itself because preview mode returns a fragment |
| Editor primitive | `rich-text-editor.tsx` (228 lines) | `full` and `lean` variants over `@tiptap/react` + `@tiptap/starter-kit` 3.27.1 |
| Document sanitizer | `doc-render-html.ts:98` | `paragraph` is the ONE unescaped path; re-sanitized at the sink with `sanitizeTemplateHtml` |
| Allow-lists | `sanitize-html.ts:21,38` · `narrative-html.ts:60` | template 11 tags · note 9 + `#text` · `HTML_START` 8 |
| OOXML | `doc-render-docx.ts:95` · `doc-render-pptx.ts:155` | both take `descriptionTextWithBreaks(block.html)` — **flat text** |
| Turso save | `turso-backend.ts:161-175` · `turso-schema.ts:290-331` | table-level dirty detection by **reference equality**, then `DELETE FROM <table>` + re-INSERT every row |
| Side tables | `color-schemes-store.ts` · `comm-templates-store.ts` · `comm-template-versions-schema.ts` · `committee-report-versions-schema.ts` | out-of-`TABLE_NAMES` modules with their own DDL, named as a pattern at `turso-schema.ts:100` |
| Turso view gating | `nav-config.ts:152` | `TURSO_ONLY_VIEWS = ["history","portfolio-health","trends"]`, pruned by `filterNavGroups` on `storageKind` |
| Image precedent | `branding-image-input.tsx:17-28` · `settings-types.ts:500` | `/^data:image\/(png\|jpeg\|webp\|gif);base64,/i`, 512 KB, **SVG excluded on purpose (XSS surface)** |
| Narrow-viewport hook | `use-media-query.ts` · `use-sidebar-collapsed.ts:7` | `SIDEBAR_NARROW_QUERY = "(max-width: 1023px)"` |

Dependencies are unchanged from S1: no zip, docx, pptx or pdf library. `zip.ts` already
accepts `Uint8Array`, so binary carriage is free.

## Decisions

Each was an explicit fork, resolved before design.

### 1. Harvest the Tiptap Simple Editor template; do not install it

The template (MIT, `npx @tiptap/cli add simple-editor`) is a reference implementation to
read, not a dependency to vendor. Reasons, in order of weight:

- **It is a single ProseMirror document; ours is a typed block array.** Adopting it
  wholesale abandons `dataSection` — the one block that embeds live project data through
  the real `buildExportSections` — plus the three block-keyed renderers and per-block
  version before-images.
- Its styles are **SCSS**, and its CLI injects `@import '_variables.scss'` into
  `src/app/globals.css` and installs `sass`. Its variables carry their own palette and
  shadows; `--shadow-card` is `none` in this repo and the palette sweep gates CSS.
- It ships its own `button`, `toolbar`, `popover`, `dropdown` and icon set, duplicating
  `Button` / `IconButton` / `ToggleButton` / `usePopoverDismiss` / heroicons against a
  blocking `dup:check` and the §102 ratchet.
- Every label is hardcoded English against a tsc-enforced EN/DE parity gate.

What we take is its **interaction design**: heading dropdown, link popover, list
dropdown, toolbar grouping, and the narrow-viewport collapse its `use-mobile` hook
performs — which we implement with the existing `useMediaQuery`.

`starter-kit@3.27.1` already bundles bold · italic · **underline** · strike · code ·
codeBlock · blockquote · heading · horizontalRule · bulletList · orderedList · listItem ·
listKeymap · link · hardBreak. Only highlight, subscript and superscript need new
packages.

### 2. Layout A, with layout B at a narrow pane

Blocks are edited in place. Hover or focus raises a left gutter (block-kind chip and a ⋮
overflow) and the active block gets its own toolbar. At a narrow pane the toolbar docks
once above the document and acts on the selected block.

★ The trigger is **pane width, not device width.** The Documents pane is user-resizable
and has a popout path, so a desktop user reaches the narrow layout by dragging. Framing
it as mobile support would oversell it: the app has exactly one breakpoint-driven
adaptation today (the sidebar rail at 1023px), `sm:`/`md:`/`lg:`/`xl:` appear in 52 of
281 non-test `.tsx` files, and `playwright.config.ts` runs Desktop Chrome only — there is
no automated coverage below desktop width anywhere. Genuine phone support is its own
slice with its own e2e project.

★ The swap must hinge on `useMediaQuery`, never on a measured width: **jsdom has no
layout**, so a viewport-driven branch is untestable unless the match is injectable.

### 3. Alignment is a block field, never markup

`sanitize-html.ts:31` applies `ALLOWED_URI_REGEXP: /^(?:https?|mailto):[^<>"]*$/i` to
**every attribute value, not only URI-bearing ones**. That is already why `target` and
`rel` are stripped from every stored link (§38, verified on dompurify 3.4.12).
`style="text-align:center"` and `class="text-center"` fail it identically.

So alignment cannot be expressed as markup here. It becomes an optional `DocBlock` field,
which is also where `heading.level` already lives. No toolbar in this app may introduce a
new HTML attribute without re-opening that regexp, which is a shared security boundary.

### 4. Documents get their own allow-list, and `HTML_START` is derived from it

`sanitizeTemplateHtml` is **shared** — comm templates, meeting reports, the six rich
entity fields and documents. Widening it to admit the seven new marks would change what a
model may store everywhere, retroactively, including how already-stored HTML renders.
`rich-text-editor.tsx:64` records that precise hazard as the reason an earlier slice
disabled input rules instead of widening a list.

Documents therefore get `sanitizeDocumentHtml` with their own tag list. That makes three
lists — and the drift between a list and `HTML_START` **is** §107, live today: a
description leading with `<h1>` is escaped whole and permanently.

★★★ **CORRECTED 2026-08-08, BEFORE PLANNING — an earlier revision of this decision said
"derive `HTML_START` from its allow-list", and §107's own recorded fix shape says "widening
`HTML_START` to the template list is the obvious move". BOTH ARE WRONG AND EITHER WOULD SHIP
A DATA-LOSS REGRESSION.** There is no single "its allow-list": one constant
(`narrative-html.ts:60`) is consumed by TWO classifiers whose sinks have DIFFERENT lists and
different `KEEP_CONTENT`:

| Consumer | Sink | Tags | `KEEP_CONTENT` |
|---|---|---|---|
| `narrative-html.ts:66` `narrativeToHtml` | `sanitizeNoteHtml` | 8 | **`false`** — deletes a non-listed element WITH its text |
| `rich-text-plain.ts:152` `descriptionHtml` | `sanitizeTemplateHtml` (six rich fields + documents) | 11 | default — unwraps, keeps the words |

`narrative-html.ts:70` states the alignment as deliberate — "The set is EXACTLY
sanitize-html.ts's `NOTE_ALLOWED_TAGS` … **Recognising a tag the sink STRIPS is worse than
not recognising it at all**" — and records the exact bug widening causes: "h1-6, blockquote
and div used to sit here … in fact it made `<h1>Q3</h1><p>ok</p>` render as just 'ok' and
`<div>Status</div>` render as nothing at all." Widening the shared constant therefore
re-breaks the narrative path, restoring a bug already found and fixed once.

★★★ **The correct shape: each classifier derives from ITS OWN sink's list.** `descriptionHtml`
takes the tag set as a parameter (or gains a sibling) rather than importing one shared
constant; narrative keeps deriving from `NOTE_ALLOWED_TAGS`. That is a larger change than a
regex edit and its blast radius is **the six rich entity fields, not just documents** — so it
is **its own task, and it is NOT in S3a**. Until it lands, §107 stays open and documents
inherit the 8-tag classification, which is safe (it escapes rather than deletes) and merely
means a document leading with a new tag is escaped.

### 5. Images: Turso-gated, and the gate is the feature, not the view

`tursoConfig !== null` (never `storageConfig.kind === "turso"` — kind can be set while
config is unset or quarantined). The asset library, upload and insertion are disabled with
a notice; **documents themselves stay universal.**

Gating the Documents *view* was considered and rejected. It would have cost:

- **The axe gate loses the surface.** Documents is one of the 17 `A11Y_VIEWS`
  (`e2e/a11y.spec.ts:18`); a Turso-only view must be kept out of that list because the
  file-mode seed cannot reach it. Scans would drop 90 → 85 and the spec 91 → 86, right as
  S3b adds the largest control cluster in the app. **§95 makes it unrecoverable** — no
  test exercises a real Turso database on any path, and `e2e/seed.ts` writes IndexedDB.
- **No simplification in exchange.** The six write paths must stay or existing file and
  IndexedDB users lose documents they already have, so every codec, sanitizer, golden
  fixture and the `documentVersions` slice remains. Gates are added; nothing is removed.
- Five AI tools would need dispatch-time refusal (removing definitions per-user would
  change the prompt-cache prefix and cost a miss on every request), the sample workspace
  ships `documents: 1` / `documentVersions: 1` that a file-mode user could not see, and
  two help entries (`help-content.ts:103,111`) would describe an unreachable view.

Gating the feature costs none of that and leaves the door open to lifting the gate later
with no migration.

### 6. Asset bytes live outside `TABLE_NAMES`

Three options were priced against the Turso save path.

`turso-schema.ts:297-306` maps **ten** workspace slices onto the single `meta` table —
`status` · `fieldVisibility` · `features` · `steeringCommittee` · `timelogLinks` ·
`knowledgeItems` · `insights` · `documents` · `documentVersions` · `settingsOverrides` —
and `workspaceToStatements:324` emits an unconditional `DELETE FROM meta` plus a full
re-INSERT whenever any one is dirty. **A meta-blob for assets would re-upload the entire
image library on every insight write and every knowledge-item edit.** Rejected.

| | Rename | Add / replace | Delete | Workspace load | Self-healing save | Build |
|---|---|---|---|---|---|---|
| Meta-blob | full library ×10 triggers | full | full | pulls all bytes | kept | — |
| Own `ENTITY_SPECS` table | full library | full | full | pulls all bytes | kept | 1 spec row |
| Metadata/bytes split | one small row | full | full | pulls all bytes | kept | 2 spec rows |
| Row-level diffing | one row | one row | one row | pulls all bytes | **lost** | 3–5 tasks |
| **Side table (chosen)** | metadata only | **that image** | **one DELETE** | **pulls none** | **kept** | 1 store module |

Row-level diffing was priced and rejected on the invariant, not the effort. The current
`DELETE FROM t; INSERT …` is **self-healing** — after a save the table matches the
workspace whatever state it was in. Diffing is correct only while the baseline is
accurate, and the baseline can be wrong (a second tab, §4; a partially failed save;
a manual edit). The resulting orphan or missing rows are never repaired by a later save,
and §95 means this repo cannot currently detect that class.

The side table needs none of it: the workspace save never touches it, so per-row writes
cost one row and the invariant is untouched because it does not apply.

**Accepted costs**, stated here rather than discovered later:

- **Orphans become possible** — metadata in the workspace and bytes in a side table can
  desync if one write succeeds and the other fails. A missing byte row is already the
  dangling case S3c designs. A byte row with no metadata is a leak, needing a defined
  write order and a reclaim action. Same cost class as the four existing side tables.
- **Bytes do not travel in the workspace JSON export.** Document exports embed them, which
  is the user-facing path, but a JSON backup re-imported into a different Turso database
  returns placeholders.
- **Project deletion must clean up explicitly**, with `project_id` in tenant mode.

### 7. Images are referenced by id, never by src

Stored block HTML carries `<img data-asset-id="…">` — no URI at all, so
`ALLOWED_URI_REGEXP` never comes into it and no `data:` widening is needed on a shared
sanitizer (`data:text/html` is an XSS vector and the regexp is the thing standing in front
of it).

The indirection turns three requested features into properties rather than code:

- **Rename** edits `name` only; every reference is already correct.
- **Delete propagates automatically** — resolution simply fails and the renderer draws a
  missing-asset marker. Nothing is rewritten.
- Bytes are stored once regardless of how many documents reference them.

★★ **Delete marks, it does not remove.** An asset delete is not a document mutation, so
`applyDocMutation` never fires and **no version before-image is captured** — a cascade
that stripped blocks would be unrecoverable, because version history is the only recovery
path documents have. This also matches the repo's non-cascading posture (the S4 outline's
"left dangling and rendered as such, not silently dropped"; `ResourcePicker`'s
`data-dangling-marker`).

### 8. Image budget

| Guard | Value | Why |
|---|---|---|
| Formats | **PNG + JPEG**, SVG excluded | Inherits the branding allow-list and its XSS reasoning |
| Raw upload ceiling | **25 MB** | Bounds what is read into memory at all, before any decode |
| Source dimension ceiling | **8 000 × 8 000** (64 MP) | Rejects a decompression bomb before decode: a 50 KB PNG can expand to 30000×30000. Checked from the header, not by decoding. Generous enough that no real camera or screenshot hits it |
| Downscale target | **1920 × 1080** | 8.3 MB decoded per image, vs 14.7 MB at QHD |
| Stored cap | **5 MB, applied AFTER downscale** | ★★ Checking the raw upload first would reject the photo downscaling exists to rescue — the two rules would cancel out. Keep the original if it was already smaller: re-encoding a photo to PNG can come out larger |
| Per workspace | **unlimited**, with a visible total | No save amplification and no load cost, so nothing is bought by a cap. Disclosure without enforcement |
| **Per document** | **20 distinct images** | The only moment images are held together is a `.docx`/`.pptx` export, assembled as one in-memory Blob. Distinct, not references — OOXML stores a media part once |
| Dedup | content hash | Under "unlimited", a logo in 20 documents is otherwise 20 copies. Makes delete refcount-aware |

Metadata records `{id, name, mime, size, width, height, createdAt}` — dimensions captured
**post-downscale**, because the OOXML writers size in EMU against `CONTENT_WIDTH` and
cannot backfill without decoding every image.

★ `MAX_BLOCKS_PER_DOC` does not bound images: they are inline in paragraph HTML, not
blocks, so one paragraph could hold two hundred.

★★ **Enforce at write, disclose at load, never truncate silently.** S2 shipped exactly the
opposite — an over-cap load silently and permanently destroyed the excess documents on all
six paths with no diagnostic (§103, closed). A byte budget has the same shape and a worse
payload.

### 9. One measurement can still invalidate §8

A 5 MB image is **~6.7 MB of base64**, and `SqlArg.value` is string-only even for
integers — so a single statement carries a 6.7 MB text argument in one Turso pipeline
request. Turso's request-size limit is **unknown and must not be guessed.** Measure it
against a real database before S3c is planned; **§95 means CI cannot.** If the limit is
under ~7 MB, the per-image cap drops or uploads chunk.

## Decomposition

Four releases. S4 moves ahead of the editor: it settles the dangling pattern and the
versioning policy on an `{kind, id}` pair rather than on images.

| Slice | Ships | New persisted state |
|---|---|---|
| **S3a** | `sanitizeDocumentHtml` · mark-aware OOXML · the three policies. ★ §54 and the `HTML_START` classifier split came OUT — see the S3a section | none |
| *(before S3b)* | §54 spike → decision → fix · the `HTML_START` classifier split (six rich fields) | none |
| **S4** | `linkedEntities`, chips on four entities, filter, deep-link, dangling | free — a field inside the existing `documents` blob |
| **S3b** | the editor, all marks, per-type editors, block-content editing, alignment | free — same blob |
| **S3b-2** | the structural slice deferred by S3b below: block add / remove / reorder | free — same blob |
| **S3c-1** | images end to end (this label was "S3c" before the split below) | metadata slice + one out-of-`TABLE_NAMES` side table |
| **S3c-2** | OOXML media parts for the images S3c-1 shipped | none (write-path shape unchanged) |

★ Three of the four cost nothing on the write paths.

## Cross-cutting decisions, settled in S3a

Each is asked 2–4 times across the roadmap. Answering them per-slice is how S2's "one door
of two" shape recurred six times in one release.

1. **What counts as a versioned mutation?** Asked by block edit, alignment change, entity
   link/unlink, asset rename, asset delete. `DocMutation` is a discriminated union
   (`document-mutations.ts:380`), so every new kind forces the answer at the compiler.
   **Policy: content versions; references and metadata do not.** Decision 7's
   mark-don't-remove follows from it.
2. **One dangling-reference presentation.** Three producers — deleted linked entity,
   missing asset, existing dangling resource. Build the convention once in S4, reuse
   twice. The existing one already solved the a11y half: a non-colour marker plus a
   distinguishing `title`, because colour alone fails 1.4.1.
3. **Each classifier derives from ITS OWN sink's list — never from a shared constant**
   (decision 4). The policy, not the edit: the edit is its own task, outside S3a.

---

# S3a — foundations

★★★ **SCOPE CORRECTED 2026-08-08, before planning. Two items came OUT of S3a because reading
the code showed neither was plannable as specced. Neither blocks the rest.**

**Out: §54, the prod-only CSP block on ProseMirror's base CSS.** It is real, measured and
user-visible — every rich-text surface in a prod build renders without ProseMirror's base
stylesheet — but §54 lists **"Which fix is right"** under *"What is NOT established"*, and its
option 2 widens the single residual `docs/security/threat-model.md:71` calls out, which that
entry says must be argued on that row. Option 1's feasibility is also unverified: Next's own
docs state nonces are applied **during server-side rendering**, while §54's offender is
injected at runtime by a client chunk via `createElement("style")`, which that mechanism does
not reach. **This needs a spike — does Turbopack's style injector honour a nonce? — then a
decision, then a fix.** It must land before **S3b**, since the editor is the surface it
disfigures, but it is not a dependency of S3a's other work.

**Out: the `HTML_START` classifier split** (decision 4's correction). Its blast radius is the
six rich entity fields, not documents, and the naive version regresses the narrative path.
Its own task, sequenced before S3b. §107 stays open meanwhile; documents inherit the 8-tag
classification, which escapes rather than deletes and is therefore safe.

**In: the two below, plus the three cross-cutting policies.**

**`sanitizeDocumentHtml`** — the 11 template tags plus `s` · `code` · `pre` ·
`blockquote` · `hr` · `mark` · `sub` · `sup`, and `img` with `data-asset-id` (inert until
S3c). `KEEP_CONTENT` stays at DOMPurify's default, so an unknown tag loses formatting but
keeps its words — the right failure mode for a document, and deliberately not
`sanitizeNoteHtml`'s `KEEP_CONTENT: false`.

**Mark-aware OOXML.** Replace the flat `descriptionTextWithBreaks` projection for
`paragraph` with a mark-aware walk: `<w:b/>` `<w:i/>` `<w:u w:val="single"/>` `<w:strike/>`
`<w:highlight>` `<w:vertAlign w:val="subscript">` in DOCX, the `<a:rPr>` equivalents in
PPTX, plus paragraph styles for blockquote and code block and `<w:pBdr>` for the rule.
User-visible on its own: bold and italic the model writes today are dropped from both.

## Out of scope for S3a

- Any UI. No control changes anywhere.
- Widening the shared `sanitizeTemplateHtml` — decision 4.

---

# S4 — entity attachment

`ProjectDocument.linkedEntities: {kind: "task"|"milestone"|"raid"|"change"; id: number}[]`.
A reverse link: one field on the document rather than a `documentIds` column on four
entities, so no `*_CSV_COLUMNS`, no four markdown codecs, no four sanitizers, no golden
column regen.

Attachment chips on the linked entity, a filter in the Documents view, deep-link both
ways. Deletion is non-cascading: a link to a deleted entity is left dangling and rendered
as such — and this is where the shared dangling presentation is built.

★ Four entity panes is four pane contracts, and the widest surface in a slice whose data
model is one field.

★ `activityViewOf` (`dashboard-activity-nav.ts:8`) has **no production caller** — §104.
It is a different mechanism from this slice's deep-link (activity-kind → view, not
document ↔ entity), so S4 does not close §104 by construction. But S4 is the slice
building document deep-linking, so it is the natural place to wire it rather than leave a
second half-built navigation path.

## Out of scope for S4

- AI link/unlink tools, and letting the model see a task's attached documents. Recorded
  explicitly so it does not become a fourth accidental gap beside §86 / §87 / §89.

---

# S3b — the editor

Layout A with B at a narrow pane (decision 2). A third `RichTextEditor` variant using
`sanitizeDocumentHtml`.

**Paragraph toolbar:** bold · italic · underline · strike · inline code · link · unlink ·
highlight · subscript · superscript, plus block-level code block, blockquote and
horizontal rule. Alignment is a `select` writing the block field (decision 3).

**Per-type editors:** heading (level select + plain text — `heading.text` is a plain
`string`, so no marks) · bullets (per-item fields, add/remove/reorder items, ordered
toggle) · table (per-cell fields, add/remove row and column) · `dataSection` (a picker over
the 15 `ExportSectionKey`s, never free text).

**In scope is block *content*; out of scope is the *set* of blocks.** Editing a bullets
block's items or a table's rows is that block's content. Adding, removing or reordering
blocks is not — so the gutter carries the kind chip and ⋮ but **no drag handle**. A handle
that does nothing is worse than no handle.

★★ Toolbar toggles use `ToggleButton`, never a hand-rolled `aria-pressed` — that is the
§55/§56 defect class, and doing it by hand here would create twelve instances at once.
Note that the existing `ToolbarButton` (`rich-text-editor.tsx:87`) *is* one of those
sites. Mark toggles take fill-only pressed state rather than the check marker (twelve
markers is noise); the fill must be **measured** against 1.4.1's 3:1 on all six scheme
maps, not assumed.

★ Keep `onMouseDown` `preventDefault` on every toolbar control: without it, mousedown
blurs the contenteditable and a commit-on-blur consumer can remount the editor between
mousedown and mouseup, so no click is ever dispatched.

★ Configure `StarterKit` to disable any node whose tag is not in `sanitizeDocumentHtml`,
as the lean variant does — otherwise a markdown input rule renders formatting on screen
that the sink then strips.

★ Per-block controls need block-unique accessible names ("Add row — gate table"). N
identical "Add row" labels is a 2.4.6 failure that the axe gate can pass when the seed
holds one table.

## Out of scope for S3b

- Block add / remove / reorder — the structural slice, **shipped separately as S3b-2**
  in 0.252.0 "Brust". A figure block with a caption is still out of scope (no such block
  kind exists in `DocBlock`).
- Search and replace: its extension's licence is unverified and it is orthogonal.
- Marks inside `heading.text`, `bullets.items` or table cells — those are plain `string`.

---

# S3c-1 — images

★★★ **THIS SECTION WAS "S3c" UNTIL 2026-08-21.** S3b-2 (structural blocks: add / delete /
reorder) shipped in 0.252.0 under the plain "S3c" label — a scope collision with the images
work this section describes, which had not shipped. Reading 0.252.0 as closing "S3c" would
have retired the images design without anyone deciding to
(`docs/open-followups.md` §113, `docs/work-inventory.md` §3). Images now own **S3c-1**
(this section, shipped 0.253.0 — see `docs/AGENTS/documents.md`'s "Asset images (S3c-1)"
section for the as-built architecture) and **S3c-2** (OOXML media parts, still open — see
"Out of scope for S3c-1" below). The label "S3c" alone is retired; always say which half.

Turso-gated on `tursoConfig !== null` (decision 5). Metadata as a workspace slice; bytes
in `document_asset_data`, an out-of-`TABLE_NAMES` store module mirroring the four that
exist (decision 6). Upload pipeline and caps per decision 8; the Turso request-size
measurement of decision 9 gates planning.

Surfaces: an asset list in the Documents tab with usage counts, rename, delete with the
shared dangling marker, and insertion into a paragraph as `<img data-asset-id>`.

**OOXML media machinery — this IS S3c-2, not part of what shipped.** The largest unknown
in the roadmap, with no existing scaffolding: `[Content_Types].xml` Default entries,
`_rels` parts, `word/media/`, `<w:drawing>` / `<wp:inline>` / `<a:blip r:embed>`, and EMU
extents scaled to `CONTENT_WIDTH` from the stored `{width, height}`. S3c-1 shipped without
it — DOCX/PPTX disclose a visible translated placeholder naming the asset instead of
embedding it (`docs/open-followups.md` tracks S3c-2 as its own entry).

★ The preview must resolve `data-asset-id` to a **blob object URL**, not inline base64 —
`document-preview.tsx` builds one HTML string through `dangerouslySetInnerHTML`, and ten
images would put ~67 MB of base64 in it. Render images lazily.

## Out of scope for S3c-1

- OOXML media parts — **this is S3c-2**, see above.
- Images on any non-Turso backend. The table exists and stays empty there.
- Images in the workspace JSON export (decision 6, accepted).
- SVG, permanently — the branding precedent excludes it as an XSS surface.
- GIF — decided during S3c-1 build, not in the original design: downscaling re-encodes
  and would silently destroy animation.
