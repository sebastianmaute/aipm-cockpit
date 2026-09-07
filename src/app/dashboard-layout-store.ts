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

/* ★★★ `loadLayout` AND `saveLayout` HAVE NO PRODUCTION CALLER AT ALL — they are
 * TEST-ONLY EXPORTS, kept under the same export-stability rule as the rest of
 * the Dashboard binding (every `dashboard-*` module keeps its current export
 * signature, so no Dashboard test needs editing). The hook extraction orphaned
 * them: `use-dashboard-layout.ts` imports `DASHBOARD_LAYOUT_KEY` alone and
 * delegates to `useArrangement`, which calls `loadArrangement`/`saveArrangement`
 * itself. Two test files exercise them — `dashboard-layout-store.test.ts`
 * directly, and `use-dashboard-layout.test.tsx` reading the store back to
 * assert what the hook persisted.
 * ★★ AN EARLIER REVISION OF THIS BLOCK NAMED "the only PRODUCTION caller of
 * `loadLayout`" as `readLayout` in `use-dashboard-layout.ts`, "which passes the
 * result straight into" `reconcile`. That data path does not exist in any form:
 * `readLayout` lives in `use-arrangement.ts` and never touches this file. The
 * sentence was measured before the extraction landed on the same branch, which
 * is the failure to watch for — a correction inherits none of the verification
 * of the thing it corrects.
 * ★ Verify REPO-WIDE, never inside the file a sentence names — a file-scoped
 * grep cannot falsify an "only" and so is not evidence for one:
 * `grep -rn "loadLayout(\|saveLayout(" src/app` — every hit outside this
 * comment is in a `.test.` file.
 *
 * ★ THE CAST DOWN IS STILL THE ADAPTER'S JOB AND IS DELIBERATELY VISIBLE. The
 * store validates SHAPE, not membership: `isArrangementLayout` can prove `id`
 * is a string, never that it is a `DashboardTileId`, so nothing there could
 * hand back a `DashboardLayout` honestly. Only `reconcile` can make the
 * narrowing true — it drops every id the catalogue does not know — so any
 * caller that ever returns here owes that call, and the cast stays visible so
 * that debt is stated. Do not push it into the store as a generic id parameter;
 * it would then be invisible at every call site instead of stated once here. */
export const loadLayout = (projectId: string): DashboardLayout | null =>
  loadArrangement(DASHBOARD_LAYOUT_KEY, projectId) as DashboardLayout | null;
export const saveLayout = (projectId: string, layout: DashboardLayout): void =>
  saveArrangement(DASHBOARD_LAYOUT_KEY, projectId, layout);
