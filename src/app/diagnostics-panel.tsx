"use client";
import { useState } from "react";
import type { Lang, TranslationKey } from "./i18n";
import { t } from "./i18n";
import { readDiagLog, clearDiagLog, buildDiagnosticBundle } from "./diagnostics";
import type { DiagLevel } from "./diagnostics";
import { filterDiag, summarizeDiag } from "./diagnostics-filter";
import { EmptyState } from "./empty-state";
import { DataTable } from "./data-table";
import { reportSilentFailure } from "./guard-feedback";
import { Input } from "./form-controls";
import { INTERACTIVE } from "./interaction-styles";
import { useToastContext } from "./toast-context";

export function DiagnosticsPanel({ lang }: { lang: Lang }) {
  const showToast = useToastContext();
  const [events, setEvents] = useState(() => readDiagLog());
  const [levels, setLevels] = useState<Set<DiagLevel>>(() => new Set<DiagLevel>(["error", "warn", "info"]));
  const [query, setQuery] = useState("");
  const summary = summarizeDiag(events);
  const shown = filterDiag(events, levels, query);
  const seg = (n: number, one: TranslationKey, many: TranslationKey) => `${n} ${t(lang, n === 1 ? one : many)}`;
  const summaryText =
    [
      seg(summary.error, "diagnosticsUnitErrorOne", "diagnosticsUnitErrorMany"),
      seg(summary.warn, "diagnosticsUnitWarnOne", "diagnosticsUnitWarnMany"),
      `${summary.info} ${t(lang, "diagnosticsUnitInfo")}`,
    ].join(" · ") +
    (summary.newestErrorAt ? ` · ${t(lang, "diagnosticsNewestError", String(summary.newestErrorAt).slice(11, 19))}` : "");
  const labelFor = (lv: DiagLevel) =>
    t(lang, lv === "error" ? "diagnosticsLevelError" : lv === "warn" ? "diagnosticsLevelWarn" : "diagnosticsLevelInfo");
  const toggleLevel = (lv: DiagLevel) =>
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lv)) next.delete(lv);
      else next.add(lv);
      return next;
    });

  const refresh = () => setEvents(readDiagLog());
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildDiagnosticBundle());
      showToast("info", t(lang, "diagnosticsCopied"));
    } catch (e) {
      reportSilentFailure(showToast, lang, "diagnostics.copyFailed", e, "guardClipboardCopyFailed");
    }
  };
  const download = () => {
    const blob = new Blob([buildDiagnosticBundle()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "aipm-cockpit-diagnostics.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const clear = () => {
    clearDiagLog();
    refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t(lang, "diagnosticsIntro")}</p>
      {events.length > 0 && (
        <p className="text-xs text-muted-foreground">{summaryText}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-md border border-line px-3 py-1.5 text-sm ${INTERACTIVE}`}
          onClick={refresh}
        >
          {t(lang, "diagnosticsRefresh")}
        </button>
        <button
          type="button"
          className={`rounded-md border border-line px-3 py-1.5 text-sm ${INTERACTIVE}`}
          onClick={copy}
        >
          {t(lang, "diagnosticsCopyBundle")}
        </button>
        <button
          type="button"
          className={`rounded-md border border-line px-3 py-1.5 text-sm ${INTERACTIVE}`}
          onClick={download}
        >
          {t(lang, "diagnosticsDownloadBundle")}
        </button>
        <button
          type="button"
          className={`rounded-md border border-line px-3 py-1.5 text-sm ${INTERACTIVE}`}
          onClick={clear}
        >
          {t(lang, "diagnosticsClear")}
        </button>
      </div>
      {events.length === 0 ? (
        <EmptyState title={t(lang, "diagnosticsEmpty")} compact />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {(["error", "warn", "info"] as DiagLevel[]).map((lv) => (
              <label key={lv} className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={levels.has(lv)} onChange={() => toggleLevel(lv)} aria-label={labelFor(lv)} />
                {labelFor(lv)}
              </label>
            ))}
            <Input
              type="text"
              size="xs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(lang, "diagnosticsSearchCode")}
              aria-label={t(lang, "diagnosticsSearchCode")}
              className="min-w-0 flex-1"
            />
          </div>
          {shown.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t(lang, "diagnosticsNoMatch")}</p>
          ) : (
            <div className="min-h-0 overflow-auto pr-2">
              <DataTable className="w-full text-left text-xs" tbodyClassName="divide-y divide-line" head={
                <tr>
                  <th className="py-1 pr-2 font-medium">{t(lang, "diagnosticsColTime")}</th>
                  <th className="py-1 pr-2 font-medium">{t(lang, "diagnosticsColLevel")}</th>
                  <th className="py-1 pr-2 font-medium">{t(lang, "diagnosticsColCode")}</th>
                  <th className="py-1 font-medium">{t(lang, "diagnosticsColDetails")}</th>
                </tr>
              }>
                  {shown.map((e, i) => (
                    <tr key={`${String(e.at ?? "")}-${String(e.code ?? "")}-${i}`}>
                      <td className="py-1 pr-2 font-mono text-muted-foreground">
                        {String(e.at ?? "").slice(11, 19)}
                      </td>
                      <td className="py-1 pr-2">{String(e.level ?? "")}</td>
                      <td className="py-1 pr-2 font-medium">{String(e.code ?? "")}</td>
                      <td className="py-1 font-mono text-muted-foreground">
                        {e.fields ? JSON.stringify(e.fields) : ""}
                      </td>
                    </tr>
                  ))}
              </DataTable>
            </div>
          )}
        </>
      )}
    </div>
  );
}
