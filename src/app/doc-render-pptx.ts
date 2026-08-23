// src/app/doc-render-pptx.ts — blocks → PresentationML (.pptx).
//
// SEGMENTATION (which blocks share a slide): a new slide starts at every
// pageBreak and at every level-1 heading, which becomes that slide's title.
// Level 2/3 headings stay in the body — splitting on every heading would
// shred a document into one-line slides. A segment left with neither a title
// nor a body is dropped rather than emitted as a blank slide.
//
// PAGINATION (what happens when one slide's content does not fit): body lines
// beyond a derived per-slide budget CONTINUE on further slides, each carrying
// the same title plus a numeric `(2/3)` marker. Content is never clipped and
// never silently dropped. The budget and its honest limits are documented at
// BODY_LINES_PER_SLIDE — in `doc-render-pptx-slides.ts`, with `paginateLines`
// and `lineCost`; the short version is that PowerPoint does not shrink this
// text to fit, so unbounded content runs off the slide invisibly.
//
// ★ Both rules are stated here on purpose. They are decisions, not properties
// of the format, and each is pinned by its own tests — segmentation through
// `segmentIntoSlides`, pagination through `paginateLines` and the slide-count
// assertions.
//
// ★★ A slide is TEXT PLUS PICTURES — and it was TEXT ONLY until S3c-2, so an
// older comment or test that says otherwise is describing the previous shape.
// An `<img data-asset-id>` whose bytes the caller INLINED becomes an
// `ImageLine` and then a `<p:pic>` shape placed below the body text box; every
// other image still degrades to the translated placeholder RUN. Nothing else
// escapes to a shape: PowerPoint's real table (`a:tbl`) is a graphicFrame with
// its own grid model, and the primitives module deliberately carries no helper
// for one, so tables and data sections are still laid out as aligned text
// lines. That is a recorded S1 limitation, not an oversight — a wrong `a:tbl`
// is a package PowerPoint refuses to open, which is strictly worse than plain
// lines it renders.
//
// ★★★ NOTHING HERE ESCAPES ITS OWN XML, and that is deliberate: `pptxTextBox`
// runs `xmlEscape` over every line AND every run it emits. Escaping here as
// well would DOUBLE-escape, so a user's "&" would read as a literal "&amp;" on
// the slide. The corollary is that every string reaching a slide MUST go
// through a PRIMITIVE — `pptxTextBox` for a line, `pptxPicture` for a picture's
// `name`/`descr` — because concatenating text into shape XML by hand produces a
// package PowerPoint rejects outright, and it fails silently until someone
// opens it. That is why the styled-run support added for paragraph marks went
// into the PRIMITIVE as a semantic `PptxRun` rather than as run XML built here.
//
// ★★ paragraph.html is PARSED, not projected to flat text. `htmlToRichLines`
// (shared with the DOCX renderer precisely so the two cannot drift) yields one
// RichLine per block boundary carrying styled runs, and each becomes one
// `<a:p>` — so bold/italic/underline/strike/code/highlight/sub/sup survive
// instead of being flattened away. TABLE cells still take the flat projection;
// that is the recorded `a:tbl` limitation above, not this gap.
// ★★ DOM-BOUND as a result: `htmlToRichLines` parses with DOMParser, so this
// module must never be reached from a node script.

import type { DocBlock, ProjectDocument } from "./document-model";
import {
  type PptxSlide,
  buildPptxPackage,
  pptxBackgroundRect,
  pptxTitleSubtitleShapes,
  wrapPptxSlide,
} from "./ooxml-pptx-primitives";
import { COLOR_DARK_BLUE, PPTX_MAX_ROWS_PER_SECTION } from "./export-ooxml-shared";
import { bulletMarker, htmlToRichLines } from "./rich-text-runs";
// ★★ The LINE -> SLIDE XML half. This file turns BLOCKS into `SlideLine`s; that
// one turns a list of them into a slide part and owns every decision that needs
// slide GEOMETRY (the budget, the image cost model, placement, media minting).
// The seam is `SlideLine`, and the arrow is one-way.
import {
  BODY_LINES_PER_SLIDE,
  buildContentSlide,
  createDeckMedia,
  isBlankLine,
  paginateLines,
  pptxEmbedFor,
  slideTitleFor,
  type RenderCtx,
  type SlideLine,
} from "./doc-render-pptx-slides";
import { descriptionHtml } from "./rich-text-plain";
import { RENDER_SINK } from "./html-start";
import { htmlEscape } from "./download";
// ★★ `resolveDataSection` comes from the NEUTRAL doc-data-section module, NOT
// from a sibling renderer. Importing it from doc-render-docx would typecheck
// and work, and would also drag the DOCX OOXML builders into this graph and
// point the dependency arrow renderer → renderer. That module's own comment
// forbids it; the plan's `from "./doc-render-html"` is wrong for the same
// reason (and that module never exported it — it kept a private copy).
import { resolveDataSection } from "./doc-data-section";
import {
  IMG_TAG_RE,
  NO_EXPORT_ASSETS,
  type ExportAssets,
} from "./document-export-assets";
import type { DocumentAsset } from "./document-asset";
import { safeBase64ToBytes } from "./document-asset-upload";
import type { ExportCell } from "./export-sections";
import { cellText } from "./export-sections";
import type { Workspace } from "./workspace";
import { t, type Lang } from "./i18n";

