"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { type Theme, THEME_STORAGE_KEY, readStoredTheme, resolveTheme } from "./theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

// Non-undefined default: useTheme() outside a provider is harmless (no throw).
const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window === "undefined" ? "system" : readStoredTheme(localStorage.getItem(THEME_STORAGE_KEY)),
  );

  // Apply the resolved theme as a `.dark` class on <html>, and keep it in sync
  // with OS changes (system mode) and CI-style changes (lop-style-change event).
  // This is the SOLE writer of document.documentElement.classList "dark".
  useEffect(() => {
    const apply = () => {
      // Pin-light rides scheme-capability only: a dark-capable scheme
      // (data-scheme-dark="1") honours the theme; a light-only scheme pins light.
      // data-style is always "custom" now, so it plays no part. Mirrors effectiveDark.
      const schemeDark = document.documentElement.getAttribute("data-scheme-dark") === "1";
      const dark = schemeDark && resolveTheme(theme, prefersDark()) === "dark";
      document.documentElement.classList.toggle("dark", dark);
      // Notify the style layer to re-resolve the active scheme's light/dark map.
      window.dispatchEvent(new Event("lop-theme-change"));
    };
    apply();
    // ThemeProvider recomputes .dark on lop-style-change ONLY. A scheme switch that
    // changes dark-capability re-runs syncScheme (which stamps data-scheme-dark) and
    // THEN re-dispatches lop-style-change (see use-style), so apply() always reads a
    // fresh data-scheme-dark — no reliance on cross-component listener ordering.
    window.addEventListener("lop-style-change", apply);
    let mql: MediaQueryList | undefined;
    if (theme === "system") {
      mql = window.matchMedia("(prefers-color-scheme: dark)");
      mql.addEventListener("change", apply);
    }
    return () => {
      window.removeEventListener("lop-style-change", apply);
      mql?.removeEventListener("change", apply);
    };
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures (private mode, quota) — in-memory state still applies.
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
