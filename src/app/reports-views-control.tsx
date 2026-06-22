"use client";

import { useState } from "react";

import { type Lang, t } from "./i18n";
import { useReportsViews } from "./use-reports-views";
import { type ReportsSavedView, type ReportsViewState } from "./reports-views";

interface ReportsViewsControlProps {
  lang: Lang;
  currentState: ReportsViewState;
  onApply: (state: ReportsViewState) => void;
}

const INPUT_CLASS =
  "rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground focus:ring-AIPM-green";
const BTN_CLASS =
  "rounded-md border border-line bg-surface px-2 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-50";

export function ReportsViewsControl({ lang, currentState, onApply }: ReportsViewsControlProps) {
  const { views, addView, removeView } = useReportsViews();

  const [selectedId, setSelectedId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  const selectionValid = selectedId !== "" && views.some((v) => v.id === selectedId);
  const selectValue = selectionValid ? String(selectedId) : "";

  function applyView(v: ReportsSavedView) {
    onApply(v.state);
  }

  return (
    <div className="inline-flex items-center gap-1">
      <select
        aria-label={t(lang, "savedViewsApply")}
        value={selectValue}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            setSelectedId("");
            return;
          }
          const id = Number(raw);
          setSelectedId(id);
          const v = views.find((x) => x.id === id);
          if (v) applyView(v);
        }}
        className={INPUT_CLASS}
      >
        <option value="">{t(lang, "savedViewsPlaceholder")}</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>

      {saving ? (
        <>
          <input
            aria-label={t(lang, "savedViewsName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS}
          />
          <button
            type="button"
            disabled={name.trim() === ""}
            onClick={() => {
              const n = name.trim();
              if (n) addView(n, currentState);
              setSaving(false);
              setName("");
            }}
            className={BTN_CLASS}
          >
            {t(lang, "savedViewsSaveConfirm")}
          </button>
          <button
            type="button"
            onClick={() => {
              setSaving(false);
              setName("");
            }}
            className={BTN_CLASS}
          >
            {t(lang, "savedViewsCancel")}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            setSaving(true);
            setName("");
          }}
          className={BTN_CLASS}
        >
          {t(lang, "savedViewsSave")}
        </button>
      )}

      <button
        type="button"
        aria-label={t(lang, "savedViewsDelete")}
        title={t(lang, "savedViewsDelete")}
        disabled={!selectionValid}
        onClick={() => {
          if (selectionValid) {
            removeView(Number(selectedId));
            setSelectedId("");
          }
        }}
        className={BTN_CLASS}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
