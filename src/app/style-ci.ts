// Per-device CI/style preference, orthogonal to light/dark theme. Its own
// localStorage key (NOT the workspace Settings) so a no-flash boot script can
// apply it before first paint. Pure helpers only; DOM wiring in use-style.tsx.
export type CiStyle = "AIPM" | "mockup";

export const STYLE_STORAGE_KEY = "lop-style";

/** Validate a raw stored string into a CiStyle, defaulting to "AIPM". */
export function readStoredStyle(raw: string | null): CiStyle {
  return raw === "AIPM" || raw === "mockup" ? raw : "AIPM";
}

/** Mockup ships light-only -> it PINS light regardless of the theme choice.
 *  AIPM honours the resolved theme. */
export function effectiveDark(resolvedThemeDark: boolean, style: CiStyle): boolean {
  return style === "mockup" ? false : resolvedThemeDark;
}
