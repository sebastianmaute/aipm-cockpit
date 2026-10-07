// The branded page header and footer of an exported Word file (§512 b): the
// sidebar logo and the project name at the top of every page, "Page X of Y"
// at the bottom. Pure and i18n-free: the caller passes the label already
// translated, with {0} for the page number and {1} for the page count.
//
// ★★ The header and footer are PARTS of their own (`word/header1.xml`,
// `word/footer1.xml`), and the header's logo relationship lives in ITS OWN
// relationship part, `word/_rels/header1.xml.rels`. So `rIdLogo` cannot clash
// with a media or link id the body mints: those live in
// `word/_rels/document.xml.rels`. The two ids the document part needs to point
// at the header and footer (`HEADER_REL_ID`, `FOOTER_REL_ID`) live in
// ooxml-docx-primitives.ts, which imports this module for its types only.
import { readHeaderDimensions } from "./document-asset-upload";
import { COLOR_DARK_BLUE, xmlEscape } from "./export-ooxml-shared";
import { docxInlineDrawing } from "./ooxml-docx-primitives";
import { fitExtent, mediaExtension, EMU_PER_INCH, type MediaExtension } from "./ooxml-media";

const LOGO_REL_ID = "rIdLogo";

/** The logo sits in the header band, so it is kept small: at most 0.3 inch
 *  high and 1.5 inch wide, its aspect ratio kept. */
const LOGO_MAX_HEIGHT_EMU = Math.round(0.3 * EMU_PER_INCH);
const LOGO_MAX_WIDTH_EMU = Math.round(1.5 * EMU_PER_INCH);

/** A drawing id no body drawing uses. Word tolerates a repeat; Pages does not. */
const LOGO_DRAWING_ID = 900001;

export interface DocxBranding {
  /** Shown in the header, and the logo's alt text. */
  projectName: string;
  /** The sidebar logo, a `data:image/*` URL. Left out when Word cannot take it. */
  logo?: string;
  /** e.g. "Page {0} of {1}": {0} becomes the page number, {1} the page count. */
  pageLabel: string;
}

export interface DocxLogo {
  bytes: Uint8Array;
  extension: MediaExtension;
  size: { width: number; height: number };
}

export interface DocxHeaderFooter {
  headerXml: string;
  footerXml: string;
  /** Present only with a logo. */
  headerRelsXml?: string;
  logo?: { path: string; data: Uint8Array; extension: MediaExtension };
}

/**
 * The logo's bytes, format and pixel size, or null when a Word drawing cannot
 * use it: not a base64 data URL, a format `mediaExtension` does not map (SVG is
 * the common one), or a header whose size cannot be read. A drawing needs a
 * real extent, and guessing an aspect ratio would distort the logo.
 */
export function decodeLogoDataUrl(url: string): DocxLogo | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(url);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const extension = mediaExtension(mime);
  if (!extension) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(m[2].replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const size = readHeaderDimensions(bytes, mime);
  return size ? { bytes, extension, size } : null;
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function textRun(text: string, extraRunProps = ""): string {
  return `<w:r><w:rPr>${extraRunProps}<w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function field(instr: "PAGE" | "NUMPAGES"): string {
  // The cached "1" shows until Word updates the field, which it does on open.
  return `<w:fldSimple w:instr="${instr}">${textRun("1")}</w:fldSimple>`;
}

/** The footer label with {0} and {1} replaced by the two fields, in the label's own order. */
function pageNumberRuns(label: string): string {
  return label
    .split(/(\{[01]\})/)
    .filter((part) => part !== "")
    .map((part) => (part === "{0}" ? field("PAGE") : part === "{1}" ? field("NUMPAGES") : textRun(part)))
    .join("");
}

export function buildDocxHeaderFooter(branding: DocxBranding): DocxHeaderFooter {
  const decoded = branding.logo ? decodeLogoDataUrl(branding.logo) : null;
  const extent = decoded ? fitExtent(decoded.size, LOGO_MAX_WIDTH_EMU, LOGO_MAX_HEIGHT_EMU) : null;
  const logo = decoded && extent ? decoded : null;
  const logoPath = logo ? `word/media/brand-logo.${logo.extension}` : null;

  const drawing =
    logo && extent
      ? `<w:r>${docxInlineDrawing({
          relId: LOGO_REL_ID,
          id: LOGO_DRAWING_ID,
          name: "Logo",
          descr: branding.projectName,
          extent,
        })}</w:r>${textRun("  ")}`
      : "";
  const name = textRun(branding.projectName, `<w:color w:val="${COLOR_DARK_BLUE}"/>`);

  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${W_NS} ${R_NS}>
  <w:p>${drawing}${name}</w:p>
</w:hdr>`;

  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${W_NS}>
  <w:p><w:pPr><w:jc w:val="center"/></w:pPr>${pageNumberRuns(branding.pageLabel)}</w:p>
</w:ftr>`;

  if (!logo || !logoPath) return { headerXml, footerXml };
  return {
    headerXml,
    footerXml,
    headerRelsXml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="${LOGO_REL_ID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${logoPath.slice("word/media/".length)}"/>
</Relationships>`,
    logo: { path: logoPath, data: logo.bytes, extension: logo.extension },
  };
}
