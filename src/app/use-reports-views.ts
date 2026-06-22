import { useCallback, useEffect, useState } from "react";

import {
  type ReportsSavedView,
  type ReportsViewState,
  addReportsView,
  loadReportsViews,
  removeReportsView,
  saveReportsViews,
} from "./reports-views";

export function useReportsViews(): {
  views: ReportsSavedView[];
  addView: (name: string, state: ReportsViewState) => void;
  removeView: (id: number) => void;
} {
  const [list, setList] = useState<ReportsSavedView[]>(() => loadReportsViews());

  useEffect(() => {
    saveReportsViews(list);
  }, [list]);

  const addView = useCallback(
    (name: string, state: ReportsViewState) => setList((prev) => addReportsView(prev, name, state)),
    [],
  );
  const removeView = useCallback((id: number) => setList((prev) => removeReportsView(prev, id)), []);

  return { views: list, addView, removeView };
}
