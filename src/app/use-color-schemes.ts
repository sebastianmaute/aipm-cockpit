"use client";
// React glue over the color-scheme store: loads + reconciles the built-ins,
// and drives selection. The actual inline-token APPLY lives in use-style's
// syncScheme (the single source of truth) — this hook only persists the active
// id + style and fires the events that re-run syncScheme. Coverage-excluded UI
// glue (see vitest.config.ts).
import { useCallback, useEffect, useState } from "react";
import { loadSchemes, saveSchemes, setActive as persistActive, type SchemeStore } from "./color-schemes";
import { loadSchemesAsync } from "./color-schemes-store";
import { activeSchemeOf, reconcileBuiltins } from "./builtin-schemes";
import type { TursoConfig } from "./turso-config";

const SCHEME_CHANGE_EVENT = "lop-scheme-change";

export interface UseColorSchemesArgs {
  config: TursoConfig | null;
}
export interface UseColorSchemes {
  store: SchemeStore;
  activeSupportsDark: boolean;
  refresh: () => void;
  /** Select a scheme by id (built-in or user) → style custom + apply. */
  selectScheme: (id: string) => void;
}

export function useColorSchemes({ config }: UseColorSchemesArgs): UseColorSchemes {
  const [store, setStore] = useState<SchemeStore>(() => reconcileBuiltins(loadSchemes()));

  const refresh = useCallback(() => setStore(reconcileBuiltins(loadSchemes())), []);

  // DB refresh: when Turso is configured, pull the cross-device user library,
  // mirror it into the sync cache (preserving activeId), and re-render. Migration
  // (local→DB when DB empty) is handled inside loadSchemesAsync.
  const dbKey = config ? `${config.httpUrl}|${config.authToken}` : null;
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    void loadSchemesAsync(config).then((userSchemes) => {
      if (cancelled) return;
      const cur = loadSchemes();
      const merged = { schemes: [...userSchemes], activeId: cur.activeId };
      saveSchemes(merged);
      setStore(reconcileBuiltins(merged));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbKey]);

  const selectScheme = useCallback((id: string) => {
    setStore(reconcileBuiltins(persistActive(id)));
    // The style axis is always "custom" (Phase 2), so the style effect never
    // re-fires on selection — nudge syncScheme directly via the scheme-change event.
    window.dispatchEvent(new Event(SCHEME_CHANGE_EVENT));
  }, []);

  return { store, activeSupportsDark: activeSchemeOf(store).supportsDark, refresh, selectScheme };
}
