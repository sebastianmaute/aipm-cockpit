// Forensic ring buffer for data-loss investigation. Records SUSPICIOUS workspace
// shrink events (a populated project dropping to zero collections in one step)
// with a captured caller stack, so the NEXT occurrence yields the actual trigger
// instead of post-hoc guesswork. Per-device, capped, out of exports/Turso, swept
// by clearAppConfig's `lop-app:*` removal. NOT user-facing.
//
// Inspect in devtools: `window.__lopDataLossLog()`.

const KEY = "lop-app:dataloss-log";
const CAP = 25;

export interface DataLossEvent {
  at: string; // ISO timestamp
  path: string; // "save-effect" | "load" | "reload" | ...
  prevCollections: number;
  nextCollections: number;
  refused: boolean; // did a guard block the persistence?
  stack?: string; // caller stack — the trigger evidence
}

function captureStack(): string {
  return (new Error().stack ?? "").split("\n").slice(2, 9).join("\n");
}

/** Read the forensic log (newest first). Never throws. */
export function readDataLossLog(): DataLossEvent[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DataLossEvent[]) : [];
  } catch {
    return [];
  }
}

/** Append a suspicious-shrink event. Captures a caller stack + timestamp.
 *  Forensics must NEVER throw into the app — all failures are swallowed. */
export function recordDataLossEvent(
  e: Omit<DataLossEvent, "at" | "stack"> & { stack?: string },
): void {
  try {
    if (typeof window === "undefined") return;
    const entry: DataLossEvent = {
      ...e,
      at: new Date().toISOString(),
      stack: e.stack ?? captureStack(),
    };
    const next = [entry, ...readDataLossLog()].slice(0, CAP);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* swallow — never let forensics break a save */
  }
}

if (typeof window !== "undefined") {
  (window as Window & { __lopDataLossLog?: () => DataLossEvent[] }).__lopDataLossLog =
    readDataLossLog;
}
