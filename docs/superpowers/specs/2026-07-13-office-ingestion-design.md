# Office Document Ingestion — Design

**Date:** 2026-07-13
**Feature:** AI-Assistant + create-project importer accept Office files (docx/xlsx/xlsm/pptx), extracted client-side to Markdown for actionable extraction by Claude.

## Goal

Extend attachment ingestion so Office Open XML files are unzipped and text-extracted **client-side, zero dependencies**, producing structured Markdown sent to Claude as a text document block. PDF/image/text already work via `chat-attachments.ts` — untouched.

## Rationale

- Office files are ZIP-of-XML. Browser native `DecompressionStream("deflate-raw")` unzips with no library.
- Repo already hand-rolls all OOXML **writing** (no lib: `zip.ts` `buildZip`, `export-docx/xlsx/pptx`). Reading mirrors that precedent.
- Regex text extraction (no `DOMParser`) keeps modules pure and node-testable (no jsdom).
- Shared classifier `classifyAttachment` is used by BOTH chat (`chat-panel.tsx`) and the create-project importer (`step0-import-panel.tsx`) → extending it lights up both surfaces.

## Decisions (locked with user)

1. **Approach:** client-side, no dependency (native `DecompressionStream` + hand-rolled XML extraction).
2. **Fidelity:** structured Markdown (docx headings/paragraphs/tables; xlsx per-sheet MD tables with names; pptx per-slide sections).
3. **Surfaces:** both chat AND create-project importer (shared classifier).

## New modules (`src/app/`, pure, dep-free, node-testable)

| Module | Responsibility |
|---|---|
| `unzip.ts` | Minimal ZIP reader. Parse End-of-Central-Directory record → central directory entries → per-entry decompress: method 8 (deflate) via `DecompressionStream("deflate-raw")`, method 0 (stored) passthrough. Returns `Promise<Map<string, Uint8Array>>`. Uses central directory (not local-header scan) so data-descriptor entries (bit-3 flag, which Office sometimes emits) parse correctly. |
| `office-xml.ts` | Shared helpers: `decodeUtf8(bytes)`, `unescapeXml(s)` (`&amp; &lt; &gt; &quot; &apos; &#NNN; &#xHH;`), `extractRuns(xml, tag)` (ordered text of `<tag ...>...</tag>` runs honoring `xml:space="preserve"`; trims otherwise). |
| `docx-extract.ts` | `word/document.xml` → paragraphs split on `<w:p>`; heading level from `<w:pStyle w:val="HeadingN">` → `#`×N; tables `<w:tbl>`→`<w:tr>`→`<w:tc>` rendered as Markdown table (first row = header). |
| `xlsx-extract.ts` | `xl/sharedStrings.xml` → indexed string array; `xl/workbook.xml` → sheet display names in document order; `xl/worksheets/sheetN.xml` → rows/cells (`t="s"` = shared-string index; else inline string / number / boolean). Emits `## Sheet: <name>` + Markdown table per non-empty sheet. |
| `pptx-extract.ts` | `ppt/slides/slideN.xml` numerically sorted → `## Slide N` heading + bullet list; each `<a:p>` paragraph = one bullet joining its `<a:t>` runs. |
| `office-extract.ts` | Dispatcher. `officeKindOf(mime, ext): OfficeFormat \| null` (`"docx"\|"xlsx"\|"pptx"`; xlsm→`"xlsx"`). `extractOfficeMarkdown(bytes: ArrayBuffer, fmt): Promise<string>` routes to the extractor. Output char-capped at `MAX_EXTRACT_CHARS` (~200_000) with a trailing truncation note. |

## Wiring (existing files)

- **`chat-attachments.ts`**
  - `AttachmentKind` gains `"office"`.
  - `classifyAttachment` recognizes the 4 MIME types + extensions `.docx/.xlsx/.xlsm/.pptx`, returns `"office"`.
  - `buildAttachmentBlock("office", _mime, markdown)` → `{ type:"document", source:{ type:"text", media_type:"text/plain", data: markdown } }` (same block shape as `text`).
  - `AttachmentError` gains `"extract-failed"`.
- **`chat-api.ts` `readAttachmentData(file, kind)`**
  - Widen `kind` param to include `"office"`.
  - `"office"` branch: `await file.arrayBuffer()` → `extractOfficeMarkdown(bytes, officeKindOf(file.type, file.name))` → Markdown string. Rejects on failure.
- **i18n (`i18n.ts` + `i18n.de.ts`)**: `attachmentExtractFailed` EN + DE (real umlauts).

## Data flow

```
File → classifyAttachment(mime, name) → "office"
     → readAttachmentData(file, "office")
         → file.arrayBuffer()
         → extractOfficeMarkdown(bytes, fmt)   // unzip → per-format → markdown
     → buildAttachmentBlock("office", mime, markdown)
         → { type:"document", source:{ type:"text", media_type:"text/plain", data: markdown } }
```

No new AI tool. No new persisted Workspace field. No new CSP host (extraction is fully local). No new npm dependency.

## Error handling

- Corrupt / non-OOXML / missing internal part → `extractOfficeMarkdown` rejects → chat/importer shows `attachmentExtractFailed` toast, that file is skipped (binary Office cannot fall back to the raw API). Send loop for other attachments continues; never crashes.
- Empty document → valid empty-ish Markdown (a single note line), not an error.
- Over char cap → truncate + append a truncation note line.

## Testing

- `unzip.test.ts`: fixtures built via existing `zip.ts buildZip` (stored entries) + one real deflate entry (base64 constant in-test) to exercise the `DecompressionStream` path. Assert entry map contents.
- `docx-extract.test.ts` / `xlsx-extract.test.ts` / `pptx-extract.test.ts`: synthesize the minimal internal XML parts, zip via `buildZip`, run the extractor, assert Markdown (headings, table rows, sheet names, slide sections, `&amp;` unescape, `xml:space="preserve"`).
- `office-extract.test.ts`: `officeKindOf` mapping (incl. xlsm→xlsx), char-cap truncation, reject on bad bytes.
- `chat-attachments.test.ts` (extend): office classify + `buildAttachmentBlock` office block shape.
- All node env — `DecompressionStream` is a Node 18+ global; no jsdom.

## Out of scope (YAGNI)

- Legacy `.doc/.xls/.ppt` (OLE compound, not zip), `.xlsb` (binary sheets).
- Embedded images/charts/drawings, cell styling/colors/formulas (values only), merged-cell geometry.
- ZIP64 (only needed >4GB; impossible under the 20 MB attachment cap).

## Release

Standard: bump `version.ts` (APP_VERSION + milestone) + CHANGELOG + `versionHighlight*` key (EN/DE) on the release trigger. Milestone codename: next unused (`Bishop` is confirmed available).
