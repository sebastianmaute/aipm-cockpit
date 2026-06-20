// src/app/history-panel.tsx
// Version-history timeline + compare (Slice 2). Selective restore lands in a
// later slice. Turso-gated by the parent; this component is presentational.
// Compare modes: per-row "compare with current", or tick two versions and
// "compare selected" (the two are ordered oldest→newest before diffing).

import { useState } from "react";
import { t } from "./i18n";
import type { Lang } from "./i18n";
import { useDisplayTimezone } from "./display-timezone-context";
import { formatDisplayTimestamp } from "./tz-display";
import type { ProjectVersionMeta } from "./version-history";
import type { VersionChange } from "./version-diff";
import { VersionDiffView } from "./version-diff-view";
import { changeKey, type RestoreSelection } from "./version-restore";

interface HistoryPanelProps {
  lang: Lang;
  versions: ProjectVersionMeta[];
  busy: boolean;
  onCaptureNow: (label: string) => void;
  loadDiff: (fromId: string, to: string | "now") => Promise<VersionChange[]>;
  restore: (versionId: string, selection: RestoreSelection, versionLabel: string) => Promise<void>;
}

export function HistoryPanel({ lang, versions, busy, onCaptureNow, loadDiff, restore }: HistoryPanelProps) {
  const { displayTz } = useDisplayTimezone();
  const [diff, setDiff] = useState<VersionChange[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  // Restore is offered ONLY on a vs-now compare; `compareFrom` is the version
  // we're comparing the current workspace against (null = two-version, view-only).
  const [selection, setSelection] = useState<RestoreSelection>({});
  const [compareFrom, setCompareFrom] = useState<{ id: string; label: string } | null>(null);
  // The version a per-row "Restore this" reverts TO. For a vs-now compare it is
  // `compareFrom`; for a two-version compare it is the OLDER of the two picks.
  // Separate from `compareFrom` because two-version compares restore per-row but
  // do NOT offer the checkbox/"Restore selected" multi-select (compareFrom-gated).
  const [restoreFrom, setRestoreFrom] = useState<{ id: string; label: string } | null>(null);
  // Two-version compare can render unified (inline) or side-by-side; the labels
  // head the two columns in the side-by-side layout.
  const [sideBySide, setSideBySide] = useState(false);
  const [compareLabels, setCompareLabels] = useState<{ left: string; right: string } | null>(null);
  // Inline manual-checkpoint naming (replaces the old prompt dialog).
  const [naming, setNaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");

  const labelOf = (v: ProjectVersionMeta) => v.label ?? formatDisplayTimestamp(v.capturedAt, displayTz, lang);

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

  const confirmSave = () => {
    const label = draftLabel.trim();
    if (label) onCaptureNow(label);
    setNaming(false);
    setDraftLabel("");
  };

  const cancelSave = () => {
    setNaming(false);
    setDraftLabel("");
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

  const compareSelected = (layout: "inline" | "sideBySide" = "inline") => {
    if (selected.length !== 2) return;
    // Order the two picks oldest→newest so the diff reads "from older → newer".
    const [a, b] = selected
      .map((id) => versions.find((v) => v.id === id))
      .filter((v): v is ProjectVersionMeta => !!v)
      .sort((x, y) => x.capturedAt.localeCompare(y.capturedAt));
    if (a && b) {
      setCompareFrom(null);
      // Per-row restore reverts to the OLDER pick (a); no multi-select here.
      setRestoreFrom({ id: a.id, label: labelOf(a) });
      setSelection({});
      setSideBySide(layout === "sideBySide");
      setCompareLabels({ left: labelOf(a), right: labelOf(b) });
      void runDiff(a.id, b.id);
    }
  };

  // "Restore this state" on a version row: revert the WHOLE workspace to that
  // version. We diff it against now and mark every change "all", reusing the
  // selective-restore machinery (no separate full-restore path needed).
  const restoreWholeVersion = async (v: ProjectVersionMeta) => {
    const changes = await loadDiff(v.id, "now");
    if (changes.length === 0) return; // already identical to current
    const sel: RestoreSelection = {};
    for (const c of changes) sel[changeKey(c.collection, c.recordId)] = "all";
    await restore(v.id, sel, labelOf(v));
  };

  // "Restore this" on a single record row — reverts that record to `restoreFrom`
  // (the vs-now source, or the older pick in a two-version compare).
  const restoreRecord = (key: string) => {
    const rf = restoreFrom;
    if (!rf) return;
    void restore(rf.id, { [key]: "all" }, rf.label).then(() => {
      setSelection({});
      setDiff(null);
      setCompareFrom(null);
      setRestoreFrom(null);
    });
  };

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{t(lang, "historyTitle")}</h2>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => compareSelected("inline")}
            disabled={selected.length !== 2 || comparing}
            title={t(lang, "historyCompareSelectedHint")}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:border-AIPM-dark-blue disabled:opacity-50"
          >
            {t(lang, "historyCompareSelected")}
          </button>
          <button
            type="button"
            onClick={() => compareSelected("sideBySide")}
            disabled={selected.length !== 2 || comparing}
            title={t(lang, "historyCompareSideBySideHint")}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:border-AIPM-dark-blue disabled:opacity-50"
          >
            {t(lang, "historyCompareSideBySide")}
          </button>
          {naming ? (
            <span className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmSave(); else if (e.key === "Escape") cancelSave(); }}
                placeholder={t(lang, "historyManualLabelPrompt")}
                className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground focus:border-AIPM-dark-blue focus:outline-none"
              />
              <button
                type="button"
                onClick={confirmSave}
                disabled={busy}
                className="rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {t(lang, "add")}
              </button>
              <button
                type="button"
                onClick={cancelSave}
                aria-label={t(lang, "cancel")}
                className="rounded-full px-1 text-muted-foreground hover:text-AIPM-pink"
              >
                ×
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setNaming(true)}
              disabled={busy}
              className="rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {t(lang, "historySaveNow")}
            </button>
          )}
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
                  aria-label={`${t(lang, "historyCompareSelect")} ${v.label ?? formatDisplayTimestamp(v.capturedAt, displayTz, lang)}`}
                  className="accent-AIPM-dark-blue"
                />
                <span className={`rounded px-1.5 py-0.5 text-xs ${v.trigger === "manual" ? "bg-AIPM-green/15 text-AIPM-dark-blue dark:text-AIPM-light-grey" : "bg-surface-muted text-muted-foreground"}`}>
                  {v.trigger === "manual" ? `★ ${t(lang, "historyManual")}` : t(lang, "historyAuto")}
                </span>
                <span className="text-foreground">{v.label ?? formatDisplayTimestamp(v.capturedAt, displayTz, lang)}</span>
                {v.summary && <span className="text-xs text-muted-foreground">{v.summary}</span>}
              </span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setSideBySide(false); setCompareLabels(null); setCompareFrom({ id: v.id, label: labelOf(v) }); setRestoreFrom({ id: v.id, label: labelOf(v) }); setSelection({}); void runDiff(v.id, "now"); }}
                  disabled={comparing}
                  title={t(lang, "historyCompareVsNowHint")}
                  className="cursor-pointer text-xs text-AIPM-dark-blue hover:underline disabled:opacity-50"
                >
                  {t(lang, "historyCompareVsNow")}
                </button>
                <button
                  type="button"
                  onClick={() => { void restoreWholeVersion(v); }}
                  disabled={busy || comparing}
                  title={t(lang, "historyRestoreStateHint")}
                  className="cursor-pointer rounded-md border border-line px-2 py-0.5 text-xs font-medium text-AIPM-dark-blue transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-light-grey"
                >
                  {t(lang, "historyRestoreState")}
                </button>
                <span className="text-xs text-muted-foreground">{formatDisplayTimestamp(v.capturedAt, displayTz, lang)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {diff !== null && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">{t(lang, "historyCompareTitle")}</h3>
            <span className="flex items-center gap-2">
              {/* "Restore selected" sits up here beside the per-row "Restore this"
                  buttons (vs-now compare only — it acts on the ticked records). */}
              {compareFrom !== null && (
                <button
                  type="button"
                  disabled={Object.keys(selection).length === 0}
                  onClick={() => { const cf = compareFrom; if (cf) void restore(cf.id, selection, cf.label).then(() => { setSelection({}); setDiff(null); setCompareFrom(null); setRestoreFrom(null); }); }}
                  title={t(lang, "historyRestoreSelectedHint")}
                  className="rounded-md bg-AIPM-dark-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {t(lang, "historyRestoreSelected")}
                </button>
              )}
              <button
                type="button"
                onClick={() => { setDiff(null); setSelected([]); setSelection({}); setCompareFrom(null); setRestoreFrom(null); setSideBySide(false); setCompareLabels(null); }}
                aria-label={t(lang, "alertModalClose")}
                className="cursor-pointer rounded-full px-1 text-muted-foreground hover:text-AIPM-pink"
              >
                ×
              </button>
            </span>
          </div>
          <VersionDiffView
            lang={lang}
            changes={diff}
            selectable={compareFrom !== null}
            selection={selection}
            onToggleRecord={toggleRecord}
            onToggleField={toggleField}
            onRestoreRecord={restoreFrom !== null ? restoreRecord : undefined}
            layout={sideBySide ? "sideBySide" : "inline"}
            leftLabel={sideBySide ? compareLabels?.left : undefined}
            rightLabel={sideBySide ? compareLabels?.right : undefined}
          />
        </div>
      )}
    </div>
  );
}
