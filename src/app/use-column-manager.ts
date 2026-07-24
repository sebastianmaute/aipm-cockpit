// src/app/use-column-manager.ts
"use client";

import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useColumnResize } from "./use-column-resize";
import { usePopoverDismiss } from "./use-popover-dismiss";

const HIDDEN_COLS_KEY = "aipm-cockpit:hidden-cols";

export const DEFAULT_COL_WIDTHS: Record<string, number> = {
  sel: 36,
  status: 36,
  id: 80,
  taskName: 200,
  assignee: 140,
  startDate: 110,
  dueDate: 110,
  lastUpdateDate: 110,
  createdDate: 110,
  priority: 90,
  taskStatus: 110,
  blockers: 140,
  description: 140,
  notesLog: 80,
  depRelations: 120,
  estimate: 80,
  spent: 80,
  actions: 60,
};

/** Open Points table column state. The width/drag/reset concern delegates to the
 *  shared `useColumnResize` (tableId "open-points"); this hook adds the
 *  hidden-columns set and the column-config dropdown's open state + outside-click
 *  dismiss (via the shared `usePopoverDismiss`). */
export function useColumnManager(): {
  colWidths: Record<string, number>;
  hiddenCols: Set<string>;
  setHiddenCols: Dispatch<SetStateAction<Set<string>>>;
  colConfigOpen: boolean;
  setColConfigOpen: Dispatch<SetStateAction<boolean>>;
  colConfigRef: RefObject<HTMLDivElement | null>;
  resetColWidths: () => void;
  startColResize: (col: string, e: React.MouseEvent) => void;
} {
  const { colWidths, startColResize, resetColWidths } = useColumnResize<string>(
    "open-points",
    DEFAULT_COL_WIDTHS,
  );

  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(HIDDEN_COLS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return new Set(parsed as string[]);
      }
    } catch { /* non-fatal */ }
    return new Set<string>(["estimate", "spent"]);
  });

  // Persist hiddenCols on every change.
  useEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify([...hiddenCols]));
    } catch { /* non-fatal */ }
  }, [hiddenCols]);

  const [colConfigOpen, setColConfigOpen] = useState(false);
  const colConfigRef = useRef<HTMLDivElement | null>(null);
  const closeColConfig = useCallback(() => setColConfigOpen(false), []);
  usePopoverDismiss(colConfigOpen, colConfigRef, closeColConfig);

  return {
    colWidths,
    hiddenCols,
    setHiddenCols,
    colConfigOpen,
    setColConfigOpen,
    colConfigRef,
    resetColWidths,
    startColResize,
  };
}
