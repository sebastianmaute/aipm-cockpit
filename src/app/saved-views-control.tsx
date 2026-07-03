"use client";

import type React from "react";

import { type Lang } from "./i18n";
import { useFilters } from "./filters-context";
import { useSavedViews } from "./use-saved-views";
import { type SavedView, type SavedViewPayload } from "./saved-views";
import { SavedViewsMenu } from "./saved-views-menu";

interface SavedViewsControlProps {
  lang: Lang;
  hiddenCols: Set<string>;
  setHiddenCols: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function SavedViewsControl({ lang, hiddenCols, setHiddenCols }: SavedViewsControlProps) {
  const f = useFilters();
  const { views, addView, removeView } = useSavedViews();

  function capturePayload(): SavedViewPayload {
    return {
      search: f.search,
      priorityFilter: f.priorityFilter,
      assigneeFilter: f.assigneeFilter,
      groupFilter: f.groupFilter,
      labelFilter: f.labelFilter,
      sortKey: f.sortKey,
      sortDir: f.sortDir,
      hiddenCols: [...hiddenCols],
    };
  }

  function applyView(v: SavedView) {
    f.setSearchImmediate(v.payload.search);
    f.setPriorityFilter(v.payload.priorityFilter);
    f.setAssigneeFilter(v.payload.assigneeFilter);
    f.setGroupFilter(v.payload.groupFilter);
    f.setLabelFilter(v.payload.labelFilter);
    f.setSortKey(v.payload.sortKey);
    f.setSortDir(v.payload.sortDir);
    f.setRaidFilterTaskId(null);
    setHiddenCols(new Set(v.payload.hiddenCols));
  }

  return (
    <SavedViewsMenu
      lang={lang}
      views={views}
      onApplyView={(id) => {
        const v = views.find((x) => x.id === id);
        if (v) applyView(v);
      }}
      onSaveView={(n) => addView(n, capturePayload())}
      onDeleteView={(id) => removeView(id)}
    />
  );
}
