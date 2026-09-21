// The footer line of HTML, print/PDF and PowerPoint exports (on every slide, and the
// name of the PowerPoint theme). Dependency-free on purpose:
// `doc-render-html.ts` and `export.ts` import it, and `settings-types.ts` sits in
// an import cycle (settings-types ⇄ workspace ⇄ document-model) those renderers
// should not join. `settings-types.ts` re-exports everything here.

/** Footer when none was ever set — the text every export carried before it
 *  became configurable. */
export const DEFAULT_EXPORT_FOOTER = "Acme — AI PM Cockpit";
/** Footer once the field is cleared. */
export const NEUTRAL_EXPORT_FOOTER = "AI PM Cockpit";
export const BRANDING_EXPORT_FOOTER_MAX = 120;

/** The footer line exports carry. `undefined` = never set → the default;
 *  `""` (or blank) = cleared → the neutral footer; anything else as typed, on ONE
 *  line: line breaks and control characters collapse to single spaces, because a
 *  newline splits the PowerPoint footer into paragraphs that overflow its box and a
 *  control character is illegal in the XML it is written into. */
export function exportFooterText(branding: { exportFooter?: string } | undefined): string {
  const v = branding?.exportFooter;
  if (v === undefined) return DEFAULT_EXPORT_FOOTER;
  const oneLine = Array.from(v, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch))
    .join("")
    // ★ Plain spaces only: `\s` would also flatten a non-breaking space someone
    //   typed on purpose (e.g. between a name and its legal form).
    .replace(/ {2,}/g, " ")
    .trim();
  return oneLine || NEUTRAL_EXPORT_FOOTER;
}
