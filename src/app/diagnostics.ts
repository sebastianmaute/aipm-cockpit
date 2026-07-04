// Structured, secrets-free diagnostic ring. Per-device (localStorage
// `lop-app:diag-log`), capped, out of workspace exports/Turso, swept by
// clearAppConfig's `lop-app:*` removal. Never throws into the app.
// Inspect in devtools: `window.__lopDiag()`.
import { APP_VERSION } from "./version";
import { redactFields } from "./diagnostics-redact";

const KEY = "lop-app:diag-log";
const DIAG_MAX = 200;

export type DiagLevel = "error" | "warn" | "info";
export interface DiagEvent {
  at: string;
  level: DiagLevel;
  code: string;
  fields?: Record<string, string | number | boolean>;
}

export function readDiagLog(): DiagEvent[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DiagEvent[]) : [];
  } catch {
    return [];
  }
}

// Cap the ring, evicting the OLDEST info-level events first so rare warn/error
// (data-loss, uncaught) survive a burst of info noise.
function capRing(events: DiagEvent[]): DiagEvent[] {
  if (events.length <= DIAG_MAX) return events;
  const result = [...events];
  while (result.length > DIAG_MAX) {
    let idx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].level === "info") { idx = i; break; }
    }
    if (idx === -1) { result.length = DIAG_MAX; break; } // no info left → hard-trim oldest
    result.splice(idx, 1);
  }
  return result;
}

const LEGACY_DATALOSS_KEY = "lop-app:dataloss-log";

/** One-time migration of the pre-fold `lop-app:dataloss-log` ring into the unified
 *  ring. Consumes (removes) the legacy key even if parsing fails, so it runs once. */
export function migrateLegacyDataLossLog(): void {
  try {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(LEGACY_DATALOSS_KEY);
    if (!raw) return;
    window.localStorage.removeItem(LEGACY_DATALOSS_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const migrated: DiagEvent[] = parsed
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => {
        const refused = Boolean(e.refused);
        const level: DiagLevel = refused ? "warn" : "info";
        return {
          at: String(e.at ?? ""),
          level,
          code: `dataloss.${refused ? "refused" : "observed"}`,
          fields: redactFields({
            path: e.path,
            prevCollections: e.prevCollections,
            nextCollections: e.nextCollections,
            refused,
            stack: e.stack,
          }),
        };
      });
    if (migrated.length === 0) return;
    window.localStorage.setItem(KEY, JSON.stringify(capRing([...migrated, ...readDiagLog()])));
  } catch {
    /* swallow — migration must never break boot */
  }
}

export function logDiag(level: DiagLevel, code: string, fields?: Record<string, unknown>): void {
  try {
    if (typeof window === "undefined") return;
    const entry: DiagEvent = { at: new Date().toISOString(), level, code, fields: redactFields(fields) };
    const next = capRing([entry, ...readDiagLog()]);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* never let diagnostics break the app */
  }
}

export function clearDiagLog(): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
  } catch {
    /* swallow */
  }
}

export function buildDiagnosticBundle(): string {
  const env =
    typeof navigator !== "undefined"
      ? { userAgent: navigator.userAgent, platform: navigator.platform }
      : {};
  return JSON.stringify(
    { version: APP_VERSION, generatedAt: new Date().toISOString(), env, events: readDiagLog() },
    null,
    2,
  );
}

if (typeof window !== "undefined") {
  (window as Window & { __lopDiag?: () => DiagEvent[] }).__lopDiag = readDiagLog;
}
