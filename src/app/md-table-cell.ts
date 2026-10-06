// Escapes text for one cell of a Markdown table row (`| a | b |`). Shared by
// the xlsx, docx and HTML extractors so the three cannot drift apart again.
//
// ★ Backslashes go FIRST. Escaping only `|` lets the cell's own backslash
// cancel the escape: a cell reading a\|b would come out as a\\|b, which is an
// escaped backslash followed by a bare pipe, which a table parser can read as
// a column break (CodeQL js/incomplete-sanitization).
export function escapeMarkdownTableCell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}
