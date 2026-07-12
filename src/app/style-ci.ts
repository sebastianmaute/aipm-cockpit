// Per-device CI/style preference, orthogonal to light/dark theme. Its own
// localStorage key (NOT the workspace Settings) so a no-flash boot script can
// apply it before first paint. Pure helpers only; DOM wiring in use-style.tsx.
export type CiStyle = "AIPM" | "mockup" | "custom";

export const STYLE_STORAGE_KEY = "lop-style";

/** Validate a raw stored string into a CiStyle, defaulting to "AIPM". */
export function readStoredStyle(raw: string | null): CiStyle {
  return raw === "AIPM" || raw === "mockup" || raw === "custom" ? raw : "AIPM";
}

/** AIPM honours the resolved theme. Mockup is ALWAYS light-only. A `custom`
 *  style honours the theme ONLY when the active scheme is dark-capable
 *  (`schemeSupportsDark`) — a light-only custom scheme pins light like mockup.
 *  NOTE: the production "pins light" rule is applied INLINE at two sites that
 *  cannot import this (use-theme.tsx reads the data-style / data-scheme-dark
 *  attrs; the layout.tsx boot script is a pre-paint inline string). This helper
 *  is the canonical, unit-tested statement of the rule; keep the three in sync. */
export function effectiveDark(
  resolvedThemeDark: boolean,
  style: CiStyle,
  schemeSupportsDark = false,
): boolean {
  if (style === "AIPM") return resolvedThemeDark;
  if (style === "custom" && schemeSupportsDark) return resolvedThemeDark;
  return false;
}
