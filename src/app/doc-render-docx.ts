// src/app/doc-render-docx.ts — project document blocks → WordprocessingML.
//
// ★★ DOM-BOUND: htmlToRichLines lives in rich-text-runs.ts, which parses with
// DOMParser. Never call this from a node script (the sample generator must not
// touch it).
// ★★ THIS COMMENT USED TO SAY "unlike the section-based OOXML builders". That
// stopped being true in §141(b): the rich-cell path put the same parse behind
// ooxml-docx-primitives.ts, so `buildDocx` reaches DOMParser too. The parse is
// still inside a function rather than at module eval, so IMPORTING either file
// remains harmless — what is DOM-bound is CALLING the rich path.
//
// ★★ paragraph.html is PARSED, not projected to flat text. `htmlToRichLines`
// yields one RichLine per block boundary, each carrying styled runs, and ONE
// <w:p> is emitted per line — so the block boundary is a real paragraph where it
// used to be a <w:br/> inside a single run, heading level / list numbering /
// alignment survive, and bold/italic/underline/strike/code/highlight/sub/sup
// survive instead of being flattened away.
//
// ★★ THAT RENDERING NO LONGER LIVES HERE. `docxRichParagraphs` and the styles it
// names moved to ooxml-docx-primitives.ts in §141(b), because the SAME builder
// now renders a rich ENTITY field inside a table cell — where the workspace
// exporter, not this file, is the caller. The parse is still shared with the
// PPTX renderer precisely so the two cannot drift.

import type { DocBlock, ProjectDocument } from "./document-model";
import {
  type DocxPageLayout,
  DOC_STYLES,
  buildDocxPackage,
  buildDocxTable,
  docxCellRuns,
  docxContentWidth,
  docxInlineDrawing,
  docxRichParagraphs,
} from "./ooxml-docx-primitives";
import { bulletMarker } from "./rich-text-runs";
import { resolveDataSection } from "./doc-data-section";
import {
  IMG_TAG_RE,
  NO_EXPORT_ASSETS,
  type ExportAssets,
} from "./document-export-assets";
import {
  EMU_PER_INCH,
  emuFromTwips,
  fitExtent,
  mediaExtension,
  type Extent,
  type MediaExtension,
  type MediaPart,
} from "./ooxml-media";
import { ASSET_MIME_ALLOWED, base64ToBytes } from "./document-asset-upload";
import type { DocumentAsset } from "./document-asset";
import { htmlEscape } from "./download";
import type { Workspace } from "./workspace";
import { t, type Lang } from "./i18n";

/** ★★ A project document is PROSE, so it is PORTRAIT — `doc-render-html.ts`
 *  overrides `@page` to portrait for these same documents and explains why
 *  (prose at full A4 landscape measure reads badly). Without this the SAME
 *  document arrived portrait as HTML/PDF and landscape as .docx.
 *
 *  ★★ ONE constant drives BOTH the page and the tables on purpose. The sectPr
 *  and the table width are the SAME decision — a table measured for the
 *  landscape text column overflows the narrower portrait page, silently, since
 *  it still renders. `docxContentWidth` derives the width from the very
 *  geometry that built the sectPr, so passing `PAGE` to both is enough to keep
 *  them in step; there is no second number to update. */
const PAGE: DocxPageLayout = "portrait";

/** Every table in the document is laid out to the page the document declares. */
const CONTENT_WIDTH = docxContentWidth(PAGE);

/** The same measure in EMU, for the drawing geometry.
 *
 *  ★★★ PAGE GEOMETRY IS TWIPS AND DRAWING GEOMETRY IS EMU, and here the two
 *  declarations sit one line apart. The factor is 635 (`EMU_PER_TWIP`), so
 *  handing `CONTENT_WIDTH` straight to `fitExtent` as a `maxWidthEmu` clamps
 *  every image to 10092 EMU — about a hundredth of an inch. That is valid XML,
 *  a green suite, and an invisible sliver in Word; no gate in this repo can see
 *  a unit error. `emuFromTwips` exists so the conversion is SPELLED rather than
 *  assumed: 10092 twips = 6_408_420 EMU (7.008in of usable measure on A4
 *  portrait, less its 907-twip side margins).
 *
 *  ★ `fitExtent` rejects a non-integer bound outright, and `emuFromTwips`
 *  rounds — so this is an integer by construction. */
