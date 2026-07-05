// Hand-rolled PPTX (OOXML) builder. Shared helpers in export-ooxml-shared.ts.
import { type ZipEntry, buildZip } from "./zip";
import type { ExportSection } from "./export-sections";
import {
  COLOR_DARK_BLUE,
  COLOR_GREEN,
  COLOR_LIGHT_GREY,
  COLOR_MEDIUM_GREY,
  COLOR_PINK,
  COLOR_TEXT,
  COLOR_WHITE,
  PPTX_MAX_ROWS_PER_SECTION,
  todayHuman,
  xmlEscape,
} from "./export-ooxml-shared";

// ============================================================================
// PPTX
// ============================================================================

/**
 * Build a `.pptx` Blob with a title slide + one divider+item slide block per
 * ExportSection. Each section is capped at PPTX_MAX_ROWS_PER_SECTION item
 * slides; if truncated, a notice slide is inserted after the section items.
 *
 * Slide dimensions are 16:9 widescreen (9144000 × 5143500 EMUs = standard).
 */
export function buildPptx(sections: ExportSection[]): Blob {
  const slideXmls: string[] = [];

  // Title slide (always first).
  slideXmls.push(buildPptxTitleSlide());

  for (const section of sections) {
    const truncated = section.rows.length > PPTX_MAX_ROWS_PER_SECTION;
    const usedRows = section.rows.slice(0, PPTX_MAX_ROWS_PER_SECTION);

    // Section divider slide.
    slideXmls.push(buildPptxDividerSlide(section.title, section.rows.length));

    // One item slide per row.
    for (const row of usedRows) {
      slideXmls.push(buildPptxRowSlide(section.title, section.columns, row));
    }

    // Truncation notice when section exceeds the cap.
    if (truncated) {
      slideXmls.push(
        buildPptxNoticeSlide(
          `Showing the first ${PPTX_MAX_ROWS_PER_SECTION} of ${section.rows.length} ${section.title} rows.`,
          "Export to XLSX for the full list.",
        ),
      );
    }
  }

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

// ---- PPTX sub-builders ----------------------------------------------------

/**
 * A drawingml text box helper that produces a single `<p:sp>` shape. EMUs
 * (English Metric Units) are the standard PPTX coordinate: 914400 EMUs per
 * inch. Slides are 9144000 × 5143500 EMUs (16:9 widescreen).
 */
function pptxTextBox(opts: {
  id: number;
  name: string;
  xEmu: number;
  yEmu: number;
  cxEmu: number;
  cyEmu: number;
  paragraphs: Array<{
    text: string;
    bold?: boolean;
    italic?: boolean;
    sizeHundredths?: number; // Half-points; 1800 = 18pt, 4400 = 44pt
    colorRgb?: string;
  }>;
}): string {
  const runs = opts.paragraphs
    .map((p) => {
      const rPr =
        `sz="${p.sizeHundredths ?? 1800}"` +
        (p.bold ? ' b="1"' : "") +
        (p.italic ? ' i="1"' : "");
      const color = p.colorRgb
        ? `<a:solidFill><a:srgbClr val="${p.colorRgb}"/></a:solidFill>`
        : "";
      return `<a:p>
  <a:r>
    <a:rPr lang="en-US" ${rPr} dirty="0">${color}</a:rPr>
    <a:t>${xmlEscape(p.text)}</a:t>
  </a:r>
</a:p>`;
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
function pptxBackgroundRect(colorRgb: string): string {
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
function pptxAccentBar(colorRgb: string): string {
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
function pptxTitleSubtitleShapes(titleText: string, subtitleText: string): string {
  return (
    pptxTextBox({
      id: 2,
      name: "Title",
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

function buildPptxTitleSlide(): string {
  const shapes =
    pptxBackgroundRect(COLOR_DARK_BLUE) +
    pptxTitleSubtitleShapes("List of Open Points", `Exported ${todayHuman()}`);

  return wrapPptxSlide(shapes);
}

/** Section-divider slide: full-bleed Dark Blue with the section title. */
function buildPptxDividerSlide(title: string, rowCount: number): string {
  const shapes =
    pptxBackgroundRect(COLOR_DARK_BLUE) +
    pptxTitleSubtitleShapes(title, `${rowCount} row${rowCount === 1 ? "" : "s"}`);

  return wrapPptxSlide(shapes);
}

/**
 * One content slide per row. The first two columns go into a prominent title
 * area; the remaining columns are listed as key: value lines in a meta block.
 * This layout works well for both wide (many-column) and narrow sections.
 */
function buildPptxRowSlide(
  sectionTitle: string,
  columns: string[],
  row: (string | number)[],
): string {
  const firstValue = String(row[0] ?? "");
  const secondValue = columns.length > 1 ? String(row[1] ?? "") : "";

  // Remaining fields shown as "Label: value" lines.
  const metaLines = columns
    .slice(2, 8) // cap at 6 extra fields so text fits the slide
    .map((col, i) => {
      const val = String(row[i + 2] ?? "");
      return val ? { text: `${col}: ${val}`, sizeHundredths: 1600 as const } : null;
    })
    .filter((p): p is { text: string; sizeHundredths: 1600 } => p !== null);

  const shapes =
    pptxAccentBar(COLOR_GREEN) +
    pptxTextBox({
      id: 2,
      name: "RowMeta",
      xEmu: 457200,
      yEmu: 380000,
      cxEmu: 8229600,
      cyEmu: 350000,
      paragraphs: [
        {
          text: `${sectionTitle} · ${firstValue}`,
          sizeHundredths: 1400,
          colorRgb: COLOR_MEDIUM_GREY,
          italic: true,
        },
      ],
    }) +
    pptxTextBox({
      id: 3,
      name: "RowTitle",
      xEmu: 457200,
      yEmu: 750000,
      cxEmu: 8229600,
      cyEmu: 900000,
      paragraphs: [
        {
          text: secondValue || firstValue || "(empty)",
          bold: true,
          sizeHundredths: 3200,
          colorRgb: COLOR_DARK_BLUE,
        },
      ],
    }) +
    (metaLines.length > 0
      ? pptxTextBox({
          id: 4,
          name: "RowFields",
          xEmu: 457200,
          yEmu: 1850000,
          cxEmu: 8229600,
          cyEmu: 2800000,
          paragraphs: metaLines,
        })
      : "");

  return wrapPptxSlide(shapes);
}

function buildPptxNoticeSlide(line1: string, line2: string): string {
  const shapes =
    pptxAccentBar(COLOR_PINK) +
    pptxTextBox({
      id: 2,
      name: "Notice1",
      xEmu: 685800,
      yEmu: 2000000,
      cxEmu: 7772400,
      cyEmu: 700000,
      paragraphs: [
        {
          text: line1,
          bold: true,
          sizeHundredths: 2800,
          colorRgb: COLOR_DARK_BLUE,
        },
      ],
    }) +
    pptxTextBox({
      id: 3,
      name: "Notice2",
      xEmu: 685800,
      yEmu: 2900000,
      cxEmu: 7772400,
      cyEmu: 500000,
      paragraphs: [
        {
          text: line2,
          sizeHundredths: 1800,
          colorRgb: COLOR_MEDIUM_GREY,
          italic: true,
        },
      ],
    });

  return wrapPptxSlide(shapes);
}

function wrapPptxSlide(shapesXml: string): string {
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

function buildPptxSlideMaster(): string {
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

function buildPptxSlideLayout(): string {
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

function buildPptxTheme(): string {
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
