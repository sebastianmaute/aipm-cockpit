"use client";
// React glue over the color-scheme store: loads + reconciles the built-ins,
// and drives selection. The actual inline-token APPLY lives in use-style's
// syncScheme (the single source of truth) — this hook only persists the active
// id + style and fires the events that re-run syncScheme. Coverage-excluded UI
// glue (see vitest.config.ts).
import { useCallback, useState } from "react";
import { loadSchemes, setActive as persistActive, type SchemeStore } from "./color-schemes";
import { activeSchemeOf, reconcileBuiltins } from "./builtin-schemes";
import { useCiStyle } from "./use-style";

const SCHEME_CHANGE_EVENT = "lop-scheme-change";

export interface UseColorSchemes {
  store: SchemeStore;
  activeSupportsDark: boolean;
  refresh: () => void;
  /** Select a scheme by id (built-in or user) → style custom + apply. */
  selectScheme: (id: string) => void;
}

export function useColorSchemes(): UseColorSchemes {
  const { style, setStyle } = useCiStyle();
  const [store, setStore] = useState<SchemeStore>(() => reconcileBuiltins(loadSchemes()));

  const refresh = useCallback(() => setStore(reconcileBuiltins(loadSchemes())), []);

  const selectScheme = useCallback(
    (id: string) => {
      setStore(reconcileBuiltins(persistActive(id)));
      if (style === "custom") {
        // Already custom → style effect won't re-fire; nudge syncScheme directly.
        window.dispatchEvent(new Event(SCHEME_CHANGE_EVENT));
      } else {
        // Switch to custom → the style effect resolves + applies the scheme.
        setStyle("custom");
      }
    },
    [style, setStyle],
  );

  return { store, activeSupportsDark: activeSchemeOf(store).supportsDark, refresh, selectScheme };
}
