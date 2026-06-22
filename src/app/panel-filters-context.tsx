"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { PanelFiltersState, PanelSort } from "./panel-views";

interface PanelFiltersValue extends PanelFiltersState {
  setSearch: (s: string) => void;
  setFilter: (key: string, value: string) => void;
  setSort: (sort: PanelSort) => void;
  applyState: (state: PanelFiltersState) => void;
  reset: () => void;
}

const Ctx = createContext<PanelFiltersValue | null>(null);

export function PanelFiltersProvider({
  defaults,
  children,
}: {
  defaults: PanelFiltersState;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<PanelFiltersState>(defaults);

  const setSearch = useCallback((search: string) => setState((s) => ({ ...s, search })), []);
  const setFilter = useCallback(
    (key: string, value: string) => setState((s) => ({ ...s, filters: { ...s.filters, [key]: value } })),
    [],
  );
  const setSort = useCallback((sort: PanelSort) => setState((s) => ({ ...s, sort })), []);
  const applyState = useCallback((next: PanelFiltersState) => setState(next), []);
  const reset = useCallback(() => setState(defaults), [defaults]);

  const value = useMemo<PanelFiltersValue>(
    () => ({ ...state, setSearch, setFilter, setSort, applyState, reset }),
    [state, setSearch, setFilter, setSort, applyState, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePanelFilters(): PanelFiltersValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePanelFilters must be used within PanelFiltersProvider");
  return v;
}
