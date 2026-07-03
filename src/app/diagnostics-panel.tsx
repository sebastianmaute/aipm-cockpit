"use client";
import { useState } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { readDiagLog, clearDiagLog, buildDiagnosticBundle } from "./diagnostics";
import { EmptyState } from "./empty-state";
import { INTERACTIVE } from "./interaction-styles";
import { useToastContext } from "./toast-context";

export function DiagnosticsPanel({ lang }: { lang: Lang }) {
  const showToast = useToastContext();
  const [events, setEvents] = useState(() => readDiagLog());

  const refresh = () => setEvents(readDiagLog());
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildDiagnosticBundle());
      showToast("info", t(lang, "diagnosticsCopied"));
    } catch {
      /* clipboard blocked — no-op */
    }
  };
  const download = () => {
    const blob = new Blob([buildDiagnosticBundle()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lop-app-diagnostics.json";
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
      <div className="flex flex-wrap gap-2">
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
        <div className="min-h-0 overflow-auto pr-2">
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-line">
              {events.map((e, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2 font-mono text-muted-foreground">{e.at.slice(11, 19)}</td>
                  <td className="py-1 pr-2">{e.level}</td>
                  <td className="py-1 pr-2 font-medium">{e.code}</td>
                  <td className="py-1 font-mono text-muted-foreground">
                    {e.fields ? JSON.stringify(e.fields) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
