// Shared helpers for the OOXML export builders (export-docx/xlsx/pptx).
//
// Why hand-rolled: a jszip+docx+xlsx+pptx stack is ~600KB for what is just a
// few XML strings inside a ZIP. We have our own ZIP writer (zip.ts) and the
// OOXML we emit is intentionally minimal but round-trips cleanly.
//
// Brand palette WITHOUT the leading `#` so values drop straight into OOXML
// attributes (`w:fill="004159"` etc.).
export const COLOR_DARK_BLUE = "004159";
export const COLOR_GREEN = "84BD00";
export const COLOR_PINK = "E5497C";
export const COLOR_LIGHT_GREY = "E3E6E6";
export const COLOR_MEDIUM_GREY = "939598";
export const COLOR_WHITE = "FFFFFF";
export const COLOR_TEXT = "1A1A1A";

// Per-section row cap for PPTX (xlsx reuses it). Sections with more rows emit
// a truncation-notice slide. 100 keeps file size manageable.
export const PPTX_MAX_ROWS_PER_SECTION = 100;

/** XML-escape a string for use in text content or attribute values. */
export function xmlEscape(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Today's date as YYYY-MM-DD, used as a header subtitle. */
export function todayHuman(): string {
  return new Date().toISOString().slice(0, 10);
}
