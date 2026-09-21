// The footer line of HTML and print/PDF exports. Dependency-free on purpose:
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
 *  `""` (or blank) = cleared → the neutral footer; anything else as typed. */
export function exportFooterText(branding: { exportFooter?: string } | undefined): string {
  const v = branding?.exportFooter;
  if (v === undefined) return DEFAULT_EXPORT_FOOTER;
  return v.trim() || NEUTRAL_EXPORT_FOOTER;
}
