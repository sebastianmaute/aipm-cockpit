"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_LAYOUT, hideTile, moveTile, reconcile, resizeTile, restoreTile,
  type DashboardLayout,
} from "./dashboard-layout";
import { loadLayout, saveLayout } from "./dashboard-layout-store";
import type { DashboardTileId } from "./dashboard-tiles";

/** Debounce before writing to localStorage, so a drag that reflows repeatedly
 *  does not write on every frame. */
export const LAYOUT_PERSIST_MS = 400;

export interface DashboardLayoutApi {
  layout: DashboardLayout;
  move: (dragId: DashboardTileId, targetId: DashboardTileId) => void;
  hide: (id: DashboardTileId) => void;
  restore: (id: DashboardTileId, index?: number) => void;
  resize: (id: DashboardTileId, axis: "w" | "h", value: number) => void;
  reset: () => void;
  /** Arrangement is read-only here (popout). Render no grips, menus or shelf. */
  readOnly: boolean;
}

/**
 * Owns the Dashboard arrangement: load → reconcile → mutate → debounced persist.
 *
 * ★★ THE INITIAL READ IS A LAZY `useState`, not an effect. A `useEffect` that
 * called `setState` would violate the repo's banned `react-hooks/
 * set-state-in-effect` rule, and reading localStorage in the render body would
 * violate the purity rule. A lazy initialiser is the one shape that satisfies
 * both.
 *
 * ★★ THERE IS NO `gate` OPTION, and that is deliberate rather than an omission.
 * `reconcile` takes ONE argument because a gate decides what RENDERS, never what
 * is STORED — a gated-off tile keeps its stored position so switching Budget off
 * and on again does not lose it. The render layer filters (`dashboard-panel.tsx`
 * tests each placed tile's own gate; the equivalent `liveTiles` helper is
 * exported but uncalled); this hook does not, so a `gate` option would be unused
 * here, and an unused option
 * is fatal at `--max-warnings=0`.
 *
 * ★ Popout is read-only — it never persists, mirroring `use-landing-delta`.
 */
export function useDashboardLayout({
  projectId,
  isPopout = false,
}: {
  projectId: string;
  isPopout?: boolean;
}): DashboardLayoutApi {
  const [layout, setLayout] = useState<DashboardLayout>(() =>
    reconcile(typeof window === "undefined" ? null : loadLayout(projectId)),
  );

  // Persist on change, debounced. A side effect only — no setState here.
  // ★ `dirty` gates the FIRST run: without it, merely mounting would write the
  // reconciled default back over storage for a project the user never touched.
  const dirty = useRef(false);
  useEffect(() => {
    if (isPopout || !dirty.current) return;
    const id = window.setTimeout(() => { saveLayout(projectId, layout); }, LAYOUT_PERSIST_MS);
    return () => window.clearTimeout(id);
  }, [layout, projectId, isPopout]);

  const mutate = useCallback((fn: (l: DashboardLayout) => DashboardLayout) => {
    setLayout((prev) => {
      const next = fn(prev);
      if (next !== prev) dirty.current = true;
      return next;
    });
  }, []);

  return {
    layout,
    readOnly: isPopout,
    move: useCallback(
      (dragId: DashboardTileId, targetId: DashboardTileId) => mutate((l) => moveTile(l, dragId, targetId)),
      [mutate],
    ),
    hide: useCallback((id: DashboardTileId) => mutate((l) => hideTile(l, id)), [mutate]),
    restore: useCallback(
      (id: DashboardTileId, index?: number) => mutate((l) => restoreTile(l, id, index)),
      [mutate],
    ),
    resize: useCallback(
      (id: DashboardTileId, axis: "w" | "h", value: number) => mutate((l) => resizeTile(l, id, axis, value)),
      [mutate],
    ),
    reset: useCallback(() => mutate(() => DEFAULT_LAYOUT), [mutate]),
  };
}
