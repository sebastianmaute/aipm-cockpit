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
/** Keeps only entries whose value is a usable width.
 *
 *  ★★ The stored payload is UNTRUSTED, and a non-numeric value now costs more
 *  than it used to. It reaches `colWidthStyle`, which emits it as an inline
 *  `width`; the browser discards the invalid value and that column falls back to
 *  AUTO — a SECOND auto column, which defeats the single-flex-column invariant
 *  the Open Points geometry depends on and puts the surplus back to being split.
 *  It also poisons `tableMinWidthPx`, whose running sum turns into a string.
 *  Neither is visible in jsdom. The pre-v2 hook spread the payload verbatim too,
 *  so this is hardening rather than a regression fix. */
function usableWidths<TId extends string>(obj: object): Partial<Record<TId, number>> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out as Partial<Record<TId, number>>;
}

function readSized<TId extends string>(storageKey: string): Partial<Record<TId, number>> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const v2 = parsed as { v?: unknown; widths?: unknown };
    if (v2.v === 2) {
      const w = v2.widths;
      if (w && typeof w === "object" && !Array.isArray(w)) return usableWidths<TId>(w);
      return {};
    }
    if (v2.v !== undefined) return {};
    return usableWidths<TId>(parsed);
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
    // ★★ Seed from the RENDERED width, not the declared one. A column absent from
    //    `sizedWidths` can render far wider than its default: Open Points' flex
    //    column is AUTO and routinely 2-4x its 200px default. Seeding from the
    //    default made the first mousemove write `max(40, 200 + delta)`, so the
    //    column SNAPPED narrow and only then tracked the pointer — on the one
    //    column this release makes flexible. The grip is absolutely positioned
    //    inside its <th>, so that element's box is the rendered column width.
    // ★★ THIS CHANGES THE SEED FOR EVERY TABLE, not just Open Points, and the
    //    criterion is *rendered == declared* — NOT "has an auto column".
    //    `tableLayout: "fixed"` appears EXACTLY ONCE in the app (tasks-section);
    //    all 37 other call sites are `table-layout: auto`, where `SortResizeTh`
    //    emits width + minWidth as a HINT the browser routinely exceeds. So they
    //    take the measured path too, in a real browser. Believed to REMOVE a
    //    latent jump there rather than add one — but that is reasoned, not
    //    verified, and jsdom cannot check it (every rect is 0).
    // ★ The fallback's only live consumer today is jsdom: every grip reaches
    //   here through `ColumnResizeHandle` → `DragHandle`, always inside a <th>.
    //   It is kept as defence for a future non-<th> host. (Gantt's name-column
    //   grip is NOT one — gantt has its own handler seeded from its own state
    //   and never calls this hook, which is correct there because its host div's
    //   declared width IS its rendered width.)
    const measured = (e.currentTarget as HTMLElement | null)
      ?.closest("th")
      ?.getBoundingClientRect().width ?? 0;
    dragRef.current = {
      col,
      startX: e.clientX,
      startW: measured > 0
        ? Math.round(measured)
        : (colWidthsRef.current[col] ?? defaults[col] ?? 80),
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
