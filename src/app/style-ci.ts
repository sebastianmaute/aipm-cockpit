// Per-device CI/style preference, orthogonal to light/dark theme. Its own
// localStorage key (NOT the workspace Settings) so a no-flash boot script can
// apply it before first paint. Pure helpers only; DOM wiring in use-style.tsx.
export type CiStyle = "AIPM" | "mockup" | "custom";

export const STYLE_STORAGE_KEY = "lop-style";

/** Whether dark mode is active: the resolved theme is dark AND the active
 *  scheme is dark-capable. (Light-only schemes — Mockup and light-only user
 *  schemes — pin light.)
 *  NOTE: the production "pins light" rule is applied INLINE at two sites that
 *  cannot import this (use-theme.tsx reads the data-style / data-scheme-dark
 *  attrs; the boot-theme-script.ts pre-paint inline string). This helper is the
 *  canonical, unit-tested statement of the rule; keep the three in sync. */
export function effectiveDark(
  resolvedThemeDark: boolean,
  schemeSupportsDark: boolean,
): boolean {
  return resolvedThemeDark && schemeSupportsDark;
}
