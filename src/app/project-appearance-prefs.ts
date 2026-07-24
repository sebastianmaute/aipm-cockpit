// src/app/project-appearance-prefs.ts
//
// Per-device, per-project APPEARANCE/VIEW preferences (dashboard density, theme,
// active scheme, view hints, tasks-view mode). Unlike the POLICY overrides that
// travel WITH the project (Workspace.settingsOverrides), appearance is a device
// concern — the same project can look different on different machines. Mirrors
// landing-state.ts: a single localStorage key holding a `{ [projectId]: pref }`
// map, defensive parse, SSR guard (via device-store), bounded size, per-field
// validation on load. NOT a Workspace field — never exported, never in Turso,
// cleared by app-reset's `aipm-cockpit:*` sweep (the key carries that prefix).

import { readDeviceJson, writeDeviceJson } from "./device-store";

/** A project's per-device appearance/view preferences. Every field is optional —
 *  an absent field means "inherit the device-global Settings value". */
export interface ProjectAppearancePref {
  dashboardDensity?: "comfortable" | "compact";
  theme?: "light" | "dark" | "system";
  activeSchemeId?: string;
  showViewHints?: boolean;
  tasksViewMode?: "table" | "board" | "swimlane";
}

const PROJECT_APPEARANCE_KEY = "aipm-cockpit:project-appearance";
/** Cap the map so a long-lived device can't grow it without bound (mirrors
 *  LANDING_STATE_MAX_PROJECTS). When over cap the OLDEST entry is evicted. */
export const PROJECT_APPEARANCE_MAX_PROJECTS = 50;

type PrefMap = Record<string, ProjectAppearancePref>;

/** Validate an untrusted stored entry: keep only known fields with valid values;
 *  drop invalid enum values and blank/non-string `activeSchemeId`. Returns a NEW
 *  sanitized pref (possibly `{}`). */
function sanitizePref(v: unknown): ProjectAppearancePref {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: ProjectAppearancePref = {};
  if (o.dashboardDensity === "comfortable" || o.dashboardDensity === "compact") {
    out.dashboardDensity = o.dashboardDensity;
  }
  if (o.theme === "light" || o.theme === "dark" || o.theme === "system") {
    out.theme = o.theme;
  }
  if (typeof o.activeSchemeId === "string") {
    const trimmed = o.activeSchemeId.trim();
    if (trimmed) out.activeSchemeId = trimmed;
  }
  if (typeof o.showViewHints === "boolean") out.showViewHints = o.showViewHints;
  if (o.tasksViewMode === "table" || o.tasksViewMode === "board" || o.tasksViewMode === "swimlane") {
    out.tasksViewMode = o.tasksViewMode;
  }
  return out;
}

function readMap(): PrefMap {
  const parsed = readDeviceJson<unknown>(PROJECT_APPEARANCE_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  // Prototype-free map so a hostile stored key (`__proto__`/`constructor`) can't
  // pollute the prototype or make a non-own lookup return an inherited member.
  const out: PrefMap = Object.create(null);
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    out[k] = sanitizePref(v);
  }
  return out;
}

/** Load a project's appearance prefs (→ `{}` when absent/invalid). One-shot,
 *  uncached — use `getAppearanceSnapshot`/the store for reactive reads. */
export function loadProjectAppearance(projectId: string): ProjectAppearancePref {
  return readMap()[projectId] ?? {};
}

// --- Reactive store (for useSyncExternalStore) -------------------------------
// localStorage alone doesn't re-render React on write, so a UI change to an
// appearance override would show stale until an unrelated re-render. This tiny
// store caches the parsed map, hands out referentially-stable per-project
// snapshots, and notifies subscribers on any write (same tab) or `storage`
// event (other tabs).

type Listener = () => void;
const listeners = new Set<Listener>();
let cachedMap: PrefMap | null = null;
const snapshotCache = new Map<string, ProjectAppearancePref>();
/** Shared frozen snapshot for projects with NO prefs — referential stability so
 *  useSyncExternalStore doesn't loop on a fresh `{}` each read. */
const EMPTY_PREF: ProjectAppearancePref = Object.freeze({});

function currentMap(): PrefMap {
  if (cachedMap === null) cachedMap = readMap();
  return cachedMap;
}

function prefsEqual(a: ProjectAppearancePref, b: ProjectAppearancePref): boolean {
  return (
    a.dashboardDensity === b.dashboardDensity &&
    a.theme === b.theme &&
    a.activeSchemeId === b.activeSchemeId &&
    a.showViewHints === b.showViewHints &&
    a.tasksViewMode === b.tasksViewMode
  );
}

/** Referentially-stable snapshot of a project's prefs (safe for
 *  useSyncExternalStore's getSnapshot). */
export function getAppearanceSnapshot(projectId: string): ProjectAppearancePref {
  const fresh = currentMap()[projectId] ?? EMPTY_PREF;
  const cached = snapshotCache.get(projectId);
  if (cached && prefsEqual(cached, fresh)) return cached;
  snapshotCache.set(projectId, fresh);
  return fresh;
}

function invalidate(): void {
  cachedMap = null;
  for (const l of listeners) l();
}

let storageBound = false;
function ensureStorageListener(): void {
  if (storageBound || typeof window === "undefined") return;
  storageBound = true;
  window.addEventListener("storage", (e) => {
    // key === null → localStorage.clear(); also handle our specific key.
    if (e.key === PROJECT_APPEARANCE_KEY || e.key === null) invalidate();
  });
}

/** Subscribe to appearance-store changes (for useSyncExternalStore). */
export function subscribeAppearance(cb: Listener): () => void {
  ensureStorageListener();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Replace a project's appearance prefs and persist. Re-inserts the project last
 *  (most-recent) and cap-evicts the oldest when over the project cap. */
export function saveProjectAppearance(projectId: string, pref: ProjectAppearancePref): void {
  const map = readMap();
  // Delete-then-set moves the project to the end of the insertion order so it
  // reads as most-recent for eviction.
  delete map[projectId];
  map[projectId] = sanitizePref(pref);
  const entries = Object.entries(map);
  if (entries.length > PROJECT_APPEARANCE_MAX_PROJECTS) {
    const kept: PrefMap = {};
    for (const [k, v] of entries.slice(entries.length - PROJECT_APPEARANCE_MAX_PROJECTS)) {
      kept[k] = v;
    }
    writeDeviceJson(PROJECT_APPEARANCE_KEY, kept);
    invalidate();
    return;
  }
  writeDeviceJson(PROJECT_APPEARANCE_KEY, map);
  invalidate();
}
