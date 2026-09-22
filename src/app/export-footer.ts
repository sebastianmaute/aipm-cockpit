// The footer line of HTML, print/PDF and PowerPoint exports (on every slide, and the
// name of the PowerPoint theme). Dependency-free on purpose:
// `doc-render-html.ts` and `export.ts` import it, and `settings-types.ts` sits in
// an import cycle (settings-types ⇄ workspace ⇄ document-model) those renderers
// should not join. `settings-types.ts` re-exports everything here.
//
// ★ Precedence: a build-time `NEXT_PUBLIC_EXPORT_FOOTER` value, then Settings, then
//   the neutral built-in — mirrors `ai-policy.ts`'s env → Settings → built-in order.
//   Unlike the AI-usage policy, there is always SOME footer (every export carries
//   one), so the built-in is never dropped, only ever a neutral fallback.

/** Footer used when nothing else applies: never configured in Settings, no
 *  build variable set, or a stored value cleared to blank. */
export const DEFAULT_EXPORT_FOOTER = "AI PM Cockpit";
export const BRANDING_EXPORT_FOOTER_MAX = 120;

/** Line breaks and control characters collapse to single spaces, because a newline
 *  splits the PowerPoint footer into paragraphs that overflow its box and a control
 *  character is illegal in the XML it is written into. */
function oneLineFooter(v: string): string {
  return Array.from(v, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch))
    .join("")
    // ★ Plain spaces only: `\s` would also flatten a non-breaking space someone
    //   typed on purpose (e.g. between a name and its legal form).
    .replace(/ {2,}/g, " ")
    .trim();
}

export interface ExportFooterEnv {
  footer: string | undefined;
}

/** The deployment's build-time value. Next.js inlines `NEXT_PUBLIC_*` at build,
 *  so the member access stays literal (mirrors `aiPolicyEnv`). */
export function exportFooterEnv(): ExportFooterEnv {
  return { footer: process.env.NEXT_PUBLIC_EXPORT_FOOTER };
}

/** The footer line exports carry. Precedence: `env` (the build variable, or an
 *  injected value in tests) → a stored `branding.exportFooter` → the neutral
 *  built-in. A blank env value is ignored, same as a blank stored one. `undefined`
 *  branding = never set → the built-in; `""` (or blank) = cleared → the built-in
 *  too; anything else as typed, on ONE line (see `oneLineFooter`), capped at
 *  `BRANDING_EXPORT_FOOTER_MAX` the same way `sanitizeBranding` caps a stored
 *  value — nothing upstream of this function enforces that bound on `env`. */
export function exportFooterText(
  branding: { exportFooter?: string } | undefined,
  env: ExportFooterEnv = exportFooterEnv(),
): string {
  const envLine = env.footer !== undefined ? oneLineFooter(env.footer).slice(0, BRANDING_EXPORT_FOOTER_MAX) : "";
  if (envLine) return envLine;

  const v = branding?.exportFooter;
  if (v === undefined) return DEFAULT_EXPORT_FOOTER;
  const oneLine = oneLineFooter(v);
  return oneLine || DEFAULT_EXPORT_FOOTER;
}
