"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { type CiStyle, STYLE_STORAGE_KEY, readStoredStyle } from "./style-ci";
import { applySchemeColors, readActiveSchemeColors } from "./scheme-apply";

interface CiStyleContextValue { style: CiStyle; setStyle: (s: CiStyle) => void; }
const CiStyleContext = createContext<CiStyleContextValue>({ style: "AIPM", setStyle: () => {} });

export function useCiStyle(): CiStyleContextValue { return useContext(CiStyleContext); }

export function CiStyleProvider({ children }: { children: React.ReactNode }) {
  const [style, setStyleState] = useState<CiStyle>(() =>
    typeof window === "undefined" ? "AIPM" : readStoredStyle(localStorage.getItem(STYLE_STORAGE_KEY)),
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-style", style);
    // Custom style overlays inline CSS-var overrides from the active scheme;
    // any other style clears them. (The pre-paint boot script does the same on
    // reload; this handles in-session style switches.)
    applySchemeColors(style === "custom" ? readActiveSchemeColors() : null);
    // .dark is owned solely by ThemeProvider; notify it to re-apply for the new style.
    window.dispatchEvent(new Event("lop-style-change"));
  }, [style]);

  const setStyle = useCallback((next: CiStyle) => {
    setStyleState(next);
    try { localStorage.setItem(STYLE_STORAGE_KEY, next); } catch { /* private mode / quota */ }
  }, []);

  return <CiStyleContext.Provider value={{ style, setStyle }}>{children}</CiStyleContext.Provider>;
}
