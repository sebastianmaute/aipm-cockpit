# AI document authoring, storage and download — design

Date: 2026-08-06
Status: design approved, unimplemented
Baseline: 0.217.0 "Piercy", `main` @ `485bf67b`

## Problem

The AI assistant can read documents but cannot produce one. A user who asks for a
steering-committee deck, a status report or a project charter gets prose in a chat
bubble that they must copy out by hand.

Separately, the app has no file storage of any kind. `KnowledgeLink` / `KnowledgeItem`
are **pointers** to SharePoint, Confluence or a URL — never bytes. Nothing the app
produces survives the click that produced it.

The ask: the assistant creates, edits and exports `.pptx` / `.docx` / `.pdf` / `.html`,
and those files are stored and downloadable.

## What already exists

Measured against the tree at `485bf67b`, not assumed:

| Capability | Where | Shape |
|---|---|---|
| Export to csv/md/pdf/docx/xlsx/pptx | `export.ts` `exportWorkspace` | Workspace data only, via `buildExportSections` |
| OOXML emit | `export-docx.ts` · `export-pptx.ts` · `export-xlsx.ts` | Input is `ExportSection[]` = `{key, title, columns, rows}`. Tables only — no prose, no free layout |
| ZIP write | `zip.ts` `buildZip(entries, mime)` | Hand-rolled, no dependency |
| ZIP read | `unzip.ts` `readZipEntries` | STORED + DEFLATE via native `DecompressionStream` |
| Office read | `office-extract.ts` `extractOfficeMarkdown` | docx/xlsx/pptx → **Markdown text only**. Lossy: no styles, images or layout. Already used by chat attachments and the create-project import |
| Download | `export.ts` `triggerDownload` (private) | Hidden `<a download>`, blob URL revoked next tick |
| PDF | `export.ts` `exportPdf` | Opens a print-styled tab and calls `window.print()`. **Never produces a blob** |
| AI tools | `chat-tool-defs.ts` (38 defs) → `chat-tools.ts` routing → `use-chat-dispatcher.ts` impl | Entity CRUD + reads. No file tool |
| Rich text | `rich-text-plain.ts` (DOM-free) · `rich-text-projection.ts` (browser) · `ai-rich-text.ts` | `descriptionTextWithBreaks` is the export projection used by `export-sections.ts` `richCell` |

