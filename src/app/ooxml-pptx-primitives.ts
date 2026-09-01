// Format-level PPTX (OOXML) primitives, extracted verbatim from export-pptx.ts
// so more than one renderer can build a .pptx without re-declaring the shape,
// master/layout/theme and package boilerplate. Nothing here knows about
// ExportSection — these are about the PresentationML format only. Shared ZIP
// writer + palette live in export-ooxml-shared.ts.
import { type MediaPart, contentTypeFor } from "./ooxml-media";
import type { LinkRel } from "./ooxml-links";
import { type ZipEntry, buildZip } from "./zip";
// Type-only, so this stays a format module at runtime — no i18n code is pulled
// into the OOXML graph, only the union of valid BCP-47 tags the app can produce.
import type { Lang } from "./i18n";
import {
  COLOR_DARK_BLUE,
  COLOR_GREEN,
  COLOR_LIGHT_GREY,
  COLOR_MEDIUM_GREY,
  COLOR_PINK,
  COLOR_TEXT,
  COLOR_WHITE,
  xmlEscape,
} from "./export-ooxml-shared";

/** Monospace face for a code run. One constant so a `<pre>` line and an inline
 *  `<code>` span cannot end up in two different faces. */
const MONO_TYPEFACE = "Consolas";

/** `a:rPr sz` when a paragraph names none — HUNDREDTHS of a point (see below). */
const DEFAULT_SIZE_HUNDREDTHS = 1800;

/**
 * One individually styled run inside a `PptxParagraph`.
 *
 * ★★ SEMANTIC, deliberately NOT raw XML. DrawingML splits a run's styling
 * across two mechanisms and a caller assembling either by hand gets it wrong
 * eventually: bold/italic/underline/strike/baseline are ATTRIBUTES of
 * `<a:rPr>` (so their order is free), while a monospace face and a highlight
 * are CHILD ELEMENTS of it — and `CT_TextCharacterProperties` is an XML
 * SEQUENCE (`ln · fill · effectLst · highlight · uLn · latin · …`), so
 * children emitted in the order the caller happened to discover them produce a
 * part PowerPoint rejects. Saying what a run MEANS and letting this module
 * place it makes that unreachable.
 *
 * ★ Every field is optional and falsy means "not set", so an unstyled run emits
 * the same `lang`/`sz`/`dirty` `<a:rPr>` the uniform-text paragraph below has
 * always emitted — nothing extra appears until a mark asks for it.
 */
export type PptxRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** ★ `ST_Percentage` in THOUSANDTHS of a percent: 30000 = superscript,
   *  -25000 = subscript. NOT a point offset, and NOT the WordprocessingML
   *  `w:vertAlign` enum — there is one attribute here, so a run can be one or
   *  the other but never both. */
  baselinePct?: number;
  /** Monospace via `<a:latin>` DIRECT formatting. A slide package carries no
   *  character-style part, so there is no `rStyle`/`pStyle` to name — a
   *  style-name approach silently no-ops here. */
  monospace?: boolean;
  /** Highlight fill, 6 hex digits. `<a:highlight>` takes a real colour, unlike
   *  WordprocessingML's closed `ST_HighlightColor` enum. */
  highlightRgb?: string;
  /** Solid TEXT colour, 6 hex digits. The runs branch of `PptxParagraph` has no
   *  paragraph-level colour — its sibling's `colorRgb` reaches only the
   *  uniform-text shape — so a caller that must keep a slot's colour while
   *  splitting it into runs folds the colour into each run here.
   *
   *  ★★ A LINKED RUN SHOULD USUALLY LEAVE IT UNSET. `buildPptxTheme` declares
   *  an `<a:hlink>` colour and the master's `p:clrMap` binds it, so PowerPoint
   *  colours an `<a:hlinkClick>` run from the theme — but only while the run
   *  names no fill of its own. An explicit fill wins, and the link then reads
   *  exactly like the prose around it. */
  colorRgb?: string;
  /** An external hyperlink, as the RELATIONSHIP ID that resolves to it — never
   *  the URL.
   *
   *  ★★ The name is deliberately not `href`, which is what the parse-side
   *  `TextRun` carries: one is an address and the other is an id into THIS
   *  SLIDE's `_rels` part, and a renderer that conflates them writes a URL into
   *  `r:id`. That is valid XML PowerPoint resolves to nothing, so the link is
   *  simply dead with no error anywhere. `doc-render-pptx.ts` does the
   *  conversion through a `LinkSink`, which is also what remembers the
   *  relationship so `buildPptxPackage` can declare it. */
  hyperlinkRelId?: string;
};

