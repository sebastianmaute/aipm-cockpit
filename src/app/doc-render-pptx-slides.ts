// src/app/doc-render-pptx-slides.ts — the LINE -> SLIDE XML half of the pptx
// document renderer.
//
// ★★ THE SEAM IS `SlideLine`. `doc-render-pptx.ts` turns BLOCKS into lines;
// this module turns a list of lines into one slide part, and owns everything
// that needs slide GEOMETRY to answer: the per-slide line budget, the cost
// model an image line is measured by, the run/paragraph builders, the media
// minting and the picture placement. Split out of that file when it crossed the
// 800-line ratchet; the dependency arrow is one-way (renderer -> this).
//
// ★★★ NOTHING HERE ESCAPES ITS OWN XML — `pptxTextBox` runs `xmlEscape` over
// every line and every run it emits, so escaping here would DOUBLE-escape and a
// user's "&" would read as "&amp;" on the slide. The corollary is that every
// string reaching a slide MUST go through a primitive; concatenating text into
// shape XML by hand produces a package PowerPoint rejects outright, and it
// fails silently until someone opens it.

import {
  type PptxParagraph,
  type PptxRun,
  pptxAccentBar,
  pptxBackgroundRect,
  pptxPicture,
  pptxTextBox,
  wrapPptxSlide,
} from "./ooxml-pptx-primitives";
import { COLOR_DARK_BLUE, COLOR_GREEN, COLOR_WHITE } from "./export-ooxml-shared";
import {
  type RichLine,
  type RichLineKind,
  type RunMark,
  type TextRun,
  bulletMarker,
} from "./rich-text-runs";
import {
  fitExtent,
  mediaExtension,
  type Extent,
  type MediaExtension,
  type MediaPart,
} from "./ooxml-media";
import type { LinkSink } from "./ooxml-links";
import { isAllowedAssetMime, safeBase64ToBytes } from "./document-asset-upload";
import type { DocumentAsset } from "./document-asset";
import type { ExportAssets } from "./document-export-assets";
import type { Workspace } from "./workspace";
import type { Lang } from "./i18n";

/**
 * One body line on its way to a slide.
 *
 * ★ A plain `string` for everything that has no styling to carry — headings,
 * bullets, table rows, the deliberate blank line between blocks — so those
 * paths are untouched and their emitted bytes unchanged. A `RichLine` only for
 * a rich `paragraph` block, where the marks have to survive as far as the shape
 * builder. Widening the type rather than replacing it is also what keeps
 * `paginateLines`' exported contract (and its tests) valid for plain strings.
 */
export type SlideLine = string | RichLine | ImageLine;

/**
 * An image on its way to a slide.
 *
 * ★★ The extent is already FITTED AND CAPPED to `BODY_BOX` by `paragraphLines`
 * (doc-render-pptx.ts), so `cyEmu` is at most one body box tall. That
 * bounds `lineCost` at 17 (`ceil(3474720 / 213360)`) — one line-height MORE
 * than `BODY_LINES_PER_SLIDE`, so a full-height picture always takes a slide
 * of its own. "Cost never exceeds the budget" is therefore NOT the invariant,
 * and a reader who assumes it is will write a guard that never fires.
 *
 * ★ It carries the extent rather than the `DocumentAsset` so pagination needs
 * no lookups, and so `lineCost` is a pure function of the line.
 */
export type ImageLine = { kind: "image"; id: string; cxEmu: number; cyEmu: number };

/** ★ `RichLineKind` has no "image" member, so the `kind` discriminant
 *  separates the two object arms with no extra tagging. */
function isImageLine(line: SlideLine): line is ImageLine {
  return typeof line === "object" && line.kind === "image";
}

/** The visible text of a line, for the length/blank decisions that do not care
 *  about styling. ★ An `hr` line has NO runs, so this is "" for one — see
 *  `isBlankLine`, which is where that matters. */
function slideLineText(line: SlideLine): string {
  // ★ An image shows no text. The guard is REQUIRED, not defensive: without it
  //   `line` narrows to `RichLine | ImageLine` and `.runs` does not typecheck.
  //   It is unreachable today — `isBlankLine`, this function's only caller,
  //   answers the image case before delegating.
  if (isImageLine(line)) return "";
  return typeof line === "string" ? line : line.runs.map((r) => r.text).join("");
}

