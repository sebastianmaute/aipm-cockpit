// src/app/use-column-resize.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const KEY_PREFIX = "aipm-cockpit:col-widths";

/** Reads the stored payload as the raw USER-SET map.
 *
 *  v2 is `{ v: 2, widths }` where `widths` holds only columns the user actually
 *  dragged — so a later change to a DEFAULT still reaches them. v1 is a bare
 *  object written when the hook persisted the whole merged map; it cannot tell
 *  dragged from default, so every key in it counts as user-set. That direction
 *  is deliberate: it preserves widths rather than silently discarding them. */
function readSized<TId extends string>(storageKey: string): Partial<Record<TId, number>> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const v2 = parsed as { v?: unknown; widths?: unknown };
    if (v2.v === 2) {
      const w = v2.widths;
      if (w && typeof w === "object" && !Array.isArray(w)) return { ...(w as Partial<Record<TId, number>>) };
      return {};
    }
    return { ...(parsed as Partial<Record<TId, number>>) };
  } catch {
    return {};
  }
}

export function useColumnResize<TId extends string>(
  tableId: string,
  defaults: Readonly<Record<TId, number>>,
): {
  /** Every column, defaults filled in. The long-standing public contract. */
  colWidths: Record<TId, number>;
  /** ONLY the columns the user explicitly sized. A key absent here is at its
   *  default, which is what lets a consumer emit no width at all for it. */
  sizedWidths: Partial<Record<TId, number>>;
  startColResize: (col: TId, e: React.MouseEvent) => void;
  resetColWidths: () => void;
} {
  const storageKey = `${KEY_PREFIX}:${tableId}`;
  const [sizedWidths, setSizedWidths] = useState<Partial<Record<TId, number>>>(() => readSized<TId>(storageKey));

  const colWidths = useMemo(
    () => ({ ...defaults, ...sizedWidths }) as Record<TId, number>,
    [defaults, sizedWidths],
  );

  const dragRef = useRef<{ col: TId; startX: number; startW: number } | null>(null);
  const colWidthsRef = useRef(colWidths);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  // Debounced persist (250 ms): drag fires setSizedWidths on every mousemove,
  // so without the timeout we'd write localStorage ~60x/sec.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ v: 2, widths: sizedWidths }));
      } catch { /* non-fatal */ }
    }, 250);
    return () => clearTimeout(id);
  }, [sizedWidths, storageKey]);

  const resetColWidths = useCallback(() => {
    setSizedWidths({});
    try { window.localStorage.removeItem(storageKey); } catch { /* non-fatal */ }
  }, [storageKey]);

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
      setSizedWidths((prev) => ({
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

  return { colWidths, sizedWidths, startColResize, resetColWidths };
}
