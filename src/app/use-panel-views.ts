import { useCallback, useEffect, useState } from "react";

import {
  type PanelView,
  type PanelViewKind,
  type PanelFiltersState,
  addPanelView,
  loadPanelViews,
  panelViewsFor,
  removePanelView,
  savePanelViews,
} from "./panel-views";

export function usePanelViews(view: PanelViewKind): {
  views: PanelView[];
  addView: (name: string, state: PanelFiltersState) => void;
  removeView: (id: number) => void;
} {
  const [list, setList] = useState<PanelView[]>(() => loadPanelViews());

  useEffect(() => {
    savePanelViews(list);
  }, [list]);

  const addView = useCallback(
    (name: string, state: PanelFiltersState) => setList((prev) => addPanelView(prev, view, name, state)),
    [view],
  );
  const removeView = useCallback((id: number) => setList((prev) => removePanelView(prev, id)), []);

  return { views: panelViewsFor(list, view), addView, removeView };
}
