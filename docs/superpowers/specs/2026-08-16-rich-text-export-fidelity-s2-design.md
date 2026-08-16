# Rich text S2 — export fidelity for the entity rich fields — Design

**Status:** Approved for planning
**Date:** 2026-08-16
**Base:** `main` at 0.242.0 "Ashby" (`2e2c8c00`)

**Slice 2 of the rich-text program.** S1 (0.232.0 "Merril") unified the allow-list, the sanitizer,
the editor and the toolbar. §140 (0.236.0) added task lists and text alignment — the attribute
boundary. §144 (0.236.0) made the toolbar keyboard-operable and gate-visible. This slice pays the
export half of the debt those three deliberately left: `docs/open-followups.md` **§141(b)**, plus
the two riders §141(d) and §143 that live in the same files.

## Problem

The seven rich entity fields — `Task.description`, RAID `description`/`mitigation`, Change
`description`/`impactDescription`/`resolutionNotes`, `Milestone.description` — can carry headings,
ordered and unordered lists, blockquote, code blocks, task lists and text alignment. **None of that
survives an export.** Every one of them is flattened to plain text with newlines before any renderer
sees it:

```ts
// src/app/export-sections.ts
function richCell(value: string, column: string, rich: ReadonlySet<string>): string {
  return rich.has(column) ? descriptionTextWithBreaks(value) : value;
}
```

A user who structures a change-request impact assessment as a numbered list and exports it to Word
gets one run-on paragraph. §141(b) records this as DOCX/PPTX-only; **it is not** — the same flat
string reaches HTML and PDF, where `export.ts` escapes it and inserts `<br>`:

```
$ git grep -n "htmlCellWithBreaks" -- src/app/export.ts src/app/download.ts
```

## What §141(b) understates

Three findings from grounding the design in the code, each of which changed the scope.

**1. Entity rich fields are exported as TABLE CELLS, not flowing paragraphs.** The pipe every
renderer consumes is a flat string table:

```ts
export type ExportSection = {
  key: ExportSectionKey;
  title: string;
  columns: string[];
  rows: (string | number)[][];   // ← the cell type this slice widens
};
```

**2. `htmlToRichLines` is DOM-bound and `export-sections.ts` is the pure model layer.** Rich
structure therefore cannot be *parsed* in sections — only *carried*. Every parse stays in the
DOM-bound renderers where it already lives. This is the same DOM-free axis `AGENTS.md` guards for
`rich-text-plain.ts` and `document-model.ts`.

**3. `RichLine` cannot represent what is being lost.** The type is:

```ts
export type RichLineKind = "p" | "blockquote" | "pre" | "hr";
export type RichLine = { kind: RichLineKind; runs: TextRun[] };
```

No heading level, no list kind, no numbering, no alignment, no task marker. So "wire the entity
fields onto `htmlToRichLines`" — §141(b)'s stated fix — is **necessary but not sufficient**. The
model has to grow first.

`rich-text-runs.ts` carries two comments that this slice deliberately reverses. Both are rewritten
in the same commit rather than left to rot:

- `LI` sits in `LINE_TAGS` — *"giving it a kind would force both OOXML renderers to grow list
  numbering in a slice scoped to marks."* That is now this slice's job.
- `H1`–`H6` are in `LINE_TAGS` *"to at least BREAK. Heading LEVEL is not represented."*

## Scope

| Format | Fidelity | Why |
|---|---|---|
| **DOCX** | **Yes** | Table cells hold paragraphs; styles already declared for most of what is needed |
| **HTML / PDF** | **Yes** | Cheapest of all — the stored value is already sanitized HTML |
| **In-app document preview** | **Yes, free** | Renders through `renderDocumentHtml`, so it inherits the HTML renderer's fidelity with no change of its own |
| XLSX | No | Cells have run-level rich text but **no paragraphs and no lists** — headings and numbering are unrepresentable |
| PPTX | No | See "PPTX is out" below |
| CSV | No | Interchange format. `descriptionTextWithBreaks` is correct there, and CSV export does not route through `buildExportSections` at all |

### PPTX is out, and the reason is not cost

`buildPptx` renders **one slide per row**, not a table: columns 0–1 become title and subtitle, and
columns 2–7 become `"Label: value"` lines, capped at six extra fields (`columns.slice(2, 8)`). An
entity's `description` is frequently **not on the slide at all**, and where it is, it occupies one
label-value line rather than a paragraph container. Fidelity there needs a PPTX *layout* redesign,
which does not belong inside a rich-text slice.