export type DocSlide = { title: string; body: DocBlock[] };

// ★ Re-exported so this module stays the ONE public face of the pptx document
//   renderer: `document-download.ts` imports `canEmbedPptxAsset` from HERE, not
//   from the slides module, so the two-file split stays an internal seam.
//   ★★ `lineCost` and `paginateLines` have NO non-test consumer anywhere — this
//   file reaches `paginateLines` by the direct import above, not through this
//   line — so the re-export serves `doc-render-pptx.test.ts` alone. Deleting it
//   breaks only that suite.
//   ★★ NONE of it rides a budget. An earlier revision of this comment said “the
//   export-assets budget” addressed it, which was wrong twice over:
//   `document-export-assets.ts` never imports this predicate (it takes an opaque
//   `isRenderable` callback and cannot name its source), and `assetPolicy` hands
//   docx/pptx `budgetBytes: Number.POSITIVE_INFINITY` — the OOXML path is
//   deliberately unbudgeted, so there is no budget here to address anything.
export { canEmbedPptxAsset, lineCost, paginateLines } from "./doc-render-pptx-slides";
export type { ImageLine, SlideLine } from "./doc-render-pptx-slides";

/** Column separator for the text-laid-out tables. Wide enough to read as a
 *  column break in a proportional font, where a single "|" does not. */
const CELL_SEP = "  |  ";

/**
 * Pure: split a block list into slides. Exported for direct unit testing — the
 * segmentation rule is the part most likely to regress, and driving it only
 * through the rendered package would test it three layers away.
 *
 * ★ A segment left with NEITHER a title NOR a body is dropped. A pageBreak
 * immediately followed by a level-1 heading otherwise produces a wholly blank
 * slide in the middle of the deck, and nothing downstream removes it. A titled
 * slide with an empty body is kept — that is a section divider, which is
 * legitimate output.
 */
export function segmentIntoSlides(blocks: readonly DocBlock[]): DocSlide[] {
  const slides: DocSlide[] = [];

  for (const block of blocks) {
    if (block.type === "heading" && block.level === 1) {
      slides.push({ title: block.text, body: [] });
      continue;
    }
    if (block.type === "pageBreak") {
      slides.push({ title: "", body: [] });
      continue;
    }
    const current = slides[slides.length - 1];
    // Blocks before any heading or break open an implicit untitled slide.
    if (current === undefined) slides.push({ title: "", body: [block] });
    else current.body.push(block);
  }

  return slides.filter((s) => s.title !== "" || s.body.length > 0);
}

/**
 * Flatten one table cell onto a single line.
 *
 * ★★★ REQUIRED, and the reason is the degrade-to-text decision above. Cells
 * are NOT newline-free: `export-sections` routes every rich column through
 * `descriptionTextWithBreaks` (`richCell`), so a two-paragraph RAID
 * description arrives here as a cell containing "\n". `pptxTextBox` splits its
 * text on "\n" to emit one `<a:p>` per line — so an unflattened cell breaks
 * its row in half and the trailing columns start a new line with no headers
 * above them, silently destroying the column alignment that is the ONLY thing
 * making a text-laid-out table readable.
 *
 * ★★ Collapsing to a space is normally the WRONG projection for an export a
 * human reads — that is why `descriptionTextWithBreaks` exists at all. It is
 * right HERE and only here, because the boundary cannot survive in a row that
 * must stay one line; there is no cell to put a second line inside until a
 * real DrawingML `<a:tbl>` primitive exists (the follow-up slice). Paragraph
 * blocks are unaffected and still keep every boundary.
 */
