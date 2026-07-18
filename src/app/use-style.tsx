"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { type CiStyle, STYLE_STORAGE_KEY, effectiveDark } from "./style-ci";
import {
  applySchemeColors,
  applySchemeStructural,
  writeActiveSchemeColors,
  writeActiveSchemeStructural,
  writeSchemeSupportsDark,
} from "./scheme-apply";
import { loadSchemes } from "./color-schemes";
import {
  activeSchemeOf,
  reconcileBuiltins,
  resolveActiveScheme,
  resolveActiveStructural,
} from "./builtin-schemes";
import { resolveSchemeColors } from "./scheme-tokens";

// Runtime signal (mirrors the boot-readable aipm-cockpit-scheme-supports-dark key): does
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
    applySchemeStructural(null);
    writeActiveSchemeColors(null);
    writeActiveSchemeStructural(null);
    writeSchemeSupportsDark(false);
    root.setAttribute(SCHEME_DARK_ATTR, "0");
    return;
  }
  const store = reconcileBuiltins(loadSchemes());
  const supportsDark = activeSchemeOf(store).supportsDark;
  root.setAttribute(SCHEME_DARK_ATTR, supportsDark ? "1" : "0");
  writeSchemeSupportsDark(supportsDark);
  const resolved = resolveSchemeColors(resolveActiveScheme(store, effectiveDark(currentDark(), supportsDark)));
  writeActiveSchemeColors(resolved);
  applySchemeColors(resolved);
  // Structural (non-color) tokens ride the same apply+mirror path. Always pass the
  // resolved map — an empty {} (e.g. Harbor) still clears any prior inline structural,
  // and AIPM's all-"none" map correctly overwrites Mockup's shadows on a scheme switch.
  const structural = resolveActiveStructural(store);
  writeActiveSchemeStructural(structural);
  applySchemeStructural(structural);
}

interface CiStyleContextValue { style: CiStyle; setStyle: (s: CiStyle) => void; }
const CiStyleContext = createContext<CiStyleContextValue>({ style: "AIPM", setStyle: () => {} });

export function useCiStyle(): CiStyleContextValue { return useContext(CiStyleContext); }

export function CiStyleProvider({ children }: { children: React.ReactNode }) {
  const [style, setStyleState] = useState<CiStyle>(() => {
    if (typeof window === "undefined") return "custom";
    // The style axis is the constant "custom"; the active SCHEME drives the look.
    // Persist "custom" for any non-"custom" (legacy/absent) value so the boot script +
    // selectScheme fallback stay consistent. No legacy AIPM/mockup scheme-activation:
    // those are now importable theme files, not built-ins.
    const stored = localStorage.getItem(STYLE_STORAGE_KEY);
    if (stored !== "custom") {
      try {
        localStorage.setItem(STYLE_STORAGE_KEY, "custom");
      } catch {
        /* private mode / quota */
      }
    }
    return "custom";
  });

  useEffect(() => {
    // Phase 2: the style axis is always "custom"; the active SCHEME drives the look.
    document.documentElement.setAttribute("data-style", "custom");
    // Apply the active scheme for the current theme (custom) or clear it (else).
    syncScheme(style);
    // aipm-cockpit-theme-change: ThemeProvider flipped .dark → re-resolve the light/dark map.
    const onThemeChange = () => syncScheme(style);
    // aipm-cockpit-scheme-change: the active scheme switched → refresh data-scheme-dark +
    // colors FIRST, THEN ask ThemeProvider to recompute .dark by dispatching
    // aipm-cockpit-style-change. ★★ This ordering is what makes correctness independent of
    // cross-component listener registration order: ThemeProvider reacts only to
    // aipm-cockpit-style-change, which we dispatch AFTER syncScheme has already stamped the
    // fresh data-scheme-dark, so apply() can never read a stale value. (A prior fix
    // had both providers listen to aipm-cockpit-scheme-change and relied on child-before-parent
    // registration order, which inverts once CiStyleProvider re-runs its effect.)
    const onSchemeChange = () => {
      syncScheme(style);
      window.dispatchEvent(new Event("aipm-cockpit-style-change"));
    };
    window.addEventListener("aipm-cockpit-theme-change", onThemeChange);
    window.addEventListener("aipm-cockpit-scheme-change", onSchemeChange);
    // .dark is owned solely by ThemeProvider; notify it to re-apply for the new style.
    window.dispatchEvent(new Event("aipm-cockpit-style-change"));
    return () => {
      window.removeEventListener("aipm-cockpit-theme-change", onThemeChange);
      window.removeEventListener("aipm-cockpit-scheme-change", onSchemeChange);
    };
  }, [style]);

  const setStyle = useCallback((next: CiStyle) => {
    setStyleState(next);
    try { localStorage.setItem(STYLE_STORAGE_KEY, next); } catch { /* private mode / quota */ }
  }, []);

  return <CiStyleContext.Provider value={{ style, setStyle }}>{children}</CiStyleContext.Provider>;
}
