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
 *
 * ★★ THAT RESTS ON PROJECT IDS NOT BEING INTEGER-LIKE, and they are not — this
 * is recorded so nobody re-derives the worry. `Object.keys` lists canonical
 * integer-index keys FIRST, in ASCENDING NUMERIC order, ahead of every string
 * key: with ids like `"1"`, `"2"`, … the delete-and-re-add would move nothing
 * and the cap would evict the LOWEST-NUMBERED project rather than the least
 * recently used. Every id that reaches here is a `crypto.randomUUID()` — file
 * mode mints one at all three `addProject` sites in `use-storage-file-ops.ts`,
 * Turso at both mint sites in `use-storage-turso-ops.ts` — plus the literal
 * `"default"` fallback `DashboardPanel` passes when it has no project id. A UUID
 * always contains hyphens and hex letters, so none of them can be integer-like.
 * Reproduce: `grep -rn "const id = crypto.randomUUID()" src/app/use-storage-file-ops.ts
 * src/app/use-storage-turso-ops.ts` (five hits). ★ A future id scheme that mints
 * bare decimal strings would silently break the recency rule with nothing to say
 * so — prefix it, or replace insertion order with a stored timestamp.
 *
 * ★★ A DOWNGRADE→UPGRADE ROUND TRIP LOSES THE ARRANGEMENT, PERMANENTLY, and that
 * is accepted rather than unnoticed. `isLayout` rejects any `v` that is not
 * exactly 1, so a blob written by a FUTURE version reads as absent, `reconcile`
 * hands back `DEFAULT_LAYOUT`, and the first mutation writes a `v: 1` layout over
 * the newer one — the old arrangement is gone, not merely ignored. Accepted
 * because this is a preference, not data (the same reason a quota failure is
 * swallowed below), and because the alternative — preserving an unreadable blob
 * under a side key — buys a user who downgrades once something nobody has asked
 * for. A future `v: 2` should MIGRATE a `v: 1` blob rather than reject it, which
 * costs the same round trip in the other direction.
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
