"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { type CiStyle, STYLE_STORAGE_KEY, readStoredStyle } from "./style-ci";
import { applySchemeColors, writeActiveSchemeColors, writeSchemeSupportsDark } from "./scheme-apply";
import { loadSchemes } from "./color-schemes";
import { activeSchemeOf, reconcileBuiltins, resolveActiveScheme } from "./builtin-schemes";
import { resolveSchemeColors } from "./scheme-tokens";

// Runtime signal (mirrors the boot-readable lop-scheme-supports-dark key): does
// the active custom scheme have a dark map? ThemeProvider reads it to decide
// whether `custom` may honour the theme.
const SCHEME_DARK_ATTR = "data-scheme-dark";

function currentDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

/** Resolve the active scheme for the CURRENT theme, apply its inline token
 *  overrides, and mirror the resolved map + supportsDark flag for the pre-paint
 *  boot script. Non-custom styles clear the overrides. Re-run on both style AND
 *  theme change so a dark-capable scheme swaps its light/dark sub-map. */
function syncScheme(style: CiStyle): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (style !== "custom") {
    applySchemeColors(null);
    writeActiveSchemeColors(null);
    writeSchemeSupportsDark(false);
    root.setAttribute(SCHEME_DARK_ATTR, "0");
    return;
  }
  const store = reconcileBuiltins(loadSchemes());
  const supportsDark = activeSchemeOf(store).supportsDark;
  root.setAttribute(SCHEME_DARK_ATTR, supportsDark ? "1" : "0");
  writeSchemeSupportsDark(supportsDark);
  const resolved = resolveSchemeColors(resolveActiveScheme(store, supportsDark && currentDark()));
  writeActiveSchemeColors(resolved);
  applySchemeColors(resolved);
}

interface CiStyleContextValue { style: CiStyle; setStyle: (s: CiStyle) => void; }
const CiStyleContext = createContext<CiStyleContextValue>({ style: "AIPM", setStyle: () => {} });

export function useCiStyle(): CiStyleContextValue { return useContext(CiStyleContext); }

export function CiStyleProvider({ children }: { children: React.ReactNode }) {
  const [style, setStyleState] = useState<CiStyle>(() => {
    if (typeof window === "undefined") return "AIPM";
    const stored = localStorage.getItem(STYLE_STORAGE_KEY);
    // Fresh install (no stored style) → custom, so the default (Harbor) scheme
    // is active. Matches the boot script's absent→custom default (no flash).
    return stored === null ? "custom" : readStoredStyle(stored);
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-style", style);
    // Apply the active scheme for the current theme (custom) or clear it (else).
    syncScheme(style);
    // Re-resolve the active scheme's light/dark sub-map when ThemeProvider flips
    // .dark (lop-theme-change) OR the active scheme changes (lop-scheme-change).
    // ★ Register BEFORE dispatching lop-style-change below: that dispatch makes
    // ThemeProvider re-toggle .dark and fire lop-theme-change synchronously, so
    // the listener must already be attached or the color re-resolve is dropped
    // (leaving .dark and the applied light/dark map desynced).
    const onSync = () => syncScheme(style);
    window.addEventListener("lop-theme-change", onSync);
    window.addEventListener("lop-scheme-change", onSync);
    // .dark is owned solely by ThemeProvider; notify it to re-apply for the new style.
    window.dispatchEvent(new Event("lop-style-change"));
    return () => {
      window.removeEventListener("lop-theme-change", onSync);
      window.removeEventListener("lop-scheme-change", onSync);
    };
  }, [style]);

  const setStyle = useCallback((next: CiStyle) => {
    setStyleState(next);
    try { localStorage.setItem(STYLE_STORAGE_KEY, next); } catch { /* private mode / quota */ }
  }, []);

  return <CiStyleContext.Provider value={{ style, setStyle }}>{children}</CiStyleContext.Provider>;
}
