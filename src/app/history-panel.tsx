// src/app/history-panel.tsx
// Read-only version-history timeline (Slice 1). Compare/diff + restore land in
// later slices. Turso-gated by the parent; this component is presentational.

import { t } from "./i18n";
import type { Lang } from "./i18n";
import type { ProjectVersionMeta } from "./version-history";

interface HistoryPanelProps {
  lang: Lang;
  versions: ProjectVersionMeta[];
  busy: boolean;
  onCaptureNow: (label: string) => void;
}

export function HistoryPanel({ lang, versions, busy, onCaptureNow }: HistoryPanelProps) {
  const handleSave = () => {
    const label = window.prompt(t(lang, "historyManualLabelPrompt"));
    if (label && label.trim()) onCaptureNow(label.trim());
  };

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{t(lang, "historyTitle")}</h2>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {t(lang, "historySaveNow")}
        </button>
      </div>

      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "historyEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${v.trigger === "manual" ? "bg-AIPM-green/15 text-AIPM-green" : "bg-surface-muted text-muted-foreground"}`}>
                  {v.trigger === "manual" ? `★ ${t(lang, "historyManual")}` : t(lang, "historyAuto")}
                </span>
                <span className="text-foreground">{v.label ?? new Date(v.capturedAt).toLocaleString()}</span>
              </span>
              <span className="text-xs text-muted-foreground">{new Date(v.capturedAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
