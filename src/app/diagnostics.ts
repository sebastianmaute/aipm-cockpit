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

export function logDiag(level: DiagLevel, code: string, fields?: Record<string, unknown>): void {
  try {
    if (typeof window === "undefined") return;
    const entry: DiagEvent = { at: new Date().toISOString(), level, code, fields: redactFields(fields) };
    const next = [entry, ...readDiagLog()].slice(0, DIAG_MAX);
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