Registered as new follow-up **§153** together with native bullets (`buChar`/`buAutoNum`, which need
no new package part in PPTX) — the two are the same surface.

### Native OOXML numbering is out

The DOCX package carries **no `numbering.xml`**, and `doc-render-docx.ts` already handles this for
document `bullets` blocks by emitting literal marker text, with its reason stated in `bulletMarker`.
Three arguments for keeping that:

1. **Consistency.** Document `bullets` blocks render literal markers today. Making entity fields
   native would show two list styles in one file depending on which block produced them.
2. **§141(b) asks for numbering to be *preserved*, not *native*.** A literal `3.` preserves the
   author's ordinal. Native numbering is a nicer artifact, not more information.
3. **A new package part is a corrupt-file risk class with no gate.** `numbering.xml` means
   `[Content_Types].xml` and rels edits; a malformed part makes Word refuse the file outright. No
   unit test in this repo catches that — only opening it in Word does.

Registered as new follow-up **§154**, separate from §153 because it is a different surface and a
different cost: PPTX bullets are paragraph attributes on an existing part, while DOCX numbering is a
**new package part** plus content-types and rels wiring. §154 also has to decide what it would take
to gate the risk — some form of package-level validation, or an accepted manual-open step — because
shipping a new OOXML part with no detector for a malformed one is the actual blocker, not the XML
itself.

## Architecture

`buildExportSections` has three call sites — `export.ts` twice and `doc-data-section.ts` once — and
`resolveDataSection` has exactly three real callers. So the widened cell reaches **seven** consumers
of `ExportSection.rows`, four on the export path and three on the document path. Enumerate both,
rather than trusting this count:

```
$ git grep -n "buildExportSections" -- src/app | grep -v "\.test\."
$ git grep -n "resolveDataSection" -- src/app | grep -v "\.test\."
```

```
stored rich HTML (7 entity fields)
 └─ export-sections.ts  richCell()          [PURE — no DOM, no parse]
      └─ RichCell = { html: string; text: string }
           ├─ export.ts        HTML/PDF   → sanitized html inline        ← FIDELITY
           ├─ export-docx.ts   buildDocxTable → w:p per RichLine         ← FIDELITY
           ├─ export-xlsx.ts   buildSheetXml  → cell.text
           ├─ export-pptx.ts   buildPptxRowSlide → cell.text
           └─ doc-data-section.ts  resolveDataSection()
                ├─ doc-render-html.ts  → html      ← FIDELITY
                ├─ doc-render-docx.ts  → RichLines ← FIDELITY
                └─ doc-render-pptx.ts  → cell.text
```

★ `document-preview.tsx` (the in-app preview) and `documents-history-modal.tsx` are **not** direct
consumers — they call `renderDocumentHtml`, so they inherit the HTML renderer's fidelity for free
without appearing in either grep. An earlier revision of this design listed the preview as a
sibling of the three document renderers, which is the wrong mechanism for the right outcome. Neither
file needs a change.

### Why the cell carries BOTH representations

Three shapes were considered:

| | Shape | Rejected because |
|---|---|---|
| **Chosen** | Widen the cell union to `string \| number \| RichCell`, `RichCell = { html; text }` | — |
| Side-channel | `rows` unchanged; section gains `richColumns` + a parallel HTML array | Two sources of truth for one cell. Rows filtered or reordered in one and not the other desynchronise silently, and no gate can see it. |
| Mode flag | `buildExportSections(ws, cfg, lang, { rich: true })` | The same section key would have two shapes. A consumer that forgets the flag writes raw `<p>` markup into a CSV cell — silent, and the failure lands in a file people mail out. This is §143's defect one level up, in a worse place. |

Carrying `text` alongside `html` costs a redundant `descriptionTextWithBreaks` per rich cell. That
is the price of the guarantee: **a flat consumer can never accidentally receive markup.**

### The one consumer tsc does not name — fixed here

`buildDocxTable`, `buildSheetXml` and `buildPptxRowSlide` all take `(string | number)[][]` or
`(string | number)[]`, so widening the union turns them red at the call site. **`export.ts` is the
exception**: it reaches HTML cells through

```ts
// src/app/download.ts
export function htmlCellWithBreaks(cell: unknown): string { … }
```

`unknown` accepts a `RichCell` silently and emits `[object Object]`. The signature is tightened to
`string | number` in this slice. Without that, the type-safety argument the chosen shape rests on is
false for the one consumer that matters most.

