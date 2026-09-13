// Per-device, per-project key-fact snapshot backing the Projects-list meter on
// NON-current rows (spec §5.3). A ProjectRegistryEntry holds only
// {id, name, code, storageConfig}; the eleven facts and the customer live inside
// each project's own backend, and reading every backend per render was rejected.
// Modelled on landing-state.ts: one device-store key, defensive parse, bounded
// size. NOT a Workspace field — never exported, never in Turso, cleared by
// app-reset's `aipm-cockpit:*` sweep.
//
// ★★ Absence reads as `null` = UNKNOWN, never as zero. Rendering a never-opened
// project as "0 of 11" would be a fabricated measurement.
// ★ The CURRENT project never reads this cache — it computes live from memory.

import { readDeviceJson, removeDeviceKey, writeDeviceJson } from "./device-store";
import { KEY_FACT_IDS, keyFactCompleteness, type KeyFactId } from "./project-key-facts";
import type { ProjectMeta } from "./types";

const KEY_FACTS_CACHE_KEY = "aipm-cockpit:project-key-facts";
export const KEY_FACTS_CACHE_MAX_PROJECTS = 50;

export interface KeyFactsSnapshot {
  filled: number;
  missing: KeyFactId[];
  customer: string;
  /** ISO timestamp of the write; drives eviction. */
  at: string;
}

type SnapshotMap = Record<string, KeyFactsSnapshot>;

const FACT_ID_SET: ReadonlySet<string> = new Set(KEY_FACT_IDS);

function isSnapshot(v: unknown): v is KeyFactsSnapshot {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  if (typeof s.customer !== "string" || typeof s.at !== "string") return false;
  if (!Number.isInteger(s.filled)) return false;
  const filled = s.filled as number;
  if (filled < 0 || filled > KEY_FACT_IDS.length) return false;
  if (!Array.isArray(s.missing)) return false;
  if (!s.missing.every((id) => typeof id === "string" && FACT_ID_SET.has(id))) return false;
  // ★ Reject a duplicate id in `missing` — without this, a corrupt/crafted
  // entry could repeat one id enough times to satisfy the count-adds-up check
  // below while omitting a real missing fact (e.g. ["code","code","code"] for
  // filled=8 on an 11-fact model), rendering the meter on a fabricated split.
  if (new Set(s.missing).size !== s.missing.length) return false;
  return filled + s.missing.length === KEY_FACT_IDS.length;
}

function readMap(): SnapshotMap {
  const parsed = readDeviceJson<unknown>(KEY_FACTS_CACHE_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: SnapshotMap = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (isSnapshot(v)) out[k] = v;
  }
  return out;
}

export function keyFactsSnapshot(meta: ProjectMeta, at: string): KeyFactsSnapshot {
  const { filled, missing } = keyFactCompleteness(meta);
  return { filled, missing, customer: meta.customer, at };
}

// ★ one parse-and-validate pass of the whole device map, for a caller
// (the Projects-list memo) that needs every row's snapshot in one render —
// calling `loadKeyFactsSnapshot` per row parsed and validated the WHOLE
// stored map once per row.
export function loadKeyFactsSnapshots(): Record<string, KeyFactsSnapshot> {
  return readMap();
}

export function loadKeyFactsSnapshot(projectId: string): KeyFactsSnapshot | null {
  return loadKeyFactsSnapshots()[projectId] ?? null;
}

export function saveKeyFactsSnapshot(projectId: string, snap: KeyFactsSnapshot): void {
  const map = readMap();
  map[projectId] = snap;
  const entries = Object.entries(map);
  if (entries.length > KEY_FACTS_CACHE_MAX_PROJECTS) {
    entries.sort((a, b) => b[1].at.localeCompare(a[1].at));
    writeDeviceJson(KEY_FACTS_CACHE_KEY, Object.fromEntries(entries.slice(0, KEY_FACTS_CACHE_MAX_PROJECTS)));
    return;
  }
  writeDeviceJson(KEY_FACTS_CACHE_KEY, map);
}

// ★ drop one project's entry when it is deleted/de-registered, so a
// removed project doesn't keep occupying one of the 50 cached slots forever.
// Mirrors `clearKeyFactsCache`'s use of `removeDeviceKey` for the
// whole-map-empty case: writing back an empty object would leave a live
// (if empty) key behind, which `readDeviceJson`'s callers, `app-reset`'s
// `aipm-cockpit:*` sweep, and this module's own `clearKeyFactsCache` all
// still handle fine either way, but leaving no key at all is the more
// honest "nothing cached" state and mirrors the whole-cache-clear path.
export function removeKeyFactsSnapshot(projectId: string): void {
  const map = readMap();
  if (!(projectId in map)) return;
  delete map[projectId];
  if (Object.keys(map).length === 0) {
    removeDeviceKey(KEY_FACTS_CACHE_KEY);
    return;
  }
  writeDeviceJson(KEY_FACTS_CACHE_KEY, map);
}

export function clearKeyFactsCache(): void {
  removeDeviceKey(KEY_FACTS_CACHE_KEY);
}
