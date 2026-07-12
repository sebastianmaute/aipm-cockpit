// Per-device sync baseline for two-way calendar pull: the last-agreed date for
// each pushed event, so the pull engine can tell whether the ENTITY changed
// locally since the last sync (app-wins conflict rule). Per-BROWSER, per-project;
// NOT workspace data — out of exports/Turso, cleared by clearAppConfig's aipm-cockpit:* sweep.
const KEY = "aipm-cockpit:calendar-sync-baseline";

function loadMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function saveMap(map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota/SSR — ignore */
  }
}

const keyFor = (projectId: string, entityType: string, eventId: string) => `${projectId}:${entityType}:${eventId}`;

export function readBaselineDate(projectId: string, entityType: string, eventId: string): string | undefined {
  return loadMap()[keyFor(projectId, entityType, eventId)];
}

export function writeBaselineDate(projectId: string, entityType: string, eventId: string, date: string): void {
  const map = loadMap();
  map[keyFor(projectId, entityType, eventId)] = date;
  saveMap(map);
}

export function removeBaselineEntry(projectId: string, entityType: string, eventId: string): void {
  const map = loadMap();
  delete map[keyFor(projectId, entityType, eventId)];
  saveMap(map);
}

export function loadBaseline(projectId: string, entityType: string): Record<string, string> {
  const prefix = `${projectId}:${entityType}:`;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(loadMap())) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}
