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

  // Apply the resolved theme as a `.dark` class on <html>, and (in system mode)
  // keep it in sync with OS changes.
  useEffect(() => {
    const apply = () =>
      document.documentElement.classList.toggle("dark", resolveTheme(theme, prefersDark()) === "dark");
    apply();
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
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
