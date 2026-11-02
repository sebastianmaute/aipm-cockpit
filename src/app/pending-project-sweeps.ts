// The project-scoped side-table sweeps that failed after a project hard delete
// (`hardDeleteProject`), kept so the app can try again at its next start. One
// localStorage entry maps a database's `httpUrl` to the ids of the deleted
// projects whose side tables still hold rows. This module is its only writer.
// It holds project ids only — no key, token or project data.
import { runTursoPipeline } from "./turso-pipeline";
import { projectSideTableSweepStatements } from "./project-side-tables";
import { logDiag } from "./diagnostics";
import type { TursoConfig } from "./turso-config";

export const PENDING_PROJECT_SWEEPS_KEY = "aipm-cockpit:pending-project-sweeps";

type PendingStore = Record<string, string[]>;

function readStore(): PendingStore {
  try {
    const raw = window.localStorage.getItem(PENDING_PROJECT_SWEEPS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: PendingStore = {};
    for (const [url, ids] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(ids)) continue;
      const valid = ids.filter((id): id is string => typeof id === "string" && id !== "");
      if (valid.length > 0) out[url] = valid;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(store: PendingStore): void {
  try {
    window.localStorage.setItem(PENDING_PROJECT_SWEEPS_KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable or full: the retry is lost, the leaked rows stay as before.
    logDiag("warn", "storage.pendingProjectSweepsUnwritable");
  }
}

/** The deleted projects of one database whose side-table sweep is still to be retried. */
export function pendingProjectSweeps(httpUrl: string): string[] {
  return readStore()[httpUrl] ?? [];
}

/** Whether any database still has a deleted project whose sweep is to be retried. A factory reset clears
 *  the queue with every other app key, so its dialog says so while this is true. */
export function hasPendingProjectSweeps(): boolean {
  return Object.keys(readStore()).length > 0;
}

export function addPendingProjectSweep(httpUrl: string, projectId: string): void {
  const store = readStore();
  const ids = store[httpUrl] ?? [];
  if (ids.includes(projectId)) return;
  writeStore({ ...store, [httpUrl]: [...ids, projectId] });
}

export function removePendingProjectSweep(httpUrl: string, projectId: string): void {
  const store = readStore();
  const ids = (store[httpUrl] ?? []).filter((id) => id !== projectId);
  const rest: PendingStore = Object.fromEntries(Object.entries(store).filter(([url]) => url !== httpUrl));
  writeStore(ids.length > 0 ? { ...rest, [httpUrl]: ids } : rest);
}

/** Runs the side-table sweep again for every queued project of this database, one at a
 *  time, and removes each project whose sweep succeeds. A failure keeps it queued for the
 *  next start and logs only the project id. */
export async function retryPendingProjectSweeps(config: TursoConfig): Promise<void> {
  for (const id of pendingProjectSweeps(config.httpUrl)) {
    try {
      await runTursoPipeline(config, projectSideTableSweepStatements(id));
      removePendingProjectSweep(config.httpUrl, id);
    } catch {
      logDiag("warn", "storage.projectSideTableSweepRetryFailed", { id });
    }
  }
}