/** Whether a line is the empty spacing line, as opposed to content.
 *
 *  ★★ THE `hr` ARM IS LOAD-BEARING. A horizontal rule is a RichLine with ZERO
 *  runs, so its text is "" and every blank filter over these lines would delete
 *  it — the rule would vanish from the deck with nothing to notice it by, and any
 *  test that only checks the surrounding text would still pass. A rule is
 *  content; it just happens to carry no text of its own until `HR_TEXT` draws
 *  one at emit time. */
export function isBlankLine(line: SlideLine): boolean {
  // ★★ An image is CONTENT with no text, exactly like an `hr` below it. Both
  //    blank filters would otherwise DELETE the picture with nothing in the deck
  //    to notice it by: `slideLines`' per-block strip (doc-render-pptx.ts) and
  //    `paginateLines`' leading-blank strip just below.
  if (isImageLine(line)) return false;
  if (typeof line !== "string" && line.kind === "hr") return false;
  return slideLineText(line).trim() === "";
}

// Slide geometry in EMUs (914400 per inch); slides are 9144000 × 5143500.
const TITLE_BOX = { xEmu: 457200, yEmu: 365760, cxEmu: 8229600, cyEmu: 685800 };
const BODY_BOX = { xEmu: 457200, yEmu: 1188720, cxEmu: 8229600, cyEmu: 3474720 };

// Sizes are HUNDREDTHS of a point (1800 = 18pt), matching `a:rPr sz`.
const TITLE_SIZE = 2800;
const BODY_SIZE = 1400;

const EMU_PER_POINT = 12700;
/** Typical PowerPoint single-line spacing as a multiple of the font size. */
const LINE_SPACING = 1.2;

/**
 * The height of ONE body line in EMU: 14pt × 1.2 spacing × 12700 = 213360.
 *
 * ★★ `Math.round` is a NO-OP for today's constants (the product is exactly
 * 213360, verified) and is kept because it guards the PICTURE PLACEMENT, not
 * the budget: `a:off y` is an `ST_Coordinate`, i.e. an integer, and a size or
 * spacing pair whose product was fractional would emit
 * `y="1401079.99999999997"` — valid-looking XML that PowerPoint refuses.
 */
const BODY_LINE_EMU = Math.round((BODY_SIZE / 100) * LINE_SPACING * EMU_PER_POINT);

/**
 * How many body lines fit on one slide, DERIVED from the box and the line
 * height so that changing either moves the budget with it:
 *
 *   BODY_BOX.cyEmu 3474720 / EMU_PER_POINT 12700 = 273.6pt of height
 *   BODY_SIZE 1400 hundredths = 14pt, × 1.2 spacing  = 16.8pt = 213360 EMU
 *   floor(3474720 / 213360)                       = 16 lines
 *
 * ★★★ WHY THIS IS NEEDED AT ALL: the body text does not shrink to fit.
 * `bodyPr` emits `wrap="square"` with NO `normAutofit`/`spAutoFit`, so
 * PowerPoint's no-autofit default lets text run straight past the shape
 * instead of scaling it. Overflow is therefore INVISIBLE in the XML and shows
 * up only when a human opens the deck — which is exactly the class of defect
 * no test in this repo can catch, so the renderer has to bound it.
 *
 * ★★ HONEST LIMIT: this counts LINES, not RENDERED lines. `wrap="square"`
 * means one long line wraps and consumes more than one line of height, and
 * nothing here can measure text — jsdom has no layout and the box is never
 * rendered. So the budget is sound for short lines and optimistic for long
 * ones. It converts UNBOUNDED overflow into BOUNDED overflow; it is not a
 * promise that every slide fits, and only opening a real deck can confirm
 * that. ★ An IMAGE line is measured, not counted — see `lineCost` — so the
 * optimism is confined to text.
 */
export const BODY_LINES_PER_SLIDE = Math.floor(BODY_BOX.cyEmu / BODY_LINE_EMU);