const CONTENT_WIDTH_EMU = emuFromTwips(CONTENT_WIDTH);

/** The tallest an embedded image may be drawn.
 *
 *  ★★ A JUDGEMENT CALL, stated as one. This layout's page is 16838 twips tall
 *  (11.69in) less 1020 twips of margin top and bottom, so the content box is
 *  about 10.27in — 4.5in is roughly 44% of it. It is chosen so a portrait photo
 *  cannot push everything following it off the page, NOT derived from anything.
 *  Move it on evidence; it is one constant precisely so that is cheap.
 *
 *  ★ Must stay an INTEGER — `fitExtent` declines a fractional bound. */
const MAX_IMAGE_HEIGHT_EMU = Math.round(4.5 * EMU_PER_INCH);

/** One paragraph. `docxCellRuns` already maps "\n" to <w:br/> and escapes each
 *  line, so text and table cells cannot diverge on either rule. */
function para(text: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}<w:r>${docxCellRuns(text)}</w:r></w:p>`;
}

// ★★ THE PLACEHOLDER IS THE FALLBACK NOW, NOT THE ONLY PATH. S3c-2 gave this
// file real media parts, so an asset the caller INLINED becomes a `<w:drawing>`
// in its own paragraph (`paragraphBlock`). Every other reason still falls
// through to this substitution: omitted by the export budget, no byte row, no
// metadata row, a mime outside the upload allow-list, or no stored dimensions.
//
// ★★★ WHY IT SUBSTITUTES ON THE RAW HTML, BEFORE THE PARSE — and why a drawing
// CANNOT. `docxRichParagraphs` -> `htmlToRichLines` (rich-text-runs.ts) has no
// `<img>` handling at all, so an `<img data-asset-id>` left in `block.html`
// reaches the DOMParser walk as an unrecognised void element and vanishes
// SILENTLY, with nothing in the exported file to say an image was ever there.
// TEXT can go in before that parse and inherits whatever paragraph or list-item
// context surrounds it. A `<w:drawing>` blob cannot: it is XML, and an HTML
// parse mangles it. That is what FORCES the paragraph split below.

/** Resolves an id to the asset's display name; a dangling id (row deleted, byte
 *  store empty) falls back to the id itself rather than a blank name.
 *
 *  ★ ONE map, not a parallel name map beside the metadata one — two maps built
 *  from the same list and threaded down the same call chain is the shape that
 *  drifts. */
function withImagePlaceholders(
  html: string, byId: ReadonlyMap<string, DocumentAsset>, lang: Lang,
): string {
  return html.replace(IMG_TAG_RE, (_tag, id: string) =>
    htmlEscape(t(lang, "assetExportPlaceholder", byId.get(id)?.name ?? id)));
}

/** The extension and geometry one asset embeds as, or null if it cannot embed
 *  at all.
 *
 *  ★★ Deriving BOTH here is what keeps `canEmbedDocxAsset` and the drawing from
 *  disagreeing: each condition is written once, and the drawing reuses what the
 *  decision already computed instead of re-deriving it. Re-deriving would also
 *  make each copy of a guard unobservable — a mutant in either one is masked by
 *  the other, so the suite reports coverage it does not have. */
function docxEmbedFor(
  meta: DocumentAsset | undefined,
): { ext: MediaExtension; extent: Extent } | null {
  if (!meta) return null;
  if (!(ASSET_MIME_ALLOWED as readonly string[]).includes(meta.mime)) return null;
  const ext = mediaExtension(meta.mime);
  if (!ext) return null;
  const extent = fitExtent(meta, CONTENT_WIDTH_EMU, MAX_IMAGE_HEIGHT_EMU);
  if (!extent) return null;
  return { ext, extent };
}

/** Whether an asset can become a docx drawing at all — the metadata-only half
 *  of the decision, with no reference to whether its bytes were loaded.
 *
 *  ★★★ EXPORTED because `loadExportAssets` takes this as its `isRenderable`
 *  predicate and asks it BEFORE charging the byte budget. If the call site
 *  re-implements these conditions instead of calling this, the two drift and
 *  the symptom is silent: bytes are spent on an asset that is then declined,
 *  and a later, perfectly good image is pushed into `omitted` instead. One
 *  function, two callers. */
export function canEmbedDocxAsset(meta: DocumentAsset | undefined): boolean {
  return docxEmbedFor(meta) !== null;
}

/** Mints one media part per inlined image, numbering parts and relationship ids
 *  in document order.
 *
 *  ★★ Relationship ids start at rId2 — rId1 is the styles part, and
 *  `buildDocxPackage` throws if a media part claims it.
 *
 *  ★ Deliberately per OCCURRENCE, not per asset: one image referenced twice in
 *  a document mints two parts holding the same bytes. Correct output, slightly
 *  larger file; de-duplicating would need a second counter, because a drawing's
 *  `docPr` id must stay unique even where the relationship is shared. */
function createMediaMinter(assets: ExportAssets, byId: ReadonlyMap<string, DocumentAsset>) {
  const parts: MediaPart[] = [];

  /** The drawing run for `id`, or null to fall through to the placeholder. */
  function drawingFor(id: string): string | null {
    const b64 = assets.inlined[id];
    if (!b64) return null;
    const meta = byId.get(id);
    const embed = docxEmbedFor(meta);
    if (!meta || !embed) return null;

    const index = parts.length + 1;
    // ★ The part name derives from the INDEX, never from the asset's
    //   user-supplied name — a name must never become a zip path.
    const name = `image${index}.${embed.ext}`;
    const relId = `rId${index + 1}`;
    parts.push({
      path: `word/media/${name}`,
      data: base64ToBytes(b64),
      extension: embed.ext,
      relId,
    });
    return `<w:r>${docxInlineDrawing({
      relId,
      id: index,
      name,
      descr: meta.name,
      extent: embed.extent,
    })}</w:r>`;
  }

  return { drawingFor, parts };
}

/** Whether an HTML fragment carries anything a reader would see.
 *
 *  ★★★ A BARE `.trim()` IS NOT THIS TEST, and using one brackets every
 *  image-only paragraph with blank paragraphs. Splitting `<p><img></p>` around
 *  the tag leaves the fragments `<p>` and `</p>` — non-blank as STRINGS, empty
 *  as PROSE. An image-only paragraph is precisely what the block editor
 *  inserts, so that is the DOMINANT shape here, not an edge case.
 *
 *  ★★ Asked AFTER `withImagePlaceholders` has run, never before. A segment can
 *  still hold an `<img>` this renderer DECLINED to embed, and its placeholder
 *  text is the reader's only disclosure that an image was ever there — strip
 *  the tag before substituting and the segment reads as empty, gets dropped,
 *  and that is the S3c-1 defect all over again.
 *
 *  ★ The tag strip is deliberately crude (it stops at the first `>`, even
 *  inside a quoted attribute). Over-keeping is the safe direction: the cost is
 *  an empty paragraph, where under-keeping loses text. */
function hasVisibleText(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").trim() !== "";
}

/** Wrap a fragment so the rich pipeline treats it as MARKUP.
 *
 *  ★★★ SPLITTING HTML BREAKS THE `isHtmlStart` PRECONDITION, and the symptom is
 *  literal markup in the exported document. `docxRichParagraphs` classifies its
 *  argument through `descriptionHtml(html, RENDER_SINK)`, and that sink's regex
 *  (`CONTAINS_TAG`, html-start.ts) requires a `<` followed by a LETTER — a
 *  CLOSING tag deliberately does not match it. So slicing `<p>a<img>b</p>`
 *  around the image leaves the tail `b</p>`, whose only `<` is that closing
 *  tag: the value is classified as legacy PLAIN TEXT, escaped, and the reader
 *  sees `b</p>` verbatim in Word. Measured, not reasoned — the assertion that
 *  caught it is "keeps the text either side of an inlined image", and the
 *  weaker `indexOf`-ordering form of that test could not see it.
 *
 *  ★★ A `<div>` is the right wrapper because a fragment can be unbalanced in
 *  EITHER direction — an unclosed `<p>` at the head, an orphan `</p>` at the
 *  tail — and the HTML parser reconciles both inside a wrapper. It is not a
 *  formatting choice: `htmlToRichLines` emits no line for the wrapper itself.
 *
 *  ★ Only the SPLIT path wraps. An image-free paragraph never reaches here (see
 *  `paragraphBlock`'s `out.length === 0` arm), so its bytes are untouched. */
function asMarkup(fragment: string): string {
  return `<div>${fragment}</div>`;
}

/** One paragraph block, SPLIT around every image that will actually embed.
 *
 *  ★★★ THE SPLIT IS FORCED, not stylistic — see the `<w:drawing>` note above.
 *
 *  ★★ Consequence, accepted: an image that sat inline with text gets its own
 *  paragraph. The block editor inserts images as image-only paragraphs, so the
 *  shape the product actually produces is unaffected. */
function paragraphBlock(
  html: string,
  byId: ReadonlyMap<string, DocumentAsset>,
  lang: Lang,
  drawingFor: (id: string) => string | null,
): string {
  const out: string[] = [];
  const pushSegment = (fragment: string): void => {
    const substituted = withImagePlaceholders(fragment, byId, lang);
    if (hasVisibleText(substituted)) out.push(docxRichParagraphs(asMarkup(substituted)));
  };

  let last = 0;
  for (const match of html.matchAll(IMG_TAG_RE)) {
    const drawing = drawingFor(match[1]);
    // Not embeddable: leave the tag in the segment so the placeholder pass
    // substitutes it exactly as it did before this slice.
    if (!drawing) continue;
    pushSegment(html.slice(last, match.index));
    out.push(`<w:p>${drawing}</w:p>`);
    last = match.index + match[0].length;
  }

  // ★★ THIS ARM IS THE WHOLE COMPATIBILITY STORY. A paragraph with no embedded
  // image goes through UNTOUCHED — one call, on the original string — so it is
  // byte-identical to what this file produced before the split existed, and
  // `hasVisibleText` cannot reach it to drop a deliberately blank paragraph.
  if (out.length === 0) return docxRichParagraphs(withImagePlaceholders(html, byId, lang));
  pushSegment(html.slice(last));
  return out.join("");
}

function renderBlock(
  block: DocBlock,
  ws: Workspace,
  lang: Lang,
  byId: ReadonlyMap<string, DocumentAsset>,
  drawingFor: (id: string) => string | null,
): string {
  switch (block.type) {
    case "heading":
      return para(block.text, `Heading${block.level}`);
    case "paragraph":
      return paragraphBlock(block.html, byId, lang, drawingFor);
    case "bullets":
      return block.items
        .map((item, i) => para(`${bulletMarker(block.ordered, i)} ${item}`, "ListParagraph"))
        .join("");
    case "table":
      return (
        (block.caption ? para(block.caption, "Caption") : "") +
        buildDocxTable(block.columns, block.rows, CONTENT_WIDTH)
      );
    case "dataSection": {
      const section = resolveDataSection(block.key, ws, lang);
      if (!section) return "";
      return (
        para(section.title, "Heading2") +
        buildDocxTable(section.columns, section.rows, CONTENT_WIDTH)
      );
    }
    case "pageBreak":
      return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  }
}

/** Render a project document as a `.docx` Blob. */
export function renderDocumentDocx(
  doc: ProjectDocument,
  ws: Workspace,
  lang: Lang,
  /** ★ Defaulted so every existing three-argument caller keeps rendering
   *  placeholders rather than breaking — an export that has not resolved bytes
   *  (no Turso config, Safe Mode) passes nothing. */
  assets: ExportAssets = NO_EXPORT_ASSETS,
): Blob {
  const byId = new Map((ws.documentAssets ?? []).map((a) => [a.id, a]));
  const { drawingFor, parts } = createMediaMinter(assets, byId);

  const body =
    para(doc.title, "Title") +
    doc.blocks.map((b) => renderBlock(b, ws, lang, byId, drawingFor)).join("");

  // ★ `parts` is populated BY the body render above — read it AFTER, never
  //   before. Building the package first ships an empty media list against a
  //   document.xml full of drawings whose relationships do not exist, which
  //   Word reports as a corrupt file.
  return buildDocxPackage(body, DOC_STYLES, PAGE, parts);
}
