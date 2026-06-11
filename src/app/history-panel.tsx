// src/app/history-panel.tsx
// Version-history timeline + compare (Slice 2). Selective restore lands in a
// later slice. Turso-gated by the parent; this component is presentational.
// Compare modes: per-row "compare with current", or tick two versions and
// "compare selected" (the two are ordered oldest→newest before diffing).

import { useState } from "react";
import { t } from "./i18n";
import type { Lang } from "./i18n";
import type { ProjectVersionMeta } from "./version-history";
import type { VersionChange } from "./version-diff";
import { VersionDiffView } from "./version-diff-view";
import type { RestoreSelection } from "./version-restore";

interface HistoryPanelProps {
  lang: Lang;
  versions: ProjectVersionMeta[];
  busy: boolean;
  onCaptureNow: (label: string) => void;
  loadDiff: (fromId: string, to: string | "now") => Promise<VersionChange[]>;
  restore: (versionId: string, selection: RestoreSelection, versionLabel: string) => Promise<void>;
}

export function HistoryPanel({ lang, versions, busy, onCaptureNow, loadDiff, restore }: HistoryPanelProps) {
  const [diff, setDiff] = useState<VersionChange[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  // Restore is offered ONLY on a vs-now compare; `compareFrom` is the version
  // we're comparing the current workspace against (null = two-version, view-only).
  const [selection, setSelection] = useState<RestoreSelection>({});
  const [compareFrom, setCompareFrom] = useState<{ id: string; label: string } | null>(null);

  const toggleRecord = (key: string) =>
    setSelection((s) => { const n = { ...s }; if (n[key] !== undefined) delete n[key]; else n[key] = "all"; return n; });
  const toggleField = (key: string, field: string) =>
    setSelection((s) => {
      const cur = s[key];
      const fields = cur === "all" ? [] : Array.isArray(cur) ? [...cur] : [];
      const next = fields.includes(field) ? fields.filter((f) => f !== field) : [...fields, field];
      const n = { ...s };
      if (next.length === 0) delete n[key]; else n[key] = next;
      return n;
    });

  const handleSave = () => {
    const label = window.prompt(t(lang, "historyManualLabelPrompt"));
    if (label && label.trim()) onCaptureNow(label.trim());
  };

  const runDiff = async (fromId: string, to: string | "now") => {
    setComparing(true);
    try { setDiff(await loadDiff(fromId, to)); } finally { setComparing(false); }
  };

  // Tick up to two versions; a third selection drops the oldest pick.
  const toggleSelect = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2),
    );

  const compareSelected = () => {
    if (selected.length !== 2) return;
    // Order the two picks oldest→newest so the diff reads "from older → newer".
    const [a, b] = selected
      .map((id) => versions.find((v) => v.id === id))
      .filter((v): v is ProjectVersionMeta => !!v)
      .sort((x, y) => x.capturedAt.localeCompare(y.capturedAt));
    if (a && b) { setCompareFrom(null); setSelection({}); void runDiff(a.id, b.id); }
  };

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{t(lang, "historyTitle")}</h2>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={compareSelected}
            disabled={selected.length !== 2 || comparing}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:border-AIPM-dark-blue disabled:opacity-50"
          >
            {t(lang, "historyCompareSelected")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {t(lang, "historySaveNow")}
          </button>
        </span>
      </div>

      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "historyEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.includes(v.id)}
                  onChange={() => toggleSelect(v.id)}
                  aria-label={`${t(lang, "historyCompareSelect")} ${v.label ?? new Date(v.capturedAt).toLocaleString()}`}
                  className="accent-AIPM-dark-blue"
                />
                <span className={`rounded px-1.5 py-0.5 text-xs ${v.trigger === "manual" ? "bg-AIPM-green/15 text-AIPM-green" : "bg-surface-muted text-muted-foreground"}`}>
                  {v.trigger === "manual" ? `★ ${t(lang, "historyManual")}` : t(lang, "historyAuto")}
                </span>
                <span className="text-foreground">{v.label ?? new Date(v.capturedAt).toLocaleString()}</span>
                {v.summary && <span className="text-xs text-muted-foreground">{v.summary}</span>}
              </span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setCompareFrom({ id: v.id, label: v.label ?? new Date(v.capturedAt).toLocaleString() }); setSelection({}); void runDiff(v.id, "now"); }}
                  disabled={comparing}
                  className="text-xs text-AIPM-dark-blue hover:underline disabled:opacity-50"
                >
                  {t(lang, "historyCompareVsNow")}
                </button>
                <span className="text-xs text-muted-foreground">{new Date(v.capturedAt).toLocaleString()}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {diff !== null && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">{t(lang, "historyCompareTitle")}</h3>
            <button
              type="button"
              onClick={() => { setDiff(null); setSelected([]); setSelection({}); setCompareFrom(null); }}
              aria-label={t(lang, "alertModalClose")}
              className="rounded-full px-1 text-muted-foreground hover:text-AIPM-pink"
            >
              ×
            </button>
          </div>
          <VersionDiffView
            lang={lang}
            changes={diff}
            selectable={compareFrom !== null}
            selection={selection}
            onToggleRecord={toggleRecord}
            onToggleField={toggleField}
          />
          {compareFrom !== null && (
            <button
              type="button"
              disabled={Object.keys(selection).length === 0}
              onClick={() => { const cf = compareFrom; if (cf) void restore(cf.id, selection, cf.label).then(() => { setSelection({}); setDiff(null); setCompareFrom(null); }); }}
              className="mt-2 rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {t(lang, "historyRestoreSelected")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
