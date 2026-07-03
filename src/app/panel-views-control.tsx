"use client";

import { type Lang } from "./i18n";
import { usePanelFilters } from "./panel-filters-context";
import { usePanelViews } from "./use-panel-views";
import type { PanelViewKind } from "./panel-views";
import { SavedViewsMenu } from "./saved-views-menu";

interface PanelViewsControlProps {
  lang: Lang;
  view: PanelViewKind;
  onApply?: () => void;
}

export function PanelViewsControl({ lang, view, onApply }: PanelViewsControlProps) {
  const pf = usePanelFilters();
  const { views, addView, removeView } = usePanelViews(view);

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
