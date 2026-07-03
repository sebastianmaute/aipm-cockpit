"use client";

import { type Lang } from "./i18n";
import { useReportsViews } from "./use-reports-views";
import { type ReportsViewState } from "./reports-views";
import { SavedViewsMenu } from "./saved-views-menu";

interface ReportsViewsControlProps {
  lang: Lang;
  currentState: ReportsViewState;
  onApply: (state: ReportsViewState) => void;
}

export function ReportsViewsControl({ lang, currentState, onApply }: ReportsViewsControlProps) {
  const { views, addView, removeView } = useReportsViews();

  return (
    <SavedViewsMenu
      lang={lang}
      views={views}
      onApplyView={(id) => {
        const v = views.find((x) => x.id === id);
        if (v) onApply(v.state);
      }}
      onSaveView={(n) => addView(n, currentState)}
      onDeleteView={(id) => removeView(id)}
    />
  );
}