/** A paragraph is EITHER one uniformly styled text (the original shape, whose
 *  emitted bytes are unchanged) OR a list of individually styled runs. */
export type PptxParagraph =
  | {
      text: string;
      bold?: boolean;
      italic?: boolean;
      // ★ HUNDREDTHS of a point, which is what DrawingML `a:rPr sz` takes:
      //   1800 = 18pt, 4400 = 44pt. NOT half-points — that is the
      //   WordprocessingML convention (`w:sz`, where 36 = 18pt), and the two
      //   differ by 50x. This comment said "half-points" while every value in
      //   the file was already correct hundredths, so a reader trusting it would
      //   write 5600 meaning 28pt and ship 56pt text.
      sizeHundredths?: number;
      colorRgb?: string;
    }
  | {
      runs: readonly PptxRun[];
      /** HUNDREDTHS of a point — see the sibling member above. */
      sizeHundredths?: number;
      /** Left indent in EMUs, emitted as `<a:pPr marL indent="0"/>`. ★ `indent`
       *  is pinned to 0 so the first line sits flush with the rest: `indent` is
       *  a first-line DELTA, so any non-zero value inherited from the layout
       *  would hang or over-indent line one alone. */
      indentEmu?: number;
    };

/** One `<a:r>`.
 *
 *  ★ `<a:rPr>` uses the OPEN/CLOSE form even when it has no children, matching
 *  what the uniform-text paragraph has always emitted (`>${color}</a:rPr>`).
 *  A self-closing `<a:rPr …/>` would be equally valid when empty and IMPOSSIBLE
 *  the moment a run carries a highlight or a monospace face, so one form for
 *  both keeps a single code path.
 */
function pptxRunXml(run: PptxRun, lang: Lang, sizeHundredths: number): string {
  const attrs =
    (run.bold ? ' b="1"' : "") +
    (run.italic ? ' i="1"' : "") +
    (run.underline ? ' u="sng"' : "") +
    (run.strike ? ' strike="sngStrike"' : "") +
    (run.baselinePct === undefined ? "" : ` baseline="${run.baselinePct}"`);
  // ★★★ THIS ORDER IS THE SCHEMA'S, not a preference: `highlight` precedes
  // `latin` in CT_TextCharacterProperties, and the marks arrive in HTML NESTING
  // order, which is unrelated (`<code><mark>…` hands us the face first).
  // ★★★ `hlinkClick` COMES LAST, and for the same reason. The sequence runs
  // `ln · fill · effect · highlight · uLn · uFill · latin · ea · cs · sym ·
  // hlinkClick · hlinkMouseOver · rtl · extLst`, so the link element sits after
  // BOTH children above it. A strict validator rejects it out of order while
  // PowerPoint itself is lenient — exactly the trap `DOCX_MARK_RPR`'s rank
  // table exists for on the WordprocessingML side, where `EG_RPrBase` is
  // likewise a sequence.
  // ★★ NO LOCAL `xmlns:r` HERE, and this is the one place PPTX is the OPPOSITE
  // of DOCX: `<w:hyperlink>` must declare the prefix because `w:document` binds
  // only `xmlns:w`, whereas `wrapPptxSlide` already binds `xmlns:r` on
  // `<p:sld>` — the same asymmetry `pptxPicture`'s `r:embed` comment records.
  // A redundant declaration would be harmless XML and a misleading precedent.
  // ★ `solidFill` LEADS: the sequence quoted above opens `ln · fill · effect ·
  // highlight · …`, so the fill group precedes every other child here.
  const children =
    (run.colorRgb ? `<a:solidFill><a:srgbClr val="${run.colorRgb}"/></a:solidFill>` : "") +
    (run.highlightRgb
      ? `<a:highlight><a:srgbClr val="${run.highlightRgb}"/></a:highlight>`
      : "") +
    (run.monospace ? `<a:latin typeface="${MONO_TYPEFACE}"/>` : "") +
    (run.hyperlinkRelId === undefined
      ? ""
      : `<a:hlinkClick r:id="${run.hyperlinkRelId}"/>`);
  return `<a:r>
    <a:rPr lang="${xmlEscape(lang)}" sz="${sizeHundredths}"${attrs} dirty="0">${children}</a:rPr>
    <a:t>${xmlEscape(run.text)}</a:t>
  </a:r>`;
}

