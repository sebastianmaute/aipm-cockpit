// Per-device, per-project cadence + prior-snapshot store for the weekly digest.
// Mirrors landing-state.ts: single localStorage key, capped, validated load,
// OUT of exports/Turso, swept by clearAppConfig's `lop-app:*` sweep. NOT a
// Workspace field (zero backend write paths).
import type { Health } from "../health";

export const DIGEST_STATE_KEY = "lop-app:digest-state";
export const DIGEST_STATE_MAX_PROJECTS = 50;

export interface DigestMetrics {
  overdue: number;
  openRaid: number;
}

export interface DigestState {
  lastRunAt: string;
  nextDueAt: string;
  priorRag: Health;
  priorMetrics: DigestMetrics;
}

type StateMap = Record<string, DigestState>;

const RAGS: ReadonlySet<string> = new Set(["R", "A", "G"]);

function isState(v: unknown): v is DigestState {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const m = o.priorMetrics as Record<string, unknown> | undefined;
  return (
    typeof o.lastRunAt === "string" &&
    typeof o.nextDueAt === "string" &&
    typeof o.priorRag === "string" && RAGS.has(o.priorRag) &&
    typeof m === "object" && m !== null &&
    typeof m.overdue === "number" && typeof m.openRaid === "number"
  );
}

function loadMap(): StateMap {
  try {
    const raw = localStorage.getItem(DIGEST_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: StateMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isState(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveMap(map: StateMap): void {
  // Cap: keep the most-recently-run projects (by lastRunAt desc).
  const entries = Object.entries(map).sort((a, b) => b[1].lastRunAt.localeCompare(a[1].lastRunAt));
  const capped = Object.fromEntries(entries.slice(0, DIGEST_STATE_MAX_PROJECTS));
  try {
    localStorage.setItem(DIGEST_STATE_KEY, JSON.stringify(capped));
  } catch {
    /* storage full / unavailable — non-fatal (digest is advisory) */
  }
}

export function loadDigestState(projectId: string): DigestState | null {
  return loadMap()[projectId] ?? null;
}

/** Advance the cadence: record this run and schedule the next. `now` is a full
 *  ISO instant; `nextDueAt = now + cadenceDays`. */
export function advanceDigestState(
  projectId: string,
  args: { now: string; cadenceDays: number; rag: Health; metrics: DigestMetrics },
): void {
  const next = new Date(Date.parse(args.now) + args.cadenceDays * 86_400_000).toISOString();
  const map = loadMap();
  map[projectId] = {
    lastRunAt: args.now,
    nextDueAt: next,
    priorRag: args.rag,
    priorMetrics: args.metrics,
  };
  saveMap(map);
}

export function isDigestDue(state: DigestState, now: string): boolean {
  return Date.parse(now) >= Date.parse(state.nextDueAt);
}

export function clearDigestState(): void {
  try {
    localStorage.removeItem(DIGEST_STATE_KEY);
  } catch {
    /* non-fatal */
  }
}
