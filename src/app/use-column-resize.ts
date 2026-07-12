// src/app/use-column-resize.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const KEY_PREFIX = "aipm-cockpit:col-widths";

export function useColumnResize<TId extends string>(
  tableId: string,
  defaults: Readonly<Record<TId, number>>,
): {
  colWidths: Record<TId, number>;
  startColResize: (col: TId, e: React.MouseEvent) => void;
  resetColWidths: () => void;
} {
  const storageKey = `${KEY_PREFIX}:${tableId}`;
  const [colWidths, setColWidths] = useState<Record<TId, number>>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return { ...defaults, ...(parsed as Record<TId, number>) };
        }
      }
    } catch { /* non-fatal */ }
    return { ...defaults };
  });

  const dragRef = useRef<{ col: TId; startX: number; startW: number } | null>(null);
  const colWidthsRef = useRef(colWidths);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  // Debounced persist (250 ms): drag fires setColWidths on every mousemove,
  // so without the timeout we'd write localStorage ~60x/sec.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(colWidths));
      } catch { /* non-fatal */ }
    }, 250);
    return () => clearTimeout(id);
  }, [colWidths, storageKey]);

  const resetColWidths = useCallback(() => {
    setColWidths({ ...defaults });
    try { window.localStorage.removeItem(storageKey); } catch { /* non-fatal */ }
  }, [defaults, storageKey]);

  const startColResize = useCallback((col: TId, e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      col,
      startX: e.clientX,
      startW: colWidthsRef.current[col] ?? defaults[col] ?? 80,
    };
    function onMove(mv: MouseEvent) {
      if (!dragRef.current) return;
      const { col: c, startX, startW } = dragRef.current;
      setColWidths((prev) => ({
        ...prev,
        [c]: Math.max(40, startW + mv.clientX - startX),
      }));
    }
    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [defaults]);

  return { colWidths, startColResize, resetColWidths };
}