/**
 * A drawingml text box helper that produces a single `<p:sp>` shape. EMUs
 * (English Metric Units) are the standard PPTX coordinate: 914400 EMUs per
 * inch. Slides are 9144000 × 5143500 EMUs (16:9 widescreen).
 */
export function pptxTextBox(opts: {
  id: number;
  name: string;
  /** ★★ REQUIRED, deliberately not defaulted. Every run this helper emits
   *  carries `a:rPr lang`, and it was hardcoded "en-US" for every caller —
   *  so a German deck asserted American English on all of its prose, which
   *  makes PowerPoint spell-check it against an English dictionary and makes
   *  an accessibility checker read the wrong language. A default would let a
   *  new call site reintroduce that silently, which is exactly how it survived
   *  this long; required means tsc names every site. Every member of Lang is
   *  already a valid BCP-47 tag. */
  lang: Lang;
  xEmu: number;
  yEmu: number;
  cxEmu: number;
  cyEmu: number;
  paragraphs: readonly PptxParagraph[];
}): string {
  const runs = opts.paragraphs
    .flatMap((p) => {
      if ("runs" in p) {
        const size = p.sizeHundredths ?? DEFAULT_SIZE_HUNDREDTHS;
        const pPr =
          p.indentEmu === undefined ? "" : `<a:pPr marL="${p.indentEmu}" indent="0"/>`;
        // ★ ONE <a:p>, never split: a run's text is a fragment of a line, so
        // splitting it on "\n" the way the uniform-text branch does would break
        // a paragraph apart mid-sentence. The caller upstream has already split
        // on block boundaries — that is what makes each RichLine one paragraph.
        return [
          `<a:p>${pPr}${p.runs.map((r) => pptxRunXml(r, opts.lang, size)).join("")}</a:p>`,
        ];
      }
      const rPr =
        `sz="${p.sizeHundredths ?? DEFAULT_SIZE_HUNDREDTHS}"` +
        (p.bold ? ' b="1"' : "") +
        (p.italic ? ' i="1"' : "");
      const color = p.colorRgb
        ? `<a:solidFill><a:srgbClr val="${p.colorRgb}"/></a:solidFill>`
        : "";
      // ★ One <a:p> per line. The export projection emits "\n" at a block
      // boundary and a raw newline inside <a:t> is just whitespace to
      // PowerPoint. A text with no newline yields the single paragraph it
      // always did, so existing slides stay byte-identical.
      return p.text.split("\n").map(
        (line) => `<a:p>
  <a:r>
    <a:rPr lang="${xmlEscape(opts.lang)}" ${rPr} dirty="0">${color}</a:rPr>
    <a:t>${xmlEscape(line)}</a:t>
  </a:r>
</a:p>`,
      );
    })
    .join("");

  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${opts.id}" name="${xmlEscape(opts.name)}"/>
    <p:cNvSpPr txBox="1"/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="${opts.xEmu}" y="${opts.yEmu}"/>
      <a:ext cx="${opts.cxEmu}" cy="${opts.cyEmu}"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:noFill/>
  </p:spPr>
  <p:txBody>
    <a:bodyPr wrap="square" rtlCol="0" anchor="t"/>
    <a:lstStyle/>
    ${runs}
  </p:txBody>
</p:sp>`;
}

/** Solid-color background rectangle that fills the slide. */
export function pptxBackgroundRect(colorRgb: string): string {
  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="100" name="Background"/>
    <p:cNvSpPr/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="0" y="0"/>
      <a:ext cx="9144000" cy="5143500"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:solidFill><a:srgbClr val="${colorRgb}"/></a:solidFill>
    <a:ln><a:noFill/></a:ln>
  </p:spPr>
  <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>
</p:sp>`;
}