Dependencies are `@azure/msal-browser`, `@heroicons/react`, `@tiptap/*`, `date-holidays`,
`dompurify`, `next`, `react`, `react-dom`. No zip, docx, pptx or pdf library —
`export-ooxml-shared.ts` states the rejection explicitly ("a jszip+docx+xlsx+pptx stack
is ~600KB for what is just a few XML strings inside a ZIP").

## Decisions

Each of these was an explicit fork, resolved before design:

1. **Edit means edit app-authored documents, losslessly.** The app stores a canonical
   JSON document model as the source of truth and renders bytes on demand. Editing
   patches the JSON and re-renders. An uploaded foreign `.docx` stays **readable**
   (existing `extractOfficeMarkdown` path) but is **not editable** — there is no OOXML
   round-trip and adding one would cost either ~600KB of dependencies or a large
   hand-rolled parser/writer against real-world files.
2. **Documents are project data, in `Workspace`.** They travel with the project across
   all six write paths and are attachable to entities. Not device-local, not ephemeral.
3. **The canonical model is a typed block array**, not a Markdown string — so edits are
   surgical, each block type is separately sanitizable, and a block can be data-bound.
4. **Documents get their own `AppView`**, not a section inside Knowledge.
5. **PDF is the rendered HTML, printed.** No PDF writer, no PDF dependency.
6. **AI writes directly, with automatic version history.** No review modal. Version
   history is what makes direct writes safe, given chat tool writes have no undo capture.
7. **A full block editor is in scope** — but as slice 3, not the first release.

## Nothing binary is ever stored

This falls out of decision 1 and is the property that makes the rest cheap: a document
at rest is JSON. Bytes exist only between "user clicks Download" and the browser save
dialog. There is no blob store, no IndexedDB binary column, no Turso BLOB, no size
budget on the storage layer beyond the caps below.

## Decomposition

Four slices. This document specifies **S1** in full and outlines the rest.

| Slice | Ships |
|---|---|
| **S1** | Model, storage across six write paths, Documents view shell, three renderers + PDF print, download |
| **S2** | Five AI tools, per-write version history + revert, chat file card |
| **S3** | Full block editor (add/remove/reorder, per-type editors, table cells, dataSection picker) |
| **S4** | Entity attachment |

S4 uses a **reverse link** — `ProjectDocument.linkedEntities: {kind, id}[]` — rather than
a `documentIds` column on task + milestone + RAID + change. Same product behaviour; one
field on one entity instead of four `*_CSV_COLUMNS`, four MD codecs, four sanitizers and
another golden regen.

Order rationale: S2 before S3 because the headline ask is AI authoring, and because the
editor is the largest chunk and its shape is better informed by real model output than by
guesswork.

---

# S1 — Model, storage, view, render, download

## 1. Data model

New module `src/app/document-model.ts`. Pure, i18n-free, and **DOM-free** — it is reachable
from `scripts/generate-sample-workspace.ts`, where a DOMPurify call throws under bare node
and `jsonToWorkspace`'s catch-all swallows the throw into an empty workspace that then
"successfully" writes near-empty sample files (the §36(a) failure mode).

```ts
export type DocBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; html: string }
  | { type: "bullets"; ordered?: boolean; items: string[] }
  | { type: "table"; caption?: string; columns: string[]; rows: string[][] }
  | { type: "dataSection"; key: ExportSectionKey }
  | { type: "pageBreak" };

export type ProjectDocument = {
  id: number;
  title: string;
  blocks: readonly DocBlock[];
  createdAt: string;   // ISO
  updatedAt: string;   // ISO
};
```

### Why each shape

- **Flat block list, no `kind: "document" | "deck"` flag.** `pageBreak` is the only
  segmentation primitive. DOCX emits a page break, HTML emits `break-after: page`, PPTX
  starts a new slide there *and* at every `level: 1` heading, which becomes that slide's
  title. One model, three renderers, no mode branch to keep consistent.
- **`table` mirrors `ExportSection` minus `key` and `title`.** A `dataSection` therefore
  resolves by straight substitution at render time, and there is exactly one table code
  path per renderer.
- **`dataSection` carries only an `ExportSectionKey`** (one of the 15 in
  `EXPORT_SECTION_KEYS`, `settings-types.ts:294` — count it, do not eyeball
  `defaultExportConfig`), resolved through `buildExportSections(ws, cfgWithOnlyThatKey, lang)`.
  Live data: the document refreshes as the project moves on.
- **`id: number`**, minted max+1 like every other entity, so S2's tools use the existing
  `nextEntityId(ref.current)`. `KnowledgeLink`'s `dl-N` string ids would need a separate mint.
- **No `versions` field in S1.** The whole `documents` array travels as one JSON blob per
  backend (see §2), so S2 adds versions *inside that same blob* — no new column, no codec
  change, no second golden regen. Reserving the field now would be YAGNI that saves nothing.

### Sanitizer

`sanitizeProjectDocuments(raw: unknown): ProjectDocument[]` — one entry point, per-block-type
validation, drops unknown block types rather than passing them through.

Caps, bounding what a hostile or corrupt import can force (same job as `MAX_KNOWLEDGE_ITEMS`):

| Cap | Value |
|---|---|
| `MAX_DOCUMENTS` | 200 |
| `MAX_BLOCKS_PER_DOC` | 500 |
| `MAX_TABLE_ROWS` | 500 |
| `MAX_TABLE_COLUMNS` | 30 |
| `MAX_BULLET_ITEMS` | 200 |

Text is capped with **`capHtmlText`**, not `clipText` — `capHtmlText` backs a truncation off
one code unit rather than splitting a surrogate pair, and a lone surrogate becomes `U+FFFD`
on CSV/MD while surviving on JSON/IDB (a backend-dependent corruption; `clipText` still
carries that bug, open-followups §22).

`sanitizeProjectDocuments` **cannot** run DOMPurify — it is DOM-free by contract. The
allow-list runs at the render sink and at the whole-object load boundaries (§3, §2).

## 2. Storage — six write paths

```ts
// workspace.ts
/** AI- and user-authored project documents (canonical block model; bytes are
 *  rendered on demand, never stored). Optional & additive: undefined/empty
 *  serializes to nothing (byte-stable). Sanitized by sanitizeProjectDocuments. */
documents?: readonly ProjectDocument[];
```

Optional + additive + byte-stable-when-empty, exactly like `knowledgeItems` and `insights`.

### Which persistence pattern — corrected 2026-08-06

The codebase has **two** patterns for a Workspace array, and the choice is decided by
structure, not preference:

| Pattern | Used by | Shape |
|---|---|---|
| **A — entity table** | `tasks`, `milestones`, `changes`, … | An `ENTITY_SPECS` row → own Turso table + `TABLE_NAMES` membership; flat `*_CSV_COLUMNS`; an MD **table** |
| **B — meta JSON blob** | `knowledgeItems`, `insights`, `timelogLinks` | One JSON blob in the Turso `meta` table; a fenced ` ```json ` block in Markdown; a dedicated CSV section. No `ENTITY_SPECS` row |

`documents` uses **Pattern B**, following `insights`. Evidence:

- Both existing *nested-array* Workspace fields already use it. Pattern A's columns are
  flat scalars; `blocks` is a nested array.
- `noteLog` is the only JSON-in-cell precedent and it is present in `CSV_COLUMNS`
  (`csv-codecs-core.ts:81`) but **absent from the Markdown columns entirely** — so
  Pattern A has no working Markdown story for a JSON payload. (MD cell escaping at
  `markdown-codecs-core.ts:243-245` does handle `|` and `\`, so this is a convention gap,
  not a hard blocker — but there is no precedent to copy.)
- Pattern B removes `DOCUMENTS_CSV_COLUMNS`, `documentFieldToString`,
  `buildDocumentFromObj`, the MD table codec, the `ENTITY_SPECS` row and the separate
  `encodeDocBlocks`/`decodeDocBlocks` helpers. One `JSON.stringify` per backend instead.

Consequence: `documents` is **not** in `TABLE_NAMES` — not because it is non-workspace
data, but because it has no table of its own. It rides `meta`, and Turso dirty-detection
is `dirty.add("meta")` on reference inequality, exactly as `insights` does
(`turso-schema.ts:252`).

| Path | Work |
|---|---|
| JSON file / SharePoint / local-file | Native array. `jsonToWorkspace` routes through `sanitizeProjectDocuments` **and** `sanitizeDocumentRichFields` |
| IndexedDB | KV entry alongside the other blob fields — no new object store, no DB version bump. Load path routes through both sanitizers |
| Turso single | `meta` row `key = "documents"`; load at the `rowObjects(byTable.get("meta")).find(…)` site, save beside `insights`, `dirty.add("meta")` on change |
| Turso tenant | `tenantInsert("meta", ["key","value"], ["documents", JSON.stringify(...)], projectId)` |
| CSV | `CSV_SECTION_DOCUMENTS` section + `documentsToCsv` / decode mode, mirroring `knowledgeItemsToCsv` |
| Markdown | `documentsToMarkdown` / `markdownToDocuments` — fenced ` ```json ` block, mirroring `knowledgeItemsToMarkdown` (`markdown-codecs-core.ts:171`) |

### The rich-text boundary, stated honestly

`paragraph.html` inherits **open-followups §28**. The CSV/MD/Turso decoders hand-build
entities and never call the entity sanitizer, and the sanitizer is DOM-free so it could
not run DOMPurify even if they did. Therefore:

- **Sink re-sanitize** in `doc-render-html.ts` — every `paragraph.html` passes
  `sanitizeTemplateHtml` before it reaches `dangerouslySetInnerHTML`. This is the layer
  that actually holds.
- **`sanitizeDocumentRichFields(doc)`** at the two whole-object load boundaries that cast
  verbatim: `jsonToWorkspace` and the IDB load in `browser-backend.ts`. One-argument
  function, because every call site is `.map(fn)` and `.map` passes the index as the
  second argument — a `(doc, fields)` signature would be fed `0, 1, 2…`, normalise
  nothing, and leave every test green.

This is defence at the sink, not sanitisation at rest. S2 must not assume stored HTML is
clean.

### Sample data

Add one small document to `sample-workspace-small.json` (the hand-curated master), then
regenerate `-big`/`-huge` via `npx vite-node scripts/generate-sample-workspace.ts` and
regenerate `__fixtures__/golden-*` via the serializers.

This is a legitimate new-column format change, not masking a diff. It is required: without
a seeded document the new view renders empty at axe-scan time and the a11y gate proves
nothing about it.

## 3. Renderers

### Refactor first, then build

`buildDocx` and `buildPptx` are the only exports of their modules, but their private
internals are exactly what block rendering needs: `buildDocxTable`, and pptx's
`pptxTextBox`, `wrapPptxSlide`, `buildPptxSlideMaster`, `buildPptxSlideLayout`,
`buildPptxTheme`, `pptxBackgroundRect`, `pptxAccentBar`.

Promote them into `ooxml-docx-primitives.ts` / `ooxml-pptx-primitives.ts`, consumed by
both the section exporter and the block renderer. Two concrete reasons beyond tidiness:

- `export-pptx.ts` is 586 lines against the 800-line ratchet; a second 500-line renderer
  built by copy would put both near it.
- `dup:check` (jscpd, blocking) is a live risk from three renderers built out of the same
  shapes. Shared primitives are the mitigation — verified by **running** the gate, not
  assumed.

### The three renderers

| Module | Mapping |
|---|---|
| `doc-render-html.ts` | Canonical. Two modes: `preview` (fragment, for the in-app view) and `standalone` (full document + `PRINT_STYLES`). Feeds the view, the `.html` download, and the print-PDF |
| `doc-render-docx.ts` | heading → `w:pStyle Heading{n}` · paragraph → runs with `w:br` at line breaks · bullets → numbered/bulleted paragraphs · table → `buildDocxTable` · pageBreak → `w:br w:type="page"` · dataSection → resolve, then `buildDocxTable` |
| `doc-render-pptx.ts` | Segment blocks into slides at each `pageBreak` and each `level: 1` heading (that heading becomes the slide title). Reuses master/layout/theme so decks stay on-brand |

`PRINT_STYLES` is currently private to `export.ts`; promote it alongside `triggerDownload`
(§5) so there is one print stylesheet, not two that drift.

PDF: build the `standalone` HTML, `window.open("", "_blank")`, write, close, and let the
page's own load handler call `window.print()` — the existing `exportPdf` shape, including
its popup-blocked fallback (download the `.html` instead so the user can print manually).

### Two limitations, recorded not discovered

1. **`paragraph.html` reaches OOXML as flat text with line breaks**, via
   `descriptionTextWithBreaks` (`rich-text-projection.ts`) — the same projection
   `export-sections.ts` `richCell` already uses for rich columns, so block boundaries
   survive as `"\n"` and each renderer maps that to its own primitive (`<w:br/>` for DOCX,
   one `<a:p>` per line for PPTX). Bold and italic are **lost** in `.docx` and `.pptx`;
   they survive in HTML and PDF. Mapping inline marks to `w:r` runs is a later slice.
2. **`doc-render-docx` is DOM-bound**, because that projection is. Today's OOXML builders
   are node-pure. Tests run under jsdom so this is fine, but it is a real property change:
   the sample generator must never call a renderer.

## 4. Documents view

New `AppView "documents"` — the 35th — nav-grouped beside `knowledge`. Not Turso-gated,
so it stays out of `TURSO_ONLY_VIEWS`.

Split up front per the gantt pattern, rather than after crossing the ratchet:

| File | Responsibility |
|---|---|
| `documents-panel.tsx` | Orchestrator: list state, selection, delete confirm |
| `documents-list.tsx` | Rows via `SortResizeTh` — title · blocks · updated · actions |
| `document-preview.tsx` | Read-only render from `doc-render-html` preview mode |
| `documents-toolbar.tsx` | Controls |

S1 operations: create empty · rename · duplicate · delete · download-as. Block editing is S3.

### Toolbar

**"New document" leads** the control row as the pane's primary action (the `aiPlanButton`
precedent), ahead of any filter. The trailing group is **Print · reset-columns ·
reset-size**, contiguous, with the download menu placed *before* it.