function flattenCell(cell: ExportCell): string {
  // ★ A rich cell is read through its flat text projection FIRST — this
  // renderer lays out a row as one line of text and has no cell to put a
  // second paragraph inside. Without it `String(cell)` yields "[object
  // Object]" for every rich column a dataSection carries.
  return String(cellText(cell)).replace(/\s*[\r\n]+\s*/g, " ");
}

/** ONE table layout for both the `table` block and a resolved dataSection —
 *  kept shared rather than written twice, which is both the shape the BLOCKING
 *  jscpd gate flags and how the two drift apart on a later fix. */
function tableLines(
  columns: readonly string[],
  rows: readonly (readonly ExportCell[])[],
  caption?: string,
): string[] {
  const lines: string[] = [];
  if (caption) lines.push(flattenCell(caption));
  lines.push(columns.map(flattenCell).join(CELL_SEP));
  for (const row of rows) lines.push(row.map(flattenCell).join(CELL_SEP));
  return lines;
}

// ★★★ Same reason doc-render-docx.ts carries the identical pair: media parts
// land in a later slice (S3c-2), and `htmlToRichLines` — SHARED with that
// renderer precisely so the two cannot drift — has no `<img>` handling, so an
// `<img data-asset-id>` left in `block.html` would reach the DOMParser walk as
// an unrecognised void element and vanish SILENTLY. Substituted on the RAW
// html, before descriptionHtml's upgrade and before the parse, so the
// placeholder is ordinary text by the time either runs.

/** `assetNames` resolves an id to the asset's display name (`ws.documentAssets`);
 *  a dangling id (row deleted, byte store empty) falls back to the id itself
 *  rather than a blank name. */
function withImagePlaceholders(
  html: string, byId: ReadonlyMap<string, DocumentAsset>, lang: Lang,
): string {
  return html.replace(IMG_TAG_RE, (_tag, id: string) =>
    htmlEscape(t(lang, "assetExportPlaceholder", byId.get(id)?.name ?? id)));
}

/** Wrap a split fragment so the rich pipeline still treats it as MARKUP.
 *
 *  ★★★ SPLITTING HTML BREAKS THE `isHtmlStart` PRECONDITION, and the symptom
 *  is literal markup on the slide. `RENDER_SINK`'s classifier requires a `<`
 *  followed by a LETTER, which a CLOSING tag deliberately is not — so the tail
 *  of `<p>a<img>b</p>` would be classified as legacy PLAIN TEXT, escaped, and
 *  read as `b</p>` in PowerPoint. A `<div>` reconciles a fragment unbalanced in
 *  EITHER direction and `htmlToRichLines` emits no line for the wrapper itself.
 *
 *  ★ Only the SPLIT path wraps — an image-free paragraph is handed to the rich
 *  pipeline whole, so its emitted bytes are unchanged.
 *
 *  ★★★ THERE IS DELIBERATELY NO "does this fragment have visible text?" GATE
 *  HERE, and `doc-render-docx.ts` DOES have one — the asymmetry is real, not an
 *  omission. Splitting `<p><img></p>` leaves `<p>` and `</p>`, non-blank as
 *  STRINGS and empty as PROSE, which is the block editor's own dominant shape;
 *  that renderer needs a gate because nothing downstream of it strips a blank
 *  paragraph, while HERE `slideLines` already drops every blank line a block
 *  emits. Measured, not reasoned: neutralising a visible-text gate to `true`
 *  left all 100 tests green, including the one asserting an image-only
 *  paragraph adds no body line at all.
 *
 *  ★★★ AND A GATE HERE WAS ACTIVELY WRONG TWICE, both caught by test:
 *  (1) it DROPPED A HORIZONTAL RULE. `isBlankLine`'s `hr` arm says a rule is
 *  content though it carries no text, so "has visible text" and "emits a line"
 *  disagree on exactly that fragment — and the markup test loses.
 *  (2) asked on the RAW fragment, i.e. BEFORE `withImagePlaceholders`, it
 *  DROPPED THE DISCLOSURE for a DECLINED image sharing a paragraph with an
 *  embedded one: `<img data-asset-id="a2"></p>` strips to "", so the reader's
 *  only sign the second image existed was deleted — the S3c-1 defect again.
 *  Asking about the LINES instead of about the markup is immune to both. */
function asMarkup(fragment: string): string {
  return `<div>${fragment}</div>`;
}

