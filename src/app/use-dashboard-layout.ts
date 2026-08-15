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

/** The stored arrangement for `projectId`, reconciled. SSR-safe. */
function readLayout(projectId: string): DashboardLayout {
  return reconcile(typeof window === "undefined" ? null : loadLayout(projectId));
}

/**
 * Owns the Dashboard arrangement: load → reconcile → mutate → debounced persist.
 *
 * ★★ THE INITIAL READ IS A LAZY `useState`, not an effect. A `useEffect` that
 * called `setState` would violate the repo's banned `react-hooks/
 * set-state-in-effect` rule. A lazy initialiser is the one shape that satisfies
 * both that rule and the purity rule.
 *
 * ★★★ THE PROJECT ID AND THE LAYOUT ARE **ONE** STATE OBJECT, and that is the
 * whole fix for a real cross-write. `DashboardPanel` is NOT remounted on a
 * project switch (`task-manager.tsx` passes no `key` to `WorkspaceSection`,
 * `workspace-section.tsx` mounts the panel while `activeTab === "dashboard"`,
 * and `switchToProject` never resets `activeTab`), so a seeded-once `layout`
 * beside a live `projectId` prop meant the persist effect re-ran with the NEW id
 * and the OLD layout and, 400ms later, replaced the new project's stored
 * arrangement with the previous project's. Holding the pair atomically makes
 * that state unrepresentable: every write names the id the layout was loaded
 * for. The sync itself is the repo's sanctioned RENDER-TIME RECONCILE (compare
 * the prop against the last-handled value in the render body, `setState` there),
 * because `react-hooks/set-state-in-effect` is banned and fatal.
 *
 * ★★ THERE IS NO `gate` OPTION, and that is deliberate rather than an omission.
 * `reconcile` takes ONE argument because a gate decides what RENDERS, never what
 * is STORED — a gated-off tile keeps its stored position so switching Budget off
 * and on again does not lose it. The render layer filters (`dashboard-panel.tsx`
 * owns one `isRenderable` predicate shared by the board and the shelf); this
 * hook does not, so a `gate` option would be unused here, and an unused option
 * is fatal at `--max-warnings=0`.
 *
 * ★ Popout is read-only — it never persists. `use-landing-delta` shares that
 * `isPopout` guard and NOTHING ELSE: its persist effect has `[]` deps, so on a
 * project switch it goes STALE (never re-runs, writes the mount-time project
 * once) rather than cross-writing. Do not read one as a model for the other.
 */
export function useDashboardLayout({
  projectId,
  isPopout = false,
}: {
  projectId: string;
  isPopout?: boolean;
}): DashboardLayoutApi {
  // ★★ `dirty` IS STATE, NOT A REF, and it lives INSIDE this object rather than
  // beside it. It gates the FIRST persist run: without it, merely mounting would
  // write the reconciled default back over storage for a project the user never
  // touched. It must also RESET on a switch, or the new project looks dirty the
  // moment it loads — and `dirty.current = false` in the render body is a FATAL
  // `react-hooks/refs` error ("Cannot update ref during render"), caught by the
  // gate, not by review. Carried in the same object the reset is structural: a
  // new project gets a new object whose `dirty` is false, and there is no way to
  // swap one of the three without the other two.
  const [state, setState] = useState<{ projectId: string; layout: DashboardLayout; dirty: boolean }>(
    () => ({ projectId, layout: readLayout(projectId), dirty: false }),
  );

  // Render-time reconcile — NOT an effect (`set-state-in-effect` is banned).
  if (state.projectId !== projectId) {
    setState({ projectId, layout: readLayout(projectId), dirty: false });
  }

  // Hoisted to locals: `react-hooks/exhaustive-deps` rejects an `obj.member` dep.
  const activeProjectId = state.projectId;
  const activeLayout = state.layout;
  const activeDirty = state.dirty;

  // ★★ THE PENDING WRITE IS HELD WITH ITS OWN `projectId`, so a flush can never
  // land on the wrong project no matter when it fires.
  const pending = useRef<{ projectId: string; layout: DashboardLayout } | null>(null);
  const flush = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    saveLayout(p.projectId, p.layout);
  }, []);

  // Persist on change, debounced. A side effect only — no setState here.
  useEffect(() => {
    if (isPopout || !activeDirty) return;
    pending.current = { projectId: activeProjectId, layout: activeLayout };
    const id = window.setTimeout(flush, LAYOUT_PERSIST_MS);
    return () => window.clearTimeout(id);
  }, [activeProjectId, activeLayout, activeDirty, isPopout, flush]);

  // ★★ FLUSH ON UNMOUNT **AND** ON A PROJECT SWITCH. `DashboardPanel` is
  // conditionally mounted, so navigating away inside the debounce window used to
  // discard the write silently. It must be its OWN effect: putting the flush in
  // the debounce effect's cleanup would fire on every `activeLayout` change and
  // so write once per drag frame — the exact thing the debounce exists to avoid.
  // Declaration order matters: cleanups run top-down, so the timer above is
  // cleared before this runs, and `flush` nulls `pending` so a timer that
  // already fired cannot double-write.
  useEffect(() => flush, [activeProjectId, flush]);

  const mutate = useCallback((fn: (l: DashboardLayout) => DashboardLayout) => {
    setState((prev) => {
      const next = fn(prev.layout);
      if (next === prev.layout) return prev;
      return { projectId: prev.projectId, layout: next, dirty: true };
    });
  }, []);

  return {
    layout: activeLayout,
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