Asserted with the shared `src/test/toolbar-order.ts` and `contiguous: true` — never a
hand-rolled `compareDocumentPosition` walk, which silently takes the first match and can
pass against the wrong control.

### Registrations a new view forces

| Registration | Consequence if missed |
|---|---|
| `nav-config.ts` `AppView` + nav group | View unreachable |
| `VIEW_AI_SCOPE` entry (`view-ai-scope.ts`) | **tsc failure** — the `Record<AppView, ViewScope>` is total by construction |
| `HELP_ENTRIES` entry | **`help-content-gate.test.ts` red** — `KNOWN_UNCOVERED` is `[]` (verified at `help-content-gate.test.ts:29`) |
| `A11Y_VIEWS` + `HASH_VIEW` (`e2e/a11y.spec.ts`) | 16 → 17 views; 85 → 90 axe scans |
| EN + DE i18n | tsc key parity. DE written via node utf8 write — the Edit tool corrupts umlauts and curls quotes, and the file is CRLF so an LF-anchored replace silently no-ops |
| `ASK_CLAUDE_PROMPTS` | **Deliberately none in S1.** The chip↔capability rule (pinned by `ask-claude-prompts.test.ts`) requires every chipped view to have `toolHints` or a digest behind it; document tools do not exist until S2. Chips land in S2 |