## The `RichLine` model

Alignment is **orthogonal to kind** — a heading, a paragraph and a list item can each be centred —
so it cannot be a `kind`. A discriminated union over a shared base:

```ts
type Align = "left" | "center" | "right" | "justify";   // == data-align's guarded values
type LineBase = { runs: TextRun[]; align?: Align };

export type RichLine =
  | (LineBase & { kind: "p" | "blockquote" | "pre" })
  | (LineBase & { kind: "hr" })
  | (LineBase & { kind: "heading"; level: 1 | 2 | 3 | 4 })
  | (LineBase & { kind: "li"; ordered: boolean; depth: number; index: number;
                  task?: "checked" | "unchecked" });
```

- **`level` is `1|2|3|4`** — the editor's StarterKit range. `<h5>`/`<h6>` can still arrive from
  stored legacy markup, so the parser **clamps to 4** rather than widening the type. DOCX has no
  `Heading5` and Word would silently ignore it.
- **`index` is a per-depth counter** the parser maintains, so an `<ol>` nested in an `<ol>` restarts
  correctly. Renderers never count.
- **`task` derives from `data-checked`**, whose only legal values are already `"true"`/`"false"`
  (`ATTR_VALUES` in `sanitize-html.ts`).
- **`align` reads `data-align`** — the guarded data attribute §140 shipped, whose predicate already
  admits exactly the four values above. **Not** a `style` attribute.

This is a breaking type change. Its existing consumers are `doc-render-docx.ts`,
`doc-render-pptx.ts` and `ai-document-blocks.ts`; tsc names all three. That is the point.

## Renderer mapping

### DOCX

| `RichLine` | Emitted |
|---|---|
| `heading` level N | `<w:pStyle w:val="Heading{N}"/>` |
| `li` | `ListParagraph` style + literal marker run via the existing `bulletMarker(ordered, index)`; depth as `<w:ind w:left="{720 * (depth + 1)}"/>` (`ListParagraph` sets 720; a direct `pPr` overrides) |
| `li` with `task` | marker is `TASK_MARK_CHECKED` / `TASK_MARK_UNCHECKED`, **imported from `rich-text-plain.ts`** so the OOXML and flat projections cannot drift on `"[x] "` vs `"[x]"` |
| `align` | `<w:jc w:val="…"/>` — **`justify` maps to `both`** in OOXML; the other three pass through |
| `blockquote` / `pre` / `hr` | unchanged |

Two mechanical constraints, both of which fail silently:

