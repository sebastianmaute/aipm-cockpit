"use client";

import { type Lang } from "./i18n";
import { usePanelFilters } from "./panel-filters-context";
import { usePanelViews } from "./use-panel-views";
import type { PanelViewKind } from "./panel-views";
import { SavedViewsMenu } from "./saved-views-menu";
import { useSettings } from "./use-settings";

interface PanelViewsControlProps {
  lang: Lang;
  view: PanelViewKind;
  onApply?: () => void;
}

export function PanelViewsControl({ lang, view, onApply }: PanelViewsControlProps) {
  const { settings } = useSettings();
  const pf = usePanelFilters();
  const { views, addView, removeView } = usePanelViews(view);

  // Global "Show saved views" opt-out (Settings → Appearance) hides the control.
  if (settings.showSavedViews === false) return null;

  return (
    <SavedViewsMenu
      lang={lang}
      views={views}
      onApplyView={(id) => {
        const v = views.find((x) => x.id === id);
        if (v) {
          pf.applyState(v.state);
          onApply?.();
        }
      }}
      onSaveView={(n) =>
        addView(n, {
          search: pf.search,
          filters: { ...pf.filters },
          sort: pf.sort,
          hiddenCols: [...(pf.hiddenCols ?? [])],
        })
      }
      onDeleteView={(id) => removeView(id)}
    />
  );
}