/**
 * One paragraph block's lines, SPLIT around every image that will really embed.
 *
 * Every other `<img>` — omitted by the budget, missing bytes, a dangling id, no
 * stored dimensions, a mime outside the allow-list — is left exactly where it
 * is, so `withImagePlaceholders` substitutes the S3c-1 disclosure for it as
 * before.
 *
 * ★★ An image becomes its OWN line rather than staying inline, because a
 * `<p:pic>` is a sibling SHAPE of the body text box, not a run inside it —
 * there is no inline picture in DrawingML text. That is the same forced split
 * `doc-render-docx.ts` makes for `<w:drawing>`, for a different reason.
 */
function paragraphLines(html: string, ctx: RenderCtx): SlideLine[] {
  const richLines = (fragment: string): SlideLine[] => [
    ...htmlToRichLines(
      descriptionHtml(withImagePlaceholders(fragment, ctx.byId, ctx.lang), RENDER_SINK),
    ),
  ];

  const out: SlideLine[] = [];
  let cut = 0;
  // ★ `matchAll` CLONES the shared `lastIndex` of the /g regex; a bare
  //   `.exec()` loop here would carry position between unrelated callers.
  for (const match of html.matchAll(IMG_TAG_RE)) {
    const id = match[1];
    const b64 = ctx.assets.inlined[id];
    const embed = b64 ? pptxEmbedFor(ctx.byId.get(id)) : null;
    if (!embed) continue;
    // ★★★ THE DECODE BELONGS TO THE DECISION, NOT ONLY TO THE MINTING, and
    //   this is the structural difference from `doc-render-docx.ts`. There,
    //   `drawingFor` IS both — a decline leaves the `<img>` in the segment and
    //   the placeholder pass substitutes it. Here the two are separated by
    //   pagination (part paths are deck-wide, relationship ids per slide, so
    //   nothing can be minted until slides are known), and this side is the one
    //   holding the disclosure: pushing an `ImageLine` STRIPS the tag, so
    //   `withImagePlaceholders` never sees it again. A row `mint` would later
    //   refuse therefore produced a BLANK slide — no picture, no body text, no
    //   placeholder — where docx produced the disclosure from the same fixture.
    //   Measured, not reasoned; pinned by "discloses an image whose stored
    //   base64 has …" in `doc-render-pptx.test.ts`.
    // ★★ SO THE TWO SITES' CHECKS MUST STAY IDENTICAL: `createDeckMedia`'s
    //   `mint` asks the same three questions in the same order, and its own
    //   docstring says why it may not add a fourth. `continue` here is the
    //   `!embed` arm's behaviour exactly — leave the tag where it is.
    // ★ Same function, so "decodable" cannot mean two things; the bytes are
    //   deliberately discarded rather than threaded (see `mint`'s docstring).
    if (!safeBase64ToBytes(b64)) continue;
    const at = match.index ?? 0;
    // ★ Emitted UNCONDITIONALLY — `slideLines` strips the blank a structural
    //   fragment yields, and asking about the markup instead loses an `hr` and
    //   a declined image's placeholder (see `asMarkup`).
    out.push(...richLines(asMarkup(html.slice(cut, at))));
    out.push({ kind: "image", id, cxEmu: embed.extent.cxEmu, cyEmu: embed.extent.cyEmu });
    cut = at + match[0].length;
  }
  if (out.length === 0) return richLines(html);
  out.push(...richLines(asMarkup(html.slice(cut))));
  return out;
}

/** The lines ONE block contributes. Blank lines inside a block's own output
 *  are artifacts — an empty table row, an editor's empty `<p>` — and the
 *  caller strips them; the deliberate gap BETWEEN blocks is added by the
 *  caller too. ★ A horizontal rule is NOT such an artifact even though it
 *  carries no text: see `isBlankLine`. */