### Accessibility

- Per-row controls need row-**unique** accessible names — `Download – <title>`, not N
  identical "Download". The axe gate can pass N identical labels when only one row is
  seeded, so this is a hand check, not a gate result.
- Any toggle uses `ToggleButton` (which carries the non-colour `data-pressed-marker`),
  never a hand-rolled `aria-pressed` button.
- Verify with `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Documents"` on
  a **fresh isolated server** (`PORT=3100 npm run dev`, stop with `PORT=3100 npm run stop`)
  — never the reused `:3000` dev server, whose stale Tailwind produces phantom failures.

## 5. Download

`document-download.ts` → `downloadDocument(doc, format, ws, lang)`, where `format` is
`"html" | "docx" | "pptx" | "pdf"`.

`triggerDownload` is currently private to `export.ts`. Promote it (with `PRINT_STYLES`)
into a shared `download.ts` and have both callers use it — one blob-URL lifecycle, not two
that drift.

Filename: slugified title + ISO date + extension.

The format menu mirrors `export-menu.tsx`'s shape. Whether to generalize that component or
mirror it is decided at implementation against the actual code, not guessed here.

## 6. Testing and gates

- **Coverage floors are blocking** (global lines 92 / funcs 91 / branch 80 / stmts 89).
  Every new `.ts` in this slice is real logic — model, sanitizer, three renderers, download.
  None goes in `coverage.exclude`; `use-view-digest.ts` is the precedent for testing a
  logic-bearing module rather than excluding it. Exclude glue, test logic.
