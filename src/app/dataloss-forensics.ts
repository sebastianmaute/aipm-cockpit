// Data-loss events now ride the unified diagnostic ring (see diagnostics.ts) under
// `dataloss.*` codes. This module keeps the original record/read API + the
// `window.__lopDataLossLog()` alias for back-compat with the storage guards.
import { logDiag, readDiagLog } from "./diagnostics";

export interface DataLossEvent {
  at: string;
  path: string;
  prevCollections: number;
  nextCollections: number;
  refused: boolean;
  stack?: string;
}

export function recordDataLossEvent(
  e: Omit<DataLossEvent, "at" | "stack"> & { stack?: string },
): void {
  const code = `dataloss.${e.refused ? "refused" : "observed"}`;
  logDiag(e.refused ? "warn" : "info", code, {
    path: e.path,
    prevCollections: e.prevCollections,
    nextCollections: e.nextCollections,
    refused: e.refused,
    stack: (e.stack ?? new Error().stack ?? "").split("\n").slice(2, 9).join("\n"),
  });
}

export function readDataLossLog(): DataLossEvent[] {
  return readDiagLog()
    .filter((ev) => ev.code.startsWith("dataloss."))
    .map((ev) => ({
      at: ev.at,
      path: String(ev.fields?.path ?? ""),
      prevCollections: Number(ev.fields?.prevCollections ?? 0),
      nextCollections: Number(ev.fields?.nextCollections ?? 0),
      refused: Boolean(ev.fields?.refused ?? false),
      stack: ev.fields?.stack ? String(ev.fields.stack) : undefined,
    }));
}

if (typeof window !== "undefined") {
  (window as Window & { __lopDataLossLog?: () => DataLossEvent[] }).__lopDataLossLog =
    readDataLossLog;
}