/**
 * What one line costs against a slide's budget.
 *
 * ★★★ AN IMAGE COSTS ITS HEIGHT, ROUNDED UP, and it is bounded because
 * `paragraphLines` caps every extent to `BODY_BOX` — see `ImageLine`, which
 * states the bound (17) and why it is one MORE than the budget. The walk in
 * `paginateLines` is a single forward pass and terminates whatever this
 * returns; what the cap buys is that a picture is not drawn taller than the
 * slide it sits on.
 */
export function lineCost(line: SlideLine): number {
  return isImageLine(line) ? Math.max(1, Math.ceil(line.cyEmu / BODY_LINE_EMU)) : 1;
}

/**
 * Split a slide's lines into per-slide chunks.
 *
 * Returns `[[]]` for an empty list so a titled slide with no body still yields
 * exactly one slide (a section divider); the caller drops the untitled case.
 */
export function paginateLines(lines: readonly SlideLine[], perSlide: number): SlideLine[][] {
  if (lines.length === 0) return [[]];
  const chunks: SlideLine[][] = [];
  let current: SlideLine[] = [];
  let spent = 0;

  // ★★ A SINGLE FORWARD PASS, one line consumed per iteration. That is what
  //    makes it total: a line costing more than the whole budget lands alone on
  //    its own chunk rather than repeatedly failing to fit. A formulation that
  //    re-tested the same line after breaking would not terminate for one.
  for (const line of lines) {
    const cost = lineCost(line);
    if (current.length > 0 && spent + cost > perSlide) {
      chunks.push(current);
      current = [];
      spent = 0;
    }
    // A gap between blocks is typography mid-slide and dead space at the top of
    // a continuation, so drop a blank that a break left leading. ★ An image is
    // never blank (`isBlankLine`), so this cannot swallow a picture.
    if (current.length === 0 && isBlankLine(line)) continue;
    current.push(line);
    spent += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [[]];
}

/**
 * Title for chunk `index` of `total`.
 *
 * ★ The continuation marker is NUMERIC (`(2/3)`), not a word like "(cont.)".
 * Every other string this renderer adds is hardcoded English — see the
 * truncation notice — and a digit pair needs no translation, so this is the
 * one place the mixed-language problem was avoidable for free. It also says
 * more: a reader sees how much is left, not just that something preceded.
 */
export function slideTitleFor(title: string, index: number, total: number): string {
  if (title === "" || total <= 1) return title;
  return `${title} (${index + 1}/${total})`;
}

/** `ST_Percentage` values PowerPoint itself writes for the two vertical
 *  alignments. Thousandths of a percent: 30000 = +30%, -25000 = -25%. */
const SUPERSCRIPT_PCT = 30000;
const SUBSCRIPT_PCT = -25000;

/** Highlight fill for a `<mark>` run.
 *
 *  ★★★ DECISION, NOT A DEFAULT — and it deliberately differs from the DOCX
 *  renderer's. That one keeps Word's "yellow" because `w:highlight` takes the
 *  CLOSED `ST_HighlightColor` enum, in which no brand hex is expressible at
 *  all. `<a:highlight>` takes a REAL colour, so that argument does not carry
 *  over and the choice is genuinely open. It goes to the AIPM accent because
 *  this file's OWN palette test enumerates the sanctioned hexes and asserts
 *  that every `<a:srgbClr>` in a slide part is one of them — unlike the
 *  repo-wide palette sweep, which scans CSS and cannot see OOXML, that test is
 *  a real gate over this renderer, and shipping FFFF00 here would mean either
 *  breaking it or carving out an exemption. 84BD00 also measures 7.67:1 against
 *  the body text colour (COLOR_TEXT = 1A1A1A, on the master's body style), so
 *  the highlighted words stay readable rather than merely marked. (WCAG 2.x
 *  relative luminance, recomputed 2026-08-08: 7.674599…, i.e. 7.67 — an earlier
 *  revision quoted 7.8, which rounds the wrong way and was never derived.)
 *  ★ ACCEPTED COST: the same document's highlight is yellow in its .docx and
 *  its printed PDF (where `doc-render-html.ts` leaves `<mark>` to the browser
 *  default) and AIPM green in its .pptx. Symmetry across the three renderings
 *  was the alternative, and it loses to a gate that is actually enforced. */
const HIGHLIGHT_RGB = COLOR_GREEN;

/** Left indent for one step of indentation, in EMUs. 228600 EMU = 0.25" = the
 *  360 twips the DOCX `Quote` and `CodeBlock` styles indent by, so the same
 *  document is indented identically in both formats. A nested list item takes a
 *  MULTIPLE of it — see `pptxIndentFor`. */
const RICH_INDENT_EMU = 228600;

/** A horizontal rule, drawn as text.
 *
 *  ★★ PPTX HAS NO PARAGRAPH BORDER — `<a:pPr>` carries no `w:pBdr` equivalent,
 *  so the DOCX trick (an empty paragraph wearing a bottom border) has nothing
 *  to map onto, and a drawn line SHAPE cannot sit inline in a text box's flow.
 *  Em-dashes are the same degrade-to-text decision this renderer already makes
 *  for tables, and they keep the rule inside the paginated line budget.
 *  ★ The length is FIXED, not measured to the box: nothing here can measure
 *  text (see BODY_LINES_PER_SLIDE), so this is a legible rule at the body size
 *  rather than a promise of full width. */
const HR_TEXT = "—".repeat(24);

/**
 * One parsed run as DrawingML run properties.
 *
 * ★★ ALL EIGHT MARKS ARE REPRESENTED — none is dropped as "no equivalent".
 * `code` and `highlight` were once slated to be emitted unstyled; they have
 * real DrawingML representations (`<a:latin>`, `<a:highlight>`) and get them.
 * ★★ DELIBERATELY NOT the DOCX rank record. There, every mark is a CHILD of
 * `<w:rPr>` and `CT_RPr` is a sequence, so the renderer must sort by rank.
 * Here the properties are ATTRIBUTES (order irrelevant) and the two children
 * are ordered inside the primitive, which owns the schema — so copying the
 * rank table over would be cargo cult.
 * ★ `sup` beats `sub` when a run somehow carries both: there is ONE `baseline`
 * attribute, so it can hold one value, and a silent nothing would be worse.
 * ★ `kind` folds the LINE's styling into every run, because a slide has no
 * style part to declare a `Quote`/`CodeBlock` in — see `DOCX_LINE_STYLE`'s
 * counterpart. Italic mirrors the DOCX `Quote` style; monospace mirrors
 * `CodeBlock`. Both are no-ops on a run that already carries the mark.
 * ★ EXPORTED FOR ONE ASSERTION ONLY — whether `hyperlinkRelId` is an OWN key.
 * Every other property of this function is observable in the slide XML, but
 * key presence is not: `pptxTextBox` renders an own-and-undefined field and an
 * absent one identically, so the only way to pin the shape is to look at the
 * object. `buildContentSlide` returns a string and cannot show it.
 */
export function pptxRun(run: TextRun, kind: RichLineKind, links: LinkSink | undefined): PptxRun {
  const has = (mark: RunMark): boolean => run.marks.includes(mark);
  // ★★ URL -> RELATIONSHIP ID. `TextRun.href` is an address the shared parse
  //   already validated against the scheme allow-list; `hyperlinkRelId` is an
  //   id into THIS SLIDE's rels part. The sink does the conversion and
  //   remembers what it minted, so `renderDocumentPptx` can hand the same
  //   list to `buildPptxPackage`.
  // ★ No sink means no links at all — every pre-existing caller passes none
  //   and its runs stay byte-identical.
  const relId =
    links === undefined || run.href === undefined ? undefined : links.relIdFor(run.href);
  return {
    text: run.text,
    // ★★ ABSENT on an unlinked run, never own-and-undefined — the rule the
    //   `TextRun.href` docblock states, applied to the field href resolves
    //   INTO. Written unconditionally the key is always own, so `toEqual`
    //   and `JSON.stringify` both separate a run built here from one built by
    //   hand, and `Object.hasOwn` reports true on a run with no link at all.
    //   Pinned by "omits hyperlinkRelId entirely on an unlinked run".
    // ★ The other optionals below keep the shape they have always had: the
    //   rule this obeys is the one this branch's own docblock legislates, and
    //   widening it to the mark fields is a separate decision with its own
    //   byte-level blast radius across every existing pptx assertion.
    ...(relId === undefined ? {} : { hyperlinkRelId: relId }),
    bold: has("bold"),
    italic: has("italic") || kind === "blockquote",
    underline: has("underline"),
    strike: has("strike"),
    baselinePct: has("sup") ? SUPERSCRIPT_PCT : has("sub") ? SUBSCRIPT_PCT : undefined,
    monospace: has("code") || kind === "pre",
    highlightRgb: has("highlight") ? HIGHLIGHT_RGB : undefined,
  };
}

/** One body line as one paragraph for `pptxTextBox`. A plain string keeps the
 *  uniform-text shape it always had — byte-identical, since that branch splits
 *  on "\n" and these lines are already split. */
function bodyParagraph(line: string | RichLine, links: LinkSink | undefined): PptxParagraph {
  if (typeof line === "string") return { text: line, sizeHundredths: BODY_SIZE };
  if (line.kind === "hr") return { runs: [{ text: HR_TEXT }], sizeHundredths: BODY_SIZE };
  const runs = line.runs.map((run) => pptxRun(run, line.kind, links));
  // ★★ The marker is a RUN, not a paragraph property: this path emits no
  // bullet properties at all (see `bulletMarker`), so the ordinal has to be
  // text or it is lost outright. It is its OWN run so it inherits none of the
  // item's marks — a bold list item must not get a bold "1.".
  // ★★ `pptxIndentFor` below is deliberately NOT guarded on `continuation` — a
  // wrapped line keeps the item's indent — but the marker is: one bullet per
  // item that put an `li` line into the output, however many lines it wraps to.
  // ★ NOT "one bullet per ITEM": an item that emits ONLY lines of another kind
  // (`<li><h2>h</h2></li>`, `<li><ul>…</ul></li>`) has no `li` line to mark, so
  // it renders no bullet while still spending its ordinal — open-followups §157.
  const marked =
    line.kind === "li" && !line.continuation
      ? [{ text: `${bulletMarker(line.ordered, line.index, line.task)} ` }, ...runs]
      : runs;
  return {
    runs: marked,
    sizeHundredths: BODY_SIZE,
    indentEmu: pptxIndentFor(line),
  };
}

/**
 * The left indent one line kind takes.
 *
 * ★★★ THE `heading` ARM IS A FIX, NOT A STYLE CHOICE. This was
 * `kind === "p" ? undefined : RICH_INDENT_EMU`, written when the parser could
 * only ever hand back p/blockquote/pre/hr. Widening `RichLine` to carry
 * `heading` and `li` made that ternary silently indent every section title to
 * the blockquote depth, with tsc, lint and the whole suite green — a heading is
 * a structural marker, not an aside, and lining it up with a block quote is
 * wrong. Pinned by "does not indent a heading line".
 *
 * ★ A list item indents PER DEPTH so nesting is visible; `p` stays flush.
 */
function pptxIndentFor(line: RichLine): number | undefined {
  if (line.kind === "p" || line.kind === "heading") return undefined;
  if (line.kind === "li") return RICH_INDENT_EMU * (line.depth + 1);
  return RICH_INDENT_EMU;
}

/**
 * Mints the media parts for ONE slide.
 *
 * ★★★ TWO COUNTERS THAT MUST NOT BE SWAPPED, and swapping them is a silent
 * wrong-image bug rather than a broken file. Part PATHS are DECK-WIDE: every
 * slide's media lands in the one `ppt/media/` directory, so two slides both
 * minting `image1.png` collapse to a single part and the second slide shows the
 * FIRST slide's picture. Relationship ids are PER SLIDE, because each slide has
 * its own `_rels` part in which rId1 is already the layout — `buildPptxPackage`
 * throws if a media part claims it. `PptxSlide` states both halves too.
 */
export function createDeckMedia(ctx: RenderCtx) {
  let partCount = 0;
  return function slideMedia() {
    const parts: MediaPart[] = [];
    /** The part for one image line, or null if its bytes or metadata have gone
     *  since `paragraphLines` accepted it.
     *
     *  ★★★ UNREACHABLE BY CONSTRUCTION — AND THAT IS A PROPERTY OF THE OTHER
     *  FILE, NOT OF THIS ONE. `paragraphLines` (`doc-render-pptx.ts`) applies
     *  these three checks, in this order, before it mints the `ImageLine`; a
     *  check added HERE and not THERE breaks the invariant silently, and did:
     *  the decode below was once this site's alone, which made `mint` the only
     *  place a picture could be declined — and this file has nothing to decline
     *  WITH. Skipping the picture is all `buildContentSlide` can do, and a
     *  skipped picture on a slide whose `<img>` tag `paragraphLines` already
     *  stripped leaves nothing that says an image was ever there — and for the
     *  image-ONLY paragraph the block editor inserts, nothing on the slide at
     *  all: no `<p:pic>`, no body text, no placeholder. (A paragraph with prose
     *  around the image keeps its Body; `doc-render-pptx.ts` carries the split.)
     *  Every other pptx decline reason leaves the tag in the fragment for
     *  `withImagePlaceholders`, which is the only thing that tells the reader an
     *  image was there. So the null path is a genuine last resort, not a
     *  disclosure route — keep the decision complete upstream.
     *  ★ Pinned from both sides: `doc-render-pptx-slides.test.ts` proves this
     *  function DECLINES a malformed row, and `doc-render-pptx.test.ts`'s
     *  "discloses an image whose stored base64 has …" proves the reader is told,
     *  which only the upstream check can deliver. Neither test alone is enough. */
    function mint(line: ImageLine): MediaPart | null {
      const b64 = ctx.assets.inlined[line.id];
      const embed = pptxEmbedFor(ctx.byId.get(line.id));
      if (!b64 || !embed) return null;
      // ★★ DECODE BEFORE `partCount` MOVES. `safeBase64ToBytes` declines a row
      //   it cannot turn into drawable bytes — malformed OR empty — instead of
      //   throwing out of this render, which would cost the user the entire
      //   deck over one bad row: the render is synchronous inside a promise
      //   `downloadDocument`'s call sites `void`, so nothing downstream can
      //   retry it. (They DO surface a message — each site attaches a `.catch`
      //   to `reportDownloadFailure` — so neither half makes the other
      //   redundant; `safeBase64ToBytes`' docstring carries the detail.)
      //   Bumping the DECK-WIDE counter first would leave a gap in
      //   `ppt/media/`, so the decline has to happen above it.
      // ★★ THE SECOND EVALUATION OF THIS PREDICATE IS DELIBERATE — see the
      //   docstring. `paragraphLines` decodes to DECIDE and throws the bytes
      //   away; this decodes to USE them. Threading the bytes on `ImageLine`
      //   instead would spend one decode, but it would also make this guard
      //   unreachable from any test, and this is the site where the deck-wide
      //   counter moves. Both sites call this ONE function, so they cannot
      //   disagree about what is decodable.
      // ★ WHAT THE DUPLICATION COSTS, so the trade is priced rather than
      //   asserted: one extra `atob` plus byte copy per embeddable row — ~170 ms
      //   at the documented cap (`ASSET_STORED_MAX_BYTES` 5 MiB ×
      //   `ASSET_MAX_PER_DOCUMENT` 20), measured under node at 164/175/171 ms
      //   over three runs by timing `base64ToBytes` across twenty
      //   `Buffer.alloc(5 * 1024 * 1024).toString("base64")` rows. Paid once per
      //   export, never on a keystroke path.
      const data = safeBase64ToBytes(b64);
      if (!data) return null;
      partCount += 1;
      const part: MediaPart = {
        // ★ The part name derives from the INDEX, never from the asset's
        //   user-supplied name — a name must never become a zip path.
        path: `ppt/media/image${partCount}.${embed.ext}`,
        data,
        extension: embed.ext,
        relId: `rId${parts.length + 2}`,
      };
      parts.push(part);
      return part;
    }
    return { mint, parts };
  };
}

/**
 * An UPPER BOUND on how many media relationship ids ONE slide will mint, so a
 * link sink can start above them.
 *
 * ★★★ IT HAS TO BE A BOUND RATHER THAN A COUNT, and that is a property of
 * `buildContentSlide`, not of this list: the body text box — which is where the
 * link ids are minted — is built BEFORE `mint` runs over the picture lines, so
 * the media count does not exist yet at the moment the first link id is needed.
 * This is the same reservation `doc-render-docx.ts`'s own `mediaIdCeiling`
 * makes for the same reason.
 *
 * ★★ THE TWO ARE NOT DERIVED THE SAME WAY, though, and reading this as a copy
 * would mislead: DOCX cannot see its candidate set at all before the render and
 * re-scans each block's HTML for `<img data-asset-id>`; here the candidates are
 * already `ImageLine`s in the chunk, so the only slack is whether `mint`
 * DECLINES one (bytes or metadata gone since `paragraphLines` accepted them —
 * "unreachable by construction", per its docstring). So this over-reserves only
 * on that path and can never under-reserve.
 *
 * ★ Over-reserving costs a GAP in the id sequence, which is legal — `Id` is an
 * xsd:ID and nothing in OPC requires contiguity. Under-reserving would cost a
 * collision, which `buildPptxPackage` throws on rather than shipping an image
 * that silently resolves to a link.
 */
export function mediaIdCeiling(lines: readonly SlideLine[]): number {
  return lines.filter(isImageLine).length;
}

export function buildContentSlide(
  title: string,
  lines: readonly SlideLine[],
  ctx: RenderCtx,
  mint: (line: ImageLine) => MediaPart | null,
  /** ★ ONE SINK PER SLIDE — its ids land in THIS slide's rels part. Optional so
   *  a caller that wants no links keeps the bytes it always had. */
  links?: LinkSink,
): string {
  const { lang } = ctx;
  const titleShape = title
    ? pptxTextBox({
        id: 2,
        name: "Title",
        lang,
        ...TITLE_BOX,
        paragraphs: [
          { text: title, bold: true, sizeHundredths: TITLE_SIZE, colorRgb: COLOR_DARK_BLUE },
        ],
      })
    : "";

  const textLines = lines.filter((line): line is string | RichLine => !isImageLine(line));

  // ★ No body shape at all when there are no text lines. An empty text box
  // still emits one empty <a:p>, which is a stray blank paragraph on the slide
  // — and an image-only paragraph, the block editor's own shape, produces
  // exactly that chunk.
  const body = textLines.length
    ? pptxTextBox({
        id: 3,
        name: "Body",
        lang,
        ...BODY_BOX,
        // One <a:p> per line. ★ A plain line still goes through the uniform
        // -text branch, which splits `text` on "\n" itself — so a bullet item
        // or table cell that smuggled a newline in behaves exactly as before.
        paragraphs: textLines.map((line) => bodyParagraph(line, links)),
      })
    : "";

  // ★ Shape ids 2 and 3 are the title and the body, so pictures continue from
  //   4. Ids only have to be unique WITHIN a slide.
  let shapeId = 4;
  // ★★ A picture is a SIBLING SHAPE of the body text box, not a run inside it,
  //    so it is positioned in slide coordinates and an overlapping y draws the
  //    image straight over the words. It therefore starts below the text box's
  //    USED height — line count × line height, the same optimistic measure
  //    BODY_LINES_PER_SLIDE documents: a wrapped line counts one here and takes
  //    two on screen.
  let yEmu = BODY_BOX.yEmu + textLines.length * BODY_LINE_EMU;
  const pictures = lines
    .filter(isImageLine)
    .map((line) => {
      const part = mint(line);
      if (!part) return "";
      const xml = pptxPicture({
        id: shapeId++,
        name: part.path.slice("ppt/media/".length),
        // ★ PowerPoint's alt text. The asset's own name, so the deck is not a
        //   wall of undescribed images; a dangling id falls back to the id.
        descr: ctx.byId.get(line.id)?.name ?? line.id,
        relId: part.relId,
        // ★ Centred in the body box. `fitExtent` already bounded the width by
        //   `BODY_BOX.cxEmu`, so this offset can never go negative.
        xEmu: BODY_BOX.xEmu + Math.round((BODY_BOX.cxEmu - line.cxEmu) / 2),
        yEmu,
        cxEmu: line.cxEmu,
        cyEmu: line.cyEmu,
      });
      yEmu += line.cyEmu;
      return xml;
    })
    .join("");

  return wrapPptxSlide(
    pptxBackgroundRect(COLOR_WHITE) +
      pptxAccentBar(COLOR_DARK_BLUE) +
      titleShape +
      body +
      pictures,
  );
}

/** Everything the block walk needs that is fixed for one render.
 *
 *  ★ ONE `byId` map, not a parallel name map beside it — two maps built from
 *  the same list and threaded down the same call chain is the shape that
 *  drifts apart on a later fix. `doc-render-docx.ts` carries the same note. */
export type RenderCtx = {
  ws: Workspace;
  lang: Lang;
  byId: ReadonlyMap<string, DocumentAsset>;
  assets: ExportAssets;
};

/**
 * The extension and geometry one asset embeds as ON A SLIDE, or null if it
 * cannot embed at all.
 *
 * ★★ Deriving BOTH here is what keeps `canEmbedPptxAsset` and the placed
 * picture from disagreeing: each condition is written once and the placement
 * reuses what the decision already computed. Re-deriving would also make each
 * copy of a guard unobservable — a mutant in either is masked by the other, so
 * the suite reports coverage it does not have.
 *
 * ★★ THE BOUNDS ARE THE SLIDE BODY BOX where `doc-render-docx.ts`'s twin uses
 * the PAGE CONTENT BOX, so these are two genuinely different predicates rather
 * than one duplicated. An asset that fits a portrait page need not fit a 16:9
 * body box; folding them together would make each renderer's answer depend on
 * the other renderer's geometry.
 *
 * ★ `BODY_BOX`'s members are integer literals, which `fitExtent` REQUIRES —
 * it rejects a non-integer bound outright, and the caller's fallback for a
 * rejection is the placeholder, so a computed bound would degrade silently.
 */
export function pptxEmbedFor(
  meta: DocumentAsset | undefined,
): { ext: MediaExtension; extent: Extent } | null {
  if (!meta) return null;
  if (!isAllowedAssetMime(meta.mime)) return null;
  const ext = mediaExtension(meta.mime);
  if (!ext) return null;
  const extent = fitExtent(meta, BODY_BOX.cxEmu, BODY_BOX.cyEmu);
  if (!extent) return null;
  return { ext, extent };
}

/** Whether an asset can become a slide picture at all — the metadata-only half
 *  of the decision, with no reference to whether its bytes were loaded.
 *
 *  ★★★ EXPORTED because `document-download.ts` passes it to `loadExportAssets`
 *  as the `isRenderable` predicate for the PPTX sink. The two signatures do not
 *  meet directly — `isRenderable` is asked about an ID, this asks about a
 *  metadata ROW — so that call site adapts it through a map built from
 *  `ws.documentAssets`. A call site that re-implements these conditions instead
 *  of calling this drifts from the placed picture silently.
 *
 *  ★★★ WHAT IT BUYS HERE IS THE THREE-BUCKET CONTRACT, NOT BUDGET HEADROOM —
 *  and this comment asserted the opposite for a release in which NOTHING passed
 *  the predicate at all. `loadExportAssets` asks it before charging the budget
 *  so an undrawable asset cannot push a good one into `omitted`; but the PPTX
 *  sink runs UNBUDGETED (`Number.POSITIVE_INFINITY`), so nothing is ever
 *  omitted there and there is no headroom to protect. What the predicate does
 *  do is route an undrawable id to `missing` rather than leaving it
 *  `inlined`-but-undrawable — the fourth state no bucket describes — and keep
 *  its base64 out of memory.
 *
 *  ★★ SO NO OUTPUT TEST CAN SEE THIS. Measured, not reasoned: rendering an
 *  undrawable asset with the bytes inlined and with the id in `missing` yields
 *  BYTE-IDENTICAL decks. (The same comparison for a DRAWABLE asset differs, so
 *  that identity is not vacuous.) The wiring is pinned in
 *  `document-download.test.ts` by asserting the argument `loadExportAssets`
 *  receives, and invoking it — nowhere else.
 *
 *  ★ "One function, two callers" describes `pptxEmbedFor`, not this wrapper:
 *  the conditions are written once there and read by both this predicate and
 *  the placement. This wrapper has exactly one production caller. */
export function canEmbedPptxAsset(meta: DocumentAsset | undefined): boolean {
  return pptxEmbedFor(meta) !== null;
}