- **Codec property test:** `sanitize(decode(encode(doc)))` equals `sanitize(doc)` across all
  six block types. Use `fc.date({noInvalidDate: true})` or an integer-ms range for
  timestamps — a bare `fc.date()` can emit an Invalid Date whose `.toISOString()` throws.
- `entity-persistence-registry.test.ts` extends to `documents`.
- `golden-workspace.test` regenerated once, from the real sample change.
- `npm run size:check` — no new file over 800 lines, no baselined file grown.
- `npm run dup:check` — run it; the three renderers are the reason it might fire.
- `npm run test:shuffle` before pushing — the only local reproduction of the blocking
  `unit-tests-shuffled` job.
- `npx tsc --noEmit` after editing any test — `next build` does not typecheck `*.test.tsx`
  and vitest never typechecks.
- Never read a gate's exit code through a pipe. Redirect, check unpiped, then read the file.

## 7. Out of scope for S1

- AI tools of any kind (S2)
- Version history (S2)
- Any block editing (S3)
- Entity attachment (S4)
- Editing uploaded foreign files — permanently out of scope per decision 1
- Bold/italic fidelity in `.docx` / `.pptx`
- `.xlsx` output — the block model has no natural spreadsheet projection, and
  `exportWorkspace` already covers tabular export

---

