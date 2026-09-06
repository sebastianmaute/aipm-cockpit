"use client";
/**
 * The Dashboard's binding of the shared arrangement store.
 *
 * ★★ THIS FILE IS AN ADAPTER, NOT A STORE. Every landmine that used to live here
 * now lives in `arrangement-store.ts` — the not-a-`Workspace`-field rationale,
 * the `device-store.ts` split, the insertion-order recency rule, the
 * integer-like-id warning and the downgrade round-trip note. Read them there
 * before changing anything here. What stays is the Dashboard-specific binding:
 * its storage key, and the cast back down to its own id union.
 *
 * ★ The exported names are UNCHANGED on purpose — `use-dashboard-layout.ts` and
 * the Dashboard's own tests keep compiling and passing untouched. If a Dashboard
 * test needs editing to accommodate a change here, the change is wrong.
 */
import { loadArrangement, saveArrangement } from "./arrangement-store";
import type { DashboardLayout } from "./dashboard-layout";

export const DASHBOARD_LAYOUT_KEY = "aipm-cockpit:dashboard-layout";
export { MAX_PROJECTS } from "./arrangement-store";

/* ★ THE CAST DOWN IS THE ADAPTER'S JOB AND IS DELIBERATELY VISIBLE. The store
 * validates SHAPE, not membership: `isArrangementLayout` can prove `id` is a
 * string, never that it is a `DashboardTileId`, so nothing there could hand back
 * a `DashboardLayout` honestly. `reconcile` is what makes the narrowing true —
 * it drops every id the catalogue does not know — and the only PRODUCTION caller
 * of `loadLayout` is `readLayout` in `use-dashboard-layout.ts`, which passes the
 * result straight into it. ★ Verify REPO-WIDE, never inside the file the
 * sentence already names: `grep -rn "loadLayout(" src/app` — one production hit
 * (`use-dashboard-layout.ts`), the rest in two test files, plus this comment
 * matching itself. A file-scoped grep cannot falsify an "only" and so is not
 * evidence for one. Do not push the cast into the store as a generic id
 * parameter; it would then be invisible at every call site instead of stated
 * once here. */
export const loadLayout = (projectId: string): DashboardLayout | null =>
  loadArrangement(DASHBOARD_LAYOUT_KEY, projectId) as DashboardLayout | null;
export const saveLayout = (projectId: string, layout: DashboardLayout): void =>
  saveArrangement(DASHBOARD_LAYOUT_KEY, projectId, layout);
