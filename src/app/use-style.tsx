"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { type CiStyle, STYLE_STORAGE_KEY } from "./style-ci";
import {
  applySchemeColors,
  applySchemeStructural,
  writeActiveSchemeColors,
  writeActiveSchemeStructural,
  writeSchemeSupportsDark,
} from "./scheme-apply";
import { loadSchemes, setActive } from "./color-schemes";
import {
  activeSchemeOf,
  reconcileBuiltins,
  resolveActiveScheme,
  resolveActiveStructural,
} from "./builtin-schemes";
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
  const resolved = resolveSchemeColors(resolveActiveScheme(store, supportsDark && currentDark()));
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
    // Phase 2: AIPM + Mockup are now built-in SCHEMES (ids "AIPM"/"mockup"), and the
    // style axis collapses to the constant "custom". Migrate a legacy device style
    // ONCE — activate the matching built-in scheme (so it survives reload) — and
    // for ANY non-"custom" value (legacy OR absent/fresh) persist lop-style="custom".
    // A fresh user MUST get lop-style written so the boot script and the dead
    // selectScheme fallback stay consistent; a legacy user also activates the scheme
    // first. Idempotent: an already-"custom" user keeps their existing activeId and
    // the write is a harmless no-op. This runs in the lazy initializer (before the
    // first syncScheme) so the migrated scheme paints immediately, without a
    // set-state-in-effect.
    const stored = localStorage.getItem(STYLE_STORAGE_KEY);
    if (stored === "AIPM" || stored === "mockup") setActive(stored);
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
    // lop-theme-change: ThemeProvider flipped .dark → re-resolve the light/dark map.
    const onThemeChange = () => syncScheme(style);
    // lop-scheme-change: the active scheme switched → refresh data-scheme-dark +
    // colors FIRST, THEN ask ThemeProvider to recompute .dark by dispatching
    // lop-style-change. ★★ This ordering is what makes correctness independent of
    // cross-component listener registration order: ThemeProvider reacts only to
    // lop-style-change, which we dispatch AFTER syncScheme has already stamped the
    // fresh data-scheme-dark, so apply() can never read a stale value. (A prior fix
    // had both providers listen to lop-scheme-change and relied on child-before-parent
    // registration order, which inverts once CiStyleProvider re-runs its effect.)
    const onSchemeChange = () => {
      syncScheme(style);
      window.dispatchEvent(new Event("lop-style-change"));
    };
    window.addEventListener("lop-theme-change", onThemeChange);
    window.addEventListener("lop-scheme-change", onSchemeChange);
    // .dark is owned solely by ThemeProvider; notify it to re-apply for the new style.
    window.dispatchEvent(new Event("lop-style-change"));
    return () => {
      window.removeEventListener("lop-theme-change", onThemeChange);
      window.removeEventListener("lop-scheme-change", onSchemeChange);
    };
  }, [style]);

  const setStyle = useCallback((next: CiStyle) => {
    setStyleState(next);
    try { localStorage.setItem(STYLE_STORAGE_KEY, next); } catch { /* private mode / quota */ }
  }, []);

  return <CiStyleContext.Provider value={{ style, setStyle }}>{children}</CiStyleContext.Provider>;
}
