"use client";

import { useCallback, useState } from "react";
import { allVisibleSelected, toggleAllInSet, toggleInSet } from "./row-selection";

export interface RowSelection {
  selectedIds: ReadonlySet<number>;
  count: number;
  isSelected: (id: number) => boolean;
  toggle: (id: number) => void;
  /** Select-all-visible toggle (filter-aware — see toggleAllInSet). */
  toggleAllVisible: (visibleIds: readonly number[]) => void;
  /** Whether every visible id is currently selected (header checkbox state). */
  allSelected: (visibleIds: readonly number[]) => boolean;
  clear: () => void;
}

/** Multi-row selection state for an entity panel's bulk-edit feature. Scoped to
 *  the panel's mount (cleared on remount, like the panel-filters context), so a
 *  view switch drops the selection. Pure set ops live in row-selection.ts. */
export function useRowSelection(): RowSelection {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = useCallback((id: number) => setSelectedIds((s) => toggleInSet(s, id)), []);
  const toggleAllVisible = useCallback(
    (visibleIds: readonly number[]) => setSelectedIds((s) => toggleAllInSet(s, visibleIds)),
    [],
  );
  const clear = useCallback(() => setSelectedIds(new Set()), []);
  const isSelected = useCallback((id: number) => selectedIds.has(id), [selectedIds]);
  const allSelected = useCallback(
    (visibleIds: readonly number[]) => allVisibleSelected(selectedIds, visibleIds),
    [selectedIds],
  );
  return { selectedIds, count: selectedIds.size, isSelected, toggle, toggleAllVisible, allSelected, clear };
}
