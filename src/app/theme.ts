// Per-device theme preference. "system" follows the OS; "light"/"dark" override
// it. Stored in its own localStorage key (NOT the workspace Settings), so it can
// be applied before first paint by a no-flash script. Pure helpers only — the
// DOM/localStorage wiring lives in use-theme.tsx.

export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "aipm-cockpit-theme";

/** Resolve the chosen theme to the concrete mode to apply. */
export function resolveTheme(theme: Theme, systemPrefersDark: boolean): "light" | "dark" {
  if (theme === "system") return systemPrefersDark ? "dark" : "light";
  return theme;
}

/** Validate a raw stored string into a Theme, defaulting to "system". */
export function readStoredTheme(raw: string | null): Theme {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}
