import type { DiagEvent, DiagLevel } from "./diagnostics";

/** Filter by an allowed-level set + a case-insensitive code substring (empty query = all). */
export function filterDiag(events: readonly DiagEvent[], levels: ReadonlySet<DiagLevel>, codeQuery: string): DiagEvent[] {
  const q = codeQuery.trim().toLowerCase();
  return events.filter((e) => levels.has(e.level) && (q === "" || String(e.code ?? "").toLowerCase().includes(q)));
}

export interface DiagSummary { error: number; warn: number; info: number; newestErrorAt?: string; }

/** Counts per level + the newest error timestamp, from the full ring (events are newest-first). */
export function summarizeDiag(events: readonly DiagEvent[]): DiagSummary {
  const s: DiagSummary = { error: 0, warn: 0, info: 0 };
  for (const e of events) {
    if (e.level === "error") { s.error++; if (!s.newestErrorAt) s.newestErrorAt = e.at; }
    else if (e.level === "warn") s.warn++;
    else s.info++;
  }
  return s;
}
