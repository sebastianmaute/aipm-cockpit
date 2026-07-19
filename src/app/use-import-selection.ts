"use client";

// Shared multi-select state for the Outlook pick-list import modals
// (contacts / calendar). Owns the checked Set plus the id-change reconcile — a
// fresh fetch (new item ids) re-seeds the default selection. `defaultChecked`
// decides which rows start ticked (default: all). Per-row extras (e.g. the
// calendar modal's absence-type map) stay in the caller; this owns selection only.

import { useMemo, useState } from "react";

export interface ImportSelection<T> {
  selectedCount: number;
  allChecked: boolean;
  isChecked: (id: string) => boolean;
  toggle: (id: string) => void;
  toggleAll: () => void;
  /** The currently-checked items, in original order. */
  selected: () => T[];
}

export function useImportSelection<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  defaultChecked?: (item: T) => boolean,
): ImportSelection<T> {
  const allIds = useMemo(() => items.map(idOf).join("|"), [items, idOf]);
  const seed = () =>
    new Set(items.filter((it) => (defaultChecked ? defaultChecked(it) : true)).map(idOf));
  const [prevIds, setPrevIds] = useState(allIds);
  const [checked, setChecked] = useState<Set<string>>(seed);
  if (prevIds !== allIds) {
    setPrevIds(allIds);
    setChecked(seed());
  }

  const allChecked = items.length > 0 && items.every((it) => checked.has(idOf(it)));

  return {
    selectedCount: checked.size,
    allChecked,
    isChecked: (id) => checked.has(id),
    toggle: (id) =>
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    toggleAll: () => setChecked(() => (allChecked ? new Set() : new Set(items.map(idOf)))),
    selected: () => items.filter((it) => checked.has(idOf(it))),
  };
}
