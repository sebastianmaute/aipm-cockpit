// Format-level PPTX (OOXML) primitives, extracted verbatim from export-pptx.ts
// so more than one renderer can build a .pptx without re-declaring the shape,
// master/layout/theme and package boilerplate. Nothing here knows about
// ExportSection — these are about the PresentationML format only. Shared ZIP
// writer + palette live in export-ooxml-shared.ts.
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
  const children =
    (run.highlightRgb
      ? `<a:highlight><a:srgbClr val="${run.highlightRgb}"/></a:highlight>`
      : "") + (run.monospace ? `<a:latin typeface="${MONO_TYPEFACE}"/>` : "");
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

/** Assemble a .pptx package around a caller-supplied list of slide XML strings.
 *  Everything here — content types, presentation.xml sldIdList, all the rels,
 *  master/layout/theme — depends ONLY on the slide COUNT, so both the section
 *  exporter and any later renderer use this unchanged. */
export function buildPptxPackage(slideXmls: string[]): Blob {
  // [Content_Types].xml — one Override per slide plus static parts.
  const slideOverrides = slideXmls
    .map(
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join("");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slideOverrides}
</Types>`;

  // presentation.xml — sldIdList with sequential IDs starting at 256.
  const sldIds = slideXmls
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
  ${slideXmls
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

  // Each slide shares the same _rels (points at slideLayout1).
  const slideRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
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
  for (let i = 0; i < slideXmls.length; i++) {
    entries.push({ path: `ppt/slides/slide${i + 1}.xml`, data: slideXmls[i] });
    entries.push({ path: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: slideRels });
  }

  return buildZip(
    entries,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
}