function blockLines(block: DocBlock, ctx: RenderCtx): SlideLine[] {
  const { ws, lang } = ctx;
  switch (block.type) {
    case "heading":
      return [block.text];

    case "paragraph":
      // One RichLine per block boundary, each carrying its own runs — the parse
      // already does the splitting the flat projection used to need — plus one
      // ImageLine per embeddable image. See `paragraphLines`.
      // ★★ Upgrade-aware first: a legacy plain-text value is not markup, and
      // parsing it raw fuses its lines (§118). The sink is "render" — the one
      // that recognises every tag — because htmlToRichLines keeps the text of
      // any tag at all, so an allow-list-derived classifier would escape the
      // whole value instead. Same composition as doc-render-docx's richParas;
      // the reasoning lives on html-start.ts's "render" member.
      return paragraphLines(block.html, ctx);

    case "bullets":
      return block.items.map((item, i) => `${bulletMarker(block.ordered, i)} ${item}`);

    case "table":
      return tableLines(block.columns, block.rows, block.caption);

    case "dataSection": {
      const section = resolveDataSection(block.key, ws, lang);
      // An empty register renders as nothing, not as a bare heading with no
      // rows under it — a fresh project would otherwise grow one per deck.
      if (!section) return [];
      const total = section.rows.length;
      const truncated = total > PPTX_MAX_ROWS_PER_SECTION;
      const rows = truncated ? section.rows.slice(0, PPTX_MAX_ROWS_PER_SECTION) : section.rows;
      const lines = tableLines(section.columns, rows, section.title);
      if (truncated) {
        // ★ Cap and wording mirror export-pptx.ts, which faces the same
        // problem. This notice bounds the PACKAGE; pagination below bounds
        // what fits on a slide — two different jobs, both needed.
        // ★★ It is a MIXED-LANGUAGE sentence in a non-English deck: the frame
        // is hardcoded English like its sibling's, but `section.title` is
        // already LOCALIZED by the registry, so a German deck reads
        // "Showing the first 100 of 125 RAID rows." with a German title
        // spliced in. Wanted: an i18n key. Not done here because that means
        // opening i18n.de.ts, and silently dropping rows is worse than an
        // awkward sentence.
        lines.push(
          `Showing the first ${PPTX_MAX_ROWS_PER_SECTION} of ${total} ${section.title} rows.`,
        );
      }
      return lines;
    }

    case "pageBreak":
      // Consumed by segmentation; unreachable in practice, and if one ever
      // did land here it must contribute nothing rather than a blank line.
      return [];
  }
}

/** Body blocks → the plain lines a slide shows, with one blank line between
 *  blocks.
 *
 *  ★★ That blank line is the point. A blanket trailing
 *  `filter(l => l.trim() !== "")` used to strip EVERY empty line, so two
 *  consecutive paragraphs abutted with no visual gap and read as one. The
 *  distinction that makes stripping safe here: a blank INSIDE one block's
 *  output is an artifact, a blank BETWEEN two blocks is typography. */
function slideLines(slide: DocSlide, ctx: RenderCtx): SlideLine[] {
  const blocks = slide.body
    .map((block) => blockLines(block, ctx).filter((line) => !isBlankLine(line)))
    .filter((lines) => lines.length > 0);
  return blocks.flatMap((lines, i) => (i === 0 ? lines : ["", ...lines]));
}

/** Render a document as a .pptx package. The title slide always comes first,
 *  matching `buildPptx`, so a deck is never zero slides even when the document
 *  has no blocks. */
export function renderDocumentPptx(
  doc: ProjectDocument,
  ws: Workspace,
  lang: Lang,
  assets: ExportAssets = NO_EXPORT_ASSETS,
): Blob {
  const ctx: RenderCtx = {
    ws,
    lang,
    byId: new Map((ws.documentAssets ?? []).map((a) => [a.id, a])),
    assets,
  };
  const slideMedia = createDeckMedia(ctx);
  // ★ The title slide carries no image, so an image-free document still
  //   produces the byte-identical package `buildPptxPackage` promises.
  const deck: PptxSlide[] = [
    {
      xml: wrapPptxSlide(
        pptxBackgroundRect(COLOR_DARK_BLUE) + pptxTitleSubtitleShapes(doc.title, "", lang),
      ),
      media: [],
    },
  ];

  for (const slide of segmentIntoSlides(doc.blocks)) {
    const lines = slideLines(slide, ctx);
    // A slide whose only block resolved to nothing (an empty dataSection) has
    // no title and no lines left — the same blank-slide defect segmentation
    // drops, caught one stage later because resolution needs the workspace.
    if (!slide.title && lines.length === 0) continue;
    const chunks = paginateLines(lines, BODY_LINES_PER_SLIDE);
    for (const [i, chunk] of chunks.entries()) {
      // ★★ ONE minter PER SLIDE, sharing the deck-wide part counter it closes
      //    over. Hoisting this out of the loop would number every relationship
      //    id deck-wide; minting a fresh deck counter inside it would number
      //    every part per slide. Both compile.
      const media = slideMedia();
      const xml = buildContentSlide(
        slideTitleFor(slide.title, i, chunks.length),
        chunk,
        ctx,
        media.mint,
      );
      deck.push({ xml, media: media.parts });
    }
  }

  return buildPptxPackage(deck);
}
