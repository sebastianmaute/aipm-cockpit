import { useCallback, useEffect, useState } from "react";

import {
  type SavedView,
  type SavedViewPayload,
  addSavedView,
  loadSavedViews,
  removeSavedView,
  renameSavedView,
  saveSavedViews,
} from "./saved-views";

export function useSavedViews(): {
  views: SavedView[];
  addView: (name: string, payload: SavedViewPayload) => void;
  removeView: (id: number) => void;
  renameView: (id: number, name: string) => void;
} {
  const [views, setViews] = useState<SavedView[]>(() => loadSavedViews());

  useEffect(() => {
    saveSavedViews(views);
  }, [views]);

  const addView = useCallback((name: string, payload: SavedViewPayload) => {
    setViews((prev) => addSavedView(prev, name, payload));
  }, []);

  const removeView = useCallback((id: number) => {
    setViews((prev) => removeSavedView(prev, id));
  }, []);

  const renameView = useCallback((id: number, name: string) => {
    setViews((prev) => renameSavedView(prev, id, name));
  }, []);

  return { views, addView, removeView, renameView };
}
