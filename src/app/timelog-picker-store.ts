// Per-device, per-project Time-bookings PICKER scope — which customer and which
// of that customer's projects are currently selected in the two-step fetch flow.
//
// Deliberately NOT `Workspace.timelogLinks`. That field means "the scope of the
// LAST FETCH", and `handleRefreshBookings` depends on it meaning exactly that
// ("re-fetches the LAST-FETCHED scope, independent of the live picker"). It is
// also workspace data, so writing it on every dropdown change would dirty the
// workspace and fire an autosave — a network write under Turso — per twiddle.
// This store means "what is currently picked" and never leaves the device.
//
// NOT a Workspace field: never exported, never in Turso, absent from the
// recovery CONFIG_KEYS; cleared by app-reset's `aipm-cockpit:*` sweep purely via
// the key prefix, so it needs no wiring there.

import { readDeviceJson, removeDeviceKey, writeDeviceJson } from "./device-store";

const TIMELOG_PICKER_KEY = "aipm-cockpit:timelog-picker";
export const TIMELOG_PICKER_MAX_PROJECTS = 50;

export interface TimelogPickerScope {
  customerId?: number;
  projectIds?: number[];
}

/** Stored shape. `seq` is a monotonic recency counter used only for eviction and
 *  is stripped before the scope reaches a caller.
 *
 *  Why a counter and not a timestamp: this module must stay clock-free (pure and
 *  trivially testable — landing-state can sort on a `lastVisitAt` it already
 *  stores for its own reasons; there is no such field here and inventing one
 *  just to cap would be worse). Why not rely on object key insertion order:
 *  JS orders integer-like string keys NUMERICALLY ahead of insertion-ordered
 *  string keys, and a project key can be numeric, so insertion order is not
 *  trustworthy here. */
interface StoredScope extends TimelogPickerScope {
  seq?: number;
}

type ScopeMap = Record<string, StoredScope>;

function isStoredScope(v: unknown): v is StoredScope {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const s = v as StoredScope;
  if (
    s.customerId !== undefined &&
    (typeof s.customerId !== "number" || !Number.isFinite(s.customerId))
  ) {
    return false;
  }
  if (s.seq !== undefined && (typeof s.seq !== "number" || !Number.isFinite(s.seq))) return false;
  if (s.projectIds !== undefined) {
    if (!Array.isArray(s.projectIds)) return false;
    if (s.projectIds.some((n) => typeof n !== "number" || !Number.isFinite(n))) return false;
  }
  return true;
}

function readMap(): ScopeMap {
  const parsed = readDeviceJson<unknown>(TIMELOG_PICKER_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: ScopeMap = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (isStoredScope(v)) out[k] = v;
  }
  return out;
}

export function loadPickerScope(projectKey: string): TimelogPickerScope {
  const stored = readMap()[projectKey];
  if (!stored) return {};
  const { seq: _seq, ...scope } = stored;
  void _seq;
  return scope;
}

export function savePickerScope(projectKey: string, scope: TimelogPickerScope): void {
  const map = readMap();
  let maxSeq = 0;
  for (const v of Object.values(map)) if ((v.seq ?? 0) > maxSeq) maxSeq = v.seq ?? 0;
  map[projectKey] = { ...scope, seq: maxSeq + 1 };

  const entries = Object.entries(map);
  if (entries.length > TIMELOG_PICKER_MAX_PROJECTS) {
    entries.sort((a, b) => (b[1].seq ?? 0) - (a[1].seq ?? 0));
    const kept: ScopeMap = {};
    for (const [k, v] of entries.slice(0, TIMELOG_PICKER_MAX_PROJECTS)) kept[k] = v;
    writeDeviceJson(TIMELOG_PICKER_KEY, kept);
    return;
  }
  writeDeviceJson(TIMELOG_PICKER_KEY, map);
}

export function clearPickerScope(): void {
  removeDeviceKey(TIMELOG_PICKER_KEY);
}
