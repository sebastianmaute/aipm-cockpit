"use client";
/**
 * Per-device, per-project storage for the Dashboard arrangement.
 *
 * ★★ NOT A `Workspace` FIELD, deliberately — zero backend write paths, nothing
 * in exports or Turso. One localStorage key holds a `{[projectId]: layout}` map,
 * exactly like `landing-state.ts`, so `clearAppConfig`'s `aipm-cockpit:*` sweep
 * already clears it and no codec, DDL or golden fixture has to change.
 *
 * ★ The raw storage I/O goes through `device-store.ts` (`readDeviceJson` /
 * `writeDeviceJson`), the same envelope `landing-state.ts` uses — it owns the
 * SSR guard, the defensive parse and the quota-safe write. Validation, the cap
 * and the recency rule stay here, which is that helper's documented split.
 *
 * ★ Insertion order in the JSON object IS the recency order used for eviction.
 * Re-saving an existing project deletes and re-adds its key so it moves to the
 * end; without that, the first 50 projects a user ever opened would be pinned
 * forever and the 51st could never be stored.
 */
import { readDeviceJson, writeDeviceJson } from "./device-store";
import type { DashboardLayout } from "./dashboard-layout";

export const DASHBOARD_LAYOUT_KEY = "aipm-cockpit:dashboard-layout";
export const MAX_PROJECTS = 50;

/** ★ Deliberately loose: an unknown id or an out-of-range span is `reconcile`'s
 *  job, not this one. This only rejects a blob that is not a layout AT ALL. */
function isPlacedTile(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const t = v as { id?: unknown; w?: unknown; h?: unknown };
  return typeof t.id === "string" && typeof t.w === "number" && typeof t.h === "number";
}

function isLayout(v: unknown): v is DashboardLayout {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const l = v as { v?: unknown; board?: unknown; hidden?: unknown };
  if (l.v !== 1 || !Array.isArray(l.board) || !Array.isArray(l.hidden)) return false;
  return (l.board as unknown[]).every(isPlacedTile)
    && (l.hidden as unknown[]).every((h) => typeof h === "string");
}

/** The whole `{[projectId]: layout}` map, unvalidated. A missing key, a corrupt
 *  blob or a non-object payload all read as `{}` — never a throw. */
function readMap(): Record<string, unknown> {
  const parsed = readDeviceJson<unknown>(DASHBOARD_LAYOUT_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

export function loadLayout(projectId: string): DashboardLayout | null {
  const entry = readMap()[projectId];
  return isLayout(entry) ? entry : null;
}

export function saveLayout(projectId: string, layout: DashboardLayout): void {
  const map = readMap();
  delete map[projectId];                                  // re-add so it is newest
  map[projectId] = layout;
  const keys = Object.keys(map);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_PROJECTS))) delete map[stale];
  // Quota or private-mode failure is swallowed by `writeDeviceJson`: the
  // arrangement is a preference, not data — losing it must never break the
  // dashboard.
  writeDeviceJson(DASHBOARD_LAYOUT_KEY, map);
}