/** A thin accent bar pinned to the top of the slide. */
export function pptxAccentBar(colorRgb: string): string {
  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="101" name="Accent"/>
    <p:cNvSpPr/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="0" y="0"/>
      <a:ext cx="9144000" cy="120000"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:solidFill><a:srgbClr val="${colorRgb}"/></a:solidFill>
    <a:ln><a:noFill/></a:ln>
  </p:spPr>
  <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>
</p:sp>`;
}


/** One embedded image as a `<p:pic>` shape.
 *
 *  ★ `descr` is PowerPoint's alt text. The asset name goes there so the
 *  exported deck is not a wall of undescribed images.
 *
 *  ★★ `noChangeAspect` stops a user's first drag from stretching the picture —
 *  the extent is already aspect-correct from `fitExtent`, and without this
 *  PowerPoint lets a corner handle distort it.
 *
 *  ★★ The `r:` prefix on `r:embed` is NOT declared here. `wrapPptxSlide` binds
 *  it on `<p:sld>` and every shape this module emits is spliced in there, so a
 *  local `xmlns:r` would be redundant. Verified by reading `wrapPptxSlide`, not
 *  by a test — these tests substring-match, so no assertion in this repo can
 *  see an unbound prefix. Splice a `<p:pic>` into anything else and check the
 *  binding first. */
export function pptxPicture(opts: {
  id: number;
  name: string;
  descr: string;
  relId: string;
  xEmu: number;
  yEmu: number;
  cxEmu: number;
  cyEmu: number;
}): string {
  return `<p:pic>
  <p:nvPicPr>
    <p:cNvPr id="${opts.id}" name="${xmlEscape(opts.name)}" descr="${xmlEscape(opts.descr)}"/>
    <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
    <p:nvPr/>
  </p:nvPicPr>
  <p:blipFill>
    <a:blip r:embed="${opts.relId}"/>
    <a:stretch><a:fillRect/></a:stretch>
  </p:blipFill>
  <p:spPr>
    <a:xfrm>
      <a:off x="${opts.xEmu}" y="${opts.yEmu}"/>
      <a:ext cx="${opts.cxEmu}" cy="${opts.cyEmu}"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
  </p:spPr>
</p:pic>`;
}

/**
 * The Title (id 2) + Subtitle (id 3) textbox pair shared by the cover slide
 * and the section-divider slides — identical coords/sizes/colours, only the
 * two text strings differ. Returns the concatenated shape XML, byte-identical
 * to the prior inline pair.
 */
export function pptxTitleSubtitleShapes(
  titleText: string,
  subtitleText: string,
  lang: Lang,
): string {
  return (
    pptxTextBox({
      id: 2,
      name: "Title",
      lang,
      xEmu: 685800,
      yEmu: 1700000,
      cxEmu: 7772400,
      cyEmu: 900000,
      paragraphs: [
        {
          text: titleText,
          bold: true,
          sizeHundredths: 4400,
          colorRgb: COLOR_WHITE,
        },
      ],
    }) +
    pptxTextBox({
      id: 3,
      name: "Subtitle",
      lang,
      xEmu: 685800,
      yEmu: 2700000,
      cxEmu: 7772400,
      cyEmu: 500000,
      paragraphs: [
        {
          text: subtitleText,
          italic: true,
          sizeHundredths: 2400,
          colorRgb: COLOR_LIGHT_GREY,
        },
      ],
    })
  );
}

export function wrapPptxSlide(shapesXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="9144000" cy="5143500"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="9144000" cy="5143500"/>
        </a:xfrm>
      </p:grpSpPr>
      ${shapesXml}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

export function buildPptxSlideMaster(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:srgbClr val="${COLOR_WHITE}"/></a:solidFill>
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle>
      <a:lvl1pPr algn="l"><a:defRPr sz="4400" b="1"><a:solidFill><a:srgbClr val="${COLOR_DARK_BLUE}"/></a:solidFill></a:defRPr></a:lvl1pPr>
    </p:titleStyle>
    <p:bodyStyle>
      <a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:srgbClr val="${COLOR_TEXT}"/></a:solidFill></a:defRPr></a:lvl1pPr>
    </p:bodyStyle>
    <p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:otherStyle>
  </p:txStyles>
</p:sldMaster>`;
}

