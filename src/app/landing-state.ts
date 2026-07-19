// Per-browser, per-project landing-page state (last-visit timestamp + RAG
// snapshot) backing the Dashboard "since you last looked" strip. Mirrors
// activity-log.ts: a single localStorage key, defensive parse, SSR guard,
// bounded size. NOT a Workspace field — never exported, never in Turso, cleared
// by app-reset's `aipm-cockpit:*` sweep.

import { readDeviceJson, removeDeviceKey, writeDeviceJson } from "./device-store";
import type { LandingState } from "./dashboard-delta";

const LANDING_STATE_KEY = "aipm-cockpit:landing-state";
export const LANDING_STATE_MAX_PROJECTS = 50;

type StateMap = Record<string, LandingState>;

function isLandingState(v: unknown): v is LandingState {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const s = v as LandingState;
  if (s.lastVisitAt !== undefined && typeof s.lastVisitAt !== "string") return false;
  if (s.rag !== undefined && (typeof s.rag !== "object" || s.rag === null)) return false;
  if (s.metrics !== undefined && (typeof s.metrics !== "object" || s.metrics === null)) return false;
  return true;
}

function readMap(): StateMap {
  const parsed = readDeviceJson<unknown>(LANDING_STATE_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: StateMap = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (isLandingState(v)) out[k] = v;
  }
  return out;
}

export function loadLandingState(projectId: string): LandingState {
  return readMap()[projectId] ?? {};
}

export function saveLandingState(projectId: string, state: LandingState): void {
  const map = readMap();
  map[projectId] = state;
  const entries = Object.entries(map);
  if (entries.length > LANDING_STATE_MAX_PROJECTS) {
    entries.sort((a, b) => (b[1].lastVisitAt ?? "").localeCompare(a[1].lastVisitAt ?? ""));
    const kept: StateMap = {};
    for (const [k, v] of entries.slice(0, LANDING_STATE_MAX_PROJECTS)) kept[k] = v;
    writeDeviceJson(LANDING_STATE_KEY, kept);
    return;
  }
  writeDeviceJson(LANDING_STATE_KEY, map);
}

export function clearLandingState(): void {
  removeDeviceKey(LANDING_STATE_KEY);
}
