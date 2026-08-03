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
 *  is deliberate: it preserves widths rather than silently discarding them.
 *
 *  ★★ BUT DO NOT READ "v1 blob" AS "the user's drags". The pre-v2 persist effect
 *  had no first-run guard, so it fired ~250ms after MOUNT and wrote the whole
 *  MERGED map. Any table a user has simply LOOKED AT therefore holds a full
 *  defaults snapshot, and this function promotes every key of it to user-set.
 *  Consequence: for an existing user the v2 benefit ("a DEFAULT change now
 *  reaches them") does NOT apply to a table carrying a v1 blob — only to fresh
 *  installs, to anyone who clicks reset, and to a table whose id was bumped
 *  (which is exactly why Open Points moved to `open-points-v2`). Dropping v1
 *  keys whose value already equals the default would recover it; that is a
 *  behaviour change for the 37 other tables (37 call sites across 17 files — count
 *  invocations, not files) and is deliberately NOT done here.
 *
 *  ★ An unrecognised VERSION reads as "no user widths" rather than falling
 *  through to the v1 branch — otherwise a future `{v:3,widths:{…}}` would be
 *  spread verbatim, putting a numeric `v` and an OBJECT-valued `widths` into a
 *  `Record<TId, number>` and on into `colWidths`. Safe only by accident today
 *  (no column is named `v` or `widths`). */
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
    if (v2.v !== undefined) return {};
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