export function buildPptxSlideLayout(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

export function buildPptxTheme(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Acme">
  <a:themeElements>
    <a:clrScheme name="Acme">
      <a:dk1><a:srgbClr val="${COLOR_TEXT}"/></a:dk1>
      <a:lt1><a:srgbClr val="${COLOR_WHITE}"/></a:lt1>
      <a:dk2><a:srgbClr val="${COLOR_DARK_BLUE}"/></a:dk2>
      <a:lt2><a:srgbClr val="${COLOR_LIGHT_GREY}"/></a:lt2>
      <a:accent1><a:srgbClr val="${COLOR_DARK_BLUE}"/></a:accent1>
      <a:accent2><a:srgbClr val="${COLOR_GREEN}"/></a:accent2>
      <a:accent3><a:srgbClr val="60C0DD"/></a:accent3>
      <a:accent4><a:srgbClr val="${COLOR_PINK}"/></a:accent4>
      <a:accent5><a:srgbClr val="AA4899"/></a:accent5>
      <a:accent6><a:srgbClr val="${COLOR_MEDIUM_GREY}"/></a:accent6>
      <a:hlink><a:srgbClr val="${COLOR_DARK_BLUE}"/></a:hlink>
      <a:folHlink><a:srgbClr val="AA4899"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Acme">
      <a:majorFont>
        <a:latin typeface="Titillium Web"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Titillium Web"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>`;
}

/** One slide and the images it references.
 *
 *  ★★★ THE TWO IDENTIFIERS HERE ARE SCOPED DIFFERENTLY, AND SWAPPING THEM
 *  PRODUCES VALID XML SHOWING THE WRONG IMAGE — a defect no schema check and
 *  no substring assertion can see:
 *    · `path` must be unique across the WHOLE DECK. Every media part lands in
 *      the single `ppt/media/` directory, so two slides both minting
 *      `ppt/media/image1.png` collapse into one zip entry and one of the two
 *      images is silently replaced by the other.
 *    · `relId` is scoped to ONE SLIDE. Each slide gets its own
 *      `ppt/slides/_rels/slideN.xml.rels`, `rId1` is that slide's layout, and
 *      image ids therefore restart at `rId2` on every slide. Numbering them
 *      deck-wide is harmless but wasteful; numbering `path` per-slide is data
 *      loss.
 *  The caller mints both — the slide XML already references `relId` via
 *  `r:embed` by the time it reaches this builder.
 *
 *  ★★ `links` shares the SLIDE-scoped id space with `media` and nothing else:
 *  two slides may both mint `rId2`, one for an image and one for a link, and
 *  that is correct. Within ONE slide the two families must not overlap — see
 *  the duplicate guard in `buildPptxPackage`. A link has no `path` because it
 *  has no part at all, which is what `TargetMode="External"` licenses. */
export type PptxSlide = {
  xml: string;
  media: readonly MediaPart[];
  /** ★ OPTIONAL so every pre-existing caller stays byte-identical — omitted
   *  and `[]` must both add no relationship. */
  links?: readonly LinkRel[];
};

/** Assemble a .pptx package around a caller-supplied list of slides.
 *  Everything here — content types, presentation.xml sldIdList, all the rels,
 *  master/layout/theme — depends ONLY on the slide COUNT and each slide's own
 *  media, so both the section exporter and any later renderer use this
 *  unchanged.
 *
 *  ★★★ ADDITIVE BY CONTRACT: a deck whose every slide has empty `media` AND no
 *  `links` must produce byte-for-byte the package this builder produced before
 *  images existed — no `Default` entry, no `ppt/media/` part, no extra
 *  relationship.
 *  ★★ MORE SO FOR `links` THAN FOR `media`: a link has NO part, so even a
 *  NON-empty list must add no zip entry and no content-type `Default` — which
 *  is exactly what `TargetMode="External"` licenses.
 *  ★★ Enforced in TWO places since open-followups §216 closed, and this
 *  docstring used to name only the first: this file's own test, "leaves the
 *  media-free package byte-for-byte what it was" (frozen literals, pinning
 *  only the parts it names), and `ooxml-package-manifest.test.ts`, which
 *  compares the whole media-free deck against the ORDERED 11-part manifest in
 *  `docs/baselines/ooxml-parts.json` and fails on a content change, an
 *  addition, a removal or a REORDER, naming the part in each case. Move that
 *  baseline ONLY with `npm run ooxml:manifest` — there is deliberately no
 *  `vitest -u` path.
 *
 *  ★★ Neither reaches a media-BEARING deck, and `export-ooxml.test.ts` reaches
 *  none of it: it asserts part PRESENCE and slide-XML SUBSTRINGS, never
 *  package bytes. There is still no .pptx byte fixture in this repo — the
 *  manifest replaced that idea on purpose. */
export function buildPptxPackage(slides: readonly PptxSlide[]): Blob {
  // ★★ Relationship ids are minted by the CALLER, because the slide XML
  // already references them by the time it gets here. rId1 is the slide
  // LAYOUT on every slide; a media part claiming it would replace the layout
  // with an image and PowerPoint would open a deck with no master styling and
  // no error. Cheap to assert, invisible otherwise.
  for (const slide of slides) {
    for (const part of slide.media) {
      if (part.relId === "rId1") {
        throw new Error(`media relId "rId1" is reserved for the slide layout (${part.path})`);
      }
    }
  }
  // ★★ ONE id space PER SLIDE, two families. rId1 is that slide's layout;
  // media and links both mint above it. A DUPLICATE is valid XML that resolves
  // to whichever relationship appears FIRST — an image silently becoming a link
  // target, with no schema error and no visible symptom. The rId1 check alone
  // could not see that.
  // ★★★ SCOPED TO THE SLIDE, NEVER THE DECK. Ids restart at rId2 on every
  // slide, so a `seen` set hoisted out of this loop would throw on correct
  // output the moment two slides each carry one link.
  // ★ The rId1 arm here is reachable for a LINK only — the media pass above
  // runs first and keeps its own message, which names the offending part and
  // which a test asserts. Deliberately not merged into one loop: losing that
  // path from the message would make a real failure harder to place.
  for (const slide of slides) {
    const seen = new Set<string>();
    for (const relId of [
      ...slide.media.map((m) => m.relId),
      ...(slide.links ?? []).map((l) => l.relId),
    ]) {
      if (relId === "rId1") {
        throw new Error(`relId "rId1" is reserved for the slide layout`);
      }
      if (seen.has(relId)) throw new Error(`duplicate relationship id "${relId}"`);
      seen.add(relId);
    }
  }

  // ★ One `Default` per DISTINCT extension across the WHOLE deck — OPC forbids
  // repeating one, and two slides carrying a .png each must not yield two
  // `<Default Extension="png">` entries (a file PowerPoint refuses to open).
  // A media-free deck yields the empty string, which is the byte-identity half
  // of the contract above.
  const allMedia = slides.flatMap((s) => [...s.media]);
  const mediaDefaults = [...new Set(allMedia.map((m) => m.extension))]
    .map((ext) => `\n  <Default Extension="${ext}" ContentType="${contentTypeFor(ext)}"/>`)
    .join("");

  // [Content_Types].xml — one Override per slide plus static parts.
  const slideOverrides = slides
    .map(
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join("");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${mediaDefaults}
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slideOverrides}
</Types>`;

  // presentation.xml — sldIdList with sequential IDs starting at 256.
  const sldIds = slides
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`)
    .join("");

  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>${sldIds}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

  const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slides
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
    )
    .join("")}
</Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

  const slideMasterXml = buildPptxSlideMaster();
  const slideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

  const slideLayoutXml = buildPptxSlideLayout();
  const slideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

  const themeXml = buildPptxTheme();

  // Per-slide _rels: the layout at rId1, then THIS slide's images.
  //
  // ★★ The Target is PART-RELATIVE to `ppt/slides/`, because the relationship
  // part it sits in is `ppt/slides/_rels/slideN.xml.rels`. A package-absolute
  // `ppt/media/image1.png` here resolves to `ppt/slides/ppt/media/…` and the
  // image silently does not render.
  //
  // ★★★ A HYPERLINK TARGET IS THE OPPOSITE — the RAW absolute URL, resolved
  // against nothing, which is exactly what `TargetMode="External"` means. Made
  // part-relative like its neighbour it would resolve to `ppt/slides/https:/…`
  // and open nothing. It is also the only Target here carrying user text, so it
  // is the only one that needs escaping.
  const slideRelsFor = (slide: PptxSlide): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${slide.media
    .map(
      (m) =>
        `\n  <Relationship Id="${m.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${m.path.slice("ppt/media/".length)}"/>`,
    )
    .join("")}${(slide.links ?? [])
    .map(
      (l) =>
        `\n  <Relationship Id="${l.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(l.target)}" TargetMode="External"/>`,
    )
    .join("")}
</Relationships>`;

  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", data: contentTypes },
    { path: "_rels/.rels", data: rootRels },
    { path: "ppt/presentation.xml", data: presentationXml },
    { path: "ppt/_rels/presentation.xml.rels", data: presentationRels },
    { path: "ppt/slideMasters/slideMaster1.xml", data: slideMasterXml },
    { path: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: slideMasterRels },
    { path: "ppt/slideLayouts/slideLayout1.xml", data: slideLayoutXml },
    { path: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: slideLayoutRels },
    { path: "ppt/theme/theme1.xml", data: themeXml },
  ];
  for (let i = 0; i < slides.length; i++) {
    entries.push({ path: `ppt/slides/slide${i + 1}.xml`, data: slides[i].xml });
    entries.push({
      path: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      data: slideRelsFor(slides[i]),
    });
  }
  // Media parts are deck-wide and written ONCE each — see `PptxSlide`.
  for (const part of allMedia) entries.push({ path: part.path, data: part.data });

  return buildZip(
    entries,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
}