# S2 — AI tools and version history (outline)

Five tools: `create_document`, `get_document`, `update_document`, `delete_document`,
`list_documents`. Schemas in `chat-tool-defs.ts`, routing in `chat-tools.ts`, implementation
in `use-chat-dispatcher.ts`. Write tools guard `if (args.isReadOnly) throw readOnlyError()`
first; ids mint via `nextEntityId(ref.current)`; both the ref and `setDocuments` update.

Two hazards that must be designed for, not discovered:

1. **`update_document(blocks)` is replace semantics** — the `set_task_dependencies` class,
   where what the model *leaves out* is destroyed. Chat tool writes have **no undo capture**.
   Both guards are mandatory: a wholly-refused write must leave the stored blocks
   **untouched** (never write the empty result), and every real write must report what it
   dropped. Validate array-ness at the tool boundary in `chat-tools.ts`, not in the pure
   model — a non-array must never be read as "clear all".
   Test trap: asserting `blocks` equals `[]` against a fixture that never had blocks passes
   whether the code preserves or erases. Seed a real prior value and watch it fail first.
2. **Model-authored `paragraph.html` needs an allow-list before storage.** Route the model's
   input through `sanitizeAiRichText` (`ai-rich-text.ts`) — which is `sanitizeRichText` then
   **`sanitizeTemplateHtml`**. Not `sanitizeNoteHtml` — and the difference is NOT reach.
   `ALLOWED_TAGS` is `["p","br","strong","em","u","h1","h2","ul","ol","li","a"]`
   (`sanitize-html.ts`), so NEITHER list allows `<h3>`/`<div>`/`<table>`: both delete those
   TAGS. What differs is the TEXT inside them — `sanitizeNoteHtml` sets `KEEP_CONTENT:false`
   and deletes it along with the tag, while `sanitizeTemplateHtml` keeps DOMPurify's default
   and UNWRAPS the tag. A model emitting `<h3>Section</h3>` therefore keeps the word
   "Section" as a paragraph instead of losing it outright. Apply it to the
   model's input/patch, never to the merged document, and **skip** a field the model did not
   supply rather than blanking it. Add the field to `AI_RICH_FIELDS`.
   Test at the **write**, not at the tool call — spying on `runTool` is one hop short of the
   defect.

Version history: each write snapshots the previous `blocks` + `title` into a per-document
version list inside the same JSON-in-cell blob, with a retention cap. Revert from the
Documents view. This is what makes direct AI writes safe.

Also in S2: a chat file card (preview + Download + Open), an `ai.documentWrite` activity
kind, and `ASK_CLAUDE_PROMPTS` chips for the `documents` view — which only become legal
once `toolHints` exist behind them.

# S3 — Full block editor (outline)

Per-block-type editors: heading (level + text), paragraph (the lean `RichTextEditor`),
bullets, table (cell-by-cell + add/remove row/column), `dataSection` (a picker over the 15
`ExportSectionKey`s). Add, remove and reorder blocks, with both drag and a keyboard path —
drag alone fails the a11y gate.

Save handlers are functional setters (`setDocuments(prev => …)`). If an "Add block" modal
precomputes an id, route the save through `resolveEntitySave` and decide create-vs-update by
the modal's **intent**, never by id existence.

# S4 — Entity attachment (outline)

`ProjectDocument.linkedEntities: {kind: "task" | "milestone" | "raid" | "change"; id: number}[]`.
Reverse link: one field on one entity rather than a `documentIds` column on four. Attachment
chips on the linked entity, a filter in the Documents view, and deep-link both ways.

Deletion is non-cascading, mirroring `delete_resource`: a link to a deleted entity is left
dangling and rendered as such, not silently dropped.