- **`DOC_STYLES` declares Heading1/2/3 only** — the editor allows h1–h4. A `w:pStyle` naming a style
  `styles.xml` does not carry is **silently ignored by Word** (the file's own comment says so), so an
  `<h4>` would render as body text with every XML assertion green. `Heading4` is added.
- **`w:pPr`'s children are an `xsd:sequence`** — the same trap `doc-render-docx.ts` already
  documents for `w:rPr` via `DOCX_MARK_RPR`'s `rank`. Order is `pStyle → pBdr → spacing → ind → jc`.
  A string-comparison test passes whatever the order, so this needs its own assertion.

`richParas`'s comment — *"Table cells never come through here — `buildDocxTable` takes plain
strings — so no `<w:p>`/`<w:pBdr>` emitted here can land somewhere a paragraph is not allowed"* — is
**falsified by this slice** and is rewritten with it. `<w:p>` is legal inside `<w:tc>`, so the
emission stays valid; what changes is that the guarantee the comment asserted no longer holds.

### HTML / PDF

The cell's `html` goes in **unescaped**, re-sanitized at the sink with `sanitizeRichHtml` —
idempotent, and the same defense-in-depth `RichTextView` and the comm-send preview already apply.

`PRINT_STYLES` gains **cell-scoped** rules, or an `<h1>` inside a table cell renders at 18pt and
blows the row apart: heading sizes stepped down under `td`, `ul`/`ol` margin and padding reset,
`data-align` honoured.

No new CSP surface — `PRINT_STYLES` is already an inline `<style>` in a standalone document, and
this adds rules to it rather than a new mechanism.

### Flat consumers

`export-xlsx.ts`, `export-pptx.ts` and `doc-render-pptx.ts` read `cell.text`. Output is
byte-identical to today, and a test asserts exactly that.

## Riders

Both land in files this slice already opens.

- **§141(d)** — `CONTAINS_TAG`'s `/i` flag is unpinned repo-wide: the mutant survives 215 tests
  across six files, and dropping it escapes UPPERCASE legacy markup (`<P>`, `<STRONG>`) into Word,
  PowerPoint, the HTML preview and the PDF. Closed by one `doc-render-html` test rendering
  `"Intro <STRONG>bold</STRONG> tail"` and asserting the markup is **not** escaped. The register
  already says this belongs with §141(b)'s work.
- **§143** — convert `doc-render-docx.ts` and `doc-render-pptx.ts` to the branded `RENDER_SINK`
  constant (2 of the 25 remaining raw literals), and add the **construction test** the entry calls
  the honest minimum: assert `SINK_TAGS.projection` *is* `SINK_TAGS.document` and that `htmlStartRe`
  yields an identical `source` for both. That pins the premise behind the one sink pair no fixture
  can ever distinguish, and goes red the moment they diverge — at which point a fixture becomes
  possible and should be written.

## Testing

Eight layers. Load-bearing assertions get a mutation proof, not just a green run.

1. **`rich-text-runs.test.ts`** — the parser, where every new field is minted: heading level;
   `<h5>`/`<h6>` clamped to 4; `<ol>` nested in `<ol>` restarting its counter per depth; `depth` on
   nested lists; `task` both ways; `align` on **each** kind — paragraph, heading and list item.
   Orthogonality is the property, so one alignment test on a paragraph does not cover it.
2. **`export-sections.test.ts`** — `richCell` returns a `RichCell` for rich columns **only**, and
   its `.text` is byte-identical to today's output. That regression proves the flat consumers did
   not move.
3. **DOCX mapping** — the table above, case by case, including `justify → both`.
4. **`w:pPr` child order** — asserted explicitly, the way `DOCX_MARK_RPR`'s `rank` already is.
5. **Style-declaration invariant** — every `w:pStyle w:val="X"` any renderer emits has a matching
   `w:styleId="X"` in `DOC_STYLES`. This is the mechanical guard for the whole Heading4 class and
   generalizes past this slice.
6. **`w:jc` value domain** — only the four legal `ST_Jc` values can be emitted.
7. **HTML/PDF** — a rich cell emits markup rather than escaped text, and the emitted markup is
   sanitizer-clean.
8. **Flat-consumer byte-stability** — XLSX and PPTX output unchanged for a fixture carrying
   headings, lists and alignment.

Plus the two rider tests above.

**What no test here can prove:** that Word and PowerPoint actually open the files. There is no OOXML
schema validation in this repo and adding one is out of scope. Layers 4–6 are the compensating
controls — they pin the three mechanical properties that make Word reject or silently drop content.
**One manual open in Word and LibreOffice is owed** and is named here so it does not join the unpaid
eye-verify debt from the dashboard slice.

No new `.ts` files, so no `coverage.exclude` decision. `htmlToRichLines` runs under jsdom. No new
i18n strings. This is a feature, so it takes a **version bump across all eight sites**.

## Out of scope

| Not doing | Why |
|---|---|
| **§141(a)** repair of already-escaped stored values | Undecidable — nothing distinguishes "the old boundary escaped it" from "the user typed a literal tag". The register prices doing nothing; the population shrinks on every human re-save. |
| **§141(c)** / §31 markup-byte cap | Re-price only. Caps measure visible text; the 21-tag list moved the ceiling. Register note, no code. |
| **PPTX fidelity** | See "PPTX is out". Becomes §153. |
| **Native OOXML numbering** | New package part = corrupt-file risk with no gate. Becomes §154. |
| **XLSX / CSV fidelity** | XLSX has runs but no paragraphs or lists. CSV is interchange. |
| **The other 23 §143 raw literals** | Display/upgrade boundaries, not storage classifiers. |
| **§142, §28, §36(a), §151** | Different files, different arguments. §36(a) belongs with the §151 probe. |

## Register changes

- **§141(b)** — closed, with the correction that the loss was never DOCX/PPTX-only.
- **§141(d)** — closed.
- **§143** — the construction test lands; the entry stays open for the remaining 23 literals and
  records that the undecidable pair is now a tested premise.
- **§153** — new: PPTX export fidelity (native bullets, a real table layout, the six-field cap),
  carrying the layout finding from this design.
- **§154** — new: native DOCX list numbering via a `numbering.xml` part, and what would have to
  exist to gate a new OOXML package part at all.
