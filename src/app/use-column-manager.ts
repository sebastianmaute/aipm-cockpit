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

const COL_WIDTHS_KEY = "lop-app:col-widths";
const HIDDEN_COLS_KEY = "lop-app:hidden-cols";

export const DEFAULT_COL_WIDTHS: Record<string, number> = {
  sel: 36,
  status: 36,
  id: 80,
  taskName: 200,
  assignee: 140,
  startDate: 110,
  dueDate: 110,
  lastUpdateDate: 110,
  priority: 90,
  taskStatus: 110,
  blockers: 140,
  notes: 140,
  depRelations: 120,
  estimate: 80,
  spent: 80,
  actions: 60,
};

export function useColumnManager(): {
  colWidths: Record<string, number>;
  setColWidths: Dispatch<SetStateAction<Record<string, number>>>;
  hiddenCols: Set<string>;
  setHiddenCols: Dispatch<SetStateAction<Set<string>>>;
  colConfigOpen: boolean;
  setColConfigOpen: Dispatch<SetStateAction<boolean>>;
  colConfigRef: RefObject<HTMLDivElement | null>;
  resetColWidths: () => void;
  startColResize: (col: string, e: React.MouseEvent) => void;
} {
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = window.localStorage.getItem(COL_WIDTHS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          return { ...DEFAULT_COL_WIDTHS, ...(parsed as Record<string, number>) };
      }
    } catch { /* non-fatal */ }
    return DEFAULT_COL_WIDTHS;
  });
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
  const [colConfigOpen, setColConfigOpen] = useState(false);
  const colDragRef = useRef<{ col: string; startX: number; startW: number } | null>(null);
  const colConfigRef = useRef<HTMLDivElement | null>(null);
  const colWidthsRef = useRef(colWidths);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  // Persist colWidths debounced 250 ms — column drag fires setColWidths on
  // every mousemove; without the timeout we'd write localStorage 60×/sec.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidths));
      } catch { /* non-fatal */ }
    }, 250);
    return () => clearTimeout(id);
  }, [colWidths]);

  // Persist hiddenCols on every change.
  useEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify([...hiddenCols]));
    } catch { /* non-fatal */ }
  }, [hiddenCols]);

  // Close column-config dropdown on outside click or Escape.
  useEffect(() => {
    if (!colConfigOpen) return;
    function onDown(e: MouseEvent) {
      if (colConfigRef.current && !colConfigRef.current.contains(e.target as Node))
        setColConfigOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setColConfigOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [colConfigOpen]);

  const resetColWidths = useCallback(() => {
    setColWidths(DEFAULT_COL_WIDTHS);
    try { window.localStorage.removeItem(COL_WIDTHS_KEY); } catch { /* non-fatal */ }
  }, []);

  const startColResize = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    colDragRef.current = { col, startX: e.clientX, startW: colWidthsRef.current[col] ?? 80 };
    function onMove(mv: MouseEvent) {
      if (!colDragRef.current) return;
      const { col: c, startX, startW } = colDragRef.current;
      setColWidths((prev) => ({ ...prev, [c]: Math.max(40, startW + mv.clientX - startX) }));
    }
    function onUp() {
      colDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  return {
    colWidths,
    setColWidths,
    hiddenCols,
    setHiddenCols,
    colConfigOpen,
    setColConfigOpen,
    colConfigRef,
    resetColWidths,
    startColResize,
  };
}
