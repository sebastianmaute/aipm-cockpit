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
/** Columns hidden on a fresh install. */
const DEFAULT_HIDDEN = ["estimate", "spent", "createdDate"] as const;
/** Columns introduced in v2. A stored v1 payload (a bare array) predates them,
 *  so they are unioned in ONCE — the `v` marker is what stops the union from
 *  re-hiding a column the user has since chosen to show. */
const NEW_HIDDEN_IN_V2 = ["createdDate"] as const;

export const DEFAULT_COL_WIDTHS: Record<string, number> = {
  // ★ These are DECLARED widths, and under `table-layout: fixed` every column
  //   that declares one keeps it — the leftover all goes to `taskName`, the one
  //   auto column (see open-points-table-geometry.ts). So a utility column is
  //   tuned to what it actually holds rather than padded to absorb slack.
  sel: 36, // a 16px checkbox plus its tap padding
  status: 28, // holds a single ~10px RAG dot
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
  depRelations: 96, // an em-dash, or a short chip plus a pencil
  estimate: 80,
  spent: 80,
  actions: 32, // one ⋮ icon button
};

/** Open Points table column state. The width/drag/reset concern delegates to the
 *  shared `useColumnResize` (tableId "open-points-v2"); this hook adds the
 *  hidden-columns set and the column-config dropdown's open state + outside-click
 *  dismiss (via the shared `usePopoverDismiss`).
 *
 *  ★★ WHY THE ID WAS BUMPED off "open-points" rather than migrated. The old blob
 *  cannot distinguish a width the user DRAGGED from one that is merely the
 *  default: the pre-v2 persist effect had no first-run guard, so it wrote the
 *  whole MERGED map ~250ms after MOUNT. Nearly every existing blob is therefore a
 *  full defaults snapshot, and `readSized` promotes every key of it to user-set.
 *  Migrating it would carry the OLD fat widths forward and make the retune above
 *  a no-op for exactly the users who see the wasted space. The cost is losing
 *  genuine drags for this one table; "reset columns" is unaffected. */
export function useColumnManager(): {
  colWidths: Record<string, number>;
  /** ONLY the columns the user explicitly sized. The pane needs these, not the
   *  defaults-filled map — an absent key is what lets `taskName` render with no
   *  declared width and so absorb the table's leftover. */
  sizedWidths: Partial<Record<string, number>>;
  hiddenCols: Set<string>;
  setHiddenCols: Dispatch<SetStateAction<Set<string>>>;
  colConfigOpen: boolean;
  setColConfigOpen: Dispatch<SetStateAction<boolean>>;
  colConfigRef: RefObject<HTMLDivElement | null>;
  resetColWidths: () => void;
  startColResize: (col: string, e: React.MouseEvent) => void;
} {
  const { colWidths, sizedWidths, startColResize, resetColWidths } = useColumnResize<string>(
    "open-points-v2",
    DEFAULT_COL_WIDTHS,
  );

  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(HIDDEN_COLS_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        // v1: a bare array, written before NEW_HIDDEN_IN_V2 existed.
        if (Array.isArray(parsed)) {
          return new Set([...(parsed as string[]), ...NEW_HIDDEN_IN_V2]);
        }
        // v2: { v, hidden } — honoured verbatim.
        if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { hidden?: unknown }).hidden)
        ) {
          return new Set((parsed as { hidden: string[] }).hidden);
        }
      }
    } catch { /* non-fatal */ }
    return new Set<string>(DEFAULT_HIDDEN);
  });

  // Persist hiddenCols on every change, always in the v2 shape.
  useEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify({ v: 2, hidden: [...hiddenCols] }));
    } catch { /* non-fatal */ }
  }, [hiddenCols]);

  const [colConfigOpen, setColConfigOpen] = useState(false);
  const colConfigRef = useRef<HTMLDivElement | null>(null);
  const closeColConfig = useCallback(() => setColConfigOpen(false), []);
  usePopoverDismiss(colConfigOpen, colConfigRef, closeColConfig);

  return {
    colWidths,
    sizedWidths,
    hiddenCols,
    setHiddenCols,
    colConfigOpen,
    setColConfigOpen,
    colConfigRef,
    resetColWidths,
    startColResize,
  };
}
